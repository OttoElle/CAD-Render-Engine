import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createMaterial } from './materials.js';
import { buildEnvironmentTexture, getLightPreset, keyLightDirection } from './environment.js';

const SELECT_EMISSIVE = new THREE.Color(0x1f5fbf);
const BLACK = new THREE.Color(0x000000);

// View directions in CAD coordinates (Z up), pointing from the model to the camera.
const BACKGROUNDS = {
  dark: 0x16181c,
  grey: 0xc9ccd1,
  white: 0xffffff,
};

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
    this.scene.background = new THREE.Color(BACKGROUNDS.dark);

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
      background: 'dark',
    };

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
    this.camera.position.set(1, 1, 1);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => {
      this.requestRender();
      this.onViewChange?.();
    });

    // CAD models are Z-up, three.js and HDRI lighting are Y-up.
    this.modelRoot = new THREE.Group();
    this.modelRoot.rotation.x = -Math.PI / 2;
    this.scene.add(this.modelRoot);

    this.parts = [];
    this.highlighted = new Set();
    this.edgesVisible = true;
    /** Called with the part id (or null) when the user clicks in the viewport. */
    this.onPartClick = null;
    /** Aspect ratio of the final image, or null if it follows the viewport. */
    this.outputAspect = null;
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
    if (!(this.bounds.radius > 0)) this.bounds.radius = 1;
    this._groundY = box.min.y;
    this._updateShadowSetup();

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
    const frame = this.getOutputFrame(this.outputAspect ?? this.camera.aspect);
    const vFov = THREE.MathUtils.degToRad(frame.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (frame.width / frame.height));
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;
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
    if (Math.abs(direction.y) > 0.9999) {
      direction.set(0, Math.sign(direction.y), 0.0005).normalize();
    }

    const apply = (dir, dist, tgt) => {
      this.controls.target.copy(tgt);
      this.camera.position.copy(tgt).addScaledVector(dir, dist);
      this._updateClipPlanes();
      this.controls.update();
      this.requestRender();
      this.onViewChange?.();
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

  /** Changes any subset of the lighting settings (preset, rotation, intensity, ground, background). */
  setLighting(changes) {
    const presetChanged = 'presetId' in changes && changes.presetId !== this.lighting.presetId;
    Object.assign(this.lighting, changes);
    const preset = getLightPreset(this.lighting.presetId);

    if (presetChanged || !this.environmentTexture) {
      this.environmentTexture?.dispose();
      this._envTarget?.dispose();
      this.environmentTexture = buildEnvironmentTexture(preset);
      this._envTarget = this._pmrem.fromEquirectangular(this.environmentTexture);
      this.scene.environment = this._envTarget.texture;
    }

    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(this.lighting.rotation);
    this.scene.environmentIntensity = this.lighting.intensity;
    // Either a named background or a custom colour such as "#dfe6ee".
    this.scene.background.set(BACKGROUNDS[this.lighting.background] ?? this.lighting.background);
    this._updateShadowSetup();
    this.requestRender();
  }

  _updateShadowSetup() {
    const preset = getLightPreset(this.lighting.presetId);
    const { center, radius } = this.bounds;
    const hasModel = this.parts.length > 0;

    this.ground.visible = hasModel && this.lighting.ground;
    this.shadowLight.visible = this.ground.visible;
    if (!hasModel) return;

    const direction = keyLightDirection(preset).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      THREE.MathUtils.degToRad(this.lighting.rotation),
    );
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
    this.shadowLight.shadow.radius = preset.shadow.radius;
    this.shadowLight.shadow.bias = -0.0005;

    this.ground.material.opacity = preset.shadow.opacity;
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
    };
  }

  applyViewState(view) {
    this.camera.position.fromArray(view.position);
    this.controls.target.fromArray(view.target);
    this.camera.fov = view.fov;
    this._updateClipPlanes();
    this.controls.update();
    this.requestRender();
    this.onViewChange?.();
  }

  setFov(fov) {
    // Dolly so the model keeps its apparent size while the perspective changes.
    const offset = this.camera.position.clone().sub(this.controls.target);
    const scale = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    this.camera.position.copy(this.controls.target).addScaledVector(offset, scale);
    this.camera.fov = fov;
    this._updateClipPlanes();
    this.controls.update();
    this.requestRender();
    this.onViewChange?.();
  }

  _updateClipPlanes() {
    const distance = this.camera.position.distanceTo(this.bounds.center);
    const radius = this.bounds.radius;
    this.camera.near = Math.max((distance - radius * 2) / 10, radius / 1000);
    this.camera.far = distance + radius * 80;
    this.camera.updateProjectionMatrix();
  }

  /**
   * The largest rectangle with the given aspect ratio that fits the viewport.
   * The final rendering shows exactly this region; `fov` is the vertical field
   * of view a camera with that aspect ratio needs to do so.
   */
  getOutputFrame(aspect) {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const viewAspect = width / height;
    let w = width;
    let h = height;
    if (aspect > viewAspect) h = width / aspect;
    else w = height * aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * (h / height);
    return {
      x: (width - w) / 2,
      y: (height - h) / 2,
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
    this.camera.updateMatrixWorld();
    this._raycaster.setFromCamera(pointer, this.camera);
    const visible = this.parts.filter((p) => p.mesh.visible).map((p) => p.mesh);
    const hit = this._raycaster.intersectObjects(visible, false)[0];
    this.onPartClick?.(hit ? hit.object.userData.partId : null);
  }

  _resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
    this.onViewChange?.();
  }

  _tick() {
    if (this._animation) this._animation();
    // With damping enabled, update() keeps firing 'change' until the motion settles.
    else this.controls.update();
    if (!this._needsRender) return;
    this._needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }
}
