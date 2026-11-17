/**
 * Keyboard shortcuts for the viewport. Each action has one key; the user can
 * change them in the settings, and the choice is kept in this browser.
 */

export const SHORTCUT_ACTIONS = {
  fit: { label: 'Fit the model into the view', key: 'f' },
  edges: { label: 'Show or hide edges', key: 'e' },
  axes: { label: 'Show or hide the coordinate system', key: 'a' },
  guides: { label: 'Show or hide guide lines', key: 'g' },
};

const STORAGE_KEY = 'clearcoat:shortcuts';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return Object.fromEntries(
      Object.entries(SHORTCUT_ACTIONS).map(([action, spec]) => [
        action,
        typeof saved[action] === 'string' && saved[action].length === 1 ? saved[action] : spec.key,
      ]),
    );
  } catch {
    return Object.fromEntries(Object.entries(SHORTCUT_ACTIONS).map(([action, spec]) => [action, spec.key]));
  }
}

let keys = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Not remembered; the keys still work until the page is reloaded.
  }
}

/** The key of an action, in capitals for display. */
export const shortcutLabel = (action) => keys[action].toUpperCase();

/** The action a pressed key stands for, or null. */
export function shortcutFor(key) {
  if (typeof key !== 'string' || key.length !== 1) return null;
  const lower = key.toLowerCase();
  return Object.keys(keys).find((action) => keys[action] === lower) || null;
}

/**
 * Gives an action a new key. A key that another action had moves over, and
 * that action gets the key this one had, so no two actions share a key.
 */
export function setShortcut(action, key) {
  const lower = key.toLowerCase();
  const other = shortcutFor(lower);
  if (other && other !== action) keys[other] = keys[action];
  keys[action] = lower;
  save();
}

export function resetShortcuts() {
  keys = Object.fromEntries(Object.entries(SHORTCUT_ACTIONS).map(([action, spec]) => [action, spec.key]));
  save();
}

export const shortcutsAreDefault = () =>
  Object.entries(SHORTCUT_ACTIONS).every(([action, spec]) => keys[action] === spec.key);
