import {
  state,
  newId,
  withIds,
  defaultScene,
  defaultLighting,
  defaultCamera,
  defaultOutput,
  defaultSectionCap,
  QUALITY,
  OUTPUT_SIZES,
  RENDER_DEVICES,
  FLOORS,
} from './state.js';
import { getMaterialDef, sanitizeTuning } from './materials.js';
import { getLightPreset, presetLights, sanitizeLight } from './environment.js';

/**
 * Projects and templates, kept in the browser.
 *
 * A project is one rendering job: its model, materials, scene, lighting,
 * camera, saved views and output settings. The settings live in localStorage;
 * the STEP file and a custom HDRI are too large for that and go to IndexedDB,
 * so a project opens again complete with its model.
 *
 * A template is a reusable set of settings without a model. Its materials
 * remember the part names they were assigned to, so they find their parts
 * again in a new revision of the same assembly.
 */

const PROJECTS_KEY = 'cad-render-engine:projects';
const TEMPLATES_KEY = 'cad-render-engine:templates';
// Settings of the version before projects existed; used once as defaults.
const LEGACY_SETTINGS_KEY = 'cad-render-engine:settings';

let index = null;
let templates = [];
let saveTimer = null;
let suspended = false;
let viewProvider = () => null;
let pendingPalette = null;

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or disabled; the app works without it.
  }
}

// --- Files in IndexedDB -------------------------------------------------------

let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('cad-render-engine', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withStore(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', mode);
    const request = run(transaction.objectStore('files'));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const warn = (error) => console.warn('File storage failed.', error);

export const fileKeys = {
  step: (projectId) => `step:${projectId}`,
  hdri: (projectId) => `hdri:${projectId}`,
  templateHdri: (templateId) => `hdri:template:${templateId}`,
};

/** Stored files. Failures are not fatal: the project then simply opens without its file. */
export const files = {
  put: (key, file) => withStore('readwrite', (store) => store.put({ name: file.name, blob: file }, key)).catch(warn),
  get: (key) =>
    withStore('readonly', (store) => store.get(key))
      .then((entry) => (entry ? new File([entry.blob], entry.name) : null))
      .catch(() => null),
  delete: (key) => withStore('readwrite', (store) => store.delete(key)).catch(warn),
  async copy(from, to) {
    const file = await files.get(from);
    if (file) await files.put(to, file);
    else await files.delete(to);
  },
};

// --- Snapshots ----------------------------------------------------------------

/** Copies `saved` over `defaults`, ignoring unknown keys and values of the wrong type. */
function mergeTyped(defaults, saved) {
  const result = { ...defaults };
  if (!saved || typeof saved !== 'object') return result;
  for (const key of Object.keys(defaults)) {
    const value = saved[key];
    if (value === undefined) continue;
    if (defaults[key] === null || typeof value === typeof defaults[key]) result[key] = value;
  }
  return result;
}

function settingsSnapshot() {
  return {
    scene: { ...state.scene },
    lighting: { ...state.lighting, lights: state.lighting.lights.map(({ id, ...light }) => light) },
    camera: { ...state.camera },
    output: { ...state.output },
  };
}

function modelSnapshot() {
  return {
    fileName: state.fileName,
    partCount: state.parts.length,
    materials: state.materials.map((entry) => ({
      materialId: entry.materialId,
      colorHex: entry.colorHex,
      tuning: { ...entry.tuning },
      partIds: [...entry.partIds],
    })),
    views: state.views.map(({ name, position, target, fov, roll }) => ({ name, position, target, fov, roll })),
    sections: state.sections.map(({ name, axis, position, flip, enabled, uncut }) => ({
      name,
      axis,
      position,
      flip,
      enabled,
      uncut: [...uncut],
    })),
    sectionCap: { ...state.sectionCap },
    hidden: state.parts.filter((part) => !part.mesh.visible).map((part) => part.id),
    view: viewProvider(),
  };
}

function blankRecord(name) {
  return { id: uid(), name, fileName: null, partCount: 0, materials: [], views: [], hidden: [], view: null };
}

function syncSummaries() {
  state.projects = index.projects.map(({ id, name, fileName }) => ({ id, name, fileName }));
  state.templates = templates.map(({ id, name }) => ({ id, name }));
}

/** Puts the scene, lighting, camera and output settings of a project or template into the state. */
export function applySettings(record) {
  state.scene = mergeTyped(defaultScene(), record.scene);
  // Projects from before the floor choice only had a switch for the shadow floor.
  if (record.scene && record.scene.floor === undefined && record.scene.ground === false) state.scene.floor = 'none';
  if (!FLOORS[state.scene.floor]) state.scene.floor = 'shadow';
  if (!['linear', 'radial'].includes(state.scene.gradientType)) state.scene.gradientType = 'linear';
  state.scene.reflection = Math.min(Math.max(state.scene.reflection, 0), 1);
  state.scene.reflectionBlur = Math.min(Math.max(state.scene.reflectionBlur, 0), 1);
  for (const key of ['gradientFrom', 'gradientTo', 'coveColor']) {
    if (!/^#[0-9a-f]{6}$/i.test(state.scene[key])) state.scene[key] = defaultScene()[key];
  }
  state.lighting = mergeTyped(defaultLighting(), record.lighting);
  if (state.lighting.presetId !== 'custom') {
    state.lighting.presetId = getLightPreset(state.lighting.presetId).id;
    state.lighting.hdriName = null;
    if (state.scene.background === 'environment') state.scene.background = 'light';
  }
  // Projects from before editable softboxes get the lights of their preset.
  const savedLights = record.lighting?.lights;
  state.lighting.lights = withIds(
    Array.isArray(savedLights)
      ? savedLights.map(sanitizeLight).filter(Boolean)
      : state.lighting.presetId === 'custom'
        ? []
        : presetLights(getLightPreset(state.lighting.presetId)),
  );
  state.camera = mergeTyped(defaultCamera(), record.camera);
  state.output = mergeTyped(defaultOutput(), record.output);
  if (!OUTPUT_SIZES[state.output.size]) state.output.size = 'view';
  if (!QUALITY[state.output.quality]) state.output.quality = 'standard';
  if (!RENDER_DEVICES[state.output.device]) state.output.device = 'gpu';
}

/**
 * Restores materials and saved views for the model that was just loaded, if
 * the project was last saved with the same file (by name and part count).
 * Returns the hidden parts and the camera to restore, or null.
 */
export function applyModelData(record) {
  if (!record || record.fileName !== state.fileName || record.partCount !== state.parts.length) return null;
  const valid = (id) => Number.isInteger(id) && id >= 0 && id < state.parts.length;
  state.materials = (record.materials || []).map((entry) => restoreEntry(entry, (entry.partIds || []).filter(valid)));
  state.views = (record.views || []).map((view) => ({ id: newId(), ...view }));
  state.sections = (record.sections || [])
    .filter((section) => [0, 1, 2].includes(section.axis) && Number.isFinite(section.position))
    .map((section) => ({
      id: newId(),
      name: String(section.name || 'Schnitt'),
      axis: section.axis,
      position: section.position,
      flip: Boolean(section.flip),
      enabled: section.enabled !== false,
      uncut: new Set((section.uncut || []).filter(valid)),
    }));
  state.sectionCap = mergeTyped(defaultSectionCap(), record.sectionCap);
  return { hidden: (record.hidden || []).filter(valid), view: record.view || null };
}

/**
 * Recreates template materials and assigns them to the parts with the
 * remembered names. A template with a single material means "everything in
 * this material" and gets all parts.
 */
export function applyPalette(palette) {
  const claimed = new Set();
  const single = (palette || []).length === 1;
  state.materials = (palette || []).map((item) => {
    const names = new Set(item.partNames || []);
    const partIds = new Set();
    for (const part of state.parts) {
      if ((!single && !names.has(part.name)) || claimed.has(part.id)) continue;
      partIds.add(part.id);
      claimed.add(part.id);
    }
    return restoreEntry(item, partIds);
  });
}

/** A material entry from stored data. Entries saved before the sliders existed get the library values. */
function restoreEntry(saved, partIds) {
  const def = getMaterialDef(saved.materialId);
  return {
    id: newId(),
    materialId: def.id,
    colorHex: /^#[0-9a-f]{6}$/i.test(saved.colorHex) ? saved.colorHex : def.color,
    tuning: sanitizeTuning(def.id, saved.tuning),
    partIds: new Set(partIds),
  };
}

/** Template materials wait here while the project has no model yet. */
export function setPendingPalette(palette) {
  pendingPalette = palette && palette.length > 0 ? palette : null;
}

export function takePendingPalette() {
  const palette = pendingPalette;
  pendingPalette = null;
  return palette;
}

// --- Saving -------------------------------------------------------------------

/** The viewer's current camera is saved with the project; main supplies it. */
export function setViewProvider(provider) {
  viewProvider = provider;
}

/** While a project is being switched or loaded, the half-built state must not be saved. */
export function suspendSaving(value) {
  suspended = value;
  if (value) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (suspended || !index) return;
  const record = currentRecord();
  if (!record) return;
  record.name = state.project.name.trim() || 'Projekt';
  Object.assign(record, settingsSnapshot());
  // Without a model the last saved model data stays, so a failed load loses nothing.
  if (state.parts.length > 0) Object.assign(record, modelSnapshot());
  write(PROJECTS_KEY, index);
  syncSummaries();
}

/** Saves shortly after the last change, so dragging a slider does not write constantly. */
export function scheduleSave() {
  if (suspended) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

// Do not lose the last change when the tab is closed or reloaded right after it.
window.addEventListener('pagehide', () => {
  if (saveTimer !== null) saveNow();
});

// --- Projects -----------------------------------------------------------------

export function currentRecord() {
  return index.projects.find((project) => project.id === index.currentId) || null;
}

/** Loads the stored projects and templates and returns the project to open. */
export function initProjects() {
  index = read(PROJECTS_KEY);
  if (!index || !Array.isArray(index.projects) || index.projects.length === 0) {
    const first = blankRecord('Projekt 1');
    const legacy = read(LEGACY_SETTINGS_KEY);
    if (legacy) {
      first.lighting = legacy.lighting;
      first.output = legacy.output;
      if (legacy.scene) first.scene = { floor: legacy.scene.ground === false ? 'none' : 'shadow' };
    }
    index = { currentId: first.id, projects: [first] };
  }
  if (!currentRecord()) index.currentId = index.projects[0].id;
  const savedTemplates = read(TEMPLATES_KEY);
  templates = Array.isArray(savedTemplates) ? savedTemplates : [];
  syncSummaries();
  // Ask the browser not to evict the stored models when disk space runs low.
  navigator.storage?.persist?.().catch(() => {});
  return currentRecord();
}

function uniqueName(base, taken) {
  if (!taken.includes(base)) return base;
  let number = 2;
  while (taken.includes(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

export function createProject() {
  const names = index.projects.map((project) => project.name);
  let number = index.projects.length + 1;
  while (names.includes(`Projekt ${number}`)) number += 1;
  const record = blankRecord(`Projekt ${number}`);
  index.projects.push(record);
  write(PROJECTS_KEY, index);
  syncSummaries();
  return record;
}

export async function duplicateProject(id) {
  const source = index.projects.find((project) => project.id === id);
  if (!source) return null;
  const record = JSON.parse(JSON.stringify(source));
  record.id = uid();
  record.name = uniqueName(
    `${source.name} Kopie`,
    index.projects.map((project) => project.name),
  );
  await files.copy(fileKeys.step(source.id), fileKeys.step(record.id));
  await files.copy(fileKeys.hdri(source.id), fileKeys.hdri(record.id));
  index.projects.push(record);
  write(PROJECTS_KEY, index);
  syncSummaries();
  return record;
}

/** Deletes a project and returns the one that is current afterwards. */
export function deleteProject(id) {
  index.projects = index.projects.filter((project) => project.id !== id);
  files.delete(fileKeys.step(id));
  files.delete(fileKeys.hdri(id));
  if (index.projects.length === 0) index.projects.push(blankRecord('Projekt 1'));
  if (!currentRecord()) index.currentId = index.projects[0].id;
  write(PROJECTS_KEY, index);
  syncSummaries();
  return currentRecord();
}

export function setCurrentProject(id) {
  const record = index.projects.find((project) => project.id === id);
  if (!record) return null;
  index.currentId = id;
  write(PROJECTS_KEY, index);
  return record;
}

// --- Templates ----------------------------------------------------------------

export function getTemplate(id) {
  return templates.find((template) => template.id === id) || null;
}

/** Saves the current settings as a template. A template with the same name is replaced. */
export async function saveTemplate(name) {
  const existing = templates.find((template) => template.name === name);
  const template = {
    id: existing?.id ?? uid(),
    name,
    ...settingsSnapshot(),
    fov: viewProvider()?.fov ?? null,
    materials: state.materials.map((entry) => ({
      materialId: entry.materialId,
      colorHex: entry.colorHex,
      tuning: { ...entry.tuning },
      partNames: [...new Set([...entry.partIds].map((partId) => state.parts[partId]?.name).filter(Boolean))],
    })),
  };
  // The focus point belongs to one model and view, not to a reusable setup.
  template.camera.focusPoint = null;
  if (state.lighting.presetId === 'custom') {
    await files.copy(fileKeys.hdri(state.project.id), fileKeys.templateHdri(template.id));
  } else {
    files.delete(fileKeys.templateHdri(template.id));
  }
  templates = existing ? templates.map((item) => (item === existing ? template : item)) : [...templates, template];
  write(TEMPLATES_KEY, templates);
  syncSummaries();
  return template;
}

export function deleteTemplate(id) {
  templates = templates.filter((template) => template.id !== id);
  files.delete(fileKeys.templateHdri(id));
  write(TEMPLATES_KEY, templates);
  syncSummaries();
}
