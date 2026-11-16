import { Viewer } from './viewer.js';
import { loadStepFile } from './step-loader.js';

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
    swatch.style.background = `#${part.color.getHexString()}`;

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
      highlightSelected(id);
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
    highlightSelected(null);
  }
});

viewer.onSelect = highlightSelected;

// Exposed for automated tests and debugging in the browser console.
window.__cadViewer = viewer;
