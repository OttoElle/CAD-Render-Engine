import * as THREE from 'three';

/** Directions of an exploded view: away from the centre, or along one CAD axis. */
export const EXPLODE_DIRECTIONS = {
  radial: 'Away from the centre',
  x: 'Along X',
  y: 'Along Y',
  z: 'Along Z',
};

/** Direction choices for a single part: the assembly's, or one of its own. */
export const PART_EXPLODE_DIRECTIONS = {
  auto: 'Like the assembly',
  radial: 'Away from the centre',
  '+x': 'Towards +X',
  '-x': 'Towards −X',
  '+y': 'Towards +Y',
  '-y': 'Towards −Y',
  '+z': 'Towards +Z',
  '-z': 'Towards −Z',
};

/**
 * `added` is set once the user adds the exploded view to the tree. `amount` 0 is
 * assembled, 1 doubles all distances from the centre.
 * `direction` is one of EXPLODE_DIRECTIONS. `anchor` is the id of a part that
 * stays in place and serves as the centre, or null for the middle of the
 * assembly. `parts` holds settings of single parts by id:
 * { fixed (stays in place), direction (see PART_EXPLODE_DIRECTIONS), factor (1 = like the others) }.
 */
export const defaultExplode = () => ({ added: false, amount: 0, direction: 'radial', anchor: null, parts: {} });

/** Whether the exploded view is part of the project: added by the user, or set by a view or job. */
export const hasExplode = (explode) => Boolean(explode.added || explode.amount > 0);

export const defaultPartExplode = () => ({ fixed: false, direction: 'auto', factor: 1 });

/** A deep copy, for views and jobs that keep their own explosion. */
export function cloneExplode(explode) {
  return {
    ...explode,
    parts: Object.fromEntries(Object.entries(explode.parts || {}).map(([id, item]) => [id, { ...item }])),
  };
}

/** The settings of one part, with defaults for parts that have none. */
export function partExplode(explode, partId) {
  return { ...defaultPartExplode(), ...(explode.parts?.[partId] || {}) };
}

/** Changes the settings of one part; parts back at the defaults are dropped. */
export function setPartExplode(explode, partId, changes) {
  const next = { ...partExplode(explode, partId), ...changes };
  explode.parts = { ...(explode.parts || {}) };
  const plain = !next.fixed && next.direction === 'auto' && next.factor === 1;
  if (plain) delete explode.parts[partId];
  else explode.parts[partId] = next;
}

// Axis index and side: 0 moves the part to the side of the centre it is on already.
const AXES = { x: [0, 0], y: [1, 0], z: [2, 0], '+x': [0, 1], '-x': [0, -1], '+y': [1, 1], '-y': [1, -1], '+z': [2, 1], '-z': [2, -1] };

/**
 * Offsets of an exploded view in CAD coordinates, keyed by part id. Each part
 * moves away from the centre in proportion to its distance from it, so
 * neighbours separate evenly. `moved` holds the user's own part offsets,
 * which shift where a part starts from.
 */
export function explodeOffsets(parts, explode, moved = new Map()) {
  const offsets = new Map();
  if (!(explode.amount > 0) || parts.length < 2) return offsets;
  const centers = parts.map((part) => {
    const center = part.mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
    const offset = moved.get(part.id);
    return offset ? center.add(new THREE.Vector3().fromArray(offset)) : center;
  });
  let middle;
  const anchor = parts.findIndex((part) => part.id === explode.anchor);
  if (anchor >= 0) {
    middle = centers[anchor].clone();
  } else {
    const assembly = new THREE.Box3();
    for (const center of centers) assembly.expandByPoint(center);
    middle = assembly.getCenter(new THREE.Vector3());
  }
  // How far parts typically sit from the centre; a part in the middle that is sent somewhere moves by a share of it.
  const spread = Math.max(...centers.map((center) => center.distanceTo(middle)), 1e-6);
  parts.forEach((part, i) => {
    if (part.id === explode.anchor) return;
    const own = partExplode(explode, part.id);
    if (own.fixed) return;
    const direction = own.direction === 'auto' ? explode.direction : own.direction;
    const offset = centers[i].clone().sub(middle);
    const axis = AXES[direction];
    if (axis) {
      const [index, sign] = axis;
      let along = offset.getComponent(index);
      // A part sent to one side moves that way at least half its distance from the centre.
      if (sign !== 0) along = sign * Math.max(Math.abs(along), offset.length() * 0.5, spread * 0.25);
      offset.set(0, 0, 0).setComponent(index, along);
    }
    offset.multiplyScalar(explode.amount * own.factor);
    if (offset.lengthSq() > 0) offsets.set(part.id, offset.toArray());
  });
  return offsets;
}
