import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Mouse navigation as in CAD programs:
 * - left drag rotates around the point of the model under the cursor (or the
 *   model's centre). Freely by default, like Onshape: sideways around the
 *   screen's vertical, up and down around the screen's horizontal, so the
 *   model always follows the mouse. With `levelHorizon`, sideways turns around
 *   the world's vertical instead, which keeps the horizon level (turntable);
 *   up and down goes on without a stop, right over the top;
 * - right or middle drag, or Shift with the left button, pans;
 * - the wheel zooms towards the cursor, or towards the middle of the view
 *   when `zoomToCenter` is set, so a centred model stays centred.
 *
 * The camera always looks at `target`. Its orientation is "levelled look at
 * target, then rolled by `roll`", which the viewer re-applies after update().
 */
export class CadControls extends THREE.EventDispatcher {
  constructor(camera, element, { pickPoint, pivotFallback, blocked }) {
    super();
    this.camera = camera;
    this.element = element;
    this.target = new THREE.Vector3();
    /** Roll around the viewing axis in radians, see the class comment. */
    this.roll = 0;
    this.minDistance = 0.01;
    this.maxDistance = Infinity;
    this.enabled = true;
    /** Rotation per pixel, as a share of a half turn across the viewport's height. */
    this.rotateSpeed = 1.1;
    /** Turntable rotation around the world's vertical instead of free rotation (see the class comment). */
    this.levelHorizon = false;
    /** The point the current drag rotates around, for showing it; null when not rotating. */
    this.activePivot = null;
    /** Wheel zoom keeps the middle of the view in place instead of the point under the cursor. */
    this.zoomToCenter = false;
    /** Returns the world point of the model under the given client position, or null. */
    this.pickPoint = pickPoint;
    /** Returns the point to rotate around when the cursor is not over the model. */
    this.pivotFallback = pivotFallback;
    /** Returns true while a press belongs to something else, such as a gizmo. */
    this.blocked = blocked;

    this._drag = null;
    this._raycaster = new THREE.Raycaster();

    element.addEventListener('pointerdown', (event) => this._onPointerDown(event));
    element.addEventListener('pointermove', (event) => this._onPointerMove(event));
    element.addEventListener('pointerup', (event) => this._onPointerUp(event));
    element.addEventListener('pointercancel', (event) => this._onPointerUp(event));
    element.addEventListener('wheel', (event) => this._onWheel(event), { passive: false });
    element.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /** Points the camera at the target; the viewer adds the roll afterwards. */
  update() {
    const offset = this.camera.position.clone().sub(this.target);
    // Straight up or down, "levelled" has no meaning; tilt by a hair.
    if (Math.hypot(offset.x, offset.z) < offset.length() * 1e-6) {
      this.camera.position.x += offset.length() * 1e-5;
    }
    this.camera.up.copy(UP);
    this.camera.lookAt(this.target);
  }

  // --- Input ----------------------------------------------------------------------

  _ndc(event) {
    const rect = this.element.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  _onPointerDown(event) {
    if (!this.enabled || this._drag || this.blocked?.()) return;
    const pan = event.button === 1 || event.button === 2 || (event.button === 0 && (event.shiftKey || event.ctrlKey));
    if (event.button > 2) return;
    this.element.setPointerCapture?.(event.pointerId);
    this._drag = {
      mode: pan ? 'pan' : 'rotate',
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pivot: null,
      moved: false,
    };
    if (!pan) {
      this._drag.pivot = this.pickPoint?.(event.clientX, event.clientY) || this.pivotFallback?.() || this.target.clone();
    }
  }

  _onPointerMove(event) {
    const drag = this._drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!drag.moved && drag.mode === 'rotate') {
      this.activePivot = drag.pivot;
      this.dispatchEvent({ type: 'start' });
    }
    drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.mode === 'rotate') this._rotate(dx, dy, drag.pivot);
    else this._pan(dx, dy);
  }

  _onPointerUp(event) {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    this.element.releasePointerCapture?.(event.pointerId);
    const moved = this._drag.moved;
    this._drag = null;
    this.activePivot = null;
    if (moved) this.dispatchEvent({ type: 'end' });
  }

  _onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();
    // Lines, pages or pixels: normalise to roughly 100 per notch.
    const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 800 : event.deltaY;
    this._zoom(Math.exp(delta * 0.0012), this._ndc(event));
  }

  // --- Moves ----------------------------------------------------------------------

  /** The camera's current orientation, roll included. */
  _orientation() {
    this.update();
    const q = this.camera.quaternion.clone();
    if (this.roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll));
    return q;
  }

  /** Turns camera and target together by `turn` around `pivot`, and keeps the roll consistent. */
  _turn(turn, pivot) {
    const orientation = turn.clone().multiply(this._orientation());
    this.camera.position.sub(pivot).applyQuaternion(turn).add(pivot);
    this.target.sub(pivot).applyQuaternion(turn).add(pivot);
    // Split the new orientation into "levelled look at target" and a roll.
    this.update();
    const levelled = this.camera.quaternion.clone();
    const rest = levelled.invert().multiply(orientation);
    this.roll = 2 * Math.atan2(rest.z, rest.w);
    this.roll = THREE.MathUtils.euclideanModulo(this.roll + Math.PI, Math.PI * 2) - Math.PI;
    this.dispatchEvent({ type: 'change' });
  }

  _rotate(dx, dy, pivot) {
    const orientation = this._orientation();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
    // The same feel on any window size: a drag across the viewport's height turns about 200°.
    const perPixel = (Math.PI * this.rotateSpeed) / Math.max(this.element.clientHeight, 200);
    // Free: around the screen's own axes. Level: sideways around the world's vertical; upside down it turns the other way.
    const vertical = !this.levelHorizon ? up : up.y >= 0 ? UP : UP.clone().negate();
    const turn = new THREE.Quaternion()
      .setFromAxisAngle(vertical, -dx * perPixel)
      .multiply(new THREE.Quaternion().setFromAxisAngle(right, -dy * perPixel));
    this._turn(turn, pivot);
  }

  _pan(dx, dy) {
    const orientation = this._orientation();
    const distance = this.camera.position.distanceTo(this.target);
    const height = this.element.clientHeight || 1;
    // World size of one pixel at the depth of the target.
    const perPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / height / (this.camera.zoom || 1);
    const move = new THREE.Vector3(-dx * perPixel, dy * perPixel, 0).applyQuaternion(orientation);
    this.camera.position.add(move);
    this.target.add(move);
    this.dispatchEvent({ type: 'change' });
  }

  /** Scales the distance to the target by `factor`, keeping the point under the cursor in place. */
  _zoom(factor, ndc) {
    const distance = this.camera.position.distanceTo(this.target);
    const next = THREE.MathUtils.clamp(distance * factor, this.minDistance, this.maxDistance);
    const scale = next / distance;
    if (Math.abs(scale - 1) < 1e-6) return;
    if (this.zoomToCenter) {
      // The camera looks at the target, so the target is the middle of the view.
      this.camera.position.sub(this.target).multiplyScalar(scale).add(this.target);
      this.dispatchEvent({ type: 'change' });
      return;
    }
    // The point under the cursor on the plane through the target.
    this.camera.updateMatrixWorld();
    this._raycaster.setFromCamera(ndc, this.camera);
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.target);
    const anchor = this._raycaster.ray.intersectPlane(plane, new THREE.Vector3()) || this.target.clone();
    this.camera.position.sub(anchor).multiplyScalar(scale).add(anchor);
    this.target.sub(anchor).multiplyScalar(scale).add(anchor);
    this.dispatchEvent({ type: 'change' });
  }
}
