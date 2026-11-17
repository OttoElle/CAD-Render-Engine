import { Vector3 } from 'three';
import { Viewer } from './viewer.js';
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
  importProject,
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
} from './persistence.js';
import { sectionToPlane } from './section.js';
import { sceneGradient } from './backdrop.js';
import { explodeOffsets } from './explode.js';
import {
  FILE_FORMATS,
  TURN_SECONDS,
  convertImage,
  downloadBlob,
  recordVideo,
  safeFileName,
  zipFiles,
} from './export.js';
import { PROJECT_EXTENSION, packProject, unpackProject } from './project-file.js';
import { renderTree, setCollapsed } from './tree.js';
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
  materialEntryOf,
  setPartsAssigned,
  QUALITY,
  OUTPUT_SIZES,
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
const projectChip = $('#project-chip');

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

$('#fit-btn').append(icon('fit', 16), 'Einpassen');
edgesBtn.append(icon('edges', 16), 'Kanten');

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
  });
}

/** Moves the parts apart for an exploded view, or back together. */
function applyExplode() {
  viewer.setPartOffsets(explodeOffsets(state.parts, state.explode));
}

/** Shows a saved view, including how far the assembly was exploded. */
function showView(view) {
  viewer.applyViewState(view);
  if (view.explode) {
    state.explode = { ...view.explode };
    applyExplode();
  }
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

/** Direction from the model to the camera in CAD coordinates (Z up). */
function cameraDirectionCad() {
  const [x, y, z] = viewer.camera.position.clone().sub(viewer.controls.target).toArray();
  return [x, -z, y];
}

/** Whether a cut along `axis` must be flipped to keep the half away from the camera, so the cut face is in view. */
function sectionFacesCamera(axis) {
  return cameraDirectionCad()[axis] > 0;
}

/** Adds a cut through the middle of the model that opens it up towards the camera. */
function addSection() {
  if (state.parts.length === 0) return;
  // Pick the horizontal axis the camera looks along most.
  const cad = cameraDirectionCad();
  const axis = Math.abs(cad[0]) >= Math.abs(cad[1]) ? 0 : 1;
  const center = viewer.modelBox.getCenter(new Vector3());
  const section = {
    id: newId(),
    name: `Schnitt ${state.sections.length + 1}`,
    axis,
    position: center.getComponent(axis),
    flip: sectionFacesCamera(axis),
    enabled: true,
    uncut: new Set(),
  };
  state.sections.push(section);
  select(`section:${section.id}`);
}

/** Pixel size of the final image for the current output settings. */
function resolveOutputSize() {
  const { output } = state;
  if (output.size === 'custom') return { width: output.width, height: output.height };
  const preset = OUTPUT_SIZES[output.size];
  if (preset?.width) return { width: preset.width, height: preset.height };

  // "Wie Ansicht": the free part of the viewport at screen resolution, capped to a sane size.
  const region = viewer.getFreeRegion();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  let width = region.width * ratio;
  let height = region.height * ratio;
  const scale = Math.min(1, 4096 / Math.max(width, height));
  width = Math.max(Math.round((width * scale) / 2) * 2, 64);
  height = Math.max(Math.round((height * scale) / 2) * 2, 64);
  return { width, height };
}

/** Shows the crop of the final image when its aspect ratio differs from the viewport. */
function updateOutputFrame() {
  const cropped = state.output.size !== 'view';
  const { width, height } = resolveOutputSize();
  viewer.outputAspect = cropped ? width / height : null;
  viewer.outputMargin = cropped ? 14 : 0;
  // A rendering shown over the viewport covers the view the frame belongs to.
  const show = cropped && state.parts.length > 0 && !state.selected.startsWith('render:');
  outputFrameEl.hidden = !show;
  const frame = viewer.getOutputFrame(width / height);
  viewer.setBackdropFrame(frame);
  if (!show) return;
  Object.assign(outputFrameEl.style, {
    left: `${frame.x}px`,
    top: `${frame.y}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
  });
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

// --- Renderings ---------------------------------------------------------------

function runningRender() {
  return state.renders.find((render) => render.status === 'running') || null;
}

/**
 * Puts a rendering into the queue. The camera, the exploded view and the
 * output settings are taken now; materials, lights and scene as they are when
 * its turn comes. `view` is a saved view to render instead of the current one,
 * `turntable` the number of images for a full turn of the model.
 */
function queueRender({ name, view = null, turntable = 0 } = {}) {
  const { width, height } = resolveOutputSize();
  const output = { ...state.output, width, height };
  const render = {
    id: newId(),
    name: name || `Rendering ${state.renders.length + 1}`,
    status: 'queued',
    stage: 'building',
    progress: 0,
    samples: 0,
    targetSamples: QUALITY[output.quality].samples,
    seconds: 0,
    width,
    height,
    transparent: output.transparent,
    denoised: false,
    note: null,
    deviceName: null,
    handle: null,
    blob: null,
    url: null,
    error: null,
    output,
    view: view
      ? { position: view.position, target: view.target, fov: view.fov, roll: view.roll, explode: { ...view.explode } }
      : { ...viewer.getViewState(), explode: { ...state.explode } },
    // A turntable series keeps all its images; `shownFrame` is the one on screen.
    turntable: turntable > 0 ? turntable : 0,
    frames: [],
    frameIndex: 0,
    shownFrame: 0,
  };
  state.renders.push(render);
  return render;
}

/** Checks whether rendering is possible at all; shows why not otherwise. */
function canRender() {
  if (state.parts.length === 0) return false;
  if (!isRenderSupported()) {
    select('renders');
    return false;
  }
  return true;
}

function beginRender() {
  if (!canRender()) return;
  const render = queueRender();
  if (runningRender()) setStatus('Das Rendering startet, sobald das laufende fertig ist.', { timeout: 4000 });
  select(`render:${render.id}`);
  runQueue();
}

/** Queues one rendering for each saved view. */
function renderAllViews() {
  if (!canRender() || state.views.length === 0) return;
  const renders = state.views.map((view) => queueRender({ name: view.name, view }));
  select(`render:${renders[0].id}`);
  runQueue();
}

/** Queues a turntable series: the model turns once, seen from the current camera. */
function renderTurntable() {
  if (!canRender()) return;
  const frames = state.output.turntableFrames;
  const render = queueRender({ name: `Drehteller ${frames} Bilder`, turntable: frames });
  select(`render:${render.id}`);
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
        },
        // Right before the scene is read: show the camera and explosion this rendering was queued with.
        prepare: () => {
          if (index === 0) {
            viewer.applyViewState(render.view);
            state.explode = { ...render.view.explode };
            applyExplode();
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
            render.note = 'Entrauschen nicht möglich';
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
        render.note = `abgebrochen nach ${render.frames.length} von ${count} Bildern`;
      }
      render.status = 'done';
      render.progress = 1;
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
  state.renders = state.renders.filter((other) => other !== render);
  select('renders');
}

/** Base of all file names: the project's name, or the model's. */
function fileBase() {
  return safeFileName(state.project.name) || safeFileName((state.fileName || 'Modell').replace(/\.(step|stp)$/i, ''));
}

/** The files of a finished rendering: one image, or the numbered images of a turntable series. */
async function renderFiles(render, format, folder = '') {
  const { extension } = FILE_FORMATS[format];
  const name = `${fileBase()}_${safeFileName(render.name)}_${render.width}x${render.height}`;
  if (!render.turntable) return [{ name: `${folder}${name}.${extension}`, blob: await convertImage(render.blob, format) }];
  const digits = String(render.frames.length).length;
  return Promise.all(
    render.frames.map(async (frame, i) => ({
      name: `${folder}${name}_${String(i + 1).padStart(Math.max(digits, 3), '0')}.${extension}`,
      blob: await convertImage(frame.blob, format),
    })),
  );
}

async function exporting(text, run) {
  setStatus(text);
  try {
    await run();
    setStatus('');
  } catch (error) {
    console.error(error);
    setStatus(`Speichern fehlgeschlagen: ${error?.message || error}`, { error: true, timeout: 6000 });
  }
}

/** Saves one rendering in the given format; a turntable series as a ZIP archive. */
function saveRender(render, format = state.output.format) {
  return exporting('Bilder werden gespeichert …', async () => {
    const files = await renderFiles(render, format);
    if (files.length === 1) downloadBlob(files[0].blob, files[0].name.split('/').pop());
    else downloadBlob(await zipFiles(files), `${fileBase()}_${safeFileName(render.name)}.zip`);
  });
}

/** Saves all finished renderings in one ZIP archive, turntable series in folders of their own. */
function saveAllRenders() {
  const done = state.renders.filter((render) => render.status === 'done');
  if (done.length === 0) return;
  return exporting('Bilder werden gespeichert …', async () => {
    const files = [];
    for (const render of done) {
      files.push(...(await renderFiles(render, state.output.format, render.turntable ? `${safeFileName(render.name)}/` : '')));
    }
    downloadBlob(await zipFiles(files), `${fileBase()}_Renderings.zip`);
  });
}

/** Saves a turntable series as a video of one full turn. */
function saveVideo(render) {
  return exporting('Video wird aufgenommen …', async () => {
    const { blob, extension } = await recordVideo(render.frames.map((frame) => frame.blob));
    downloadBlob(blob, `${fileBase()}_${safeFileName(render.name)}_${render.width}x${render.height}.${extension}`);
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
    }, (TURN_SECONDS * 1000) / render.frames.length);
  }
  panelLive?.();
}

function showFrame(render, index) {
  render.shownFrame = Math.min(Math.max(index, 0), render.frames.length - 1);
  updateRenderView();
}

/** Shows the selected rendering over the viewport, live while it runs and as an image afterwards. */
function updateRenderView() {
  const [kind, idText] = state.selected.split(':');
  const render = kind === 'render' ? state.renders.find((item) => item.id === Number(idText)) : null;
  renderViewEl.hidden = !render;
  if (!render) {
    renderViewEl.replaceChildren();
    return;
  }

  // A finished image, or the last finished image of a turntable series that is still running.
  const frame = render.turntable ? render.frames[render.shownFrame] : null;
  const imageUrl =
    render.status === 'done' ? (frame?.url ?? render.url) : render.status === 'running' && !render.handle ? frame?.url : null;
  const current = renderViewEl.firstChild;
  if (imageUrl) {
    if (current?.tagName === 'IMG') {
      // Swapping the source keeps playback free of flicker.
      if (current.src !== imageUrl) current.src = imageUrl;
    } else {
      renderViewEl.replaceChildren(h('img', { src: imageUrl, alt: render.name }));
    }
    return;
  }
  const canvas = render.status === 'running' ? render.handle?.canvas : null;
  if (canvas) {
    if (current !== canvas) renderViewEl.replaceChildren(canvas);
    return;
  }
  const text =
    render.status === 'running'
      ? 'Szene wird vorbereitet …'
      : render.status === 'queued'
        ? 'Wartet, bis die Renderings davor fertig sind'
        : 'Kein Bild vorhanden';
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
    if (state.scene.background === 'environment') state.scene.background = 'light';
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
  setStatus(`Lade ${file.name} …`);
  const started = performance.now();
  try {
    const parts = await loadStepFile(file);
    if (token !== projectToken) return;

    viewer.setParts(parts);
    resetForModel(file.name, parts);
    const restored = applyModelData(record);
    if (restored) {
      for (const id of restored.hidden) viewer.setPartVisible(id, false);
      if (restored.view) viewer.applyViewState(restored.view);
    } else {
      // A focus point belongs to the model it was picked on.
      state.camera.focusPoint = null;
      const palette = takePendingPalette();
      if (palette) applyPalette(palette);
    }
    if (store) files.put(fileKeys.step(state.project.id), file);

    // Long part lists start folded so the steps below stay in sight.
    setCollapsed('geometry', parts.length > 12);
    if (store) state.selected = 'geometry';
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    setStatus(`${file.name} geladen (${seconds} s)`, { timeout: 2500 });
  } catch (error) {
    if (token !== projectToken) return;
    console.error(error);
    setStatus(`Import fehlgeschlagen: ${error.message}`, { error: true });
  } finally {
    if (token === projectToken) {
      loading = false;
      showModelUi();
      emit('model');
    }
  }
}

/** Makes a stored project the one on screen: settings first, then its HDRI and model. */
async function openProject(record) {
  const token = ++projectToken;
  suspendSaving(true);
  setPickingFocus(false);
  loading = false;
  resetForProject(record);
  setPendingPalette(null);
  viewer.setCustomEnvironment(null);
  viewer.setFov(35);
  viewer.setParts([]);
  applySettings(record);
  state.selected = 'project';
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
      setStatus(`${record.fileName} ist nicht mehr gespeichert. Bitte die Datei erneut öffnen.`, { error: true });
    }
  }
  if (token === projectToken) suspendSaving(false);
}

async function switchProject(id) {
  saveNow();
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
  setStatus(`Vorlage „${template.name}“ angewendet`, { timeout: 2500 });
}

// --- Project files ------------------------------------------------------------

/** A project file waiting for the decision whether it replaces the project of the same name. */
let pendingImport = null;

/** Saves the current project with its model and HDRI as one file. */
function exportProject() {
  saveNow();
  const record = getProject(state.project.id);
  if (!record) return;
  return exporting('Projekt wird exportiert …', async () => {
    const step = record.fileName ? await files.get(fileKeys.step(record.id)) : null;
    const hdri = state.lighting.presetId === 'custom' ? await files.get(fileKeys.hdri(record.id)) : null;
    const blob = await packProject(record, { step, hdri });
    downloadBlob(blob, `${fileBase()}.${PROJECT_EXTENSION}`);
  });
}

async function importProjectFile(file) {
  if (!file) return;
  let data;
  try {
    setStatus(`Lese ${file.name} …`);
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
    select('project');
    emit('project');
    return;
  }
  await finishImport(data, false);
}

async function finishImport(data, replace) {
  pendingImport = null;
  // Replacing the open project: its pending changes must not be written over the imported one.
  if (replace && data.record.id === state.project.id) suspendSaving(true);
  else saveNow();
  const record = await importProject(data.record, { step: data.step, hdri: data.hdri, replace });
  setCurrentProject(record.id);
  await openProject(record);
  setStatus(`Projekt „${record.name}“ importiert`, { timeout: 3000 });
}

// --- Tree and panel -----------------------------------------------------------

function selectionHighlight() {
  const [kind, idText] = state.selected.split(':');
  return kind === 'part' ? [Number(idText)] : clickHighlight;
}

const actions = {
  openFile: () => fileInput.click(),
  newProject: async () => {
    saveNow();
    const record = createProject();
    setCurrentProject(record.id);
    await openProject(record);
  },
  switchProject,
  duplicateProject: async () => {
    saveNow();
    const record = await duplicateProject(state.project.id);
    if (!record) return;
    setCurrentProject(record.id);
    await openProject(record);
  },
  deleteProject: async () => {
    // Nothing of the deleted project may be written back by a pending save.
    suspendSaving(true);
    await openProject(deleteProject(state.project.id));
  },
  saveTemplate: async (name) => {
    await saveTemplate(name);
    emit('project');
    setStatus(`Vorlage „${name}“ gespeichert`, { timeout: 2500 });
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
  sectionFacesCamera,
  toggleSection: (id) => {
    const section = state.sections.find((item) => item.id === id);
    if (!section) return;
    section.enabled = !section.enabled;
    emit('sections');
  },
  addMaterial: () => {
    if (state.parts.length === 0) return;
    const entry = addMaterial();
    select(`material:${entry.id}`);
  },
  showView,
  addView: () => {
    if (state.parts.length === 0) return;
    const view = {
      id: newId(),
      name: `Ansicht ${state.views.length + 1}`,
      ...viewer.getViewState(),
      explode: { ...state.explode },
    };
    state.views.push(view);
    select(`view:${view.id}`);
  },
  togglePart: (id) => {
    viewer.setPartVisible(id, !state.parts[id].mesh.visible);
    emit('geometry');
  },
  showAllParts: () => {
    for (const part of state.parts) viewer.setPartVisible(part.id, true);
    emit('geometry');
  },
  isolatePart: (id) => {
    for (const part of state.parts) viewer.setPartVisible(part.id, part.id === id);
    emit('geometry');
  },
  hover: (ids) => viewer.setHighlight(ids ?? selectionHighlight()),
  loadHdri: () => hdriInput.click(),
  addLight: () => {
    const names = state.lighting.lights.map((light) => light.name);
    let number = state.lighting.lights.length + 1;
    while (names.includes(`Softbox ${number}`)) number += 1;
    const [light] = withIds([newLight(`Softbox ${number}`)]);
    state.lighting.lights.push(light);
    select(`light:${light.id}`);
  },
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
  startRender: beginRender,
  renderAllViews,
  renderTurntable,
  cancelRender,
  cancelQueue,
  deleteRender,
  saveRender,
  saveAllRenders,
  saveVideo,
  togglePlaying,
  isPlaying: (render) => playing === render,
  showFrame,
  resolveOutputSize,
  fit: () => viewer.fit(),
  closePanel: () => select(''),
  renderSupported: isRenderSupported(),
};

function refresh(what) {
  const live = what.endsWith(':live');
  const area = what.replace(':live', '');

  if (area === 'model' || area === 'materials') applyMaterials();
  if (area === 'model' || area === 'explode') applyExplode();
  if (area === 'model' || area === 'scene' || area === 'lighting') applySceneAndLighting();
  if (area === 'model' || area === 'sections' || what === 'selection') applySections();

  if (what === 'selection') {
    clickHighlight = [];
    if (pickingFocus && state.selected !== 'views') setPickingFocus(false);
    if (pickingHighlight && state.selected !== `light:${pickingHighlight.id}`) setPickingHighlight(null);
    const [kind, idText] = state.selected.split(':');
    if (kind === 'view') {
      const view = state.views.find((item) => item.id === Number(idText));
      if (view) showView(view);
    }
  }
  if (!live) viewer.setHighlight(selectionHighlight());

  scheduleSave();
  projectChip.textContent = state.project.name || 'Projekt';
  renderTree(treeEl, actions);
  if (live) panelLive?.();
  else panelLive = renderPanel(panelEl, { viewer, actions });
  updateInset();
  updateOutputFrame();
  updateRenderView();
  updateFocusMarker();
}

subscribe(refresh);
setViewProvider(() => (state.parts.length > 0 ? viewer.getViewState() : null));

viewer.onViewChange = () => {
  viewCube.update();
  updateOutputFrame();
  updateFocusMarker();
  if (state.selected === 'views') panelLive?.();
  scheduleSave();
};

viewer.onPartClick = (partId, point, normal) => {
  if (pickingHighlight) {
    if (!point) return;
    placeHighlight(pickingHighlight, point, normal);
    if (pickingHighlight.el < 0 && state.scene.floor !== 'none' && !state.output.transparent) {
      setStatus('Das Licht liegt unter dem Horizont und wird im Rendering vom Boden verdeckt.', { timeout: 5000 });
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

  // Around the geometry step a click opens the part; elsewhere it only points it out,
  // so the panel being worked in stays open.
  const browsing = ['', 'project', 'geometry', 'part', 'materials'].includes(kind) || state.selected === 'material:cad';
  if (browsing) {
    if (partId !== null) select(`part:${partId}`);
    else if (kind === 'part') select('geometry');
    return;
  }
  clickHighlight = partId === null ? [] : [partId];
  viewer.setHighlight(clickHighlight);
  if (partId !== null) setStatus(state.parts[partId].label, { timeout: 2500 });
};

// --- Opening files ------------------------------------------------------------

async function openFile(file) {
  if (!file || loading) return;
  if (!/\.(step|stp)$/i.test(file.name)) {
    setStatus('Bitte eine STEP-Datei wählen (.step oder .stp).', { error: true });
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
  setStatus(`Lade ${file.name} …`);
  try {
    viewer.setCustomEnvironment(await loadHdriFile(file));
    // The softboxes of a preset do not belong into a photographed environment.
    if (state.lighting.presetId !== 'custom') state.lighting.lights = [];
    state.lighting.presetId = 'custom';
    state.lighting.hdriName = file.name;
    files.put(fileKeys.hdri(state.project.id), file);
    emit('lighting');
    setStatus(`${file.name} geladen`, { timeout: 2500 });
  } catch (error) {
    console.error(error);
    setStatus(`HDRI konnte nicht geladen werden: ${error.message}`, { error: true });
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

// Drag and drop anywhere on the window.
let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  dropzone.classList.add('dragover');
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(dragDepth - 1, 0);
  if (dragDepth === 0) dropzone.classList.remove('dragover');
});
window.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('dragover');
  const file = event.dataTransfer?.files?.[0];
  // Dropping an HDRI sets it as lighting, a project file imports the project.
  if (file && /\.(hdr|exr)$/i.test(file.name)) openHdri(file);
  else if (file && file.name.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)) importProjectFile(file);
  else openFile(file);
});

// --- Viewport tools -----------------------------------------------------------

$('#fit-btn').addEventListener('click', () => viewer.fit());
projectChip.addEventListener('click', () => select('project'));

function toggleEdges() {
  const visible = !viewer.edgesVisible;
  viewer.setEdgesVisible(visible);
  edgesBtn.setAttribute('aria-pressed', String(visible));
}
edgesBtn.addEventListener('click', toggleEdges);

window.addEventListener('keydown', (event) => {
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || event.metaKey || event.ctrlKey) return;
  if (event.key === 'f' || event.key === 'F') viewer.fit();
  if (event.key === 'e' || event.key === 'E') toggleEdges();
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

// Exposed for automated tests and debugging in the browser console.
window.__cad = { viewer, state, actions, select, emit, getMaterialDef };
