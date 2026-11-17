import * as THREE from 'three';

/** Directions of an exploded view: away from the centre, or along one CAD axis. */
export const EXPLODE_DIRECTIONS = {
  radial: 'Von der Mitte aus',
  x: 'Entlang X',
  y: 'Entlang Y',
  z: 'Entlang Z',
};

export const defaultExplode = () => ({ amount: 0, direction: 'radial' });

/**
 * Offsets of an exploded view in CAD coordinates, keyed by part id. Each part
 * moves away from the centre of the assembly in proportion to its distance
 * from it, so neighbours separate evenly; `amount` 1 doubles all distances.
 */
export function explodeOffsets(parts, explode) {
  const offsets = new Map();
  if (!(explode.amount > 0) || parts.length < 2) return offsets;
  const assembly = new THREE.Box3();
  const centers = parts.map((part) => {
    const box = part.mesh.geometry.boundingBox;
    assembly.union(box);
    return box.getCenter(new THREE.Vector3());
  });
  const middle = assembly.getCenter(new THREE.Vector3());
  const axis = { x: 0, y: 1, z: 2 }[explode.direction];
  parts.forEach((part, i) => {
    const offset = centers[i].sub(middle);
    if (axis !== undefined) {
      const along = offset.getComponent(axis);
      offset.set(0, 0, 0).setComponent(axis, along);
    }
    offset.multiplyScalar(explode.amount);
    if (offset.lengthSq() > 0) offsets.set(part.id, offset.toArray());
  });
  return offsets;
}
