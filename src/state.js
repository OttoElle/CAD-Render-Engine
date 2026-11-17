import { getMaterialDef } from './materials.js';

export const defaultScene = () => ({ background: 'light', ground: true });
export const defaultLighting = () => ({ presetId: 'studio-soft', rotation: 0, intensity: 1, hdriName: null });
export const defaultCamera = () => ({ dof: false, fStop: 4, focusPoint: null });
export const defaultOutput = () => ({
  size: 'view',
  width: 1920,
  height: 1080,
  quality: 'standard',
  transparent: false,
  denoise: true,
  device: 'gpu',
  gentle: false,
});

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
  /** Material entries: { id, materialId, colorHex, partIds:Set }. A part is in at most one entry. */
  materials: [],
  /** `background` is 'light', 'grey', 'white', 'dark', 'environment' (show the HDRI) or a hex colour. */
  scene: defaultScene(),
  /** `hdriName` is set while a user-supplied HDRI file is loaded (presetId 'custom'). */
  lighting: defaultLighting(),
  /** Lens settings that only show in the final rendering. `focusPoint` is a world position or null (pivot). */
  camera: defaultCamera(),
  /** Saved views: { id, name, position, target, fov, roll }. */
  views: [],
  output: defaultOutput(),
  /** Renderings: { id, name, status, progress, samples, width, height, blob, url, handle, seconds }. */
  renders: [],
  /** Key of the tree node whose settings are shown, e.g. "geometry" or "material:3". */
  selected: 'geometry',
};

export const QUALITY = {
  draft: { label: 'Entwurf', samples: 64 },
  standard: { label: 'Standard', samples: 256 },
  high: { label: 'Hoch', samples: 1024 },
  ultra: { label: 'Sehr hoch', samples: 4096 },
};

export const OUTPUT_SIZES = {
  view: { label: 'Wie Ansicht' },
  hd: { label: 'Full HD 16:9 (1920 × 1080)', width: 1920, height: 1080 },
  square: { label: 'Quadrat (1920 × 1920)', width: 1920, height: 1920 },
  uhd: { label: '4K 16:9 (3840 × 2160)', width: 3840, height: 2160 },
  portrait: { label: 'Hochformat 4:5 (1600 × 2000)', width: 1600, height: 2000 },
  custom: { label: 'Eigene Größe' },
};

export const RENDER_DEVICES = {
  gpu: { label: 'Grafikkarte' },
  cpu: { label: 'CPU (sehr langsam)' },
};

const listeners = new Set();
let nextId = 1;

export function subscribe(listener) {
  listeners.add(listener);
}

/** Notifies listeners. `what` names the area that changed so they can update selectively. */
export function emit(what) {
  for (const listener of listeners) listener(what);
}

export function newId() {
  return nextId++;
}

export function select(key) {
  state.selected = key;
  emit('selection');
}

function clearRenders() {
  for (const render of state.renders) {
    render.handle?.cancel();
    if (render.url) URL.revokeObjectURL(render.url);
  }
  state.renders = [];
}

/** Replaces the model. Materials and views start empty; the caller restores saved ones. */
export function resetForModel(fileName, parts) {
  clearRenders();
  state.fileName = fileName;
  state.parts = parts;
  state.materials = [];
  state.views = [];
}

/** Empties everything that belongs to a project, before another one is loaded. */
export function resetForProject(project) {
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
