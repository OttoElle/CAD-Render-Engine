import { h } from './dom.js';

/**
 * The loading card in the middle of the viewport while a STEP file is read,
 * with a progress bar. OpenCascade reports nothing while it converts the
 * surfaces to triangles, which is most of the time, so that part of the bar
 * runs on an estimate from the file size and the speed measured on this
 * computer during earlier imports.
 */

/** Share of the bar each step of an import fills, in order. */
const STAGES = {
  read: { from: 0, to: 0.03, text: 'Reading the file' },
  engine: { from: 0.03, to: 0.08, text: 'Starting the CAD kernel' },
  parse: { from: 0.08, to: 0.82, text: 'Converting the surfaces' },
  edges: { from: 0.82, to: 0.96, text: 'Finding the edges' },
  build: { from: 0.96, to: 1, text: 'Preparing the view' },
};

const SPEED_KEY = 'clearcoat.importSpeed';
/** Milliseconds per megabyte of STEP text, until this computer has measured its own. */
const DEFAULT_MS_PER_MB = 4000;

function loadSpeed() {
  try {
    const value = Number(localStorage.getItem(SPEED_KEY));
    return value > 0 ? value : DEFAULT_MS_PER_MB;
  } catch {
    return DEFAULT_MS_PER_MB;
  }
}

function saveSpeed(msPerMb) {
  try {
    localStorage.setItem(SPEED_KEY, String(Math.round(msPerMb)));
  } catch {
    // Only a better estimate next time; nothing is lost.
  }
}

export function createLoadingIndicator(host) {
  const title = h('div', { class: 'loading-title' });
  const fill = h('div', { class: 'loading-fill' });
  const stageText = h('span', { class: 'loading-stage' });
  const percent = h('span', { class: 'loading-percent' });
  const bar = h('div', { class: 'loading-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  const node = h('div', { id: 'loading', hidden: true, role: 'status' }, h('div', { class: 'loading-card' }, title, bar, h('div', { class: 'loading-meta' }, stageText, percent)));
  host.append(node);

  let current = null;
  let frame = 0;

  const draw = () => {
    if (!current) return;
    const stage = STAGES[current.stage];
    let share = 0;
    if (current.stage === 'parse') {
      // Approaches the end of the step without reaching it before the step is over.
      const elapsed = performance.now() - current.parseStart;
      share = Math.min(1 - Math.exp((-2.3 * elapsed) / current.expected), 0.97);
    } else if (current.total > 0) {
      share = current.done / current.total;
    }
    // Each file of a model with added files gets its own part of the bar.
    const inFile = stage.from + (stage.to - stage.from) * share;
    const value = Math.max((current.fileIndex + inFile) / current.fileCount, current.shown);
    current.shown = value;
    fill.style.width = `${(value * 100).toFixed(1)}%`;
    percent.textContent = `${Math.floor(value * 100)} %`;
    bar.setAttribute('aria-valuenow', String(Math.floor(value * 100)));
    const counts = current.stage === 'edges' && current.total > 1 ? ` (${current.done} of ${current.total} parts)` : '';
    stageText.textContent = `${stage.text}${counts} …`;
    frame = requestAnimationFrame(draw);
  };

  const show = (file, fileIndex, fileCount) => {
    const shown = current && fileIndex > 0 ? current.shown : 0;
    current = { stage: 'read', done: 0, total: 0, size: file.size, fileIndex, fileCount, shown, parseStart: 0, expected: 1 };
    title.textContent = fileCount > 1 ? `Loading ${file.name} (${fileIndex + 1} of ${fileCount})` : `Loading ${file.name}`;
    node.hidden = false;
    cancelAnimationFrame(frame);
    draw();
  };

  const update = ({ stage, done, total }) => {
    if (!current || !STAGES[stage]) return;
    const now = performance.now();
    if (current.stage === 'parse' && stage !== 'parse') {
      // Remember how fast this computer converts, for the next estimate.
      const megabytes = Math.max(current.size / 1e6, 0.05);
      const measured = (now - current.parseStart) / megabytes;
      saveSpeed(loadSpeed() * 0.5 + measured * 0.5);
    }
    if (stage === 'parse' && current.stage !== 'parse') {
      current.parseStart = now;
      current.expected = Math.max((current.size / 1e6) * loadSpeed(), 300);
    }
    Object.assign(current, { stage, done, total });
  };

  let owner = null;

  /**
   * Shows the card for a model made of `fileCount` files. The handle's calls
   * do nothing once a newer import took over the card, e.g. after switching
   * to another project while a model was still loading.
   */
  return function begin(fileCount = 1) {
    const handle = {
      /** The next file starts; its progress reports go to `progress`. */
      file(file, fileIndex = 0) {
        if (owner === handle) show(file, fileIndex, fileCount);
      },
      progress(report) {
        if (owner === handle) update(report);
      },
      finish() {
        if (owner !== handle) return;
        owner = null;
        current = null;
        cancelAnimationFrame(frame);
        node.hidden = true;
      },
    };
    owner = handle;
    return handle;
  };
}
