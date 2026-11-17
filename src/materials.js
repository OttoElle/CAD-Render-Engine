import * as THREE from 'three';

/**
 * Material library. `color: null` means "keep the colour from the CAD file".
 * `params` are MeshPhysicalMaterial parameters, which the real-time view and
 * the path tracer both understand. `finish` adds machining marks: 'brushed'
 * (straight lines) or 'turned' (circles around an axis, as from a lathe).
 */
export const MATERIAL_GROUPS = {
  metal: 'Metal',
  plastic: 'Plastic',
  coating: 'Paint and coating',
  other: 'Glass and other',
};

export const MATERIALS = [
  { id: 'cad', label: 'Original (CAD colour)', color: null, params: { metalness: 0, roughness: 0.5 } },

  { id: 'alu-satin', group: 'metal', label: 'Aluminium satin', color: '#cdd0d3', params: { metalness: 1, roughness: 0.3 } },
  { id: 'alu-matt', group: 'metal', label: 'Aluminium bead-blasted', color: '#d5d7da', params: { metalness: 1, roughness: 0.42 } },
  { id: 'alu-poliert', group: 'metal', label: 'Aluminium polished', color: '#e6e7e9', params: { metalness: 1, roughness: 0.08 } },
  {
    id: 'alu-gebuerstet',
    group: 'metal',
    label: 'Aluminium brushed',
    color: '#d3d6d9',
    params: { metalness: 1, roughness: 0.3 },
    finish: 'brushed',
  },
  {
    id: 'alu-gedreht',
    group: 'metal',
    label: 'Aluminium turned',
    color: '#d9dbde',
    params: { metalness: 1, roughness: 0.22 },
    finish: 'turned',
  },
  { id: 'alu-schwarz', group: 'metal', label: 'Aluminium anodised black', color: '#1b1c1f', params: { metalness: 1, roughness: 0.38 } },
  {
    id: 'alu-eloxiert',
    group: 'metal',
    label: 'Aluminium anodised colour',
    color: '#2f5fa8',
    params: { metalness: 1, roughness: 0.32, clearcoat: 0.25, clearcoatRoughness: 0.25 },
  },
  { id: 'stahl', group: 'metal', label: 'Steel', color: '#8f9296', params: { metalness: 1, roughness: 0.3 } },
  {
    id: 'stahl-geschliffen',
    group: 'metal',
    label: 'Steel ground',
    color: '#a3a6aa',
    params: { metalness: 1, roughness: 0.2 },
    finish: 'turned',
  },
  { id: 'stahl-bruniert', group: 'metal', label: 'Steel black oxide', color: '#2c2d30', params: { metalness: 1, roughness: 0.42 } },
  { id: 'edelstahl', group: 'metal', label: 'Stainless steel polished', color: '#c9cbcd', params: { metalness: 1, roughness: 0.12 } },
  {
    id: 'edelstahl-gebuerstet',
    group: 'metal',
    label: 'Stainless steel brushed',
    color: '#c3c5c8',
    params: { metalness: 1, roughness: 0.28 },
    finish: 'brushed',
  },
  { id: 'verzinkt', group: 'metal', label: 'Steel galvanised', color: '#b9bec4', params: { metalness: 1, roughness: 0.5 } },
  { id: 'chrom', group: 'metal', label: 'Chrome', color: '#d4d6d9', params: { metalness: 1, roughness: 0.03 } },
  { id: 'guss', group: 'metal', label: 'Cast iron raw', color: '#6c6e71', params: { metalness: 1, roughness: 0.62 } },
  { id: 'titan', group: 'metal', label: 'Titanium', color: '#b5afa7', params: { metalness: 1, roughness: 0.3 } },
  { id: 'messing', group: 'metal', label: 'Brass', color: '#d8b56a', params: { metalness: 1, roughness: 0.22 } },
  { id: 'kupfer', group: 'metal', label: 'Copper', color: '#d98c68', params: { metalness: 1, roughness: 0.2 } },
  { id: 'gold', group: 'metal', label: 'Gold', color: '#f0c66b', params: { metalness: 1, roughness: 0.12 } },

  { id: 'kunststoff-matt', group: 'plastic', label: 'Plastic matte', color: '#2b2d31', params: { metalness: 0, roughness: 0.7 } },
  { id: 'kunststoff-seidenmatt', group: 'plastic', label: 'Plastic satin', color: '#e9e8e3', params: { metalness: 0, roughness: 0.42 } },
  {
    id: 'kunststoff-glanz',
    group: 'plastic',
    label: 'Plastic glossy',
    color: '#d9342b',
    params: { metalness: 0, roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.1 },
  },
  {
    id: 'kunststoff-transparent',
    group: 'plastic',
    label: 'Plastic clear',
    color: '#f4f8fb',
    params: { metalness: 0, roughness: 0.05, transmission: 1, ior: 1.49, thickness: 2 },
  },
  { id: 'gummi', group: 'plastic', label: 'Rubber', color: '#141414', params: { metalness: 0, roughness: 0.95 } },

  {
    id: 'lack',
    group: 'coating',
    label: 'Paint glossy',
    color: '#1f5fbf',
    params: { metalness: 0, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04 },
  },
  { id: 'lack-matt', group: 'coating', label: 'Paint matte', color: '#3a4a5c', params: { metalness: 0, roughness: 0.62 } },
  {
    id: 'lack-metallic',
    group: 'coating',
    label: 'Metallic paint',
    color: '#7a8796',
    params: { metalness: 0.55, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.03 },
  },
  {
    id: 'pulver',
    group: 'coating',
    label: 'Powder coating',
    color: '#2d3033',
    params: { metalness: 0, roughness: 0.48, clearcoat: 0.15, clearcoatRoughness: 0.45 },
  },

  {
    id: 'glas',
    group: 'other',
    label: 'Glass',
    color: '#ffffff',
    params: { metalness: 0, roughness: 0.02, transmission: 1, ior: 1.5, thickness: 2 },
  },
  {
    id: 'glas-satiniert',
    group: 'other',
    label: 'Glass frosted',
    color: '#ffffff',
    params: { metalness: 0, roughness: 0.35, transmission: 1, ior: 1.5, thickness: 2 },
  },
  {
    id: 'keramik',
    group: 'other',
    label: 'Ceramic glazed',
    color: '#f2f0ea',
    params: { metalness: 0, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.05 },
  },
];

const BY_ID = new Map(MATERIALS.map((material) => [material.id, material]));

export function getMaterialDef(id) {
  return BY_ID.get(id) || MATERIALS[0];
}

export const FINISHES = {
  none: { label: 'Smooth' },
  brushed: { label: 'Brushed' },
  turned: { label: 'Turned' },
};

/** Axis of a finish: 'auto' or a CAD axis. Brushing runs along it, turning circles around it. */
export const FINISH_AXES = {
  auto: 'Automatic',
  x: 'X axis',
  y: 'Y axis',
  z: 'Z axis',
};

/** How strongly the machining marks stretch the reflections, used when a finish is first chosen. */
const DEFAULT_FINISH_STRENGTH = 0.7;

/**
 * The adjustable values of a material entry, starting from the library
 * material. Sliders in the material panel change these.
 */
export function defaultTuning(materialId) {
  const def = getMaterialDef(materialId);
  return {
    roughness: def.params.roughness ?? 0.5,
    metalness: def.params.metalness ?? 0,
    clearcoat: def.params.clearcoat ?? 0,
    finish: def.finish ?? 'none',
    finishAxis: 'auto',
    finishStrength: DEFAULT_FINISH_STRENGTH,
  };
}

const clamp01 = (value, fallback) => (Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback);

/** Validated tuning for a material, e.g. from a stored project. Missing values come from the library. */
export function sanitizeTuning(materialId, saved) {
  const base = defaultTuning(materialId);
  if (!saved || typeof saved !== 'object') return base;
  return {
    roughness: clamp01(saved.roughness, base.roughness),
    metalness: clamp01(saved.metalness, base.metalness),
    clearcoat: clamp01(saved.clearcoat, base.clearcoat),
    finish: FINISHES[saved.finish] ? saved.finish : base.finish,
    finishAxis: FINISH_AXES[saved.finishAxis] ? saved.finishAxis : base.finishAxis,
    finishStrength: clamp01(saved.finishStrength, base.finishStrength),
  };
}

export function isDefaultTuning(materialId, tuning) {
  const base = defaultTuning(materialId);
  return Object.keys(base).every((key) => base[key] === tuning[key]);
}

/** Colour a part gets when a library material is chosen without an override. */
export function defaultColor(part, materialId) {
  const def = getMaterialDef(materialId);
  return def.color ?? `#${part.cadColor.getHexString()}`;
}

/**
 * Everything the 3D views need to build a part's material: the library
 * parameters with the user's tuning applied, the colour and the finish.
 */
export function resolveLook(materialId, colorHex, tuning) {
  const def = getMaterialDef(materialId);
  const tune = tuning || defaultTuning(materialId);
  const finish = tune.finish !== 'none' && tune.finishStrength > 0 ? tune.finish : 'none';
  return {
    color: colorHex,
    params: {
      ...def.params,
      roughness: tune.roughness,
      metalness: tune.metalness,
      clearcoat: tune.clearcoat,
      clearcoatRoughness: def.params.clearcoatRoughness ?? 0.05,
      anisotropy: finish === 'none' ? 0 : tune.finishStrength,
    },
    finish,
    finishAxis: tune.finishAxis,
  };
}

/** Builds the three.js material for a part from its resolved look (see resolveLook). */
export function createMaterial(part) {
  const look = part.look || resolveLook(part.materialId, part.colorHex);
  return new THREE.MeshPhysicalMaterial({
    ...look.params,
    color: new THREE.Color(look.color),
    side: THREE.DoubleSide,
  });
}

// --- Machining marks ------------------------------------------------------------

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

/**
 * The axis of a finish for one part, in CAD coordinates. 'auto' guesses from
 * the part's bounding box: brushing runs along the longest side; a turned part
 * turns around the axis whose cross section is closest to square (round).
 */
export function finishFrame(finish, axisChoice, box) {
  const size = box.getSize(new THREE.Vector3()).toArray();
  const center = box.getCenter(new THREE.Vector3());
  let axis = AXIS_INDEX[axisChoice];
  if (axis === undefined) {
    if (finish === 'brushed') {
      axis = size.indexOf(Math.max(...size));
    } else {
      // The two other sides of a turned part are its diameter, so they are about equal.
      let best = Infinity;
      for (let i = 0; i < 3; i += 1) {
        const a = size[(i + 1) % 3];
        const b = size[(i + 2) % 3];
        const mismatch = Math.abs(a - b) / Math.max(a, b, 1e-9);
        // Prefer the thinner direction when several fit equally, e.g. a disc.
        const score = mismatch + (size[i] / Math.max(...size, 1e-9)) * 0.02;
        if (score < best) {
          best = score;
          axis = i;
        }
      }
    }
  }
  return { axis: new THREE.Vector3().setComponent(axis, 1), center };
}

/**
 * Writes a tangent attribute that tells the anisotropic shading which way the
 * reflections stretch: across the machining marks. Works on any geometry with
 * normals in CAD coordinates (whole parts, clipped parts and section caps).
 */
export function applyFinishTangents(geometry, finish, frame) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  if (!normal) return;
  const count = position.count;
  const tangents = new Float32Array(count * 4);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const groove = new THREE.Vector3();
  const across = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const fallback = new THREE.Vector3();

  for (let i = 0; i < count; i += 1) {
    n.fromBufferAttribute(normal, i).normalize();
    if (finish === 'turned') {
      // Marks run in circles around the axis.
      p.fromBufferAttribute(position, i).sub(frame.center);
      radial.copy(p).addScaledVector(frame.axis, -p.dot(frame.axis));
      groove.crossVectors(frame.axis, radial);
    } else {
      // Marks run in straight lines along the axis, projected onto the surface.
      groove.copy(frame.axis);
    }
    groove.addScaledVector(n, -groove.dot(n));
    if (groove.lengthSq() < 1e-8) {
      // The surface faces along the marks (or sits on the turning axis); any direction will do.
      fallback.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0);
      groove.copy(fallback).addScaledVector(n, -fallback.dot(n));
    }
    groove.normalize();
    across.crossVectors(n, groove).normalize();
    tangents[i * 4] = across.x;
    tangents[i * 4 + 1] = across.y;
    tangents[i * 4 + 2] = across.z;
    tangents[i * 4 + 3] = 1;
  }
  // Reuse an existing attribute of the right size, so the graphics buffer is updated instead of leaked.
  const existing = geometry.attributes.tangent;
  if (existing && existing.count === count && existing.itemSize === 4 && existing.array instanceof Float32Array) {
    existing.array.set(tangents);
    existing.needsUpdate = true;
  } else {
    geometry.setAttribute('tangent', new THREE.BufferAttribute(tangents, 4));
  }
}
