/**
 * Small inline icon set (24 px grid, stroked). The markup is static, so it is
 * safe to insert as HTML.
 */
const PATHS = {
  plus: '<path d="M12 6v12M6 12h12"/>',
  minus: '<path d="M6 12h12"/>',
  close: '<path d="M7 7l10 10M17 7L7 17"/>',
  check: '<path d="M6 12.5l4 4 8-9"/>',
  chevronUp: '<path d="M6 15l6-6 6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  home: '<path d="M4 11.5L12 5l8 6.5"/><path d="M6.5 10v9h11v-9"/><path d="M10.5 19v-5h3v5"/>',
  rollLeft: '<path d="M5.5 12a6.5 6.5 0 1 0 2.6-5.2"/><path d="M7.5 3.2v4h4"/>',
  rollRight: '<path d="M18.5 12a6.5 6.5 0 1 1-2.6-5.2"/><path d="M16.5 3.2v4h-4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff:
    '<path d="M4 4l16 16"/><path d="M9.5 6a9 9 0 0 1 2.5-.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7"/><path d="M6.3 7.8A16.5 16.5 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 3.5-.7"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
  edges: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  folder: '<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  target: '<circle cx="12" cy="12" r="6"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7"/>',
};

export function icon(name, size = 16) {
  const node = document.createElement('span');
  node.className = 'icon';
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML =
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
  return node;
}
