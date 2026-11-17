import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createMaterial, finishFrame, applyFinishTangents } from './materials.js';
import { buildEnvironmentTexture, getLightPreset, CUSTOM_SHADOW } from './environment.js';
import { buildCap } from './section.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { buildCoveGeometry, placeCove, gradientCss, floorMaterialParams, coveAlbedo, REFLECTION_F90_SCALE } from './backdrop.js';

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

/**
 * Blends the mirror image into the floor by the Fresnel term of a surface with
 * the given reflectance: faint from above, stronger at grazing angles.
 */
const FLOOR_REFLECTION_SHADER = {
  name: 'FloorReflectionShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    strength: { value: 0 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vec4 mirrored = texture2DProj(tDiffuse, vUv);
      float cosTheta = clamp(abs(normalize(cameraPosition - vWorld).y), 0.0, 1.0);
      float f90 = min(1.0, strength * ${REFLECTION_F90_SCALE.toFixed(2)});
      float fresnel = strength + (f90 - strength) * pow(1.0 - cosTheta, 5.0);
      gl_FragColor = vec4(mirrored.rgb, mirrored.a * clamp(fresnel, 0.0, 1.0));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

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
    // Transparent where a colour gradient behind the canvas shows through.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Neutral tone mapping keeps material colours true, which matters for product shots.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Section cuts clip the parts at planes set per material.
    this.renderer.localClippingEnabled = true;

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

    // Mirror image of the model in a reflective floor, blended in by the Fresnel term.
    this.reflector = null;

    // Studio cove behind the model; it turns with the camera so it always fills the background.
    this.cove = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhysicalMaterial({ roughness: 0.9 }));
    this.cove.receiveShadow = true;
    this.cove.visible = false;
    this.cove.raycast = () => {};
    this.scene.add(this.cove);

    this.lighting = {
      presetId: 'studio-soft',
      rotation: 0,
      intensity: 1,
      floor: 'shadow',
      background: 'light',
      gradient: null,
      coveColor: '#e4e6ea',
      reflection: 0,
      reflectionBlur: 0.1,
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
    /** Active section cuts: { plane (THREE.Plane in CAD coordinates), uncut (Set of part ids left whole) }. */
    this.sections = [];
    /** How cut faces look: `mode` 'material' (like the part) or 'color'. */
    this.capStyle = { mode: 'material', color: '#d9534f' };
    /** Bounding box of the model in CAD coordinates. */
    this.modelBox = new THREE.Box3();
    this._capsDirty = false;
    this._capsChangedAt = 0;
    this._capsCost = 0;

    // Outline and faint fill of the section plane that is being edited.
    this._sectionHelper = new THREE.Group();
    this._sectionHelper.visible = false;
    const helperOutline = new THREE.LineLoop(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)),
      new THREE.LineBasicMaterial({ color: 0x2563eb }),
    );
    const helperFill = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)),
      new THREE.MeshBasicMaterial({
        color: 0x2563eb,
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    helperFill.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    helperOutline.raycast = () => {};
    helperFill.raycast = () => {};
    helperOutline.frustumCulled = false;
    helperFill.frustumCulled = false;
    this._sectionHelper.add(helperFill, helperOutline);
    this.modelRoot.add(this._sectionHelper);
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
    this._placeCove();
    this.onViewChange?.();
  }

  _placeCove() {
    if (this.cove.visible) placeCove(this.cove, this.camera, this.controls.target, this.bounds.center, this._groundY ?? 0);
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
      this._disposeCaps(part);
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

    this.sections = [];
    this._sectionHelper.visible = false;
    this.modelBox.makeEmpty();
    for (const part of parts) {
      part.caps = [];
      part.worldPlanes = [];
      if (!part.mesh.geometry.boundingBox) part.mesh.geometry.computeBoundingBox();
      this.modelBox.union(part.mesh.geometry.boundingBox);
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

    this._updateBounds();
    this._updateShadowSetup();

    this.roll = 0;
    this.setView('iso');
  }

  /**
   * Moves parts away from their place for an exploded view. `offsets` maps
   * part ids to offsets [x, y, z] in CAD coordinates; parts not in it go back.
   */
  setPartOffsets(offsets) {
    for (const part of this.parts) {
      const offset = offsets.get(part.id);
      if (offset) part.mesh.position.fromArray(offset);
      else part.mesh.position.set(0, 0, 0);
      this._applyClipping(part);
    }
    this._updateBounds();
    this._updateShadowSetup();
    this.requestRender();
  }

  /** Bounding sphere and floor height of the model as it stands, including an explosion. */
  _updateBounds() {
    this.modelRoot.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const partBox = new THREE.Box3();
    for (const part of this.parts) {
      box.union(partBox.copy(part.mesh.geometry.boundingBox).applyMatrix4(part.mesh.matrixWorld));
    }
    box.getBoundingSphere(this.bounds);
    if (!(this.bounds.radius > 0)) this.bounds.set(new THREE.Vector3(), 1);
    this._groundY = Number.isFinite(box.min.y) ? box.min.y : 0;
    // The cove is sized to the model; rebuild it when the model grows or shrinks noticeably.
    const coveRadius = this.cove.userData.radius;
    if (!coveRadius || Math.abs(this.bounds.radius - coveRadius) > coveRadius * 0.02 || this.parts.length === 0) {
      this.cove.geometry.dispose();
      this.cove.geometry = this.parts.length > 0 ? buildCoveGeometry(this.bounds.radius) : new THREE.BufferGeometry();
      this.cove.userData.radius = this.parts.length > 0 ? this.bounds.radius : null;
    }
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

  /** Changes any subset of the lighting settings (preset, lights, rotation, intensity, ground, background). */
  setLighting(changes) {
    Object.assign(this.lighting, changes);
    const custom = this.lighting.presetId === 'custom' && this._customEnvironment;
    const preset = getLightPreset(this.lighting.presetId);
    // Only what changes the picture; renaming a softbox must not rebuild the environment.
    const lights = (this.lighting.lights || [])
      .filter((light) => light.enabled && light.power > 0)
      .map(({ az, el, width, height, power, color, round }) => ({ az, el, width, height, power, color, round, enabled: true }));
    const key = `${custom ? this._customEnvironment.uuid : preset.id}|${JSON.stringify(lights)}`;

    if (key !== this._environmentKey) {
      this._environmentKey = key;
      // Generated textures are rebuilt on demand; a custom HDRI is kept for reuse.
      if (this.environmentTexture && this.environmentTexture !== this._customEnvironment) {
        this.environmentTexture.dispose();
      }
      this._envTarget?.dispose();
      this.environmentTexture =
        custom && lights.length === 0
          ? this._customEnvironment
          : buildEnvironmentTexture(custom ? this._customEnvironment : preset, lights);
      this._envTarget = this._pmrem.fromEquirectangular(this.environmentTexture);
      this.scene.environment = this._envTarget.texture;
      this._keyDirection = this.environmentTexture.userData.keyDirection.clone();
      this._shadowSettings = custom ? CUSTOM_SHADOW : preset.shadow;
    }

    const rotation = THREE.MathUtils.degToRad(this.lighting.rotation);
    this.scene.environmentRotation.y = rotation;
    this.scene.environmentIntensity = this.lighting.intensity;

    if (this.showsEnvironmentBackground) {
      this.scene.background = this.environmentTexture;
      this.scene.backgroundRotation.y = rotation;
      this.scene.backgroundIntensity = this.lighting.intensity;
    } else if (this.lighting.background === 'gradient') {
      // The gradient is drawn behind the transparent canvas (see setBackdropFrame).
      this.scene.background = null;
      this.scene.backgroundIntensity = 1;
    } else {
      // Either a named background or a custom colour such as "#dfe6ee".
      this._backgroundColor.set(BACKGROUNDS[this.lighting.background] ?? this.lighting.background);
      this.scene.background = this._backgroundColor;
      this.scene.backgroundIntensity = 1;
    }
    this.renderer.setClearColor(0x000000, 0);
    this._updateBackdropCss();
    this._updateShadowSetup();
    this.requestRender();
  }

  /**
   * Lays the colour gradient out over the output frame, so that it matches
   * the final image. Called whenever the frame moves.
   */
  setBackdropFrame(frame) {
    this._backdropFrame = frame;
    this._updateBackdropCss();
  }

  _updateBackdropCss() {
    const show = this.lighting.background === 'gradient' && this.lighting.gradient && this._backdropFrame;
    const css = show ? gradientCss(this.lighting.gradient, this._backdropFrame) : '';
    if (this.canvas.style.background !== css) this.canvas.style.background = css;
  }

  /** Background as a plain colour, also while an HDRI is shown instead. */
  get backgroundColor() {
    return this._backgroundColor;
  }

  _updateShadowSetup() {
    const { center, radius } = this.bounds;
    const hasModel = this.parts.length > 0;

    // An HDRI background brings its own ground, so the shadow plane would float in it.
    const floor = hasModel && !this.showsEnvironmentBackground ? this.lighting.floor : 'none';
    this.ground.visible = floor === 'shadow';
    this.cove.visible = floor === 'cove';
    this.shadowLight.visible = floor !== 'none';
    this._updateReflector(floor === 'shadow' && this.lighting.reflection > 0);
    if (this.cove.visible) {
      const params = floorMaterialParams(this.lighting.reflection, this.lighting.reflectionBlur, 0.9);
      Object.assign(this.cove.material, params);
      this.cove.material.color.copy(
        coveAlbedo(this.lighting.coveColor, this.environmentTexture.userData.floorIrradiance, this.lighting.intensity),
      );
      this._placeCove();
    }
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
    if (this.reflector) {
      this.reflector.scale.setScalar(radius * 60);
      this.reflector.position.copy(this.ground.position);
      this.reflector.material.uniforms.strength.value = this.lighting.reflection;
    }
  }

  /** Creates the mirror for a reflective floor on demand and removes it again when not needed. */
  _updateReflector(needed) {
    if (!needed) {
      if (this.reflector) {
        this.scene.remove(this.reflector);
        this.reflector.dispose();
        this.reflector = null;
      }
      return;
    }
    if (this.reflector) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const reflector = new Reflector(new THREE.PlaneGeometry(1, 1), {
      textureWidth: size.x,
      textureHeight: size.y,
      clipBias: 0.0005,
      shader: FLOOR_REFLECTION_SHADER,
    });
    reflector.rotation.x = -Math.PI / 2;
    reflector.renderOrder = -1;
    reflector.material.transparent = true;
    reflector.material.depthWrite = false;
    reflector.raycast = () => {};
    // The floor mirrors the lighting environment like it does in the rendering. The shadow
    // plane lies in the mirror itself and must not show up in the reflection.
    const render = reflector.onBeforeRender;
    reflector.onBeforeRender = (...args) => {
      const { scene } = this;
      const saved = [this.ground.visible, scene.background, scene.backgroundIntensity, scene.backgroundBlurriness];
      const savedRotation = scene.backgroundRotation.y;
      this.ground.visible = false;
      scene.background = this.environmentTexture;
      scene.backgroundRotation.y = scene.environmentRotation.y;
      scene.backgroundIntensity = scene.environmentIntensity;
      scene.backgroundBlurriness = this.lighting.reflectionBlur * 0.4;
      render.apply(reflector, args);
      [this.ground.visible, scene.background, scene.backgroundIntensity, scene.backgroundBlurriness] = saved;
      scene.backgroundRotation.y = savedRotation;
    };
    this.reflector = reflector;
    this.scene.add(reflector);
  }

  /** Rebuilds the three.js material of a part after its materialId or colour changed. */
  updatePartMaterial(id) {
    const part = this.parts[id];
    if (!part) return;
    if (this._applyFinish(part)) this._capsDirty = true;
    part.mesh.material.dispose();
    part.mesh.material = createMaterial(part);
    if (this.highlighted.has(id)) part.mesh.material.emissive.copy(SELECT_EMISSIVE);
    this._applyClipping(part);
    if (this.capStyle.mode === 'material') {
      for (const cap of part.caps) cap.material = part.mesh.material;
    }
    this.requestRender();
  }

  /**
   * Gives a part with brushed or turned marks the tangents its anisotropic
   * shading needs. Returns true if the marks changed, so caps need them too.
   */
  _applyFinish(part) {
    const finish = part.look?.finish ?? 'none';
    const geometry = part.mesh.geometry;
    part.finishFrame = finish === 'none' ? null : finishFrame(finish, part.look.finishAxis, geometry.boundingBox);
    const key = part.finishFrame
      ? `${finish}:${part.finishFrame.axis.toArray()}:${part.finishFrame.center.toArray()}`
      : 'none';
    if (geometry.userData.finishKey === key) return false;
    geometry.userData.finishKey = key;
    if (part.finishFrame) applyFinishTangents(geometry, finish, part.finishFrame);
    return true;
  }

  // --- Section cuts -------------------------------------------------------------

  /** The planes that cut the given part, in CAD coordinates. */
  sectionPlanesFor(part) {
    return this.sections.filter((section) => !section.uncut.has(part.id)).map((section) => section.plane);
  }

  /**
   * Sets the active section cuts. The graphics card clips the parts right
   * away; the caps that close the cut faces are computed shortly after.
   */
  setSections(sections, capStyle) {
    this.sections = sections;
    this.capStyle = { ...capStyle };
    for (const part of this.parts) this._applyClipping(part);
    this._capsDirty = true;
    this._capsChangedAt = performance.now();
    // On heavy models the caps lag behind a moving plane, so they hide until it rests.
    if (this._capsCost >= 30) {
      for (const part of this.parts) for (const cap of part.caps) cap.visible = false;
    }
    this.requestRender();
  }

  _applyClipping(part) {
    const matrix = this.modelRoot.matrixWorld;
    // Cuts belong to the part, so they move along with it in an exploded view.
    part.worldPlanes = this.sectionPlanesFor(part).map((plane) =>
      plane.clone().translate(part.mesh.position).applyMatrix4(matrix),
    );
    const planes = part.worldPlanes.length > 0 ? part.worldPlanes : null;
    for (const material of [part.mesh.material, part.edges?.material, part.capMaterial]) {
      if (!material) continue;
      material.clippingPlanes = planes;
      material.clipShadows = true;
    }
  }

  _disposeCaps(part) {
    for (const cap of part.caps || []) {
      part.mesh.remove(cap);
      cap.geometry.dispose();
    }
    part.caps = [];
    part.capMaterial?.dispose();
    part.capMaterial = null;
  }

  _rebuildCaps() {
    const started = performance.now();
    // Slightly inside the kept side, so a cap is not clipped at its own plane.
    const offset = this.bounds.radius * 2e-4;
    for (const part of this.parts) {
      this._disposeCaps(part);
      const planes = this.sectionPlanesFor(part);
      if (planes.length === 0) continue;
      if (this.capStyle.mode === 'color') {
        part.capMaterial = new THREE.MeshPhysicalMaterial({
          color: this.capStyle.color,
          roughness: 0.6,
          side: THREE.DoubleSide,
        });
        this._applyClipping(part);
      }
      for (const plane of planes) {
        const geometry = buildCap(part.mesh.geometry, plane, offset);
        if (!geometry) continue;
        if (part.finishFrame && !part.capMaterial) applyFinishTangents(geometry, part.look.finish, part.finishFrame);
        const cap = new THREE.Mesh(geometry, part.capMaterial || part.mesh.material);
        cap.castShadow = true;
        cap.raycast = () => {};
        part.mesh.add(cap);
        part.caps.push(cap);
      }
    }
    this._capsCost = performance.now() - started;
  }

  /** Shows the outline of a section plane (CAD coordinates) while it is edited, or hides it with null. */
  setSectionHelper(plane) {
    this._sectionHelper.visible = Boolean(plane) && !this.modelBox.isEmpty();
    this.requestRender();
    if (!this._sectionHelper.visible) return;

    const normal = plane.normal;
    const u = new THREE.Vector3(Math.abs(normal.x) > 0.9 ? 0 : 1, Math.abs(normal.x) > 0.9 ? 1 : 0, 0);
    u.addScaledVector(normal, -u.dot(normal)).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u);
    // The rectangle around the model's bounding box as seen along the plane normal.
    const min = new THREE.Vector2(Infinity, Infinity);
    const max = new THREE.Vector2(-Infinity, -Infinity);
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i += 1) {
      corner.set(
        i & 1 ? this.modelBox.max.x : this.modelBox.min.x,
        i & 2 ? this.modelBox.max.y : this.modelBox.min.y,
        i & 4 ? this.modelBox.max.z : this.modelBox.min.z,
      );
      const point = new THREE.Vector2(corner.dot(u), corner.dot(v));
      min.min(point);
      max.max(point);
    }
    const margin = Math.max(max.x - min.x, max.y - min.y) * 0.06;
    min.subScalar(margin);
    max.addScalar(margin);
    const origin = normal.clone().multiplyScalar(-plane.constant);
    const corners = [
      [min.x, min.y],
      [max.x, min.y],
      [max.x, max.y],
      [min.x, max.y],
    ].flatMap(([x, y]) => origin.clone().addScaledVector(u, x).addScaledVector(v, y).toArray());
    for (const child of this._sectionHelper.children) {
      child.geometry.attributes.position.array.set(corners);
      child.geometry.attributes.position.needsUpdate = true;
    }
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
    // The clipped-away half of a cut part is still in the mesh; skip hits there.
    const hit = this._raycaster
      .intersectObjects(visible, false)
      .find((candidate) =>
        this.parts[candidate.object.userData.partId].worldPlanes.every(
          (plane) => plane.distanceToPoint(candidate.point) >= 0,
        ),
      );
    let normal = null;
    if (hit?.face) {
      // Parts are double sided, so the hit may be on the back of a face.
      normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (normal.dot(this._raycaster.ray.direction) > 0) normal.negate();
    }
    this.onPartClick?.(hit ? hit.object.userData.partId : null, hit ? hit.point.clone() : null, normal);
  }

  _resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    if (this.reflector) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.reflector.getRenderTarget().setSize(size.x, size.y);
    }
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
      this._placeCove();
      this.onViewChange?.();
    }
    // Caps follow a moving section plane live when that is cheap, otherwise once it rests.
    if (this._capsDirty && (this._capsCost < 30 || performance.now() - this._capsChangedAt > 160)) {
      this._capsDirty = false;
      this._rebuildCaps();
      this._needsRender = true;
    }
    if (!this._needsRender) return;
    this._needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }
}
