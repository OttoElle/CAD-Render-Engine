import { h } from './dom.js';
import { icon } from './icons.js';
import { deviceControls } from './panels.js';
import { SHORTCUT_ACTIONS, shortcutLabel, setShortcut, resetShortcuts, shortcutsAreDefault } from './shortcuts.js';

/** The action whose key is being recorded, or null. */
let recording = null;

/**
 * The app settings, which belong to this browser rather than to a project:
 * where renderings run, and the keyboard shortcuts. `onClose` closes the
 * dialog, `onChange` refreshes what shows the shortcuts.
 */
export function renderSettings(host, { onClose, onChange }) {
  const rerender = () => renderSettings(host, { onClose, onChange });

  const record = (action) => {
    recording = recording === action ? null : action;
    rerender();
    if (!recording) return;
    const listen = (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener('keydown', listen, true);
      if (event.key !== 'Escape' && event.key.length === 1 && /\S/.test(event.key)) {
        setShortcut(action, event.key);
        onChange();
      }
      recording = null;
      rerender();
    };
    window.addEventListener('keydown', listen, true);
  };

  const shortcutRows = Object.entries(SHORTCUT_ACTIONS).map(([action, spec]) =>
    h(
      'div',
      { class: 'shortcut-row' },
      h('span', null, spec.label),
      h(
        'button',
        {
          class: `key${recording === action ? ' recording' : ''}`,
          title: 'Click, then press the new key',
          onclick: () => record(action),
        },
        recording === action ? 'Press a key …' : shortcutLabel(action),
      ),
    ),
  );

  host.replaceChildren(
    h(
      'div',
      { class: 'dialog-backdrop', onclick: (event) => event.target === event.currentTarget && onClose() },
      h(
        'div',
        { class: 'dialog settings', role: 'dialog', 'aria-label': 'Settings' },
        h(
          'header',
          { class: 'dialog-header' },
          h('span', { class: 'panel-icon' }, icon('gear', 18)),
          h('h2', null, 'Settings'),
          h('button', { class: 'icon-button', title: 'Close', 'aria-label': 'Close', onclick: onClose }, icon('close', 16)),
        ),
        h(
          'div',
          { class: 'dialog-body' },
          h('h3', { class: 'section-title' }, 'Rendering'),
          deviceControls(),
          h('h3', { class: 'section-title' }, 'Keyboard shortcuts'),
          shortcutRows,
          h(
            'div',
            { class: 'button-row start' },
            h(
              'button',
              {
                disabled: shortcutsAreDefault(),
                onclick: () => {
                  resetShortcuts();
                  onChange();
                  rerender();
                },
              },
              icon('undo', 15),
              'Default keys',
            ),
          ),
          h('p', { class: 'hint' }, 'These settings belong to this browser and apply to all projects.'),
        ),
      ),
    ),
  );
}

export function isRecordingShortcut() {
  return recording !== null;
}
