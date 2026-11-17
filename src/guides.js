/**
 * Guide lines over the part of the view that ends up in the rendering, for
 * lining up the model. They only show in the viewport, never in the image.
 */

export const GUIDE_TYPES = {
  thirds: 'Rule of thirds',
  golden: 'Golden ratio',
  grid: 'Grid',
  center: 'Centre and diagonals',
};

const STORAGE_KEY = 'clearcoat:guides';
const SVG = 'http://www.w3.org/2000/svg';
const PHI = (Math.sqrt(5) - 1) / 2;

/** The viewer's own choice, kept in this browser: { visible, type }. */
export function loadGuides() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && GUIDE_TYPES[saved.type]) return { visible: Boolean(saved.visible), type: saved.type };
  } catch {
    // Storage can be blocked; the guides then start hidden.
  }
  return { visible: false, type: 'thirds' };
}

export function saveGuides(guides) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(guides));
  } catch {
    // Not remembered, which is fine.
  }
}

/** Lines as [x1, y1, x2, y2] in pixels for a frame of the given size. */
function guideLines(type, width, height) {
  const vertical = (x) => [x, 0, x, height];
  const horizontal = (y) => [0, y, width, y];
  switch (type) {
    case 'golden':
      return [
        vertical(width * (1 - PHI)),
        vertical(width * PHI),
        horizontal(height * (1 - PHI)),
        horizontal(height * PHI),
      ];
    case 'grid': {
      // Square cells, eight across the longer side.
      const cell = Math.max(width, height) / 8;
      const lines = [];
      for (let x = width / 2 - Math.floor(width / 2 / cell) * cell; x < width; x += cell) if (x > 0.5) lines.push(vertical(x));
      for (let y = height / 2 - Math.floor(height / 2 / cell) * cell; y < height; y += cell) if (y > 0.5) lines.push(horizontal(y));
      return lines;
    }
    case 'center':
      return [vertical(width / 2), horizontal(height / 2), [0, 0, width, height], [width, 0, 0, height]];
    default:
      return [vertical(width / 3), vertical((2 * width) / 3), horizontal(height / 3), horizontal((2 * height) / 3)];
  }
}

/** Draws the guides into `element`, which covers a frame of `width` × `height` pixels. */
export function drawGuides(element, type, width, height) {
  const key = `${type}:${Math.round(width)}:${Math.round(height)}`;
  if (element.dataset.key === key) return;
  element.dataset.key = key;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  for (const [x1, y1, x2, y2] of guideLines(type, width, height)) {
    // A dark line under a light one, so the guides read on bright and dark backgrounds.
    for (const kind of ['under', 'over']) {
      const line = document.createElementNS(SVG, 'line');
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      line.setAttribute('class', kind);
      svg.append(line);
    }
  }
  element.replaceChildren(svg);
}
