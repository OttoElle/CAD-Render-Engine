import * as THREE from 'three';

const AXIS_COLORS = [0xe5484d, 0x3fb950, 0x4a6cf7];
const HOVER_COLOR = 0xf5a524;
const CENTER_COLOR = 0x3d4452;
/** Length of an arrow on screen, in CSS pixels. */
const SCREEN_SIZE = 130;
const ROTATION_SNAP = 15;
const MOVE_SNAP = 1;
/** How much of the quarter circle between two arrows a ring spans, in degrees. */
const RING_ARC = 64;
/** Which handle wins where several overlap on screen. */
const PRIORITY = { free: 0, axis: 1, plane: 2, rotate: 3 };

const numberText = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function overlayMaterial(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function pickerMaterial() {
  const material = new THREE.MeshBasicMaterial();
  material.visible = false;
  return material;
}

/** Matrices that turn geometry built around +Y (arrows) or in the XY plane (rings) onto each CAD axis. */
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const ARROW_BASIS = [new THREE.Matrix4().makeBasis(Y.clone().negate(), X, Z), new THREE.Matrix4(), new THREE.Matrix4().makeBasis(X, Z, Y.clone().negate())];
const RING_BASIS = [new THREE.Matrix4().makeBasis(Y, Z, X), new THREE.Matrix4().makeBasis(Z, X, Y), new THREE.Matrix4()];
const AXES = [X, Y, Z];

/**
 * A combined move and rotate tool for parts, in the spirit of the triad in
 * CAD programs: arrows move along an axis, squares move in a plane, quarter
 * rings turn about an axis and the ball in the middle moves in the screen
 * plane. While dragging, the distance or angle shows next to the pointer;
 * afterwards it can be typed in exactly. Shift snaps to 1 mm or 15°.
 *
 * It lives in the model's CAD coordinates and keeps the same size on screen.
 */
export class Manipulator {
  constructor({ camera, canvas, parent, requestRender }) {
    this.camera = camera;
    this.canvas = canvas;
    this.parent = parent;
    this.requestRender = requestRender;
    this.root = new THREE.Group();
    this.root.visible = false;
    this.root.renderOrder = 1000;
    parent.add(this.root);
    this.handles = [];
    this.hovered = null;
    this.drag = null;
    this.callbacks = null;
    this._raycaster = new THREE.Raycaster();
    this._build();
    this._buildValueBox();

    // Capture phase, so a press on a handle is taken before the camera controls see it.
    canvas.addEventListener('pointerdown', (event) => this._onPointerDown(event), true);
    canvas.addEventListener('pointermove', (event) => this._onPointerMove(event));
    canvas.addEventListener('pointerup', (event) => this._onPointerUp(event));
    canvas.addEventListener('pointercancel', (event) => this._onPointerUp(event, true));
  }

  get attached() {
    return this.root.visible;
  }

  /** Whether a press at the pointer belongs to the tool rather than to the camera. */
  get busy() {
    return Boolean(this.drag);
  }

  _build() {
    const add = (handle, visuals, picker) => {
      for (const mesh of visuals) {
        mesh.renderOrder = 1000 + (handle.kind === 'free' ? 3 : handle.kind === 'plane' ? 1 : 2);
        mesh.raycast = () => {};
        this.root.add(mesh);
      }
      picker.userData.handle = handle;
      this.root.add(picker);
      handle.visuals = visuals;
      handle.picker = picker;
      this.handles.push(handle);
    };
    for (let axis = 0; axis < 3; axis++) {
      const color = AXIS_COLORS[axis];
      // Arrow along the axis.
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.64, 8).translate(0, 0.5, 0), overlayMaterial(color));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.18, 20).translate(0, 0.91, 0), overlayMaterial(color));
      const arrowPicker = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.86, 6).translate(0, 0.57, 0), pickerMaterial());
      for (const mesh of [shaft, cone, arrowPicker]) mesh.applyMatrix4(ARROW_BASIS[axis]);
      add({ kind: 'axis', axis, color }, [shaft, cone], arrowPicker);

      // Square for moving in the plane across this axis.
      const square = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15).translate(0.27, 0.27, 0), overlayMaterial(color, 0.35));
      const squarePicker = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2).translate(0.27, 0.27, 0), pickerMaterial());
      for (const mesh of [square, squarePicker]) mesh.applyMatrix4(RING_BASIS[axis]);
      add({ kind: 'plane', axis, color, opacity: 0.35 }, [square], squarePicker);

      // Ring for turning about this axis, between the two other arrows but clear of them, with a grip in its middle.
      const ringArc = THREE.MathUtils.degToRad(RING_ARC);
      const ringStart = (Math.PI / 2 - ringArc) / 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.012, 6, 32, ringArc).rotateZ(ringStart), overlayMaterial(color));
      const grip = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 16, 12).translate(0.62 * Math.SQRT1_2, 0.62 * Math.SQRT1_2, 0),
        overlayMaterial(color),
      );
      const ringPicker = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.065, 6, 20, ringArc).rotateZ(ringStart), pickerMaterial());
      for (const mesh of [ring, grip, ringPicker]) mesh.applyMatrix4(RING_BASIS[axis]);
      add({ kind: 'rotate', axis, color }, [ring, grip], ringPicker);
    }
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), overlayMaterial(CENTER_COLOR));
    const centerPicker = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), pickerMaterial());
    add({ kind: 'free', axis: null, color: CENTER_COLOR }, [center], centerPicker);
  }

  _buildValueBox() {
    this.valueBox = document.createElement('div');
    this.valueBox.className = 'manip-value';
    this.valueBox.hidden = true;
    this.valueInput = document.createElement('input');
    this.valueInput.type = 'text';
    this.valueInput.inputMode = 'decimal';
    this.valueInput.spellcheck = false;
    this.valueUnit = document.createElement('span');
    this.valueBox.append(this.valueInput, this.valueUnit);
    this.canvas.parentElement.append(this.valueBox);
    this.valueInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        this._commitTyped();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this._hideValue();
      }
    });
    this.valueInput.addEventListener('blur', () => {
      if (this._editing) this._hideValue();
    });
  }

  /**
   * Shows the tool at a point in CAD coordinates. `callbacks` are
   * { start(), change(change), end() }: a change is { type: 'move', delta: [x, y, z] }
   * in mm, or { type: 'rotate', axis, angle } in degrees, always measured from
   * where the last drag started.
   */
  attach(point, callbacks) {
    this.callbacks = callbacks;
    this.root.position.fromArray(point);
    this.root.visible = true;
    this.requestRender();
  }

  /** Moves the tool along when the parts moved some other way. */
  place(point) {
    if (!this.attached || this.drag) return;
    this.root.position.fromArray(point);
    this.requestRender();
  }

  detach() {
    this._hideValue();
    this.drag = null;
    this._setHovered(null);
    this.callbacks = null;
    this.root.visible = false;
    this.requestRender();
  }

  /** Keeps the tool the same size on screen; call before drawing. */
  update() {
    if (!this.attached) return;
    const world = this.root.getWorldPosition(new THREE.Vector3());
    const depth = Math.max(-world.applyMatrix4(this.camera.matrixWorldInverse).z, 1e-6);
    const height = Math.max(this.canvas.clientHeight, 1);
    const perPixel = (2 * depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / height;
    this.root.scale.setScalar(perPixel * SCREEN_SIZE);
  }

  // --- Pointer --------------------------------------------------------------------

  _ray(event) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.camera.updateMatrixWorld();
    this._raycaster.setFromCamera(pointer, this.camera);
    return this._raycaster;
  }

  _hit(event) {
    if (!this.attached) return null;
    this.update();
    this.root.updateMatrixWorld(true);
    const hits = this._ray(event).intersectObjects(
      this.handles.map((handle) => handle.picker),
      false,
    );
    if (hits.length === 0) return null;
    // The ball in the middle wins, then arrows, squares and rings.
    return hits
      .map((hit) => hit.object.userData.handle)
      .reduce((best, handle) => (PRIORITY[handle.kind] < PRIORITY[best.kind] ? handle : best));
  }

  _setHovered(handle) {
    if (handle === this.hovered) return;
    for (const item of [this.hovered, handle]) {
      if (!item) continue;
      const on = item === handle;
      for (const mesh of item.visuals) {
        mesh.material.color.setHex(on ? HOVER_COLOR : item.color);
        if (item.kind === 'plane') mesh.material.opacity = on ? 0.75 : item.opacity;
      }
    }
    this.hovered = handle;
    this.canvas.classList.toggle('over-handle', Boolean(handle));
    this.requestRender();
  }

  /** The pointer ray in the CAD coordinates the tool lives in. */
  _localRay(event) {
    const inverse = this.parent.matrixWorld.clone().invert();
    return this._ray(event).ray.clone().applyMatrix4(inverse);
  }

  _viewNormal() {
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    return direction.applyQuaternion(this.parent.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
  }

  /** Where the pointer is for the handle being dragged: a distance along the axis, a point or an angle. */
  _measure(event) {
    const { handle, origin } = this.drag;
    const ray = this._localRay(event);
    if (handle.kind === 'axis') {
      const direction = AXES[handle.axis];
      const w0 = origin.clone().sub(ray.origin);
      const b = direction.dot(ray.direction);
      const denominator = 1 - b * b;
      if (denominator < 1e-6) return null;
      return (b * ray.direction.dot(w0) - direction.dot(w0)) / denominator;
    }
    if (handle.kind === 'plane' || handle.kind === 'free') {
      const normal = handle.kind === 'plane' ? AXES[handle.axis] : this._viewNormal();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
      if (Math.abs(ray.direction.dot(normal)) < 1e-4) return null;
      return ray.intersectPlane(plane, new THREE.Vector3());
    }
    // Rotation: the angle of the pointer around the axis in the plane across it.
    const axis = AXES[handle.axis];
    if (Math.abs(ray.direction.dot(axis)) < 0.12) {
      // Seen edge-on, the plane gives no angle; the sideways mouse movement turns instead.
      return { screen: event.clientX - event.clientY };
    }
    const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(axis, origin), new THREE.Vector3());
    if (!hit) return null;
    return { vector: hit.sub(origin) };
  }

  _onPointerDown(event) {
    if (event.button !== 0 || !this.attached) return;
    const handle = this._hit(event);
    if (!handle) {
      this._hideValue();
      return;
    }
    event.stopImmediatePropagation();
    event.preventDefault();
    this._hideValue();
    this.canvas.setPointerCapture?.(event.pointerId);
    this.drag = {
      handle,
      pointerId: event.pointerId,
      origin: this.root.position.clone(),
      x: event.clientX,
      y: event.clientY,
      moved: false,
      start: null,
      angle: 0,
      last: null,
      value: handle.kind === 'axis' || handle.kind === 'rotate' ? 0 : [0, 0, 0],
    };
    this.drag.start = this._measure(event);
    this.drag.last = this.drag.start;
    this._setHovered(handle);
    this.canvas.classList.add('dragging-handle');
    this.callbacks?.start?.();
  }

  _onPointerMove(event) {
    const drag = this.drag;
    if (!drag) {
      if (event.buttons === 0 && this.attached) this._setHovered(this._hit(event));
      return;
    }
    if (event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
    drag.moved = true;
    const now = this._measure(event);
    if (now === null || drag.start === null) {
      drag.start ??= now;
      return;
    }
    const { handle } = drag;
    const snap = event.shiftKey;
    if (handle.kind === 'axis') {
      let distance = now - drag.start;
      if (snap) distance = Math.round(distance / MOVE_SNAP) * MOVE_SNAP;
      drag.value = distance;
      this._apply({ type: 'move', delta: AXES[handle.axis].clone().multiplyScalar(distance).toArray() });
    } else if (handle.kind === 'plane' || handle.kind === 'free') {
      const delta = now.clone().sub(drag.start);
      if (snap) delta.set(...delta.toArray().map((value) => Math.round(value / MOVE_SNAP) * MOVE_SNAP));
      drag.value = delta.toArray();
      this._apply({ type: 'move', delta: drag.value });
    } else {
      // Angles add up step by step, so turns beyond half a circle keep counting.
      let step = 0;
      if (now.screen !== undefined) {
        step = drag.last?.screen !== undefined ? (now.screen - drag.last.screen) * 0.6 : 0;
      } else if (drag.last?.vector) {
        const axis = AXES[handle.axis];
        const cross = new THREE.Vector3().crossVectors(drag.last.vector, now.vector);
        step = THREE.MathUtils.radToDeg(Math.atan2(cross.dot(axis), drag.last.vector.dot(now.vector)));
      }
      drag.last = now;
      drag.angle += step;
      const angle = snap ? Math.round(drag.angle / ROTATION_SNAP) * ROTATION_SNAP : drag.angle;
      drag.value = angle;
      this._apply({ type: 'rotate', axis: handle.axis, angle });
    }
    this._showValue(event, false);
  }

  _onPointerUp(event, cancelled = false) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    this.canvas.releasePointerCapture?.(event.pointerId);
    this.canvas.classList.remove('dragging-handle');
    this._setHovered(cancelled ? null : this._hit(event));
    this.callbacks?.end?.();
    // Along an axis or about one, the value can now be typed in exactly.
    if (!cancelled && (drag.handle.kind === 'axis' || drag.handle.kind === 'rotate')) {
      this._typed = { handle: drag.handle, origin: drag.origin };
      this._showValue(event, true, drag);
    } else {
      this._hideValue();
    }
  }

  _apply(change) {
    if (change.type === 'move') {
      this.root.position.copy(this.drag.origin).add(new THREE.Vector3().fromArray(change.delta));
    }
    this.callbacks?.change?.(change);
    this.requestRender();
  }

  // --- Value next to the pointer --------------------------------------------------

  _showValue(event, editable, drag = this.drag) {
    const { handle, value } = drag;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.valueBox.hidden = false;
    this.valueBox.classList.toggle('editable', editable);
    this.valueInput.readOnly = !editable;
    if (handle.kind === 'rotate') {
      this.valueInput.value = numberText.format(Math.round(value * 10) / 10);
      this.valueUnit.textContent = '°';
    } else if (handle.kind === 'axis') {
      this.valueInput.value = numberText.format(Math.round(value * 100) / 100);
      this.valueUnit.textContent = 'mm';
    } else {
      this.valueInput.value = value.map((item, i) => `${'XYZ'[i]} ${numberText.format(Math.round(item * 10) / 10)}`).filter((text, i) => Math.abs(value[i]) >= 0.05).join('  ') || '0';
      this.valueUnit.textContent = 'mm';
    }
    this.valueInput.style.width = `${Math.max(this.valueInput.value.length, 3) + 2}ch`;
    // Next to the pointer, but always inside the viewport.
    const width = this.valueBox.offsetWidth;
    const height = this.valueBox.offsetHeight;
    const left = event.clientX - rect.left + 16;
    const top = event.clientY - rect.top + 14;
    this.valueBox.style.left = `${Math.max(Math.min(left, rect.width - width - 8), 8)}px`;
    this.valueBox.style.top = `${Math.max(Math.min(top, rect.height - height - 8), 8)}px`;
    this._editing = editable;
    if (editable) {
      this.valueInput.focus({ preventScroll: true });
      this.valueInput.select();
    }
  }

  _hideValue() {
    this._editing = false;
    this._typed = null;
    this.valueBox.hidden = true;
    if (document.activeElement === this.valueInput) this.valueInput.blur();
  }

  /** Puts in the typed distance or angle, measured from where the last drag started. */
  _commitTyped() {
    const typed = this._typed;
    const text = this.valueInput.value.replace(',', '.').replace(/[^0-9.+\-eE]/g, '');
    const value = Number(text);
    if (!typed || text === '' || !Number.isFinite(value)) {
      this._hideValue();
      return;
    }
    const { handle, origin } = typed;
    this.drag = { handle, origin };
    if (handle.kind === 'axis') {
      this._apply({ type: 'move', delta: AXES[handle.axis].clone().multiplyScalar(value).toArray() });
    } else {
      this._apply({ type: 'rotate', axis: handle.axis, angle: value });
    }
    this.drag = null;
    this.callbacks?.end?.();
    this._hideValue();
  }
}
