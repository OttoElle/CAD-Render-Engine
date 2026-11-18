import * as THREE from 'three';

/**
 * Material library: a material (what the part is made of) and its surface
 * (how it was finished) are chosen separately. `color: null` means "keep the
 * colour from the CAD file". `params` are MeshPhysicalMaterial parameters,
 * which the real-time view and the path tracer both understand; a surface's
 * params and colour override the material's. A surface's `finish` adds
 * machining marks: 'brushed' (straight lines) or 'turned' (circles around an
 * axis, as from a lathe).
 */
export const MATERIAL_GROUPS = {
  metal: 'Metal',
  plastic: 'Plastic',
  other: 'Paint, glass and other',
};

/** Surfaces every metal can have, from machining. */
const MACHINED = [
  { id: 'satin', label: 'Satin', params: { roughness: 0.3 } },
  { id: 'polished', label: 'Polished', params: { roughness: 0.08 } },
  { id: 'blasted', label: 'Bead-blasted', params: { roughness: 0.45 } },
  { id: 'brushed', label: 'Brushed', params: { roughness: 0.3 }, finish: 'brushed' },
  { id: 'turned', label: 'Turned', params: { roughness: 0.22 }, finish: 'turned' },
];

const METAL = { metalness: 1, roughness: 0.3 };

export const MATERIALS = [
  {
    id: 'cad',
    label: 'Original (CAD colour)',
    color: null,
    params: { metalness: 0, roughness: 0.5 },
    surfaces: [{ id: 'standard', label: 'Standard' }],
  },

  {
    id: 'aluminium',
    group: 'metal',
    label: 'Aluminium',
    color: '#cdd0d3',
    params: METAL,
    surfaces: [
      ...MACHINED,
      {
        id: 'anodised',
        label: 'Anodised',
        color: '#1b1c1f',
        params: { roughness: 0.36, clearcoat: 0.2, clearcoatRoughness: 0.25 },
      },
    ],
  },
  {
    id: 'steel',
    group: 'metal',
    label: 'Steel',
    color: '#8f9296',
    params: METAL,
    surfaces: [
      ...MACHINED,
      { id: 'ground', label: 'Ground', color: '#a3a6aa', params: { roughness: 0.2 }, finish: 'turned' },
      { id: 'black-oxide', label: 'Black oxide', color: '#2c2d30', params: { roughness: 0.42 } },
      { id: 'galvanised', label: 'Galvanised', color: '#b9bec4', params: { roughness: 0.5 } },
      { id: 'chrome', label: 'Chrome-plated', color: '#d4d6d9', params: { roughness: 0.03 } },
    ],
  },
  {
    id: 'stainless',
    group: 'metal',
    label: 'Stainless steel',
    color: '#c6c8cb',
    params: METAL,
    surfaces: [...MACHINED, { id: 'ground', label: 'Ground', params: { roughness: 0.18 }, finish: 'turned' }],
  },
  {
    id: 'cast-iron',
    group: 'metal',
    label: 'Cast iron',
    color: '#6c6e71',
    params: METAL,
    surfaces: [{ id: 'raw', label: 'Raw cast', params: { roughness: 0.62 } }, ...MACHINED],
  },
  { id: 'titanium', group: 'metal', label: 'Titanium', color: '#b5afa7', params: METAL, surfaces: MACHINED },
  { id: 'brass', group: 'metal', label: 'Brass', color: '#d8b56a', params: METAL, surfaces: MACHINED },
  { id: 'copper', group: 'metal', label: 'Copper', color: '#d98c68', params: METAL, surfaces: MACHINED },
  { id: 'gold', group: 'metal', label: 'Gold', color: '#f0c66b', params: METAL, surfaces: MACHINED },

  {
    id: 'plastic',
    group: 'plastic',
    label: 'Plastic',
    color: '#2b2d31',
    params: { metalness: 0, roughness: 0.42 },
    surfaces: [
      { id: 'satin', label: 'Satin', params: { roughness: 0.42 } },
      { id: 'matte', label: 'Matte', params: { roughness: 0.7 } },
      { id: 'glossy', label: 'Glossy', params: { roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.1 } },
    ],
  },
  {
    id: 'clear-plastic',
    group: 'plastic',
    label: 'Clear plastic',
    color: '#f4f8fb',
    params: { metalness: 0, roughness: 0.05, transmission: 1, ior: 1.49, thickness: 2 },
    surfaces: [
      { id: 'clear', label: 'Clear' },
      { id: 'frosted', label: 'Frosted', params: { roughness: 0.35 } },
    ],
  },
  {
    id: 'rubber',
    group: 'plastic',
    label: 'Rubber',
    color: '#141414',
    params: { metalness: 0, roughness: 0.95 },
    surfaces: [{ id: 'standard', label: 'Standard' }],
  },

  {
    id: 'paint',
    group: 'other',
    label: 'Paint',
    color: '#1f5fbf',
    params: { metalness: 0, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04 },
    surfaces: [
      { id: 'glossy', label: 'Glossy' },
      { id: 'matte', label: 'Matte', params: { roughness: 0.62, clearcoat: 0 } },
      { id: 'metallic', label: 'Metallic', params: { metalness: 0.55, roughness: 0.38, clearcoatRoughness: 0.03 } },
      { id: 'powder', label: 'Powder coated', params: { roughness: 0.48, clearcoat: 0.15, clearcoatRoughness: 0.45 } },
    ],
  },
  {
    id: 'glass',
    group: 'other',
    label: 'Glass',
    color: '#ffffff',
    params: { metalness: 0, roughness: 0.02, transmission: 1, ior: 1.5, thickness: 2 },
    surfaces: [
      { id: 'clear', label: 'Clear' },
      { id: 'frosted', label: 'Frosted', params: { roughness: 0.35 } },
    ],
  },
  {
    id: 'ceramic',
    group: 'other',
    label: 'Ceramic',
    color: '#f2f0ea',
    params: { metalness: 0, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.05 },
    surfaces: [
      { id: 'glazed', label: 'Glazed' },
      { id: 'unglazed', label: 'Unglazed', params: { roughness: 0.65, clearcoat: 0 } },
    ],
  },
];

const BY_ID = new Map(MATERIALS.map((material) => [material.id, material]));

/**
 * Materials of earlier versions, where every surface was its own material,
 * as [material, surface]. Projects and templates saved with them still open.
 */
const LEGACY = {
  'alu-satin': ['aluminium', 'satin'],
  'alu-matt': ['aluminium', 'blasted'],
  'alu-poliert': ['aluminium', 'polished'],
  'alu-gebuerstet': ['aluminium', 'brushed'],
  'alu-gedreht': ['aluminium', 'turned'],
  'alu-schwarz': ['aluminium', 'anodised'],
  'alu-eloxiert': ['aluminium', 'anodised'],
  stahl: ['steel', 'satin'],
  'stahl-geschliffen': ['steel', 'ground'],
  'stahl-bruniert': ['steel', 'black-oxide'],
  verzinkt: ['steel', 'galvanised'],
  chrom: ['steel', 'chrome'],
  edelstahl: ['stainless', 'polished'],
  'edelstahl-gebuerstet': ['stainless', 'brushed'],
  guss: ['cast-iron', 'raw'],
  titan: ['titanium', 'satin'],
  messing: ['brass', 'satin'],
  kupfer: ['copper', 'satin'],
  gold: ['gold', 'satin'],
  'kunststoff-matt': ['plastic', 'matte'],
  'kunststoff-seidenmatt': ['plastic', 'satin'],
  'kunststoff-glanz': ['plastic', 'glossy'],
  'kunststoff-transparent': ['clear-plastic', 'clear'],
  gummi: ['rubber', 'standard'],
  lack: ['paint', 'glossy'],
  'lack-matt': ['paint', 'matte'],
  'lack-metallic': ['paint', 'metallic'],
  pulver: ['paint', 'powder'],
  glas: ['glass', 'clear'],
  'glas-satiniert': ['glass', 'frosted'],
  keramik: ['ceramic', 'glazed'],
};

/** The default material of a new entry. */
export const DEFAULT_MATERIAL = 'aluminium';

export function getMaterialDef(id) {
  return BY_ID.get(id) || BY_ID.get(LEGACY[id]?.[0]) || MATERIALS[0];
}

/** A surface of a material; the material's first surface when the id is unknown. */
export function getSurface(materialId, surfaceId) {
  const def = getMaterialDef(materialId);
  return def.surfaces.find((surface) => surface.id === surfaceId) || def.surfaces[0];
}

/**
 * Material and surface ids for stored data, including materials of earlier
 * versions. A legacy material whose marks were changed by hand gets the
 * surface with those marks, e.g. satin aluminium set to brushed.
 */
export function migrateMaterial(materialId, surfaceId, savedFinish) {
  const legacy = LEGACY[materialId];
  if (!legacy) {
    const def = getMaterialDef(materialId);
    return { materialId: def.id, surfaceId: getSurface(def.id, surfaceId).id };
  }
  const [id, surface] = legacy;
  const keep = getSurface(id, surface);
  const finishOf = (item) => item.finish ?? 'none';
  if (!savedFinish || savedFinish === finishOf(keep)) return { materialId: id, surfaceId: keep.id };
  const matching = getMaterialDef(id).surfaces.find((item) => finishOf(item) === savedFinish);
  return { materialId: id, surfaceId: (matching || keep).id };
}

/** The library values of a material with a surface: { color, params, finish }. */
function surfaceLook(materialId, surfaceId) {
  const def = getMaterialDef(materialId);
  const surface = getSurface(materialId, surfaceId);
  return {
    color: surface.color ?? def.color,
    params: { ...def.params, ...surface.params },
    finish: surface.finish ?? 'none',
  };
}

/** Colour of a material with a surface in the library, e.g. black for anodised aluminium. */
export function surfaceColor(materialId, surfaceId) {
  return surfaceLook(materialId, surfaceId).color;
}

export function materialLabel(materialId, surfaceId) {
  const def = getMaterialDef(materialId);
  if (def.surfaces.length < 2) return def.label;
  return `${def.label}, ${getSurface(materialId, surfaceId).label.toLowerCase()}`;
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
 * material and surface. Sliders in the material panel change these; the
 * kind of machining marks comes from the surface.
 */
export function defaultTuning(materialId, surfaceId) {
  const { params } = surfaceLook(materialId, surfaceId);
  return {
    roughness: params.roughness ?? 0.5,
    metalness: params.metalness ?? 0,
    clearcoat: params.clearcoat ?? 0,
    finishAxis: 'auto',
    finishStrength: DEFAULT_FINISH_STRENGTH,
  };
}

const clamp01 = (value, fallback) => (Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback);

/** Validated tuning for a material, e.g. from a stored project. Missing values come from the library. */
export function sanitizeTuning(materialId, surfaceId, saved) {
  const base = defaultTuning(materialId, surfaceId);
  if (!saved || typeof saved !== 'object') return base;
  return {
    roughness: clamp01(saved.roughness, base.roughness),
    metalness: clamp01(saved.metalness, base.metalness),
    clearcoat: clamp01(saved.clearcoat, base.clearcoat),
    finishAxis: FINISH_AXES[saved.finishAxis] ? saved.finishAxis : base.finishAxis,
    finishStrength: clamp01(saved.finishStrength, base.finishStrength),
  };
}

export function isDefaultTuning(materialId, surfaceId, tuning) {
  const base = defaultTuning(materialId, surfaceId);
  return Object.keys(base).every((key) => base[key] === tuning[key]);
}

/**
 * Everything the 3D views need to build a part's material: the library
 * parameters with the user's tuning applied, the colour and the finish.
 */
export function resolveLook(materialId, surfaceId, colorHex, tuning) {
  const look = surfaceLook(materialId, surfaceId);
  const tune = tuning || defaultTuning(materialId, surfaceId);
  const finish = look.finish !== 'none' && tune.finishStrength > 0 ? look.finish : 'none';
  return {
    color: colorHex,
    params: {
      ...look.params,
      roughness: tune.roughness,
      metalness: tune.metalness,
      clearcoat: tune.clearcoat,
      clearcoatRoughness: look.params.clearcoatRoughness ?? 0.05,
      anisotropy: finish === 'none' ? 0 : tune.finishStrength,
    },
    finish,
    finishAxis: tune.finishAxis,
  };
}

/** Builds the three.js material for a part from its resolved look (see resolveLook). */
export function createMaterial(part) {
  const look = part.look || resolveLook(part.materialId, null, part.colorHex);
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
