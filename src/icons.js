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
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  parts: '<path d="M12 3.5l7 4v8.5l-7 4-7-4V7.5z"/><path d="M5 7.5l7 4 7-4M12 11.5v8.5"/>',
  palette: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="9.5" r="1.2"/><circle cx="14.5" cy="8.5" r="1.2"/><circle cx="16" cy="13" r="1.2"/>',
  camera: '<path d="M4 8.5h3l1.5-2h7l1.5 2h3v10H4z"/><circle cx="12" cy="13" r="3.2"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M4.5 17l5-4.5 3.5 3 2.5-2 4 3.5"/>',
  film: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4"/>',
  check2: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  axes: '<path d="M6 18V5M6 18h13M6 18l-3.5 3"/><path d="M4 7.5L6 5l2 2.5M16.5 16l2.5 2-2.5 2"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4.5h-4.5"/><circle cx="12" cy="12" r="1.5"/>',
  guides: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/>',
  pencil: '<path d="M5 19l1-4 10-10 3 3-10 10z"/><path d="M14 7l3 3"/>',
  undo: '<path d="M9 7L5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-2"/>',
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
