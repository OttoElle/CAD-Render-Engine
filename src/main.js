import { Vector3 } from 'three';
import { Viewer } from './viewer.js';
import { ViewCube } from './viewcube.js';
import { loadStepFile } from './step-loader.js';
import { getMaterialDef } from './materials.js';
import { loadHdriFile } from './environment.js';
import {
  initProjects,
  currentRecord,
  createProject,
  duplicateProject,
  deleteProject,
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
    if (part.materialId === materialId && part.colorHex === colorHex) continue;
    part.materialId = materialId;
    part.colorHex = colorHex;
    viewer.updatePartMaterial(part.id);
  }
}

function applySceneAndLighting() {
  viewer.setLighting({
    presetId: state.lighting.presetId,
    rotation: state.lighting.rotation,
    intensity: state.lighting.intensity,
    ground: state.scene.ground,
    background: state.scene.background,
  });
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
  if (!show) return;
  const frame = viewer.getOutputFrame(width / height);
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
  viewer.canvas.classList.toggle('picking', value);
}

// --- Renderings ---------------------------------------------------------------

function runningRender() {
  return state.renders.find((render) => render.status === 'running') || null;
}

async function beginRender() {
  if (state.parts.length === 0) return;
  if (!isRenderSupported()) {
    select('renders');
    return;
  }
  const active = runningRender();
  if (active) {
    select(`render:${active.id}`);
    setStatus('Es läuft bereits ein Rendering.', { timeout: 3000 });
    return;
  }

  const { width, height } = resolveOutputSize();
  const frame = viewer.getOutputFrame(width / height);
  const targetSamples = QUALITY[state.output.quality].samples;
  const onCpu = state.output.device === 'cpu';
  const render = {
    id: newId(),
    name: `Rendering ${state.renders.length + 1}`,
    status: 'running',
    stage: 'building',
    progress: 0,
    samples: 0,
    targetSamples,
    seconds: 0,
    width,
    height,
    transparent: state.output.transparent,
    denoised: false,
    note: null,
    deviceName: null,
    handle: null,
    blob: null,
    url: null,
    error: null,
  };
  state.renders.push(render);
  select(`render:${render.id}`);

  const started = performance.now();
  viewer.setHighlight([]);
  try {
    // Loaded on demand so the path tracer does not slow down the start of the app.
    const { startRender } = await import('./render.js');
    render.handle = await startRender(viewer, {
      width,
      height,
      samples: targetSamples,
      transparent: render.transparent,
      ground: state.scene.ground,
      fov: frame.fov,
      denoise: state.output.denoise,
      device: state.output.device,
      // Software rendering only stays stable with small work packages.
      gentle: state.output.gentle || onCpu,
      // A parallel projection has no lens, so it stays sharp throughout.
      dof:
        state.camera.dof && !viewer.parallel
          ? { fStop: state.camera.fStop, focusDistance: focusDistance() }
          : null,
      onProgress: ({ stage, progress, samples }) => {
        render.seconds = (performance.now() - started) / 1000;
        if (stage === 'denoise-failed') {
          render.denoised = false;
          render.note = 'Entrauschen nicht möglich';
        } else {
          render.stage = stage;
          if (stage === 'rendering' && samples !== null) {
            render.samples = samples;
            render.progress = Math.min(progress ?? samples / targetSamples, 1);
          }
          if (stage === 'denoising') {
            render.denoised = true;
            render.progress = progress ?? render.progress;
          }
        }
        emit('renders:live');
      },
    });
    render.deviceName = render.handle.deviceName;
    if (render.status !== 'running') {
      // Cancelled or deleted while the scene was being prepared.
      render.handle.cancel();
      return;
    }
    emit('renders');

    const blob = await render.handle.done;
    render.handle = null;
    render.seconds = (performance.now() - started) / 1000;
    if (blob) {
      render.blob = blob;
      render.url = URL.createObjectURL(blob);
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
}

function cancelRender(render) {
  render.status = 'cancelled';
  render.handle?.cancel();
  emit('renders');
}

function deleteRender(render) {
  if (render.status === 'running') {
    render.status = 'cancelled';
    render.handle?.cancel();
  }
  if (render.url) URL.revokeObjectURL(render.url);
  state.renders = state.renders.filter((other) => other !== render);
  select('renders');
}

function saveRender(render) {
  const safe = (text) => text.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
  const base = safe(state.project.name) || safe((state.fileName || 'Modell').replace(/\.(step|stp)$/i, ''));
  const link = h('a', {
    href: render.url,
    download: `${base}_${safe(render.name)}_${render.width}x${render.height}.png`,
  });
  document.body.append(link);
  link.click();
  link.remove();
}

/** Shows the selected rendering over the viewport, live while it runs and as an image afterwards. */
function updateRenderView() {
  const [kind, idText] = state.selected.split(':');
  const render = kind === 'render' ? state.renders.find((item) => item.id === Number(idText)) : null;
  const content =
    render?.status === 'done'
      ? h('img', { src: render.url, alt: render.name })
      : render?.status === 'running' && render.handle
        ? render.handle.canvas
        : null;

  renderViewEl.hidden = !render;
  if (!render) {
    renderViewEl.replaceChildren();
    return;
  }
  const current = renderViewEl.firstChild;
  const same =
    current &&
    ((content && current === content) ||
      (content?.tagName === 'IMG' && current.tagName === 'IMG' && current.src === content.src));
  if (same) return;
  renderViewEl.replaceChildren(
    content ||
      h(
        'p',
        { class: 'render-placeholder' },
        render.status === 'running' ? 'Szene wird vorbereitet …' : 'Kein Bild vorhanden',
      ),
  );
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
  deleteTemplate: (id) => {
    deleteTemplate(id);
    emit('project');
  },
  addMaterial: () => {
    if (state.parts.length === 0) return;
    const entry = addMaterial();
    select(`material:${entry.id}`);
  },
  addView: () => {
    if (state.parts.length === 0) return;
    const view = { id: newId(), name: `Ansicht ${state.views.length + 1}`, ...viewer.getViewState() };
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
  pickFocus: () => {
    setPickingFocus(!pickingFocus);
    emit('camera');
  },
  isPickingFocus: () => pickingFocus,
  focusDistance,
  startRender: beginRender,
  cancelRender,
  deleteRender,
  saveRender,
  resolveOutputSize,
  fit: () => viewer.fit(),
  closePanel: () => select(''),
  renderSupported: isRenderSupported(),
};

function refresh(what) {
  const live = what.endsWith(':live');
  const area = what.replace(':live', '');

  if (area === 'model' || area === 'materials') applyMaterials();
  if (area === 'model' || area === 'scene' || area === 'lighting') applySceneAndLighting();

  if (what === 'selection') {
    clickHighlight = [];
    if (pickingFocus && state.selected !== 'views') setPickingFocus(false);
    const [kind, idText] = state.selected.split(':');
    if (kind === 'view') {
      const view = state.views.find((item) => item.id === Number(idText));
      if (view) viewer.applyViewState(view);
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

viewer.onPartClick = (partId, point) => {
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
  // Dropping an HDRI sets it as lighting.
  if (file && /\.(hdr|exr)$/i.test(file.name)) openHdri(file);
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
    clickHighlight = [];
    viewer.setHighlight(selectionHighlight());
  }
});

new ResizeObserver(() => updateInset()).observe(stageEl);
updateInset(true);
openProject(initProjects());

// Exposed for automated tests and debugging in the browser console.
window.__cad = { viewer, state, actions, select, getMaterialDef };
