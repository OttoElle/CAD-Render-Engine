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
  OUTPUT_ASPECTS,
  OUTPUT_RESOLUTIONS,
  LEGACY_OUTPUT_SIZES,
  RENDER_DEVICES,
  TURNTABLE_FRAMES,
  TURNTABLE_SECONDS,
  JOB_SETTINGS,
  UP_AXES,
  FLOORS,
  defaultAdjust,
} from './state.js';
import { getMaterialDef, sanitizeTuning } from './materials.js';
import {
  defaultExplode,
  cloneExplode,
  EXPLODE_DIRECTIONS,
  PART_EXPLODE_DIRECTIONS,
  defaultPartExplode,
} from './explode.js';
import { FILE_FORMATS } from './export.js';
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
  thumbnail: (projectId) => `thumb:${projectId}`,
  /** A finished rendering: its image, or image `frame` of a turntable series. */
  render: (projectId, key, frame = null) => `render:${projectId}:${key}${frame === null ? '' : `:${frame}`}`,
  renderThumbnail: (projectId, key) => `renderthumb:${projectId}:${key}`,
};

/** Deletes the stored files of a rendering. */
export function deleteRenderFiles(projectId, meta) {
  files.delete(fileKeys.renderThumbnail(projectId, meta.key));
  if (meta.turntable) {
    for (let i = 0; i < (meta.frameCount || 0); i++) files.delete(fileKeys.render(projectId, meta.key, i));
  } else {
    files.delete(fileKeys.render(projectId, meta.key));
  }
}

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

const validPart = (id) => Number.isInteger(id) && id >= 0 && id < state.parts.length;

function sanitizeExplode(saved) {
  const explode = mergeTyped(defaultExplode(), saved);
  if (!EXPLODE_DIRECTIONS[explode.direction]) explode.direction = 'radial';
  explode.amount = Math.min(Math.max(Number(explode.amount) || 0, 0), 3);
  if (!validPart(explode.anchor)) explode.anchor = null;
  const parts = {};
  for (const [id, item] of Object.entries(saved?.parts || {})) {
    if (!validPart(Number(id))) continue;
    const own = mergeTyped(defaultPartExplode(), item);
    if (!PART_EXPLODE_DIRECTIONS[own.direction]) own.direction = 'auto';
    own.factor = Math.min(Math.max(Number(own.factor) || 0, 0), 5);
    parts[id] = own;
  }
  explode.parts = parts;
  return explode;
}

const isVector = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

function sanitizeViewState(saved) {
  if (!saved || !isVector(saved.position) || !isVector(saved.target)) return null;
  return {
    position: saved.position,
    target: saved.target,
    fov: Number.isFinite(saved.fov) ? saved.fov : 35,
    roll: Number.isFinite(saved.roll) ? saved.roll : 0,
  };
}

/** Checks image and file settings, as used by the output defaults and by render jobs. */
function sanitizeImageSettings(settings) {
  if (!OUTPUT_ASPECTS[settings.aspect]) settings.aspect = 'view';
  if (!OUTPUT_RESOLUTIONS[settings.resolution]) settings.resolution = 1920;
  for (const key of ['width', 'height']) settings[key] = Math.min(Math.max(Math.round(Number(settings[key]) || 1920), 64), 8192);
  if (!QUALITY[settings.quality]) settings.quality = 'standard';
  if (!FILE_FORMATS[settings.format]) settings.format = 'png';
  if (!TURNTABLE_FRAMES.includes(settings.turntableFrames)) settings.turntableFrames = 36;
  if (!TURNTABLE_SECONDS.includes(settings.turntableSeconds)) settings.turntableSeconds = 6;
  return settings;
}

function sanitizeJob(saved) {
  const camera = sanitizeViewState(saved?.camera);
  if (!camera) return null;
  const defaults = defaultOutput();
  const job = {
    id: newId(),
    name: typeof saved.name === 'string' && saved.name.trim() ? saved.name : 'Render job',
    type: saved.type === 'animation' ? 'animation' : 'image',
    camera,
    explode: sanitizeExplode(saved.explode),
  };
  for (const key of JOB_SETTINGS) job[key] = typeof saved[key] === typeof defaults[key] ? saved[key] : defaults[key];
  return sanitizeImageSettings(job);
}

/** Metadata of a stored rendering, as kept in the project record. */
export function sanitizeRenderMeta(saved) {
  if (!saved || typeof saved.key !== 'string') return null;
  const adjust = mergeTyped(defaultAdjust(), saved.adjust);
  return {
    key: saved.key,
    name: String(saved.name || 'Rendering'),
    width: Number(saved.width) || 0,
    height: Number(saved.height) || 0,
    seconds: Number(saved.seconds) || 0,
    samples: Number(saved.samples) || 0,
    denoised: Boolean(saved.denoised),
    transparent: Boolean(saved.transparent),
    note: typeof saved.note === 'string' ? saved.note : null,
    deviceName: typeof saved.deviceName === 'string' ? saved.deviceName : null,
    turntable: Number(saved.turntable) || 0,
    frameCount: Number(saved.frameCount) || 0,
    turntableSeconds: TURNTABLE_SECONDS.includes(saved.turntableSeconds) ? saved.turntableSeconds : 6,
    format: FILE_FORMATS[saved.format] ? saved.format : 'png',
    createdAt: Number(saved.createdAt) || Date.now(),
    adjust,
  };
}

/** What is kept of a finished rendering in the project record; the images are in IndexedDB. */
export function renderMeta(render) {
  return {
    key: render.key,
    name: render.name,
    width: render.width,
    height: render.height,
    seconds: render.seconds,
    samples: render.samples,
    denoised: render.denoised,
    transparent: render.transparent,
    note: render.note,
    deviceName: render.deviceName,
    turntable: render.turntable,
    frameCount: render.turntable ? render.frames.length : 0,
    turntableSeconds: render.turntableSeconds,
    format: render.format,
    createdAt: render.createdAt,
    adjust: { ...render.adjust },
  };
}

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
    views: state.views.map(({ name, position, target, fov, roll, explode }) => ({
      name,
      position,
      target,
      fov,
      roll,
      explode: cloneExplode(explode),
    })),
    explode: cloneExplode(state.explode),
    upAxis: state.upAxis,
    partOffsets: Object.fromEntries(state.partOffsets),
    jobs: state.jobs.map(({ id, ...job }) => ({ ...job, explode: cloneExplode(job.explode) })),
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
  return {
    id: uid(),
    name,
    modifiedAt: Date.now(),
    fileName: null,
    partCount: 0,
    materials: [],
    views: [],
    jobs: [],
    renders: [],
    hidden: [],
    view: null,
  };
}

/**
 * The whole project as plain data, for taking back changes made in a panel.
 * applySettings and applyModelData restore it.
 */
export function snapshotProject() {
  return JSON.parse(
    JSON.stringify({ ...settingsSnapshot(), ...(state.parts.length > 0 ? modelSnapshot() : {}) }),
  );
}

function syncSummaries() {
  state.projects = index.projects.map((project) => ({
    id: project.id,
    name: project.name,
    fileName: project.fileName,
    modifiedAt: project.modifiedAt || 0,
    partCount: project.fileName ? project.partCount || 0 : 0,
    materialCount: project.fileName ? (project.materials || []).length : 0,
    viewCount: project.fileName ? (project.views || []).length : 0,
    renderCount: (project.renders || []).length,
  }));
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
  // Earlier versions had one choice for proportions and size together.
  const legacy = record.output && record.output.aspect === undefined ? LEGACY_OUTPUT_SIZES[record.output.size] : null;
  if (legacy) [state.output.aspect, state.output.resolution] = legacy;
  delete state.output.size;
  sanitizeImageSettings(state.output);
  if (!RENDER_DEVICES[state.output.device]) state.output.device = 'gpu';
}

/**
 * Restores materials and saved views for the model that was just loaded, if
 * the project was last saved with the same file (by name and part count).
 * Returns the hidden parts and the camera to restore, or null.
 */
export function applyModelData(record) {
  if (!record || record.fileName !== state.fileName || record.partCount !== state.parts.length) return null;
  const valid = validPart;
  state.materials = (record.materials || []).map((entry) => restoreEntry(entry, (entry.partIds || []).filter(valid)));
  state.views = (record.views || []).map((view) => ({ id: newId(), ...view, explode: sanitizeExplode(view.explode) }));
  state.explode = sanitizeExplode(record.explode);
  state.upAxis = UP_AXES[record.upAxis] ? record.upAxis : '+Z';
  state.partOffsets = new Map(
    Object.entries(record.partOffsets || {})
      .map(([id, offset]) => [Number(id), offset])
      .filter(([id, offset]) => valid(id) && isVector(offset)),
  );
  state.jobs = (record.jobs || []).map(sanitizeJob).filter(Boolean);
  state.sections = (record.sections || [])
    .filter((section) => [0, 1, 2].includes(section.axis) && Number.isFinite(section.position))
    .map((section) => ({
      id: newId(),
      name: String(section.name || 'Section'),
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
  const changes = {
    name: state.project.name.trim() || 'Project',
    ...settingsSnapshot(),
    // Renderings belong to the project, also while its model is missing.
    renders: state.renders.filter((render) => render.stored).map(renderMeta),
  };
  // Without a model the last saved model data stays, so a failed load loses nothing.
  if (state.parts.length > 0) Object.assign(changes, modelSnapshot());
  // Only real changes count for "last modified"; moving the camera does not.
  const { view, ...compared } = changes;
  if (Object.entries(compared).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(record[key]))) {
    record.modifiedAt = Date.now();
  }
  Object.assign(record, changes);
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
    const first = blankRecord('Project 1');
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

/** A name for a new project that is not taken yet. */
export function nextProjectName() {
  const names = index.projects.map((project) => project.name);
  let number = index.projects.length + 1;
  while (names.includes(`Project ${number}`)) number += 1;
  return `Project ${number}`;
}

export function createProject(name = nextProjectName()) {
  const record = blankRecord(
    uniqueName(
      name.trim() || nextProjectName(),
      index.projects.map((project) => project.name),
    ),
  );
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
    `${source.name} copy`,
    index.projects.map((project) => project.name),
  );
  // Renderings stay with the original; their images are large.
  record.renders = [];
  await files.copy(fileKeys.step(source.id), fileKeys.step(record.id));
  await files.copy(fileKeys.hdri(source.id), fileKeys.hdri(record.id));
  await files.copy(fileKeys.thumbnail(source.id), fileKeys.thumbnail(record.id));
  record.modifiedAt = Date.now();
  index.projects.push(record);
  write(PROJECTS_KEY, index);
  syncSummaries();
  return record;
}

/** Deletes a project and returns the one that is current afterwards. */
export function deleteProject(id) {
  const record = getProject(id);
  index.projects = index.projects.filter((project) => project.id !== id);
  files.delete(fileKeys.step(id));
  files.delete(fileKeys.hdri(id));
  files.delete(fileKeys.thumbnail(id));
  for (const meta of record?.renders || []) deleteRenderFiles(id, meta);
  if (index.projects.length === 0) index.projects.push(blankRecord('Project 1'));
  if (!currentRecord()) index.currentId = index.projects[0].id;
  write(PROJECTS_KEY, index);
  syncSummaries();
  return currentRecord();
}

/** The stored record of a project, as it is written to a project file. */
export function getProject(id) {
  return index.projects.find((project) => project.id === id) || null;
}

/** Renames a stored project; the name stays unique. */
export function renameProject(id, name) {
  const record = getProject(id);
  const trimmed = name.trim();
  if (!record || !trimmed || trimmed === record.name) return record;
  record.name = uniqueName(
    trimmed,
    index.projects.filter((project) => project !== record).map((project) => project.name),
  );
  record.modifiedAt = Date.now();
  write(PROJECTS_KEY, index);
  syncSummaries();
  return record;
}

/** Stores changed render metadata (e.g. image adjustments) of any project. */
export function updateRenderMeta(projectId, key, changes) {
  const meta = getProject(projectId)?.renders?.find((item) => item.key === key);
  if (!meta) return;
  Object.assign(meta, changes);
  write(PROJECTS_KEY, index);
}

/**
 * Stores a project read from a project file, with its STEP model and HDRI.
 * With `replace`, it overwrites the project with the same id (the same
 * project, coming back from another computer). Otherwise it is added, under
 * a new id if that one is taken, and under a free name.
 */
export async function importProject(data, { step, hdri, replace }) {
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported project';
  // Project files carry no renderings.
  const record = { ...blankRecord(name), ...data, name, renders: [] };
  const existing = replace ? getProject(data.id) : null;
  if (existing) {
    for (const meta of existing.renders || []) deleteRenderFiles(existing.id, meta);
    index.projects = index.projects.map((project) => (project === existing ? record : project));
  } else {
    if (typeof data.id !== 'string' || getProject(data.id)) record.id = uid();
    record.name = uniqueName(
      name,
      index.projects.map((project) => project.name),
    );
    index.projects.push(record);
  }
  if (step) await files.put(fileKeys.step(record.id), step);
  else await files.delete(fileKeys.step(record.id));
  if (hdri) await files.put(fileKeys.hdri(record.id), hdri);
  else await files.delete(fileKeys.hdri(record.id));
  write(PROJECTS_KEY, index);
  syncSummaries();
  return record;
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
