import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createMaterial } from './materials.js';
import { buildEnvironmentTexture, getLightPreset, keyLightDirection, CUSTOM_SHADOW } from './environment.js';

const SELECT_EMISSIVE = new THREE.Color(0x1f5fbf);
const BLACK = new THREE.Color(0x000000);

const BACKGROUNDS = {
  light: 0xeef0f3,
  dark: 0x16181c,
  grey: 0xc9ccd1,
  white: 0xffffff,
};

// Sensor height in millimetres used to express the field of view as a focal length (full frame).
const SENSOR_HEIGHT = 24;

export const fovToFocalLength = (fov) => SENSOR_HEIGHT / 2 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
export const focalLengthToFov = (focalLength) =>
  THREE.MathUtils.radToDeg(2 * Math.atan(SENSOR_HEIGHT / 2 / focalLength));

/** Below this field of view the camera counts as a parallel projection. */
const PARALLEL_FOV = 1;

// View directions in CAD coordinates (Z up), pointing from the model to the camera.
const VIEW_DIRECTIONS = {
  iso: [1, -1, 0.8],
  front: [0, -1, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
};

/**
 * Real-time viewport used to position the model and camera.
 * Renders only when something changed, so an idle app costs no GPU time.
 */
export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Neutral tone mapping keeps material colours true, which matters for product shots.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this._backgroundColor = new THREE.Color(BACKGROUNDS.light);
    this.scene.background = this._backgroundColor;

    this._pmrem = new THREE.PMREMGenerator(this.renderer);
    this._envTarget = null;
    /** Equirectangular HDR texture of the current lighting, reused by the path tracer. */
    this.environmentTexture = null;

    // Only used to cast the ground shadow; the image-based lighting does the shading.
    this.shadowLight = new THREE.DirectionalLight(0xffffff, 0.001);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(2048, 2048);
    this.shadowLight.shadow.blurSamples = 16;
    this.scene.add(this.shadowLight, this.shadowLight.target);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.3, depthWrite: false }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.ground.raycast = () => {};
    this.scene.add(this.ground);

    this.lighting = {
      presetId: 'studio-soft',
      rotation: 0,
      intensity: 1,
      ground: true,
      background: 'light',
    };

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
    this.camera.position.set(1, 1, 1);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    // Only flags here: the roll is re-applied in _syncCamera before anyone looks at the camera.
    this.controls.addEventListener('change', () => {
      this._needsRender = true;
      this._viewChanged = true;
    });

    /** Camera roll around the viewing axis in radians. Orbit controls always level the camera, so it is re-applied after each update. */
    this.roll = 0;
    /** Width in pixels on the left that floating UI covers; the view is centred in the rest. */
    this.inset = 0;
    this._insetTarget = 0;
    this._viewChanged = false;
    this._perspectiveFov = 35;

    // CAD models are Z-up, three.js and HDRI lighting are Y-up.
    this.modelRoot = new THREE.Group();
    this.modelRoot.rotation.x = -Math.PI / 2;
    this.scene.add(this.modelRoot);

    this.parts = [];
    this.highlighted = new Set();
    this.edgesVisible = true;
    /** Called with the part id (or null) and the hit point when the user clicks in the viewport. */
    this.onPartClick = null;
    /** Aspect ratio of the final image, or null if it follows the viewport. */
    this.outputAspect = null;
    /** Space in pixels kept around the output frame, so its border does not touch the window edge. */
    this.outputMargin = 0;
    /** Called whenever the camera or the viewport size changes. */
    this.onViewChange = null;
    this.bounds = new THREE.Sphere(new THREE.Vector3(), 1);

    this._needsRender = true;
    this._raycaster = new THREE.Raycaster();
    this._pointerDown = null;

    canvas.addEventListener('pointerdown', (e) => {
      this._pointerDown = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => this._handleClick(e));

    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    this._resize();
    this.setLighting({});
    this.renderer.setAnimationLoop(() => this._tick());
  }

  requestRender() {
    this._needsRender = true;
  }

  /** Runs the orbit controls and re-applies the roll they remove. */
  _syncCamera() {
    this.controls.update();
    if (this.roll) this.camera.rotateZ(this.roll);
  }

  _notifyView() {
    this._needsRender = true;
    this._viewChanged = false;
    this.onViewChange?.();
  }

  /** Reserves space on the left for floating UI. The view glides over to the new centre. */
  setInset(pixels, immediate = false) {
    this._insetTarget = Math.max(pixels, 0);
    if (immediate) {
      this.inset = this._insetTarget;
      this._applyViewOffset();
      this._notifyView();
    }
  }

  _applyViewOffset() {
    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);
    // Shifts the image so that the optical centre sits in the middle of the free area.
    if (this.inset > 0.5) this.camera.setViewOffset(width, height, -this.inset / 2, 0, width, height);
    else this.camera.clearViewOffset();
  }

  /** The part of the viewport that is not covered by floating UI. */
  getFreeRegion() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const inset = Math.min(this.inset, width * 0.7);
    return { x: inset, y: 0, width: Math.max(width - inset, 1), height: Math.max(height, 1) };
  }

  setParts(parts) {
    for (const part of this.parts) {
      this.modelRoot.remove(part.mesh);
      part.mesh.geometry.dispose();
      part.mesh.material.dispose();
      if (part.edges) {
        part.edges.geometry.dispose();
        part.edges.material.dispose();
      }
    }

    this.parts = parts;
    this.highlighted = new Set();

    for (const part of parts) {
      part.mesh.userData.partId = part.id;
      part.mesh.castShadow = true;
      // Prefer the real CAD edges from the importer; fall back to crease detection.
      let edgeGeometry;
      if (part.edgePositions) {
        edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute('position', new THREE.BufferAttribute(part.edgePositions, 3));
      } else {
        edgeGeometry = new THREE.EdgesGeometry(part.mesh.geometry, 30);
      }
      const edges = new THREE.LineSegments(
        edgeGeometry,
        new THREE.LineBasicMaterial({ color: 0x0c0d10, transparent: true, opacity: 0.5 }),
      );
      edges.raycast = () => {};
      edges.visible = this.edgesVisible;
      part.mesh.add(edges);
      part.edges = edges;
      this.modelRoot.add(part.mesh);
    }

    this.modelRoot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    box.getBoundingSphere(this.bounds);
    if (!(this.bounds.radius > 0)) this.bounds.set(new THREE.Vector3(), 1);
    this._groundY = Number.isFinite(box.min.y) ? box.min.y : 0;
    this._updateShadowSetup();

    this.roll = 0;
    this.setView('iso');
  }

  /** Looks at the model from a named direction and fits it into the viewport. */
  setView(name) {
    const dir = VIEW_DIRECTIONS[name] || VIEW_DIRECTIONS.iso;
    // Convert the CAD (Z-up) direction to world (Y-up) space.
    this._frame(new THREE.Vector3(dir[0], dir[2], -dir[1]).normalize());
  }

  /** Fits the model into the viewport while keeping the current viewing direction. */
  fit() {
    this._frame(this.camera.position.clone().sub(this.controls.target).normalize());
  }

  _frame(direction) {
    const { center, radius } = this.bounds;
    // Fit into the output frame, which is what the final image shows.
    const region = this.getFreeRegion();
    const frame = this.getOutputFrame(this.outputAspect ?? region.width / region.height);
    const vFov = THREE.MathUtils.degToRad(frame.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (frame.width / frame.height));
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.08;
    this._moveCamera(center, direction, distance, false);
  }

  /**
   * Turns the camera to look at the model from the given world direction,
   * keeping the current pivot and zoom. Used by the view cube.
   */
  lookFrom(direction) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    this._moveCamera(this.controls.target.clone(), direction.clone().normalize(), offset.length(), true);
  }

  /** Orbits by the given angles in degrees (positive azimuth turns the camera to the right). */
  orbitBy(azimuth, elevation) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += THREE.MathUtils.degToRad(azimuth);
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - THREE.MathUtils.degToRad(elevation), 0.001, Math.PI - 0.001);
    const direction = new THREE.Vector3().setFromSpherical(spherical).normalize();
    this._moveCamera(this.controls.target.clone(), direction, offset.length(), true);
  }

  _moveCamera(target, direction, distance, animate) {
    // Looking straight along the up axis is degenerate for orbit controls; nudge it.
    if (Math.hypot(direction.x, direction.z) < 0.0005) {
      direction.set(0, Math.sign(direction.y), 0.0005).normalize();
    }

    const apply = (dir, dist, tgt) => {
      this.controls.target.copy(tgt);
      this.camera.position.copy(tgt).addScaledVector(dir, dist);
      this._updateClipPlanes();
      this._syncCamera();
      this._notifyView();
    };

    this._animation = null;
    if (!animate) {
      apply(direction, distance, target);
      return;
    }

    const startOffset = this.camera.position.clone().sub(this.controls.target);
    const startDir = startOffset.clone().normalize();
    const startDist = startOffset.length();
    const startTarget = this.controls.target.clone();
    const rotation = new THREE.Quaternion().setFromUnitVectors(startDir, direction);
    const identity = new THREE.Quaternion();
    const started = performance.now();
    const duration = 220;

    this._animation = () => {
      const t = Math.min((performance.now() - started) / duration, 1);
      const eased = t * t * (3 - 2 * t);
      const q = identity.clone().slerp(rotation, eased);
      apply(
        startDir.clone().applyQuaternion(q).normalize(),
        THREE.MathUtils.lerp(startDist, distance, eased),
        startTarget.clone().lerp(target, eased),
      );
      if (t >= 1) this._animation = null;
    };
  }

  /**
   * Sets or clears the user-supplied HDRI. It is used while the lighting
   * preset is 'custom'. The viewer takes ownership of the texture.
   */
  setCustomEnvironment(texture) {
    if (this._customEnvironment && this._customEnvironment !== texture) this._customEnvironment.dispose();
    this._customEnvironment = texture;
    this._environmentKey = null;
  }

  /** True while the HDRI itself is shown as the background. */
  get showsEnvironmentBackground() {
    return this.lighting.background === 'environment';
  }

  /** Changes any subset of the lighting settings (preset, rotation, intensity, ground, background). */
  setLighting(changes) {
    Object.assign(this.lighting, changes);
    const custom = this.lighting.presetId === 'custom' && this._customEnvironment;
    const preset = getLightPreset(this.lighting.presetId);
    const key = custom ? this._customEnvironment.uuid : preset.id;

    if (key !== this._environmentKey) {
      this._environmentKey = key;
      // Procedural textures are rebuilt on demand; a custom HDRI is kept for reuse.
      if (this.environmentTexture && this.environmentTexture !== this._customEnvironment) {
        this.environmentTexture.dispose();
      }
      this._envTarget?.dispose();
      this.environmentTexture = custom ? this._customEnvironment : buildEnvironmentTexture(preset);
      this._envTarget = this._pmrem.fromEquirectangular(this.environmentTexture);
      this.scene.environment = this._envTarget.texture;
      this._keyDirection = custom ? this._customEnvironment.userData.keyDirection.clone() : keyLightDirection(preset);
      this._shadowSettings = custom ? CUSTOM_SHADOW : preset.shadow;
    }

    const rotation = THREE.MathUtils.degToRad(this.lighting.rotation);
    this.scene.environmentRotation.y = rotation;
    this.scene.environmentIntensity = this.lighting.intensity;

    if (this.showsEnvironmentBackground) {
      this.scene.background = this.environmentTexture;
      this.scene.backgroundRotation.y = rotation;
      this.scene.backgroundIntensity = this.lighting.intensity;
    } else {
      // Either a named background or a custom colour such as "#dfe6ee".
      this._backgroundColor.set(BACKGROUNDS[this.lighting.background] ?? this.lighting.background);
      this.scene.background = this._backgroundColor;
      this.scene.backgroundIntensity = 1;
    }
    this._updateShadowSetup();
    this.requestRender();
  }

  /** Background as a plain colour, also while an HDRI is shown instead. */
  get backgroundColor() {
    return this._backgroundColor;
  }

  _updateShadowSetup() {
    const { center, radius } = this.bounds;
    const hasModel = this.parts.length > 0;

    // An HDRI background brings its own ground, so the shadow plane would float in it.
    this.ground.visible = hasModel && this.lighting.ground && !this.showsEnvironmentBackground;
    this.shadowLight.visible = this.ground.visible;
    if (!hasModel || !this._keyDirection) return;

    const direction = this._keyDirection
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(this.lighting.rotation));
    this.shadowLight.target.position.copy(center);
    this.shadowLight.position.copy(center).addScaledVector(direction, radius * 4);

    // The shadow can fall far to the side when the key light is low.
    const extent = radius * 3;
    const camera = this.shadowLight.shadow.camera;
    camera.left = -extent;
    camera.right = extent;
    camera.top = extent;
    camera.bottom = -extent;
    camera.near = radius * 0.5;
    camera.far = radius * 12;
    camera.updateProjectionMatrix();
    this.shadowLight.shadow.radius = this._shadowSettings.radius;
    this.shadowLight.shadow.bias = -0.0005;

    this.ground.material.opacity = this._shadowSettings.opacity;
    this.ground.scale.setScalar(radius * 12);
    this.ground.position.set(center.x, this._groundY ?? center.y - radius, center.z);
  }

  /** Rebuilds the three.js material of a part after its materialId or colour changed. */
  updatePartMaterial(id) {
    const part = this.parts[id];
    if (!part) return;
    part.mesh.material.dispose();
    part.mesh.material = createMaterial(part);
    if (this.highlighted.has(id)) part.mesh.material.emissive.copy(SELECT_EMISSIVE);
    this.requestRender();
  }

  setEdgesVisible(visible) {
    this.edgesVisible = visible;
    for (const part of this.parts) part.edges.visible = visible;
    this.requestRender();
  }

  setPartVisible(id, visible) {
    const part = this.parts[id];
    if (!part) return;
    part.mesh.visible = visible;
    this.requestRender();
  }

  /** Tints the given parts so the user can see which ones an entry refers to. */
  setHighlight(ids) {
    this.highlighted = new Set(ids);
    for (const part of this.parts) {
      part.mesh.material.emissive.copy(this.highlighted.has(part.id) ? SELECT_EMISSIVE : BLACK);
    }
    this.requestRender();
  }

  getViewState() {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      fov: this.camera.fov,
      roll: this.roll,
    };
  }

  applyViewState(view) {
    this._animation = null;
    this.camera.position.fromArray(view.position);
    this.controls.target.fromArray(view.target);
    this.camera.fov = view.fov;
    this.roll = view.roll || 0;
    this._updateClipPlanes();
    this._syncCamera();
    this._notifyView();
  }

  setFov(fov) {
    // Dolly so the model keeps its apparent size while the perspective changes.
    const offset = this.camera.position.clone().sub(this.controls.target);
    const scale = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    this.camera.position.copy(this.controls.target).addScaledVector(offset, scale);
    this.camera.fov = fov;
    this._updateClipPlanes();
    this._syncCamera();
    this._notifyView();
  }

  get focalLength() {
    return fovToFocalLength(this.camera.fov);
  }

  setFocalLength(focalLength) {
    this.setFov(focalLengthToFov(focalLength));
  }

  /** A parallel projection is approximated by a very long lens far away from the model. */
  get parallel() {
    return this.camera.fov <= PARALLEL_FOV * 1.5;
  }

  setParallel(parallel) {
    if (parallel === this.parallel) return;
    if (parallel) {
      this._perspectiveFov = this.camera.fov;
      this.setFov(PARALLEL_FOV);
    } else {
      this.setFov(this._perspectiveFov);
    }
  }

  /** Rolls the camera around its viewing axis by the given angle in degrees. */
  rollBy(degrees) {
    this.setPose({ roll: THREE.MathUtils.radToDeg(this.roll) + degrees });
  }

  /** Back to the levelled standard view with the model fitted. */
  home() {
    this.roll = 0;
    this.setView('iso');
  }

  /**
   * The camera as numbers: `azimuth` (0° = front, 90° = right) and `elevation`
   * in degrees around the pivot, `roll` in degrees, `distance` in model units
   * and the pivot `target` in CAD coordinates (Z up).
   */
  getPose() {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = offset.length();
    const target = this.controls.target;
    return {
      azimuth: THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z)),
      elevation: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(offset.y / distance, -1, 1))),
      roll: THREE.MathUtils.radToDeg(this.roll),
      distance,
      target: [target.x, -target.z, target.y],
    };
  }

  /** Changes any subset of the values returned by getPose(). */
  setPose(changes) {
    const pose = { ...this.getPose(), ...changes };
    const azimuth = THREE.MathUtils.degToRad(pose.azimuth);
    const elevation = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pose.elevation, -89.95, 89.95));
    const direction = new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth),
    );
    // Keep the roll within -180° to 180°.
    this.roll = THREE.MathUtils.degToRad(THREE.MathUtils.euclideanModulo(pose.roll + 180, 360) - 180);
    const [x, y, z] = pose.target;
    this._moveCamera(new THREE.Vector3(x, z, -y), direction, Math.max(pose.distance, 1e-3), false);
  }

  /** Distance of a world point from the camera, measured along the viewing axis. */
  depthOf(point) {
    this.camera.updateMatrixWorld();
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    return point.clone().sub(this.camera.position).dot(forward);
  }

  _updateClipPlanes() {
    const distance = this.camera.position.distanceTo(this.bounds.center);
    const radius = this.bounds.radius;
    this.camera.near = Math.max((distance - radius * 2) / 10, radius / 1000);
    this.camera.far = distance + radius * 80;
    this.camera.updateProjectionMatrix();
  }

  /**
   * The largest rectangle with the given aspect ratio that fits the free part
   * of the viewport. The final rendering shows exactly this region; `fov` is
   * the vertical field of view a camera with that aspect ratio needs to do so.
   */
  getOutputFrame(aspect) {
    const region = this.getFreeRegion();
    const { width, height } = region;
    const availableWidth = Math.max(width - 2 * this.outputMargin, 1);
    const availableHeight = Math.max(height - 2 * this.outputMargin, 1);
    let w = availableWidth;
    let h = availableHeight;
    if (aspect > availableWidth / availableHeight) h = availableWidth / aspect;
    else w = availableHeight * aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * (h / this.canvas.clientHeight);
    return {
      x: region.x + (width - w) / 2,
      y: region.y + (height - h) / 2,
      width: w,
      height: h,
      fov: THREE.MathUtils.radToDeg(2 * Math.atan(tanHalf)),
    };
  }

  _handleClick(event) {
    const down = this._pointerDown;
    this._pointerDown = null;
    // Ignore drags: only a click without movement selects a part.
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    if (event.button !== 0 || this.parts.length === 0) return;

    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._syncCamera();
    this.camera.updateMatrixWorld();
    this._raycaster.setFromCamera(pointer, this.camera);
    const visible = this.parts.filter((p) => p.mesh.visible).map((p) => p.mesh);
    const hit = this._raycaster.intersectObjects(visible, false)[0];
    this.onPartClick?.(hit ? hit.object.userData.partId : null, hit ? hit.point.clone() : null);
  }

  _resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this._applyViewOffset();
    this._notifyView();
  }

  _tick() {
    if (this._animation) this._animation();
    // With damping enabled, update() keeps firing 'change' until the motion settles.
    else this._syncCamera();

    if (this.inset !== this._insetTarget) {
      const delta = this._insetTarget - this.inset;
      this.inset = Math.abs(delta) < 1 ? this._insetTarget : this.inset + delta * 0.3;
      this._applyViewOffset();
      this._viewChanged = true;
      this._needsRender = true;
    }
    if (this._viewChanged) {
      this._viewChanged = false;
      this.onViewChange?.();
    }
    if (!this._needsRender) return;
    this._needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }
}
