import { getMaterialDef, defaultTuning } from './materials.js';
import { getLightPreset, presetLights } from './environment.js';
import { defaultExplode } from './explode.js';

let nextId = 1;

export function newId() {
  return nextId++;
}

/** Gives stored or preset items the runtime ids the tree uses. */
export function withIds(items) {
  return items.map((item) => ({ ...item, id: newId() }));
}

export const defaultScene = () => ({
  background: 'light',
  floor: 'shadow',
  gradientType: 'linear',
  gradientFrom: '#ffffff',
  gradientTo: '#c9ced6',
  coveColor: '#e4e6ea',
  reflection: 0,
  reflectionBlur: 0.1,
});

/** Floor shapes. */
export const FLOORS = {
  shadow: 'Flat floor',
  cove: 'Cove (curves up behind the model)',
  none: 'No floor',
};

/** Solid background colours by name; anything else is a hex colour. */
export const BACKGROUND_COLORS = {
  light: 'Light',
  white: 'White',
  grey: 'Grey',
  dark: 'Dark',
};

/** Which CAD axis points up in the scene. */
export const UP_AXES = {
  '+Z': '+Z (usual for CAD)',
  '+Y': '+Y',
  '+X': '+X',
  '-Z': '−Z',
  '-Y': '−Y',
  '-X': '−X',
};
export const defaultLighting = () => ({
  presetId: 'studio-soft',
  rotation: 0,
  intensity: 1,
  hdriName: null,
  lights: withIds(presetLights(getLightPreset('studio-soft'))),
});
export const defaultCamera = () => ({ dof: false, fStop: 4, focusPoint: null });
export const defaultSectionCap = () => ({ mode: 'material', color: '#d9534f' });
/**
 * Rendering device and the settings new render jobs start with. A job copies
 * these; afterwards it keeps its own.
 */
export const defaultOutput = () => ({
  /** Proportions (see OUTPUT_ASPECTS) and the longer side in pixels; `width`/`height` for a custom size. */
  aspect: '16:9',
  resolution: 1920,
  width: 1920,
  height: 1080,
  quality: 'standard',
  transparent: false,
  denoise: true,
  device: 'gpu',
  gentle: false,
  /** File format for saving: 'png' or 'jpg' (see FILE_FORMATS in export.js). */
  format: 'png',
  /** Images per turn of a turntable series. */
  turntableFrames: 36,
  /** Length of one turn in the video, in seconds. */
  turntableSeconds: 6,
});

/** Choices for the number of images in a turntable series. */
export const TURNTABLE_FRAMES = [24, 36, 72, 120];
/** Choices for the length of one turn in the video. */
export const TURNTABLE_SECONDS = [4, 6, 8, 12];

/** Settings of a render job that come from the output defaults. */
export const JOB_SETTINGS = [
  'aspect',
  'resolution',
  'width',
  'height',
  'quality',
  'denoise',
  'format',
  'transparent',
  'turntableFrames',
  'turntableSeconds',
];

/** Image adjustments of a finished rendering, each from -100 to 100 (vignette 0 to 100). */
export const defaultAdjust = () => ({ exposure: 0, contrast: 0, saturation: 0, warmth: 0, vignette: 0 });

/**
 * Application state for everything the tree shows. The viewer owns the 3D
 * objects; this module owns the user's choices and tells listeners when they
 * change.
 */
export const state = {
  /** The project being worked on: { id, name }. Everything below belongs to it. */
  project: { id: null, name: '' },
  /** Summaries of all stored projects and templates, for the project panel. */
  projects: [],
  templates: [],
  fileName: null,
  parts: [],
  /**
   * Section cuts: { id, name, axis (0 = X, 1 = Y, 2 = Z in CAD coordinates), position (mm),
   * flip, enabled, uncut:Set of part ids that stay whole }.
   */
  sections: [],
  /** How cut faces look: `mode` 'material' (like the part) or 'color'. */
  sectionCap: defaultSectionCap(),
  /**
   * Material entries: { id, materialId, colorHex, tuning, partIds:Set }. A part is in at most one entry.
   * `tuning` holds the slider values (roughness, metalness, clearcoat, finish, finishAxis, finishStrength).
   */
  materials: [],
  /**
   * `background` is 'light', 'grey', 'white', 'dark', 'gradient', 'environment' (show the HDRI) or a hex colour.
   * `floor` is 'shadow' (seamless floor that only shows shadows and reflections), 'cove' (a backdrop curving
   * up behind the model) or 'none'. `reflection` is the floor's reflectance (0 to 1).
   */
  scene: defaultScene(),
  /**
   * `hdriName` is set while a user-supplied HDRI file is loaded (presetId 'custom').
   * `lights` are the softboxes on top of the preset or HDRI: { id, name, az, el, width, height, power, color, round, enabled }.
   * `intensity` scales all light; the panel shows it as exposure in EV.
   */
  lighting: defaultLighting(),
  /** Lens settings that only show in the final rendering. `focusPoint` is a world position or null (pivot). */
  camera: defaultCamera(),
  /** Exploded view, see defaultExplode in explode.js. */
  explode: defaultExplode(),
  /** Which CAD axis points up (see UP_AXES). */
  upAxis: '+Z',
  /** Parts moved by the user: part id → [x, y, z] offset in CAD coordinates (mm). */
  partOffsets: new Map(),
  /** Parts turned by the user: part id → [x, y, z] angles in degrees about the CAD axes, around the part's centre. */
  partRotations: new Map(),
  /** Saved views: { id, name, position, target, fov, roll, explode }. */
  views: [],
  output: defaultOutput(),
  /**
   * Render jobs: { id, name, type ('image' or 'animation'), camera (a view state), explode,
   * and the settings listed in JOB_SETTINGS }.
   */
  jobs: [],
  /**
   * Renderings: { id, key (stable id for storage), name, status, progress, samples, width, height,
   * blob, url, handle, seconds, frames, adjust, stored, loaded }.
   */
  renders: [],
  /** Key of the tree node whose settings are shown, e.g. "geometry" or "material:3". */
  selected: 'geometry',
};

export const QUALITY = {
  draft: { label: 'Draft', samples: 64 },
  standard: { label: 'Standard', samples: 256 },
  high: { label: 'High', samples: 1024 },
  ultra: { label: 'Very high', samples: 4096 },
};

/** Image proportions; `ratio` is width / height. "Like the view" follows the free part of the viewport. */
export const OUTPUT_ASPECTS = {
  view: { label: 'Like the view' },
  '16:9': { label: 'Landscape 16:9', ratio: 16 / 9 },
  '3:2': { label: 'Landscape 3:2', ratio: 3 / 2 },
  '4:3': { label: 'Landscape 4:3', ratio: 4 / 3 },
  '1:1': { label: 'Square 1:1', ratio: 1 },
  '4:5': { label: 'Portrait 4:5', ratio: 4 / 5 },
  '2:3': { label: 'Portrait 2:3', ratio: 2 / 3 },
  '9:16': { label: 'Portrait 9:16', ratio: 9 / 16 },
  custom: { label: 'Custom size in pixels' },
};

/** Resolutions as the length of the image's longer side in pixels. */
export const OUTPUT_RESOLUTIONS = {
  1280: 'HD (1280 px)',
  1920: 'Full HD (1920 px)',
  2560: '2K (2560 px)',
  3840: '4K (3840 px)',
};

/** Output sizes of earlier versions, as proportion and resolution. */
export const LEGACY_OUTPUT_SIZES = {
  view: ['view', 1920],
  hd: ['16:9', 1920],
  square: ['1:1', 1920],
  uhd: ['16:9', 3840],
  portrait: ['4:5', 1920],
  custom: ['custom', 1920],
};

export const RENDER_DEVICES = {
  gpu: { label: 'Graphics card' },
  cpu: { label: 'CPU (very slow)' },
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
}

/** Notifies listeners. `what` names the area that changed so they can update selectively. */
export function emit(what) {
  for (const listener of listeners) listener(what);
}


export function select(key) {
  state.selected = key;
  emit('selection');
}

export function clearRenders() {
  for (const render of state.renders) {
    // Also stops a turntable series and anything still waiting in the queue.
    render.status = 'cancelled';
    render.handle?.cancel();
    if (render.url) URL.revokeObjectURL(render.url);
    for (const frame of render.frames || []) URL.revokeObjectURL(frame.url);
  }
  state.renders = [];
}

/**
 * Replaces the model. Materials, views and jobs start empty; the caller
 * restores saved ones. Finished renderings belong to the project and stay.
 */
export function resetForModel(fileName, parts) {
  state.fileName = fileName;
  state.parts = parts;
  state.materials = [];
  state.sections = [];
  state.sectionCap = defaultSectionCap();
  state.explode = defaultExplode();
  state.upAxis = '+Z';
  state.partOffsets = new Map();
  state.partRotations = new Map();
  state.views = [];
  state.jobs = [];
}

/** Empties everything that belongs to a project, before another one is loaded. */
export function resetForProject(project) {
  clearRenders();
  resetForModel(null, []);
  state.project = { id: project.id, name: project.name };
  state.scene = defaultScene();
  state.lighting = defaultLighting();
  state.camera = defaultCamera();
  state.output = defaultOutput();
}

/** The material entry a part belongs to, or null if it keeps its CAD colour. */
export function materialEntryOf(partId) {
  return state.materials.find((entry) => entry.partIds.has(partId)) || null;
}

export function addMaterial(materialId = 'alu-satin', { claimAll = true } = {}) {
  const entry = {
    id: newId(),
    materialId,
    colorHex: getMaterialDef(materialId).color,
    tuning: defaultTuning(materialId),
    partIds: new Set(),
  };
  // The first entry starts with every part, which is the common case for single parts.
  if (claimAll && state.materials.length === 0) {
    for (const part of state.parts) entry.partIds.add(part.id);
  }
  state.materials.push(entry);
  emit('materials');
  return entry;
}

export function removeMaterial(id) {
  state.materials = state.materials.filter((entry) => entry.id !== id);
  emit('materials');
}

/** Assigns or unassigns parts for an entry (null = back to the CAD colour), removing them from every other entry. */
export function setPartsAssigned(entry, partIds, assigned) {
  for (const partId of partIds) {
    if (assigned || !entry) {
      for (const other of state.materials) other.partIds.delete(partId);
      entry?.partIds.add(partId);
    } else {
      entry.partIds.delete(partId);
    }
  }
  emit('materials');
}

export function materialEntryLabel(entry) {
  return getMaterialDef(entry.materialId).label;
}
