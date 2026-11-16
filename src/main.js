import { Viewer } from './viewer.js';
import { ViewCube } from './viewcube.js';
import { loadStepFile } from './step-loader.js';
import { getMaterialDef } from './materials.js';
import { renderTree } from './tree.js';
import { renderPanel, identicalParts } from './panels.js';
import { h } from './dom.js';
import {
  state,
  subscribe,
  emit,
  select,
  newId,
  resetForModel,
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
const fileInput = $('#file-input');
const dropzone = $('#dropzone');
const statusEl = $('#status');
const treeEl = $('#tree');
const panelEl = $('#panel');
const outputFrameEl = $('#output-frame');
const renderViewEl = $('#render-view');
const edgesBtn = $('#edges-btn');

let loading = false;
let statusTimer = null;
let panelLive = null;

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

  // "Wie Ansicht": the viewport at screen resolution, capped to a sane size.
  const canvas = viewer.canvas;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  let width = canvas.clientWidth * ratio;
  let height = canvas.clientHeight * ratio;
  const scale = Math.min(1, 4096 / Math.max(width, height));
  width = Math.max(Math.round((width * scale) / 2) * 2, 64);
  height = Math.max(Math.round((height * scale) / 2) * 2, 64);
  return { width, height };
}

/** Shows the crop of the final image when its aspect ratio differs from the viewport. */
function updateOutputFrame() {
  const show = state.parts.length > 0 && state.output.size !== 'view';
  outputFrameEl.hidden = !show;
  const { width, height } = resolveOutputSize();
  viewer.outputAspect = show ? width / height : null;
  if (!show) return;
  const frame = viewer.getOutputFrame(width / height);
  Object.assign(outputFrameEl.style, {
    left: `${frame.x}px`,
    top: `${frame.y}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
  });
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
      onProgress: ({ stage, progress, samples }) => {
        render.stage = stage;
        render.seconds = (performance.now() - started) / 1000;
        if (stage === 'rendering') {
          render.samples = samples;
          render.progress = Math.min(progress ?? samples / targetSamples, 1);
        }
        emit('renders:live');
      },
    });
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
  const base = (state.fileName || 'Modell').replace(/\.(step|stp)$/i, '');
  const link = h('a', {
    href: render.url,
    download: `${base}_${render.name.replace(/\s+/g, '-')}_${render.width}x${render.height}.png`,
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

// --- Tree and panel -----------------------------------------------------------

const actions = {
  openFile: () => fileInput.click(),
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
    viewer.setHighlight([]);
    const [kind, idText] = state.selected.split(':');
    if (kind === 'view') {
      const view = state.views.find((item) => item.id === Number(idText));
      if (view) viewer.applyViewState(view);
    }
  }

  renderTree(treeEl, actions);
  if (live) panelLive?.();
  else panelLive = renderPanel(panelEl, { viewer, actions });
  updateOutputFrame();
  updateRenderView();
}

subscribe(refresh);

viewer.onViewChange = () => {
  viewCube.update();
  updateOutputFrame();
};

viewer.onPartClick = (partId) => {
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
  viewer.setHighlight(partId === null ? [] : [partId]);
  if (partId !== null) setStatus(state.parts[partId].label, { timeout: 2500 });
};

// --- Opening files ------------------------------------------------------------

async function openFile(file) {
  if (!file || loading) return;
  if (!/\.(step|stp)$/i.test(file.name)) {
    setStatus('Bitte eine STEP-Datei wählen (.step oder .stp).', { error: true });
    return;
  }

  loading = true;
  setStatus(`Lade ${file.name} …`);
  const started = performance.now();
  try {
    const parts = await loadStepFile(file);
    viewer.setParts(parts);
    $('#view-controls').hidden = false;
    dropzone.classList.add('loaded');
    resetForModel(file.name, parts);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    setStatus(`${file.name} geladen (${seconds} s)`, { timeout: 2500 });
  } catch (error) {
    console.error(error);
    setStatus(`Import fehlgeschlagen: ${error.message}`, { error: true });
  } finally {
    loading = false;
  }
}

fileInput.addEventListener('change', () => {
  openFile(fileInput.files[0]);
  fileInput.value = '';
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
  openFile(event.dataTransfer?.files?.[0]);
});

// --- Viewport tools -----------------------------------------------------------

$('#fit-btn').addEventListener('click', () => viewer.fit());

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
  if (event.key === 'Escape') viewer.setHighlight([]);
});

refresh('model');

// Exposed for automated tests and debugging in the browser console.
window.__cad = { viewer, state, actions, select, getMaterialDef };
