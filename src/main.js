import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { Viewer } from './viewer.js';
import { drawGuides, loadGuides, saveGuides, GUIDE_TYPES } from './guides.js';
import { openMenu } from './menu.js';
import { SHORTCUT_ACTIONS, shortcutFor, shortcutLabel } from './shortcuts.js';
import { renderSettings, isRecordingShortcut } from './settings.js';
import { ViewCube } from './viewcube.js';
import { loadStepFile } from './step-loader.js';
import { getMaterialDef, resolveLook } from './materials.js';
import { loadHdriFile, getLightPreset, presetLights, newLight } from './environment.js';
import {
  initProjects,
  currentRecord,
  createProject,
  duplicateProject,
  deleteProject,
  getProject,
  renameProject,
  nextProjectName,
  importProject,
  snapshotProject,
  renderMeta,
  sanitizeRenderMeta,
  deleteRenderFiles,
  setCurrentProject,
  applySettings,
  applyModelData,
  applyPalette,
  setPendingPalette,
  takePendingPalette,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  setViewProvider,
  suspendSaving,
  scheduleSave,
  saveNow,
  files,
  fileKeys,
  addedFileCount,
} from './persistence.js';
import { sectionToPlane } from './section.js';
import { sceneGradient } from './backdrop.js';
import { explodeOffsets, defaultExplode } from './explode.js';
import { adjustCss, adjustImage } from './adjust.js';
import {
  FILE_FORMATS,
  convertImage,
  downloadBlob,
  recordVideo,
  safeFileName,
  zipFiles,
} from './export.js';
import { PROJECT_EXTENSION, packProject, unpackProject } from './project-file.js';
import { renderTree, setCollapsed } from './tree.js';
import { renderOverview } from './overview.js';
import { renderPanel, identicalParts } from './panels.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import {
  state,
  subscribe,
  emit,
  select,
  newId,
  withIds,
  resetForModel,
  resetForProject,
  addMaterial,
  removeMaterial,
  materialEntryOf,
  setPartsAssigned,
  presentParts,
  defaultAdjust,
  QUALITY,
  OUTPUT_ASPECTS,
  JOB_SETTINGS,
} from './state.js';

const $ = (selector) => document.querySelector(selector);

/** The final rendering runs on WebGPU; the real-time view works without it. */
const isRenderSupported = () => 'gpu' in navigator;

const viewer = new Viewer($('#viewport'));
const viewCube = new ViewCube($('#viewcube-host'), viewer);
const stageEl = $('#stage');
const sidebarEl = $('#sidebar');
const fileInput = $('#file-input');
const hdriInput = $('#hdri-input');
const projectInput = $('#project-input');
const dropzone = $('#dropzone');
const statusEl = $('#status');
const treeEl = $('#tree');
const panelEl = $('#panel');
const outputFrameEl = $('#output-frame');
const focusMarkerEl = $('#focus-marker');
const renderViewEl = $('#render-view');
const edgesBtn = $('#edges-btn');
const axesBtn = $('#axes-btn');
const guidesBtn = $('#guides-btn');
const guidesEl = $('#guides');
const projectChip = $('#project-chip');
const projectsBtn = $('#projects-btn');
const overviewEl = $('#overview');

let loading = false;
let statusTimer = null;
let panelLive = null;
/** Counts project switches, so a model that finishes loading late is not put into the wrong project. */
let projectToken = 0;
/** While true, the next click on the model sets the focus point for the depth of field. */
let pickingFocus = false;
/** Softbox that the next click on the model places, so that its reflection lands on the clicked point. */
let pickingHighlight = null;
/** Part highlighted by a click in the viewport, kept while the pointer leaves the tree. */
let clickHighlight = [];
/** The project as it was when the open panel was opened, for discarding its changes. */
let panelSnapshot = null;
/** Taken right before an action creates something and opens it, so discarding removes it again. */
let pendingSnapshot = null;
/** Part whose move gizmo is shown, or null. */
/** Whether the move and rotate tool is on; it shows at the selected parts while their panel is open. */
let gizmoOn = false;
/** Where the selected parts were when the current drag of the tool started. */
let gizmoBase = null;
/** Whether the app settings are open. */
let settingsOpen = false;
const settingsEl = $('#settings');

$('#fit-btn').append(icon('fit', 16), 'Fit');
edgesBtn.append(icon('edges', 16), 'Edges');
axesBtn.append(icon('axes', 16), 'Axes');
guidesBtn.append(icon('guides', 16), 'Guides');
/** Guide lines over the render frame: { visible, type }, remembered in this browser. */
const guides = loadGuides();
guidesBtn.setAttribute('aria-pressed', String(guides.visible));

function setStatus(text, { error = false, timeout = 0 } = {}) {
  clearTimeout(statusTimer);
  statusEl.hidden = !text;
  statusEl.textContent = text || '';
  statusEl.classList.toggle('error', error);
  if (text && timeout) statusTimer = setTimeout(() => setStatus(''), timeout);
}

// --- Applying state to the 3D view ------------------------------------------

function applyMaterials() {
  for (const part of state.parts) {
    const entry = materialEntryOf(part.id);
    const materialId = entry ? entry.materialId : 'cad';
    const colorHex = entry ? entry.colorHex : `#${part.cadColor.getHexString()}`;
    const look = resolveLook(materialId, colorHex, entry?.tuning);
    const key = JSON.stringify(look);
    if (part.lookKey === key) continue;
    part.materialId = materialId;
    part.colorHex = colorHex;
    part.look = look;
    part.lookKey = key;
    viewer.updatePartMaterial(part.id);
  }
}

function applySceneAndLighting() {
  viewer.setLighting({
    presetId: state.lighting.presetId,
    lights: state.lighting.lights,
    rotation: state.lighting.rotation,
    intensity: state.lighting.intensity,
    floor: state.scene.floor,
    background: state.scene.background,
    gradient: sceneGradient(state.scene),
    coveColor: state.scene.coveColor,
    reflection: state.scene.reflection,
    reflectionBlur: state.scene.reflectionBlur,
    shadow: state.scene.shadow,
  });
}

/** Puts the parts where the user moved and turned them, plus how far an exploded view moves them apart. */
function applyExplode() {
  const exploded = explodeOffsets(presentParts(), state.explode, state.partOffsets);
  viewer.setPartTransforms(state.partOffsets, state.partRotations, exploded);
  const ids = gizmoParts();
  if (ids.length > 0) viewer.placeGizmo(selectionCenter(ids));
}

/** Turns the model so that the chosen CAD axis points up. */
function applyUpAxis() {
  if (viewer.setUpAxis(state.upAxis)) {
    viewCube.setModelRotation(viewer.modelRoot.quaternion);
    if (state.parts.length > 0) viewer.fit();
  }
}

/** Centre of a part as it stands, in CAD coordinates. */
function partCenter(id) {
  const part = state.parts[id];
  return part.mesh.geometry.boundingBox.getCenter(new Vector3()).applyMatrix4(part.mesh.matrix).toArray();
}

/** Rounds an angle to a tenth of a degree, within −180° to 180°. */
function roundAngle(degrees) {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return Math.round(wrapped * 10) / 10 || 0;
}

/** The selected parts the move tool works on: those of an open part panel. */
function gizmoParts() {
  if (!gizmoOn || !state.selected.startsWith('part:')) return [];
  return [...state.selectedParts].filter((id) => state.parts[id] && !state.parts[id].removed);
}

/** Middle of the given parts as they stand, in CAD coordinates. */
function selectionCenter(ids) {
  const sum = new Vector3();
  for (const id of ids) sum.add(new Vector3().fromArray(partCenter(id)));
  return sum.divideScalar(ids.length).toArray();
}

const roundMm = (value) => Math.round(value * 100) / 100 || 0;

function setPlacement(id, offset, angles) {
  if (offset.some((value) => value !== 0)) state.partOffsets.set(id, offset);
  else state.partOffsets.delete(id);
  if (angles.some((value) => value !== 0)) state.partRotations.set(id, angles);
  else state.partRotations.delete(id);
}

/**
 * The move tool's changes, applied to all selected parts from where they were
 * when the drag started. Several parts turn together about their common middle.
 */
const gizmoCallbacks = {
  start: () => {
    const entries = gizmoParts().map((id) => {
      const part = state.parts[id];
      const offset = [...(state.partOffsets.get(id) || [0, 0, 0])];
      const angles = state.partRotations.get(id) || [0, 0, 0];
      const center = part.mesh.geometry.boundingBox.getCenter(new Vector3());
      return {
        id,
        offset,
        rotation: new Quaternion().setFromEuler(new Euler(...angles.map((value) => MathUtils.degToRad(value)), 'XYZ')),
        center,
        placed: center.clone().add(new Vector3().fromArray(offset)),
      };
    });
    const pivot = new Vector3();
    for (const entry of entries) pivot.add(entry.placed);
    gizmoBase = { entries, pivot: pivot.divideScalar(Math.max(entries.length, 1)) };
  },
  change: (change) => {
    if (!gizmoBase) return;
    for (const entry of gizmoBase.entries) {
      if (change.type === 'move') {
        setPlacement(
          entry.id,
          entry.offset.map((value, i) => roundMm(value + change.delta[i])),
          state.partRotations.get(entry.id) || [0, 0, 0],
        );
        continue;
      }
      const turn = new Quaternion().setFromAxisAngle(
        new Vector3().setComponent(change.axis, 1),
        MathUtils.degToRad(change.angle),
      );
      const rotation = turn.clone().multiply(entry.rotation);
      const angles = new Euler()
        .setFromQuaternion(rotation, 'XYZ')
        .toArray()
        .slice(0, 3)
        .map((value) => roundAngle(MathUtils.radToDeg(value)));
      // The part's middle swings around the middle of the selection.
      const placed = entry.placed.clone().sub(gizmoBase.pivot).applyQuaternion(turn).add(gizmoBase.pivot);
      setPlacement(entry.id, placed.sub(entry.center).toArray().map(roundMm), angles);
    }
    applyExplode();
    panelLive?.();
  },
  end: () => emit('geometry'),
};

/** Shows the move tool at the selected parts, or hides it. */
function updateGizmo() {
  const ids = gizmoParts();
  if (ids.length === 0) {
    if (viewer.manipulator.attached) viewer.detachGizmo();
    return;
  }
  if (viewer.manipulator.attached) viewer.placeGizmo(selectionCenter(ids));
  else viewer.attachGizmo(selectionCenter(ids), gizmoCallbacks);
}

/**
 * Opens a part, or with `additive` (Ctrl, Cmd or Shift held) adds it to the
 * open selection or takes it out again.
 */
function selectPart(id, additive = false) {
  if (!additive || !state.selected.startsWith('part:')) {
    state.selectedParts = new Set([id]);
    select(`part:${id}`);
    return;
  }
  const next = new Set(state.selectedParts);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  if (next.size === 0) {
    select('');
    return;
  }
  state.selectedParts = next;
  const current = Number(state.selected.split(':')[1]);
  select(`part:${next.has(current) ? current : [...next][0]}`);
}

/** Takes parts out of the model. They can be brought back from the Parts menu in the tree. */
function deleteParts(ids) {
  const list = ids.filter((id) => state.parts[id] && !state.parts[id].removed);
  if (list.length === 0) return;
  for (const id of list) {
    state.parts[id].removed = true;
    viewer.setPartVisible(id, false);
    if (state.explode.anchor === id) state.explode.anchor = null;
  }
  if (state.selected.startsWith('part:') && list.some((id) => state.selectedParts.has(id))) {
    panelSnapshot = null;
    state.selectedParts = new Set();
    select('');
  }
  emit('geometry');
  setStatus(
    `${list.length === 1 ? state.parts[list[0]].label : `${list.length} parts`} deleted. Geometry › Parts › ⋯ brings ${list.length === 1 ? 'it' : 'them'} back.`,
    { timeout: 5000 },
  );
}

function restoreParts() {
  for (const part of state.parts) {
    if (!part.removed) continue;
    part.removed = false;
    viewer.setPartVisible(part.id, true);
  }
  emit('geometry');
}

/** Marks parts as deleted after a project was loaded. */
function applyRemoved(ids) {
  for (const part of state.parts) part.removed = false;
  for (const id of ids) {
    state.parts[id].removed = true;
    viewer.setPartVisible(id, false);
  }
}

/** Shows a saved view or a render job's camera. The exploded view is set only under Geometry. */
function showView(view) {
  viewer.applyViewState(view.camera || view);
}

/** Hands the active section cuts to the 3D view and outlines the one being edited. */
function applySections() {
  viewer.setSections(
    state.sections
      .filter((section) => section.enabled)
      .map((section) => ({ plane: sectionToPlane(section), uncut: section.uncut })),
    state.sectionCap,
  );
  const [kind, idText] = state.selected.split(':');
  const edited = kind === 'section' ? state.sections.find((item) => item.id === Number(idText)) : null;
  viewer.setSectionHelper(edited ? sectionToPlane(edited) : null);
}

/** Direction from the model to the camera in CAD coordinates. */
function cameraDirectionCad() {
  return viewer.toCad(viewer.camera.position.clone().sub(viewer.controls.target)).toArray();
}

/** Whether a cut along `axis` must be flipped to keep the half away from the camera, so the cut face is in view. */
function sectionFacesCamera(axis) {
  return cameraDirectionCad()[axis] > 0;
}

/**
 * Adds a cut through the middle of the model that opens it up towards the
 * camera, across the given axis or the horizontal one the camera looks along most.
 */
function addSection(chosenAxis = null) {
  if (state.parts.length === 0) return;
  const cad = cameraDirectionCad();
  const up = viewer.toCad(new Vector3(0, 1, 0)).toArray().map(Math.abs);
  const candidates = [0, 1, 2].filter((i) => up[i] < 0.5);
  const axis = [0, 1, 2].includes(chosenAxis)
    ? chosenAxis
    : candidates.reduce((best, i) => (Math.abs(cad[i]) > Math.abs(cad[best]) ? i : best), candidates[0]);
  const center = viewer.modelBox.getCenter(new Vector3());
  pendingSnapshot = snapshotProject();
  const section = {
    id: newId(),
    name: `Section ${state.sections.length + 1}`,
    axis,
    position: center.getComponent(axis),
    flip: sectionFacesCamera(axis),
    enabled: true,
    uncut: new Set(),
  };
  state.sections.push(section);
  select(`section:${section.id}`);
}

/** The render job whose panel is open, or null. */
function selectedJob() {
  const [kind, idText] = state.selected.split(':');
  return kind === 'job' ? state.jobs.find((job) => job.id === Number(idText)) || null : null;
}

/** Pixel size of the final image for a render job (or the output defaults). */
function resolveOutputSize(output = selectedJob() || state.output) {
  if (output.aspect === 'custom') return { width: output.width, height: output.height };
  let ratio = OUTPUT_ASPECTS[output.aspect]?.ratio;
  if (!ratio) {
    // "Like the view": the proportions of the free part of the viewport.
    const region = viewer.getFreeRegion();
    ratio = Math.max(region.width, 1) / Math.max(region.height, 1);
  }
  const long = output.resolution;
  const even = (value) => Math.max(Math.round(value / 2) * 2, 64);
  return ratio >= 1 ? { width: even(long), height: even(long / ratio) } : { width: even(long * ratio), height: even(long) };
}

/** Shows the crop of the final image while a render job is open, when its aspect ratio differs from the viewport. */
function updateOutputFrame() {
  const job = selectedJob();
  const cropped = Boolean(job) && job.aspect !== 'view';
  const { width, height } = resolveOutputSize(job || state.output);
  viewer.outputAspect = cropped ? width / height : null;
  viewer.outputMargin = cropped ? 14 : 0;
  // The frame only shows while a job is being set up, so it does not get in the way otherwise.
  const show = cropped && state.parts.length > 0;
  outputFrameEl.hidden = !show;
  const frame = viewer.getOutputFrame(width / height);
  viewer.setBackdropFrame(frame);
  const box = {
    left: `${frame.x}px`,
    top: `${frame.y}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
  };
  // Guides cover the frame of the open job, or the free view when the image takes its proportions.
  const guided = guides.visible && state.parts.length > 0;
  guidesEl.hidden = !guided;
  if (guided) {
    Object.assign(guidesEl.style, box);
    drawGuides(guidesEl, guides.type, frame.width, frame.height);
  }
  if (show) Object.assign(outputFrameEl.style, box);
}

/** Keeps the 3D view centred in the area that the sidebar and the open panel leave free. */
function updateInset(immediate = false) {
  const anchor = panelEl.hidden ? sidebarEl : panelEl;
  const inset = anchor.offsetLeft + anchor.offsetWidth + 12;
  stageEl.style.setProperty('--inset', `${inset}px`);
  viewer.setInset(inset, immediate);
}

// --- Depth of field -----------------------------------------------------------

function focusPoint() {
  return state.camera.focusPoint ? new Vector3().fromArray(state.camera.focusPoint) : viewer.controls.target.clone();
}

/** Distance of the sharp plane from the camera in model units. */
function focusDistance() {
  return Math.max(viewer.depthOf(focusPoint()), 0.1);
}

/** Marks the focus point in the viewport while the depth of field is being set up. */
function updateFocusMarker() {
  const show = state.parts.length > 0 && state.camera.dof && state.selected === 'views';
  focusMarkerEl.hidden = !show;
  if (!show) return;
  viewer.camera.updateMatrixWorld();
  const ndc = focusPoint().project(viewer.camera);
  focusMarkerEl.style.left = `${((ndc.x + 1) / 2) * viewer.canvas.clientWidth}px`;
  focusMarkerEl.style.top = `${((1 - ndc.y) / 2) * viewer.canvas.clientHeight}px`;
}

function setPickingFocus(value) {
  pickingFocus = value;
  if (value) pickingHighlight = null;
  viewer.canvas.classList.toggle('picking', value || pickingHighlight !== null);
}

function setPickingHighlight(light) {
  pickingHighlight = light;
  if (light) pickingFocus = false;
  viewer.canvas.classList.toggle('picking', light !== null || pickingFocus);
}

/**
 * Moves a softbox so that its reflection appears at a point on the model, as
 * seen from the current camera: the light goes where the view ray bounces to.
 */
function placeHighlight(light, point, normal) {
  const toCamera = viewer.camera.position.clone().sub(point).normalize();
  const reflected = normal.clone().multiplyScalar(2 * normal.dot(toCamera)).sub(toCamera).normalize();
  const azimuth = (Math.atan2(reflected.x, reflected.z) * 180) / Math.PI - state.lighting.rotation;
  light.az = Math.round((((azimuth + 180) % 360) + 360) % 360 - 180);
  light.el = Math.round(Math.min(Math.max((Math.asin(reflected.y) * 180) / Math.PI, -30), 90));
}

// --- Render jobs ----------------------------------------------------------------

/** Creates a render job from the current camera, with the settings of the last job (or the defaults). */
function createJob(type = 'image', { name, view } = {}) {
  const source = state.jobs.at(-1) || state.output;
  const count = state.jobs.filter((job) => job.type === type).length + 1;
  const job = {
    id: newId(),
    name: name || `${type === 'animation' ? 'Turntable' : 'Image'} ${count}`,
    type,
    camera: view ? { position: view.position, target: view.target, fov: view.fov, roll: view.roll } : viewer.getViewState(),
  };
  for (const key of JOB_SETTINGS) job[key] = source[key] ?? state.output[key];
  state.jobs.push(job);
  return job;
}

function addJob(type = 'image') {
  if (state.parts.length === 0) return;
  pendingSnapshot = snapshotProject();
  const job = createJob(type);
  select(`job:${job.id}`);
}

/** One image job for each saved view that has none yet. */
function jobsFromViews() {
  const existing = new Set(state.jobs.map((job) => job.name));
  const created = state.views.filter((view) => !existing.has(view.name)).map((view) => createJob('image', { name: view.name, view }));
  emit('jobs');
  return created.length;
}

function duplicateJob(job) {
  pendingSnapshot = snapshotProject();
  const copy = { ...structuredClone({ ...job, id: 0 }), id: newId(), name: `${job.name} copy` };
  state.jobs.splice(state.jobs.indexOf(job) + 1, 0, copy);
  select(`job:${copy.id}`);
}

function deleteJob(job) {
  state.jobs = state.jobs.filter((other) => other !== job);
  panelSnapshot = null;
  select('');
}

// --- Renderings ---------------------------------------------------------------

/** True while a rendering puts its camera into the view; an open job must not take that over. */
let applyingRenderView = false;

function runningRender() {
  return state.renders.find((render) => render.status === 'running') || null;
}

const renderKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * Puts a render job into the queue. The job's camera, explosion and image
 * settings are copied now; materials, lights and scene are taken as they are
 * when its turn comes.
 */
function queueRender(job) {
  const { width, height } = resolveOutputSize(job);
  const output = { ...job, width, height, device: state.output.device, gentle: state.output.gentle };
  const render = {
    id: newId(),
    key: renderKey(),
    name: job.name,
    status: 'queued',
    stage: 'building',
    progress: 0,
    samples: 0,
    targetSamples: QUALITY[output.quality].samples,
    seconds: 0,
    width,
    height,
    transparent: output.transparent,
    format: output.format,
    denoised: false,
    note: null,
    deviceName: null,
    handle: null,
    blob: null,
    url: null,
    error: null,
    output,
    view: { ...job.camera },
    // A turntable series keeps all its images; `shownFrame` is the one on screen.
    turntable: job.type === 'animation' ? job.turntableFrames : 0,
    turntableSeconds: job.turntableSeconds,
    frames: [],
    frameIndex: 0,
    shownFrame: 0,
    adjust: defaultAdjust(),
    createdAt: Date.now(),
    stored: false,
    loaded: true,
  };
  state.renders.push(render);
  return render;
}

/** Checks whether rendering is possible at all; shows why not otherwise. */
function canRender() {
  if (state.parts.length === 0) return false;
  if (!isRenderSupported()) {
    setStatus('Rendering needs WebGPU. Please use Chrome or Edge.', { error: true, timeout: 6000 });
    return false;
  }
  return true;
}

/** Renders one job; its rendering opens so the progress can be watched. */
function renderJob(job) {
  if (!canRender()) return;
  const render = queueRender(job);
  if (runningRender()) setStatus('The rendering starts as soon as the one before it is done.', { timeout: 4000 });
  panelSnapshot = null;
  select(`render:${render.id}`);
  runQueue();
}

/** Puts all render jobs into the queue, in their order. */
function renderAllJobs() {
  if (!canRender() || state.jobs.length === 0) return;
  const first = state.jobs.map((job) => queueRender(job))[0];
  panelSnapshot = null;
  if (!runningRender()) select(`render:${first.id}`);
  else emit('renders');
  runQueue();
}

/** Starts the next waiting rendering, unless one is running. */
function runQueue() {
  if (runningRender()) return;
  const next = state.renders.find((render) => render.status === 'queued');
  if (next) runRender(next);
}

async function runRender(render) {
  render.status = 'running';
  render.stage = 'building';
  emit('renders');

  const { output } = render;
  const count = render.turntable || 1;
  const projectId = state.project.id;
  const started = performance.now();
  try {
    // Loaded on demand so the path tracer does not slow down the start of the app.
    const { startRender } = await import('./render.js');
    for (let index = 0; index < count && render.status === 'running'; index++) {
      render.frameIndex = index;
      const frameStarted = performance.now();
      render.handle = await startRender(viewer, {
        width: render.width,
        height: render.height,
        samples: render.targetSamples,
        transparent: render.transparent,
        backdrop: {
          floor: state.scene.floor,
          gradient: state.scene.background === 'gradient' ? sceneGradient(state.scene) : null,
          coveColor: state.scene.coveColor,
          reflection: state.scene.reflection,
          reflectionBlur: state.scene.reflectionBlur,
          shadow: state.scene.shadow,
        },
        // Right before the scene is read: show the camera this rendering was queued with.
        prepare: () => {
          if (index === 0) {
            applyingRenderView = true;
            viewer.applyViewState(render.view);
            applyingRenderView = false;
          }
          return {
            fov: viewer.getOutputFrame(render.width / render.height).fov,
            // A parallel projection has no lens, so it stays sharp throughout.
            dof:
              state.camera.dof && !viewer.parallel
                ? { fStop: state.camera.fStop, focusDistance: focusDistance() }
                : null,
          };
        },
        orbit: render.turntable ? (index / count) * Math.PI * 2 : 0,
        denoise: output.denoise,
        device: output.device,
        // Software rendering only stays stable with small work packages.
        gentle: output.gentle || output.device === 'cpu',
        onProgress: ({ stage, progress, samples }) => {
          render.seconds = (performance.now() - started) / 1000;
          if (stage === 'denoise-failed') {
            render.denoised = false;
            render.note = 'denoising not possible';
          } else {
            render.stage = stage;
            let frameProgress = null;
            if (stage === 'rendering' && samples !== null) {
              render.samples = samples;
              frameProgress = Math.min(progress ?? samples / render.targetSamples, 1);
            }
            if (stage === 'denoising') {
              render.denoised = true;
              frameProgress = progress ?? null;
            }
            if (frameProgress !== null) render.progress = (index + frameProgress) / count;
          }
          emit('renders:live');
        },
      });
      render.deviceName = render.handle.deviceName;
      if (render.status !== 'running') {
        // Cancelled or deleted while the scene was being prepared.
        render.handle.cancel();
        break;
      }
      if (index === 0) emit('renders');

      const blob = await render.handle.done;
      render.handle = null;
      render.seconds = (performance.now() - started) / 1000;
      if (!blob) break;
      if (render.turntable) {
        render.frames.push({ blob, url: URL.createObjectURL(blob), seconds: (performance.now() - frameStarted) / 1000 });
        render.shownFrame = index;
        render.progress = (index + 1) / count;
        emit('renders:live');
      } else {
        render.blob = blob;
        render.url = URL.createObjectURL(blob);
      }
    }

    if (render.turntable ? render.frames.length > 0 : render.blob) {
      if (render.turntable && render.frames.length < count) {
        render.note = `stopped after ${render.frames.length} of ${count} images`;
      }
      render.status = 'done';
      render.progress = 1;
      if (projectId === state.project.id && state.renders.includes(render)) await storeRender(render, projectId);
    } else if (render.status === 'running') {
      render.status = 'cancelled';
    }
  } catch (error) {
    console.error(error);
    render.handle = null;
    render.status = 'failed';
    render.error = error?.message || String(error);
  }
  emit('renders');
  runQueue();
}

/** A small picture of a rendering for the gallery in the project overview. */
async function renderThumbnail(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(360 / bitmap.width, 240 / bitmap.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(Math.round(bitmap.width * scale), 1);
  canvas.height = Math.max(Math.round(bitmap.height * scale), 1);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

/** Keeps a finished rendering with the project, so it is still there after a reload. */
async function storeRender(render, projectId) {
  const named = (blob, name) => new File([blob], name, { type: blob.type });
  try {
    if (render.turntable) {
      await Promise.all(render.frames.map((frame, i) => files.put(fileKeys.render(projectId, render.key, i), named(frame.blob, `${i}.png`))));
    } else {
      await files.put(fileKeys.render(projectId, render.key), named(render.blob, 'image.png'));
    }
    const thumb = await renderThumbnail(render.turntable ? render.frames[0].blob : render.blob);
    if (thumb) await files.put(fileKeys.renderThumbnail(projectId, render.key), named(thumb, 'thumb.jpg'));
    render.stored = true;
    scheduleSave();
  } catch (error) {
    console.warn('Rendering could not be stored.', error);
  }
}

/** A rendering restored from the project record; its images load when they are needed. */
function restoredRender(meta) {
  return {
    ...meta,
    id: newId(),
    status: 'done',
    stage: 'done',
    progress: 1,
    targetSamples: meta.samples,
    blob: null,
    url: null,
    error: null,
    handle: null,
    frames: [],
    frameIndex: 0,
    shownFrame: 0,
    stored: true,
    loaded: false,
  };
}

/** Loads the images of a stored rendering (from any project) into a rendering object. */
async function loadRenderImages(target, projectId) {
  if (target.turntable) {
    const loaded = await Promise.all(
      Array.from({ length: target.frameCount }, (_, i) => files.get(fileKeys.render(projectId, target.key, i))),
    );
    if (loaded.some((file) => !file)) throw new Error('Some images of this rendering are missing.');
    target.frames = loaded.map((blob) => ({ blob, url: URL.createObjectURL(blob), seconds: 0 }));
  } else {
    const blob = await files.get(fileKeys.render(projectId, target.key));
    if (!blob) throw new Error('The image of this rendering is missing.');
    target.blob = blob;
    target.url = URL.createObjectURL(blob);
  }
  target.loaded = true;
  return target;
}

/** Makes sure the images of a rendering of the open project are in memory. */
function ensureRenderLoaded(render) {
  if (render.loaded) return Promise.resolve(render);
  render.loading ??= loadRenderImages(render, state.project.id)
    .catch((error) => {
      render.status = 'failed';
      render.error = error.message;
    })
    .finally(() => {
      render.loading = null;
      emit('renders');
    });
  return render.loading;
}

function cancelRender(render) {
  if (render.status === 'queued' || render.status === 'running') render.status = 'cancelled';
  render.handle?.cancel();
  emit('renders');
}

/** Takes all renderings that have not started yet out of the queue. */
function cancelQueue() {
  for (const render of state.renders) if (render.status === 'queued') render.status = 'cancelled';
  emit('renders');
}

function deleteRender(render) {
  if (render.status === 'running' || render.status === 'queued') {
    render.status = 'cancelled';
    render.handle?.cancel();
  }
  if (render === playing) stopPlaying();
  if (render.url) URL.revokeObjectURL(render.url);
  for (const frame of render.frames) URL.revokeObjectURL(frame.url);
  if (render.stored) deleteRenderFiles(state.project.id, renderMeta(render));
  state.renders = state.renders.filter((other) => other !== render);
  if (state.selected === `render:${render.id}`) select('');
  else emit('renders');
}

/** Base of all file names: the project's name, or the model's. */
function fileBase(name = state.project.name) {
  return safeFileName(name) || safeFileName((state.fileName || 'Model').replace(/\.(step|stp)$/i, ''));
}

/** The files of a finished rendering, adjusted: one image, or the numbered images of a turntable series. */
async function renderFiles(render, format, { folder = '', base = fileBase() } = {}) {
  const { extension } = FILE_FORMATS[format];
  const name = `${base}_${safeFileName(render.name)}_${render.width}x${render.height}`;
  const prepare = async (blob) => convertImage(await adjustImage(blob, render.adjust), format);
  if (!render.turntable) return [{ name: `${folder}${name}.${extension}`, blob: await prepare(render.blob) }];
  const digits = String(render.frames.length).length;
  const result = [];
  // One after the other, so a long series does not hold all decoded images at once.
  for (const [i, frame] of render.frames.entries()) {
    result.push({ name: `${folder}${name}_${String(i + 1).padStart(Math.max(digits, 3), '0')}.${extension}`, blob: await prepare(frame.blob) });
  }
  return result;
}

async function exporting(text, run) {
  setStatus(text);
  try {
    await run();
    setStatus('');
  } catch (error) {
    console.error(error);
    setStatus(`Saving failed: ${error?.message || error}`, { error: true, timeout: 6000 });
  }
}

/** Saves one rendering in the given format; a turntable series as a ZIP archive. */
function saveRender(render, format = render.format || 'png', base = fileBase()) {
  return exporting('Saving images …', async () => {
    await ensureRenderLoaded(render);
    const files = await renderFiles(render, format, { base });
    if (files.length === 1) downloadBlob(files[0].blob, files[0].name.split('/').pop());
    else downloadBlob(await zipFiles(files), `${base}_${safeFileName(render.name)}.zip`);
  });
}

/** Saves all finished renderings in one ZIP archive, turntable series in folders of their own. */
function saveAllRenders(format = 'png') {
  const done = state.renders.filter((render) => render.status === 'done');
  if (done.length === 0) return;
  return exporting('Saving images …', async () => {
    const files = [];
    for (const render of done) {
      await ensureRenderLoaded(render);
      if (!render.loaded) continue;
      files.push(...(await renderFiles(render, format, { folder: render.turntable ? `${safeFileName(render.name)}/` : '' })));
    }
    downloadBlob(await zipFiles(files), `${fileBase()}_Renderings.zip`);
  });
}

/** Saves a turntable series as a video of one full turn. */
function saveVideo(render, base = fileBase()) {
  return exporting('Recording video …', async () => {
    await ensureRenderLoaded(render);
    const blobs = [];
    for (const frame of render.frames) blobs.push(await adjustImage(frame.blob, render.adjust));
    const { blob, extension } = await recordVideo(blobs, { seconds: render.turntableSeconds || 6 });
    downloadBlob(blob, `${base}_${safeFileName(render.name)}_${render.width}x${render.height}.${extension}`);
  });
}

// --- Turntable playback ---------------------------------------------------------

let playing = null;
let playTimer = null;

function stopPlaying() {
  clearInterval(playTimer);
  playTimer = null;
  playing = null;
}

/** Plays a turntable series in the view, at the speed of the video. */
function togglePlaying(render) {
  if (playing === render) {
    stopPlaying();
  } else {
    stopPlaying();
    playing = render;
    playTimer = setInterval(() => {
      if (state.selected !== `render:${render.id}`) {
        stopPlaying();
        return;
      }
      render.shownFrame = (render.shownFrame + 1) % render.frames.length;
      updateRenderView();
      panelLive?.();
    }, ((render.turntableSeconds || 6) * 1000) / render.frames.length);
  }
  panelLive?.();
}

function showFrame(render, index) {
  render.shownFrame = Math.min(Math.max(index, 0), render.frames.length - 1);
  updateRenderView();
}

/** Lays the vignette overlay exactly over the image shown in the render view. */
function placeVignette() {
  const image = renderViewEl.querySelector('img');
  const overlay = renderViewEl.querySelector('.vignette');
  if (!image || !overlay) return;
  Object.assign(overlay.style, {
    left: `${image.offsetLeft}px`,
    top: `${image.offsetTop}px`,
    width: `${image.offsetWidth}px`,
    height: `${image.offsetHeight}px`,
  });
}
new ResizeObserver(placeVignette).observe(renderViewEl);

/** Shows the selected rendering over the viewport, live while it runs and as an image afterwards. */
function updateRenderView() {
  const [kind, idText] = state.selected.split(':');
  const render = kind === 'render' ? state.renders.find((item) => item.id === Number(idText)) : null;
  renderViewEl.hidden = !render;
  if (!render) {
    renderViewEl.replaceChildren();
    return;
  }
  if (render.status === 'done' && !render.loaded) ensureRenderLoaded(render);

  // A finished image, or the last finished image of a turntable series that is still running.
  const frame = render.turntable ? render.frames[render.shownFrame] : null;
  const imageUrl =
    render.status === 'done' ? (frame?.url ?? render.url) : render.status === 'running' && !render.handle ? frame?.url : null;
  const current = renderViewEl.firstChild;
  if (imageUrl) {
    let image = current?.tagName === 'IMG' ? current : null;
    if (image) {
      // Swapping the source keeps playback free of flicker.
      if (image.src !== imageUrl) image.src = imageUrl;
    } else {
      image = h('img', { src: imageUrl, alt: render.name, onload: placeVignette });
      renderViewEl.replaceChildren(image, h('div', { class: 'vignette' }));
    }
    const css = adjustCss(render.adjust);
    image.style.filter = css.filter;
    renderViewEl.querySelector('.vignette').style.background = css.vignette;
    placeVignette();
    return;
  }
  const canvas = render.status === 'running' ? render.handle?.canvas : null;
  if (canvas) {
    if (current !== canvas) renderViewEl.replaceChildren(canvas);
    return;
  }
  const text =
    render.status === 'running'
      ? 'Preparing the scene …'
      : render.status === 'queued'
        ? 'Waiting until the renderings before it are done'
        : render.status === 'done'
          ? 'Loading …'
          : 'No image';
  if (current?.className !== 'render-placeholder' || current.textContent !== text) {
    renderViewEl.replaceChildren(h('p', { class: 'render-placeholder' }, text));
  }
}

// --- Projects and templates ---------------------------------------------------

/** Loads the custom HDRI stored for the current project, or falls back to a preset. */
async function restoreHdri(token) {
  if (state.lighting.presetId !== 'custom') return;
  let loaded = false;
  try {
    const file = await files.get(fileKeys.hdri(state.project.id));
    if (file) {
      const texture = await loadHdriFile(file);
      if (token !== projectToken) {
        texture.dispose();
        return;
      }
      viewer.setCustomEnvironment(texture);
      loaded = true;
    }
  } catch (error) {
    console.warn('Stored HDRI could not be loaded.', error);
  }
  if (token !== projectToken) return;
  if (!loaded) {
    state.lighting.presetId = 'studio-soft';
    state.lighting.hdriName = null;
    state.lighting.lights = withIds(presetLights(getLightPreset('studio-soft')));
  }
  emit('lighting');
}

function showModelUi() {
  const hasModel = state.parts.length > 0;
  $('#toolbar').hidden = !hasModel;
  $('#viewcube-host').hidden = !hasModel;
  dropzone.classList.toggle('loaded', hasModel || loading);
}

/**
 * Parses a STEP file and makes it the model of the current project.
 * Materials, views and the camera come back if the project was saved with
 * this very file; otherwise the model starts fresh.
 */
async function loadModel(file, { record, store }) {
  const token = projectToken;
  loading = true;
  showModelUi();
  setStatus(`Loading ${file.name} …`);
  const started = performance.now();
  try {
    const parts = await loadStepFile(file);
    if (token !== projectToken) return;
    // Parts the user added from further files come after those of the model, in the order they were added.
    const added = [];
    if (!store) {
      for (let i = 0; i < addedFileCount(record); i++) {
        const extra = await files.get(fileKeys.addedStep(record.id, i));
        if (token !== projectToken) return;
        if (!extra) {
          setStatus(`${record.addedFiles[i].name} is no longer stored. Please add it again.`, { error: true });
          break;
        }
        const extraParts = await loadStepFile(extra);
        if (token !== projectToken) return;
        appendParts(parts, extraParts);
        added.push({ name: extra.name, partCount: extraParts.length });
      }
    } else {
      // A new model replaces the parts added to the old one.
      for (let i = 0; i < state.addedFiles.length; i++) files.delete(fileKeys.addedStep(state.project.id, i));
    }

    viewer.detachGizmo();
    viewer.setParts(parts);
    resetForModel(file.name, parts);
    state.addedFiles = added;
    const restored = applyModelData(record);
    if (restored) {
      for (const id of restored.hidden) viewer.setPartVisible(id, false);
      applyRemoved(restored.removed);
      if (restored.view) viewer.applyViewState(restored.view);
    } else {
      // A focus point belongs to the model it was picked on.
      state.camera.focusPoint = null;
      const palette = takePendingPalette();
      if (palette) applyPalette(palette);
    }
    if (store) files.put(fileKeys.step(state.project.id), file);

    // Long part lists start folded so the steps below stay in sight.
    setCollapsed('parts', parts.length > 12);
    if (store) state.selected = 'geometry';
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    setStatus(`${file.name} loaded (${seconds} s)`, { timeout: 2500 });
  } catch (error) {
    if (token !== projectToken) return;
    console.error(error);
    setStatus(`Import failed: ${error.message}`, { error: true });
  } finally {
    if (token === projectToken) {
      loading = false;
      showModelUi();
      emit('model');
    }
  }
}

/** Puts parts of a further file after the existing ones; ids continue the count. */
function appendParts(parts, extra) {
  const labels = new Set(parts.map((part) => part.label));
  for (const part of extra) {
    part.id = parts.length;
    // Keep labels apart from those of the parts already there.
    let label = part.label;
    for (let n = 2; labels.has(label); n++) label = `${part.label} (${n})`;
    part.label = label;
    labels.add(label);
    parts.push(part);
  }
}

/** Adds the parts of another STEP file to the model, e.g. a bracket to an assembly. */
async function addPartFile(file) {
  if (!file) return;
  if (state.parts.length === 0) {
    await openFile(file);
    return;
  }
  if (loading) {
    setStatus('A model is still loading. Please wait a moment and add the part again.', { error: true, timeout: 4000 });
    return;
  }
  if (!/\.(step|stp)$/i.test(file.name)) {
    setStatus('Please choose a STEP file (.step or .stp).', { error: true });
    return;
  }
  const token = projectToken;
  loading = true;
  setStatus(`Adding ${file.name} …`);
  try {
    const extra = await loadStepFile(file);
    if (token !== projectToken) return;
    const index = state.addedFiles.length;
    appendParts(state.parts, extra);
    viewer.addParts(extra);
    state.addedFiles.push({ name: file.name, partCount: extra.length });
    files.put(fileKeys.addedStep(state.project.id, index), file);
    setCollapsed('parts', false);
    setStatus(`${extra.length === 1 ? extra[0].label : `${extra.length} parts`} added from ${file.name}`, { timeout: 3000 });
    if (extra.length === 1) selectPart(extra[0].id);
  } catch (error) {
    console.error(error);
    setStatus(`Import failed: ${error.message}`, { error: true });
  } finally {
    loading = false;
    if (token === projectToken) emit('model');
  }
}

const partInput = h('input', { type: 'file', accept: '.step,.stp', hidden: true });
partInput.addEventListener('change', () => {
  const file = partInput.files[0];
  partInput.value = '';
  addPartFile(file);
});
document.body.append(partInput);

/** Makes a stored project the one on screen: settings first, then its HDRI and model. */
async function openProject(record) {
  const token = ++projectToken;
  suspendSaving(true);
  setPickingFocus(false);
  loading = false;
  resetForProject(record);
  setPendingPalette(null);
  viewer.detachGizmo();
  panelSnapshot = null;
  viewer.setCustomEnvironment(null);
  viewer.setFov(35);
  viewer.setParts([]);
  applySettings(record);
  // Finished renderings come back without their images, which load when they are looked at.
  state.renders = (record.renders || []).map(sanitizeRenderMeta).filter(Boolean).map(restoredRender);
  state.selected = 'geometry';
  showModelUi();
  emit('model');

  await restoreHdri(token);
  if (token !== projectToken) return;
  if (record.fileName) {
    const file = await files.get(fileKeys.step(record.id));
    if (token !== projectToken) return;
    if (file) {
      await loadModel(file, { record, store: false });
    } else {
      setStatus(`${record.fileName} is no longer stored. Please open the file again.`, { error: true });
    }
  }
  if (token === projectToken) suspendSaving(false);
}

async function switchProject(id) {
  saveNow();
  await saveThumbnail();
  const record = setCurrentProject(id);
  if (record) await openProject(record);
}

async function applyTemplate(id) {
  const template = getTemplate(id);
  if (!template) return;
  const token = projectToken;
  applySettings(template);
  if (state.lighting.presetId === 'custom') {
    await files.copy(fileKeys.templateHdri(id), fileKeys.hdri(state.project.id));
    await restoreHdri(token);
    if (token !== projectToken) return;
  }
  if (template.materials?.length > 0) {
    if (state.parts.length > 0) applyPalette(template.materials);
    else setPendingPalette(template.materials);
  }
  if (template.fov) viewer.setFov(template.fov);
  emit('model');
  setStatus(`Template "${template.name}" applied`, { timeout: 2500 });
}

// --- Project files ------------------------------------------------------------

/** A project file waiting for the decision whether it replaces the project of the same name. */
let pendingImport = null;

/** Saves a project with its model and HDRI as one file. */
function exportProject(id = state.project.id) {
  saveNow();
  const record = getProject(id);
  if (!record) return;
  return exporting('Exporting project …', async () => {
    const step = record.fileName ? await files.get(fileKeys.step(record.id)) : null;
    const added = [];
    for (let i = 0; i < (step ? addedFileCount(record) : 0); i++) {
      const file = await files.get(fileKeys.addedStep(record.id, i));
      if (file) added.push(file);
    }
    const hdri = record.lighting?.presetId === 'custom' ? await files.get(fileKeys.hdri(record.id)) : null;
    const blob = await packProject(record, { step, added, hdri });
    downloadBlob(blob, `${safeFileName(record.name) || 'Project'}.${PROJECT_EXTENSION}`);
  });
}

// --- Project overview -----------------------------------------------------------

let overviewOpen = false;
/**
 * A dialog over the overview: { mode: 'new' }, { mode: 'edit', id } (name and
 * template of a project) or { mode: 'gallery', id, key } (its renderings, `key` the one shown large).
 */
let overviewDialog = null;
/** Preview images of the projects as object URLs, by project id. */
const thumbnails = new Map();
/** Small pictures of stored renderings as object URLs, by storage key. */
const renderThumbnails = new Map();
/** The rendering shown large in the gallery, with its images loaded. */
let galleryRender = null;

function setOverviewDialog(dialog) {
  overviewDialog = dialog;
  if (galleryRender && (dialog?.mode !== 'gallery' || dialog.key !== galleryRender.key)) {
    if (galleryRender.url) URL.revokeObjectURL(galleryRender.url);
    for (const frame of galleryRender.frames || []) URL.revokeObjectURL(frame.url);
    galleryRender = null;
  }
  if (overviewOpen) renderOverview(overviewEl, actions);
}

/** Render metadata of a project; for the open project the live list, so new renderings show up at once. */
function projectRenders(id) {
  if (id === state.project.id) return state.renders.filter((render) => render.stored).map(renderMeta);
  return (getProject(id)?.renders || []).map(sanitizeRenderMeta).filter(Boolean);
}

async function loadRenderThumbnail(projectId, key) {
  if (renderThumbnails.has(key)) return;
  renderThumbnails.set(key, null);
  const file = await files.get(fileKeys.renderThumbnail(projectId, key));
  if (!file) return;
  renderThumbnails.set(key, URL.createObjectURL(file));
  if (overviewOpen) renderOverview(overviewEl, actions);
}

/** Opens a rendering of any project large in the gallery. */
async function showGalleryRender(projectId, key) {
  setOverviewDialog({ mode: 'gallery', id: projectId, key });
  const meta = projectRenders(projectId).find((item) => item.key === key);
  if (!meta) return;
  try {
    const loaded = await loadRenderImages({ ...meta, frames: [], blob: null, url: null }, projectId);
    if (overviewDialog?.mode !== 'gallery' || overviewDialog.key !== key) {
      if (loaded.url) URL.revokeObjectURL(loaded.url);
      for (const frame of loaded.frames) URL.revokeObjectURL(frame.url);
      return;
    }
    galleryRender = loaded;
  } catch (error) {
    setStatus(error.message, { error: true, timeout: 5000 });
  }
  if (overviewOpen) renderOverview(overviewEl, actions);
}

/** Stores a small picture of the current view as the project's preview. */
async function saveThumbnail() {
  if (state.parts.length === 0 || !state.project.id) return;
  const id = state.project.id;
  const canvas = viewer.captureThumbnail();
  if (!canvas) return;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) return;
  await files.put(fileKeys.thumbnail(id), blob);
  const old = thumbnails.get(id);
  if (old) URL.revokeObjectURL(old);
  thumbnails.set(id, URL.createObjectURL(blob));
}

let thumbnailTimer = null;

/** Renews the preview a few seconds after the last change. */
function scheduleThumbnail() {
  clearTimeout(thumbnailTimer);
  thumbnailTimer = setTimeout(() => !overviewOpen && saveThumbnail(), 3000);
}

/** Loads the preview images that are not in memory yet, then shows them. */
async function loadThumbnails() {
  let changed = false;
  for (const project of state.projects) {
    if (thumbnails.has(project.id)) continue;
    const file = await files.get(fileKeys.thumbnail(project.id));
    thumbnails.set(project.id, file ? URL.createObjectURL(file) : null);
    changed = changed || Boolean(file);
  }
  if (changed && overviewOpen) renderOverview(overviewEl, actions);
}

function showOverview(open) {
  if (open && !overviewOpen) {
    saveNow();
    saveThumbnail().then(() => overviewOpen && renderOverview(overviewEl, actions));
  }
  if (!open) setOverviewDialog(null);
  overviewOpen = open;
  overviewEl.hidden = !open;
  document.body.classList.toggle('overview-open', open);
  if (open) {
    renderOverview(overviewEl, actions);
    loadThumbnails();
  }
}

async function openFromOverview(id) {
  showOverview(false);
  if (id !== state.project.id) await switchProject(id);
}

async function importProjectFile(file) {
  if (!file) return;
  let data;
  try {
    setStatus(`Reading ${file.name} …`);
    data = await unpackProject(file);
    setStatus('');
  } catch (error) {
    console.error(error);
    setStatus(error.message, { error: true, timeout: 6000 });
    return;
  }
  if (getProject(data.record.id)) {
    // The same project already exists here, probably from an earlier exchange: ask first.
    pendingImport = data;
    showOverview(true);
    emit('project');
    return;
  }
  await finishImport(data, false);
}

async function finishImport(data, replace) {
  pendingImport = null;
  showOverview(false);
  // Replacing the open project: its pending changes must not be written over the imported one.
  if (replace && data.record.id === state.project.id) suspendSaving(true);
  else saveNow();
  const record = await importProject(data.record, { step: data.step, added: data.added, hdri: data.hdri, replace });
  setCurrentProject(record.id);
  await openProject(record);
  setStatus(`Project "${record.name}" imported`, { timeout: 3000 });
}

// --- Tree and panel -----------------------------------------------------------

function selectionHighlight() {
  const [kind, idText] = state.selected.split(':');
  return kind === 'part' ? [...state.selectedParts] : clickHighlight;
}

/** Panels where clicking a part in the viewport does something, so parts light up under the pointer. */
function pickingParts() {
  const [kind] = state.selected.split(':');
  return ['', 'geometry', 'parts', 'part', 'materials', 'material', 'section'].includes(kind);
}

/** Closes the open panel and keeps its changes, which are saved already. */
function applyPanel() {
  panelSnapshot = null;
  saveNow();
  select('');
}

/** Closes the open panel and takes back everything changed since it was opened. */
function discardPanel() {
  const snapshot = panelSnapshot;
  panelSnapshot = null;
  if (!snapshot) {
    select('');
    return;
  }
  const { key, data } = snapshot;
  viewer.detachGizmo();
  applySettings(data);
  if (state.parts.length > 0 && data.fileName) {
    const restored = applyModelData({ ...data, fileName: state.fileName, partCount: state.parts.length });
    if (restored) {
      const hidden = new Set(restored.hidden);
      for (const part of state.parts) viewer.setPartVisible(part.id, !hidden.has(part.id));
      applyRemoved(restored.removed);
      // Only the camera panel takes the camera back; elsewhere it was moved just to look.
      if (key === 'views' && restored.view) viewer.applyViewState(restored.view);
    }
  }
  state.selected = '';
  emit('model');
}

/** Deletes something from the tree's menu; its panel closes if it was open, and the deletion stays. */
function deleteFromTree(key, area, run) {
  run();
  if (state.selected === key) {
    panelSnapshot = null;
    select('');
  }
  emit(area);
}

/** Creates a project, optionally with the settings of a template, and opens it. */
async function newProject(name, templateId = null) {
  saveNow();
  await saveThumbnail();
  showOverview(false);
  const record = createProject(name);
  setCurrentProject(record.id);
  await openProject(record);
  if (templateId) await applyTemplate(templateId);
}

const actions = {
  openFile: () => fileInput.click(),
  newProject: () => {
    showOverview(true);
    setOverviewDialog({ mode: 'new' });
  },
  createProject: newProject,
  nextProjectName,
  /** Renames a project and applies a template to it, which opens it. */
  saveProjectSettings: async (id, name, templateId) => {
    const record = renameProject(id, name);
    if (id === state.project.id && record) state.project.name = record.name;
    setOverviewDialog(null);
    emit('project');
    if (templateId) {
      await openFromOverview(id);
      await applyTemplate(templateId);
    }
  },
  editProject: (id = state.project.id) => {
    showOverview(true);
    setOverviewDialog({ mode: 'edit', id });
  },
  openGallery: (id) => setOverviewDialog({ mode: 'gallery', id, key: null }),
  showGalleryRender,
  closeDialog: () => setOverviewDialog(null),
  dialog: () => overviewDialog,
  projectRenders,
  renderThumbnailUrl: (projectId, key) => {
    loadRenderThumbnail(projectId, key);
    return renderThumbnails.get(key) || null;
  },
  galleryRender: () => galleryRender,
  saveGalleryRender: (format) => {
    const record = getProject(overviewDialog?.id);
    if (galleryRender && record) saveRender(galleryRender, format, fileBase(record.name));
  },
  saveGalleryVideo: () => {
    const record = getProject(overviewDialog?.id);
    if (galleryRender && record) saveVideo(galleryRender, fileBase(record.name));
  },
  switchProject,
  openOverview: () => showOverview(true),
  openFromOverview,
  thumbnailUrl: (id) => thumbnails.get(id) || null,
  /** Copies a project; the copy shows up in the overview, the open project stays open. */
  duplicateProject: async (id = state.project.id) => {
    saveNow();
    const record = await duplicateProject(id);
    if (!record) return;
    emit('project');
    loadThumbnails();
  },
  deleteProject: async (id = state.project.id) => {
    if (id !== state.project.id) {
      deleteProject(id);
      const url = thumbnails.get(id);
      if (url) URL.revokeObjectURL(url);
      thumbnails.delete(id);
      emit('project');
      return;
    }
    // Nothing of the deleted project may be written back by a pending save.
    suspendSaving(true);
    await openProject(deleteProject(id));
  },
  saveTemplate: async (name) => {
    await saveTemplate(name);
    emit('project');
    setStatus(`Template "${name}" saved`, { timeout: 2500 });
  },
  applyTemplate,
  exportProject,
  importProject: () => projectInput.click(),
  pendingImport: () =>
    pendingImport && {
      name: getProject(pendingImport.record.id)?.name ?? pendingImport.record.name,
      exportedAt: pendingImport.exportedAt,
    },
  finishImport: (replace) => pendingImport && finishImport(pendingImport, replace),
  cancelImport: () => {
    pendingImport = null;
    emit('project');
  },
  deleteTemplate: (id) => {
    deleteTemplate(id);
    emit('project');
  },
  addSection,
  addPart: () => (state.parts.length > 0 ? partInput.click() : fileInput.click()),
  sectionFacesCamera,
  addExplode: () => {
    if (state.parts.length < 2) return;
    pendingSnapshot = snapshotProject();
    state.explode.added = true;
    if (!(state.explode.amount > 0)) state.explode.amount = 0.5;
    select('explode');
    emit('explode');
  },
  deleteExplode: () =>
    deleteFromTree('explode', 'explode', () => {
      state.explode = defaultExplode();
    }),
  addFloor: (floor) => {
    pendingSnapshot = snapshotProject();
    state.scene.floor = floor;
    if (state.scene.background === 'environment') state.scene.background = 'light';
    select('scene:floor');
    emit('scene');
  },
  deleteFloor: () =>
    deleteFromTree('scene:floor', 'scene', () => {
      state.scene.floor = 'none';
    }),
  addDepthOfField: () => {
    pendingSnapshot = snapshotProject();
    state.camera.dof = true;
    select('camera:dof');
    emit('camera');
  },
  deleteDepthOfField: () =>
    deleteFromTree('camera:dof', 'camera', () => {
      state.camera.dof = false;
      if (pickingFocus) setPickingFocus(false);
    }),
  selectPart,
  deleteParts,
  restoreParts,
  toggleSection: (id) => {
    const section = state.sections.find((item) => item.id === id);
    if (!section) return;
    section.enabled = !section.enabled;
    emit('sections');
  },
  addMaterial: (materialId) => {
    if (state.parts.length === 0) return;
    pendingSnapshot = snapshotProject();
    const entry = addMaterial(materialId);
    select(`material:${entry.id}`);
  },
  showView,
  addView: () => {
    if (state.parts.length === 0) return;
    pendingSnapshot = snapshotProject();
    const view = {
      id: newId(),
      name: `View ${state.views.length + 1}`,
      ...viewer.getViewState(),
    };
    state.views.push(view);
    select(`view:${view.id}`);
  },
  addJob,
  addAnimationJob: () => addJob('animation'),
  jobsFromViews,
  duplicateJob,
  deleteJob,
  renderJob,
  renderAllJobs,
  /** Copies a job's image settings to the defaults, so the next job starts from them. */
  jobChanged: (job) => {
    for (const key of JOB_SETTINGS) state.output[key] = job[key];
    emit('jobs');
  },
  togglePart: (id) => {
    viewer.setPartVisible(id, !state.parts[id].mesh.visible);
    emit('geometry');
  },
  /** Hides or shows several parts at once: shows them if any is hidden. */
  setPartsVisible: (ids, visible) => {
    for (const id of ids) viewer.setPartVisible(id, visible);
    emit('geometry');
  },
  showAllParts: () => {
    for (const part of presentParts()) viewer.setPartVisible(part.id, true);
    emit('geometry');
  },
  isolatePart: (id) => {
    const keep = new Set(Array.isArray(id) ? id : [id]);
    for (const part of presentParts()) viewer.setPartVisible(part.id, keep.has(part.id));
    emit('geometry');
  },
  setPartOffset: (id, offset) => {
    if (offset && offset.some((value) => value !== 0)) state.partOffsets.set(id, offset);
    else state.partOffsets.delete(id);
    emit('geometry');
  },
  setPartRotation: (id, angles) => {
    if (angles && angles.some((value) => value !== 0)) state.partRotations.set(id, angles.map(roundAngle));
    else state.partRotations.delete(id);
    emit('geometry');
  },
  resetPartPlacement: (id) => {
    for (const item of Array.isArray(id) ? id : [id]) {
      state.partOffsets.delete(item);
      state.partRotations.delete(item);
    }
    emit('geometry');
  },
  toggleGizmo,
  isGizmoOn: () => gizmoOn,
  axesVisible: () => viewer.axesHelper.visible,
  toggleAxes,
  guides: () => ({ ...guides }),
  setGuides,
  hover: (ids) => viewer.setHighlight(ids ?? selectionHighlight()),
  loadHdri: () => hdriInput.click(),
  addLight: (kind = 'softbox') => {
    const base = { softbox: 'Softbox', strip: 'Strip light', round: 'Round softbox' }[kind] || 'Softbox';
    const names = state.lighting.lights.map((light) => light.name);
    let number = 1;
    while (names.includes(`${base} ${number}`)) number += 1;
    pendingSnapshot = snapshotProject();
    const shape = kind === 'strip' ? { width: 10, height: 50 } : kind === 'round' ? { round: true } : {};
    const [light] = withIds([{ ...newLight(`${base} ${number}`), ...shape }]);
    state.lighting.lights.push(light);
    select(`light:${light.id}`);
  },
  deleteSection: (id) =>
    deleteFromTree(`section:${id}`, 'sections', () => {
      state.sections = state.sections.filter((item) => item.id !== id);
    }),
  deleteMaterial: (id) => deleteFromTree(`material:${id}`, 'materials', () => removeMaterial(id)),
  deleteLight: (id) =>
    deleteFromTree(`light:${id}`, 'lighting', () => {
      state.lighting.lights = state.lighting.lights.filter((item) => item.id !== id);
    }),
  deleteView: (id) =>
    deleteFromTree(`view:${id}`, 'views', () => {
      state.views = state.views.filter((item) => item.id !== id);
    }),
  lensText: () => (viewer.parallel ? 'parallel' : `${Math.round(viewer.focalLength)} mm`),
  toggleLight: (id) => {
    const light = state.lighting.lights.find((item) => item.id === id);
    if (!light) return;
    light.enabled = !light.enabled;
    emit('lighting');
  },
  pickHighlight: (light) => {
    setPickingHighlight(pickingHighlight === light ? null : light);
    emit('lighting');
  },
  isPickingHighlight: (light) => pickingHighlight === light,
  pickFocus: () => {
    setPickingFocus(!pickingFocus);
    emit('camera');
  },
  isPickingFocus: () => pickingFocus,
  focusDistance,
  cancelRender,
  cancelQueue,
  deleteRender,
  saveRender: (render, format) => saveRender(render, format),
  saveAllRenders,
  saveVideo: (render) => saveVideo(render),
  togglePlaying,
  isPlaying: (render) => playing === render,
  showFrame,
  resolveOutputSize,
  fit: () => viewer.fit(),
  closePanel: () => select(''),
  applyPanel,
  discardPanel,
  renderSupported: isRenderSupported(),
};

function refresh(what) {
  const live = what.endsWith(':live');
  const area = what.replace(':live', '');

  if (what === 'selection') {
    // Remember the project as it is before the panel changes anything, for discarding.
    if (state.selected !== panelSnapshot?.key) {
      panelSnapshot = state.selected ? { key: state.selected, data: pendingSnapshot || snapshotProject() } : null;
    }
    pendingSnapshot = null;
    clickHighlight = [];
    if (pickingFocus && state.selected !== 'camera:dof') setPickingFocus(false);
    if (pickingHighlight && state.selected !== `light:${pickingHighlight.id}`) setPickingHighlight(null);
    const [kind, idText] = state.selected.split(':');
    if (kind !== 'part') state.selectedParts = new Set();
    else if (!state.selectedParts.has(Number(idText))) state.selectedParts = new Set([Number(idText)]);
    if (kind === 'view') {
      const view = state.views.find((item) => item.id === Number(idText));
      if (view) showView(view);
    }
    const job = selectedJob();
    if (job) showView(job);
    viewer.setHoverEnabled(pickingParts());
  }

  if (area === 'model' || area === 'geometry') applyUpAxis();
  if (area === 'model' || area === 'materials') applyMaterials();
  if (area === 'model' || area === 'explode' || area === 'geometry') applyExplode();
  if (area === 'model' || area === 'scene' || area === 'lighting') applySceneAndLighting();
  if (area === 'model' || area === 'sections' || what === 'selection') applySections();
  if (!live) viewer.setHighlight(selectionHighlight());

  scheduleSave();
  projectChip.textContent = state.project.name || 'Project';
  if (overviewOpen && !live) renderOverview(overviewEl, actions);
  if (!live && what !== 'selection' && !what.startsWith('render')) scheduleThumbnail();
  renderTree(treeEl, actions);
  if (live) panelLive?.();
  else panelLive = renderPanel(panelEl, { viewer, actions, editable: Boolean(panelSnapshot) });
  updateInset();
  updateOutputFrame();
  updateRenderView();
  updateFocusMarker();
  updateGizmo();
  if (settingsOpen && !live) drawSettings();
}

subscribe(refresh);
setViewProvider(() => (state.parts.length > 0 ? viewer.getViewState() : null));

viewer.onViewChange = () => {
  viewCube.update();
  updateOutputFrame();
  updateFocusMarker();
  // An open render job takes the camera along.
  const job = applyingRenderView ? null : selectedJob();
  if (job) job.camera = viewer.getViewState();
  if (state.selected === 'views' || state.selected === 'camera:dof' || job) panelLive?.();
  scheduleSave();
};

viewer.onPartHover = (partId) => {
  viewer.canvas.title = partId === null ? '' : state.parts[partId]?.label || '';
};

viewer.onPartClick = (partId, point, normal, event) => {
  if (pickingHighlight) {
    if (!point) return;
    placeHighlight(pickingHighlight, point, normal);
    if (pickingHighlight.el < 0 && state.scene.floor !== 'none' && !state.output.transparent) {
      setStatus('The light is below the horizon; the floor hides it in the rendering.', { timeout: 5000 });
    }
    setPickingHighlight(null);
    emit('lighting');
    return;
  }
  if (pickingFocus) {
    if (!point) return;
    state.camera.focusPoint = point.toArray();
    setPickingFocus(false);
    emit('camera');
    return;
  }

  const [kind, idText] = state.selected.split(':');
  const entry = kind === 'material' ? state.materials.find((item) => item.id === Number(idText)) : null;
  if (entry && partId !== null) {
    // While a material is open, clicking parts in the model assigns them.
    const part = state.parts[partId];
    setPartsAssigned(
      entry,
      identicalParts(part).map((item) => item.id),
      !entry.partIds.has(partId),
    );
    return;
  }
  const section = kind === 'section' ? state.sections.find((item) => item.id === Number(idText)) : null;
  if (section && partId !== null) {
    // While a section is open, clicking a part switches whether it is cut.
    const cut = section.uncut.has(partId);
    for (const item of identicalParts(state.parts[partId])) {
      if (cut) section.uncut.delete(item.id);
      else section.uncut.add(item.id);
    }
    emit('sections');
    return;
  }

  // Around the geometry step a click opens the part; elsewhere it only points it out,
  // so the panel being worked in stays open.
  const browsing = ['', 'geometry', 'part', 'explode'].includes(kind) || state.selected === 'material:cad';
  const additive = Boolean(event && (event.ctrlKey || event.metaKey || event.shiftKey));
  if (browsing) {
    if (partId !== null) selectPart(partId, additive);
    else if (kind === 'part' && !additive) select('');
    return;
  }
  clickHighlight = partId === null ? [] : [partId];
  viewer.setHighlight(clickHighlight);
  if (partId !== null) setStatus(state.parts[partId].label, { timeout: 2500 });
};

// --- Opening files ------------------------------------------------------------

async function openFile(file) {
  if (!file) return;
  if (loading) {
    setStatus('A model is still loading. Please wait a moment and open it again.', { error: true, timeout: 4000 });
    return;
  }
  if (!/\.(step|stp)$/i.test(file.name)) {
    setStatus('Please choose a STEP file (.step or .stp).', { error: true });
    return;
  }
  await loadModel(file, { record: currentRecord(), store: true });
}

fileInput.addEventListener('change', () => {
  openFile(fileInput.files[0]);
  fileInput.value = '';
});

async function openHdri(file) {
  if (!file) return;
  setStatus(`Loading ${file.name} …`);
  try {
    viewer.setCustomEnvironment(await loadHdriFile(file));
    // The softboxes of a preset do not belong into a photographed environment.
    if (state.lighting.presetId !== 'custom') state.lighting.lights = [];
    state.lighting.presetId = 'custom';
    state.lighting.hdriName = file.name;
    files.put(fileKeys.hdri(state.project.id), file);
    emit('lighting');
    setStatus(`${file.name} loaded`, { timeout: 2500 });
  } catch (error) {
    console.error(error);
    setStatus(`The HDRI could not be loaded: ${error.message}`, { error: true });
  }
}

projectInput.addEventListener('change', () => {
  const file = projectInput.files[0];
  projectInput.value = '';
  importProjectFile(file);
});

hdriInput.addEventListener('change', () => {
  const file = hdriInput.files[0];
  hdriInput.value = '';
  openHdri(file);
});

// Drag and drop of files anywhere on the window. Only files count: dragging a
// slider or selected text inside the app must not look like a file drop.
const carriesFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
let dragDepth = 0;
window.addEventListener('dragstart', (event) => {
  // The app has nothing to drag; this stops text or images from being dragged off by accident.
  if (!event.target.closest?.('[draggable="true"]')) event.preventDefault();
});
window.addEventListener('dragenter', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  dropzone.classList.add('dragover');
});
window.addEventListener('dragover', (event) => {
  if (carriesFiles(event)) event.preventDefault();
});
window.addEventListener('dragleave', (event) => {
  if (!carriesFiles(event)) return;
  dragDepth = Math.max(dragDepth - 1, 0);
  if (dragDepth === 0) dropzone.classList.remove('dragover');
});
window.addEventListener('drop', (event) => {
  dragDepth = 0;
  dropzone.classList.remove('dragover');
  if (!carriesFiles(event)) return;
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  // Dropping an HDRI sets it as lighting, a project file imports the project.
  if (file && /\.(hdr|exr)$/i.test(file.name)) openHdri(file);
  else if (file && file.name.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)) importProjectFile(file);
  else openFile(file);
});

// --- Viewport tools -----------------------------------------------------------

$('#fit-btn').addEventListener('click', () => viewer.fit());
projectChip.addEventListener('click', () => actions.editProject());
projectsBtn.addEventListener('click', () => showOverview(!overviewOpen));

function toggleEdges() {
  const visible = !viewer.edgesVisible;
  viewer.setEdgesVisible(visible);
  edgesBtn.setAttribute('aria-pressed', String(visible));
}
edgesBtn.addEventListener('click', toggleEdges);

function toggleAxes() {
  const visible = !viewer.axesHelper.visible;
  viewer.setAxesVisible(visible);
  axesBtn.setAttribute('aria-pressed', String(visible));
  if (state.selected === 'geometry') emit('geometry:live');
}
axesBtn.addEventListener('click', toggleAxes);

function setGuides(changes) {
  Object.assign(guides, changes);
  saveGuides(guides);
  guidesBtn.setAttribute('aria-pressed', String(guides.visible));
  updateOutputFrame();
  if (state.selected === 'views' || state.selected.startsWith('job:')) emit('selection');
}
// The toolbar is the one place for guide lines: the button lists the kinds and turns them off.
guidesBtn.addEventListener('click', () =>
  openMenu(guidesBtn, [
    ...Object.entries(GUIDE_TYPES).map(([type, label]) => ({
      label,
      icon: guides.visible && guides.type === type ? 'check' : null,
      run: () => setGuides({ visible: true, type }),
    })),
    null,
    { label: 'No guide lines', icon: guides.visible ? null : 'check', run: () => setGuides({ visible: false }) },
  ]),
);

function toggleGizmo() {
  gizmoOn = !gizmoOn;
  updateGizmo();
  emit('geometry:live');
}

/** Tooltips of the toolbar name the current keys. */
function updateShortcutTitles() {
  const buttons = { fit: '#fit-btn', edges: '#edges-btn', axes: '#axes-btn', guides: '#guides-btn' };
  for (const [action, selector] of Object.entries(buttons)) {
    $(selector).title = `${SHORTCUT_ACTIONS[action].label} (${shortcutLabel(action)})`;
  }
}
updateShortcutTitles();

// --- App settings -------------------------------------------------------------

$('#settings-btn').append(icon('gear', 18));
$('#settings-btn').addEventListener('click', () => showSettings(!settingsOpen));

function showSettings(open) {
  settingsOpen = open;
  settingsEl.hidden = !open;
  if (open) drawSettings();
  else settingsEl.replaceChildren();
}

function drawSettings() {
  renderSettings(settingsEl, {
    onClose: () => showSettings(false),
    onChange: () => {
      updateShortcutTitles();
      emit('selection');
    },
  });
}

window.addEventListener('keydown', (event) => {
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || event.metaKey || event.ctrlKey) return;
  if (overviewOpen) {
    if (event.key === 'Escape') {
      if (overviewDialog) setOverviewDialog(overviewDialog.mode === 'gallery' && overviewDialog.key ? { ...overviewDialog, key: null } : null);
      else showOverview(false);
    }
    return;
  }
  if (isRecordingShortcut()) return;
  if (settingsOpen) {
    if (event.key === 'Escape') showSettings(false);
    return;
  }
  const shortcut = shortcutFor(event.key);
  if (shortcut === 'fit') viewer.fit();
  if (shortcut === 'edges') toggleEdges();
  if (shortcut === 'axes') toggleAxes();
  if (shortcut === 'guides') setGuides({ visible: !guides.visible });
  if (shortcut === 'move' && state.selected.startsWith('part:')) toggleGizmo();
  if (event.key === 'Escape') {
    if (pickingFocus) actions.pickFocus();
    if (pickingHighlight) actions.pickHighlight(pickingHighlight);
    clickHighlight = [];
    viewer.setHighlight(selectionHighlight());
  }
});

new ResizeObserver(() => updateInset()).observe(stageEl);
updateInset(true);
openProject(initProjects());
// With several projects the app starts on the overview, like a list of recent documents.
if (state.projects.length > 1) showOverview(true);

// Exposed for automated tests and debugging in the browser console.
window.__cad = { viewer, state, actions, select, emit, getMaterialDef };
