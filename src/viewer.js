import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createMaterial } from './materials.js';
import { buildEnvironmentTexture, getLightPreset, keyLightDirection } from './environment.js';

const SELECT_EMISSIVE = new THREE.Color(0x1f5fbf);

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
    this.controls.addEventListener('change', () => this.requestRender());

    // CAD models are Z-up, three.js and HDRI lighting are Y-up.
    this.modelRoot = new THREE.Group();
    this.modelRoot.rotation.x = -Math.PI / 2;
    this.scene.add(this.modelRoot);

    this.parts = [];
    this.selectedId = null;
    this.edgesVisible = true;
    this.onSelect = null;
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
    this.selectedId = null;

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
    const direction = new THREE.Vector3(dir[0], dir[2], -dir[1]).normalize();
    this._frame(direction);
  }

  /** Fits the model into the viewport while keeping the current viewing direction. */
  fit() {
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this._frame(direction);
  }

  _frame(direction) {
    const { center, radius } = this.bounds;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;

    // Looking straight down the up axis is degenerate for orbit controls; nudge it.
    if (Math.abs(direction.y) > 0.9999) {
      direction.set(0, Math.sign(direction.y), 0.0001).normalize();
    }

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(distance / 1000, radius / 10000);
    this.camera.far = distance + radius * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
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
    this.scene.background.setHex(BACKGROUNDS[this.lighting.background] ?? BACKGROUNDS.dark);
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
    if (this.selectedId === id) part.mesh.material.emissive.copy(SELECT_EMISSIVE);
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

  select(id) {
    if (this.selectedId !== null && this.parts[this.selectedId]) {
      this.parts[this.selectedId].mesh.material.emissive.setScalar(0);
    }
    this.selectedId = id;
    if (id !== null && this.parts[id]) {
      this.parts[id].mesh.material.emissive.copy(SELECT_EMISSIVE);
    }
    this.requestRender();
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
    const id = hit ? hit.object.userData.partId : null;
    this.select(id);
    this.onSelect?.(id);
  }

  _resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  _tick() {
    // With damping enabled, update() keeps firing 'change' until the motion settles.
    this.controls.update();
    if (!this._needsRender) return;
    this._needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }
}
