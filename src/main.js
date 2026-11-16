import { Viewer } from './viewer.js';
import { loadStepFile } from './step-loader.js';
import { MATERIALS, defaultColor } from './materials.js';
import { LIGHT_PRESETS } from './environment.js';

const $ = (selector) => document.querySelector(selector);

const viewer = new Viewer($('#viewport'));
const fileInput = $('#file-input');
const dropzone = $('#dropzone');
const statusEl = $('#status');
const partsList = $('#parts-list');
const edgesBtn = $('#edges-btn');

let loading = false;

function setStatus(text, isError = false) {
  statusEl.hidden = !text;
  statusEl.textContent = text || '';
  statusEl.classList.toggle('error', isError);
}

const numberFormat = new Intl.NumberFormat('de-DE');

function renderPartsList(parts) {
  partsList.replaceChildren();
  for (const part of parts) {
    const item = document.createElement('li');
    item.dataset.partId = String(part.id);
    item.title = 'Klicken zum Auswählen, Doppelklick zum Ein- und Ausblenden';

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = part.colorHex;

    const name = document.createElement('span');
    name.className = 'part-name';
    name.textContent = part.label;

    const count = document.createElement('span');
    count.className = 'part-count';
    count.textContent = `${numberFormat.format(part.triangles)} △`;

    item.append(swatch, name, count);
    item.addEventListener('click', () => {
      const id = viewer.selectedId === part.id ? null : part.id;
      viewer.select(id);
      onSelectionChanged(id);
    });
    item.addEventListener('dblclick', () => {
      const hidden = item.classList.toggle('hidden-part');
      viewer.setPartVisible(part.id, !hidden);
    });
    partsList.append(item);
  }
}

function highlightSelected(id) {
  for (const item of partsList.children) {
    const selected = id !== null && Number(item.dataset.partId) === id;
    item.classList.toggle('selected', selected);
    if (selected) item.scrollIntoView({ block: 'nearest' });
  }
}

async function openFile(file) {
  if (!file || loading) return;
  if (!/\.(step|stp)$/i.test(file.name)) {
    setStatus('Bitte eine STEP-Datei wählen (.step oder .stp).', true);
    return;
  }

  loading = true;
  setStatus(`Lade ${file.name} …`);
  const started = performance.now();
  try {
    const parts = await loadStepFile(file);
    viewer.setParts(parts);
    renderPartsList(parts);
    refreshMaterialPanel();

    const triangles = parts.reduce((sum, part) => sum + part.triangles, 0);
    $('#model-name').textContent = file.name;
    $('#model-stats').textContent =
      `${parts.length} ${parts.length === 1 ? 'Bauteil' : 'Bauteile'} · ` +
      `${numberFormat.format(triangles)} Dreiecke`;
    $('#model-info').hidden = false;
    $('#parts-section').hidden = false;
    $('#toolbar').hidden = false;
    dropzone.classList.add('loaded');

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    setStatus(`${file.name} geladen (${seconds} s)`);
    setTimeout(() => {
      if (!loading) setStatus('');
    }, 2500);
  } catch (error) {
    console.error(error);
    setStatus(`Import fehlgeschlagen: ${error.message}`, true);
  } finally {
    loading = false;
  }
}

$('#open-btn').addEventListener('click', () => fileInput.click());
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

for (const button of document.querySelectorAll('#toolbar [data-view]')) {
  button.addEventListener('click', () => viewer.setView(button.dataset.view));
}
$('#fit-btn').addEventListener('click', () => viewer.fit());

function toggleEdges() {
  const visible = !viewer.edgesVisible;
  viewer.setEdgesVisible(visible);
  edgesBtn.setAttribute('aria-pressed', String(visible));
}
edgesBtn.addEventListener('click', toggleEdges);

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
  if (event.key === 'f' || event.key === 'F') viewer.fit();
  if (event.key === 'e' || event.key === 'E') toggleEdges();
  if (event.key === 'Escape') {
    viewer.select(null);
    onSelectionChanged(null);
  }
});

// --- Material ---------------------------------------------------------------

const materialSelect = $('#material-select');
const materialColor = $('#material-color');
const materialTarget = $('#material-target');

for (const material of MATERIALS) {
  materialSelect.add(new Option(material.label, material.id));
}

/** Parts the material controls act on: the selected part, or all parts if none is selected. */
function targetParts() {
  if (viewer.selectedId !== null) return [viewer.parts[viewer.selectedId]];
  return viewer.parts;
}

function refreshMaterialPanel() {
  const targets = targetParts();
  const hasModel = viewer.parts.length > 0;
  materialSelect.disabled = !hasModel;
  materialColor.disabled = !hasModel;
  if (!hasModel) {
    materialTarget.textContent = 'Kein Modell geladen';
    return;
  }
  materialTarget.textContent =
    viewer.selectedId !== null ? targets[0].label : `Alle Bauteile (${targets.length})`;

  // Show a value only if all target parts agree on it.
  const sameMaterial = targets.every((part) => part.materialId === targets[0].materialId);
  materialSelect.value = sameMaterial ? targets[0].materialId : '';
  const sameColor = targets.every((part) => part.colorHex === targets[0].colorHex);
  if (sameColor) materialColor.value = targets[0].colorHex;
}

function updateSwatch(part) {
  const swatch = partsList.querySelector(`li[data-part-id="${part.id}"] .swatch`);
  if (swatch) swatch.style.background = part.colorHex;
}

materialSelect.addEventListener('change', () => {
  for (const part of targetParts()) {
    part.materialId = materialSelect.value;
    part.colorHex = defaultColor(part, part.materialId);
    viewer.updatePartMaterial(part.id);
    updateSwatch(part);
  }
  refreshMaterialPanel();
});

materialColor.addEventListener('input', () => {
  for (const part of targetParts()) {
    part.colorHex = materialColor.value;
    viewer.updatePartMaterial(part.id);
    updateSwatch(part);
  }
});

function onSelectionChanged(id) {
  highlightSelected(id);
  refreshMaterialPanel();
}

// --- Lighting ---------------------------------------------------------------

const lightPreset = $('#light-preset');
for (const preset of LIGHT_PRESETS) {
  lightPreset.add(new Option(preset.label, preset.id));
}
lightPreset.value = viewer.lighting.presetId;
lightPreset.addEventListener('change', () => viewer.setLighting({ presetId: lightPreset.value }));

$('#light-rotation').addEventListener('input', (event) => {
  const rotation = Number(event.target.value);
  $('#light-rotation-value').textContent = `${rotation}°`;
  viewer.setLighting({ rotation });
});

$('#light-intensity').addEventListener('input', (event) => {
  const percent = Number(event.target.value);
  $('#light-intensity-value').textContent = `${percent} %`;
  viewer.setLighting({ intensity: percent / 100 });
});

$('#background-select').addEventListener('change', (event) => {
  viewer.setLighting({ background: event.target.value });
});

$('#ground-toggle').addEventListener('change', (event) => {
  viewer.setLighting({ ground: event.target.checked });
});

viewer.onSelect = onSelectionChanged;

// Exposed for automated tests and debugging in the browser console.
window.__cadViewer = viewer;
