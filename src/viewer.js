import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SELECT_EMISSIVE = new THREE.Color(0x1f5fbf);

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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x16181c);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

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
