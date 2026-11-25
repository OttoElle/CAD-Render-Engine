import { h } from './dom.js';
import { icon } from './icons.js';
import {
  state,
  emit,
  select,
  withIds,
  FLOORS,
  BACKGROUND_COLORS,
  UP_AXES,
  QUALITY,
  OUTPUT_ASPECTS,
  OUTPUT_RESOLUTIONS,
  RENDER_DEVICES,
  TURNTABLE_FRAMES,
  TURNTABLE_SECONDS,
  defaultAdjust,
  addMaterial,
  materialEntryOf,
  materialEntryLabel,
  setPartsAssigned,
  presentParts,
} from './state.js';
import {
  MATERIALS,
  MATERIAL_GROUPS,
  FINISH_AXES,
  getMaterialDef,
  getSurface,
  surfaceColor,
  defaultTuning,
  isDefaultTuning,
} from './materials.js';
import { LIGHT_PRESETS, MAX_LIGHT_SIZE, getLightPreset, presetLights } from './environment.js';
import { EXPLODE_DIRECTIONS, PART_EXPLODE_DIRECTIONS, partExplode, setPartExplode, hasExplode } from './explode.js';
import { HATCH_PATTERNS, hatchSpacing } from './hatch.js';
import { FILE_FORMATS, videoSupported } from './export.js';
import { ADJUSTMENTS, isNeutral } from './adjust.js';
import { shortcutLabel } from './shortcuts.js';

const numberFormat = new Intl.NumberFormat('en-US');
const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];
const FOCAL_MIN = 15;
const FOCAL_MAX = 200;
const NO_WEBGPU = 'This browser does not support WebGPU. Please use Chrome or Edge.';

/** Whether assigning one part also assigns all identical parts (e.g. all screws of one size). */
let linkIdentical = true;

/** Parts with the same name and triangle count are treated as copies of one another. */
export function identicalParts(part) {
  if (!linkIdentical) return [part];
  return state.parts.filter((other) => other.name === part.name && other.triangles === part.triangles);
}

// --- Controls -----------------------------------------------------------------

/** A setting in one row: its name on the left, the control on the right, an optional note under the control. */
function field(label, control, value) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    value ? h('span', { class: 'field-note' }, value) : null,
  );
}

function selectControl(options, value, onchange) {
  const node = h('select', { onchange: (event) => onchange(event.target.value) });
  for (const [optionValue, label] of options) node.add(new Option(label, optionValue));
  node.value = value;
  return node;
}

/** A row of buttons of which exactly one is chosen. `options` are [value, label, icon?]. */
function segmented(label, options, value, onchange) {
  return h(
    'div',
    { class: label ? 'field' : 'field wide' },
    label ? h('span', { class: 'field-label' }, label) : null,
    h(
      'div',
      { class: 'segmented', role: 'radiogroup', 'aria-label': label },
      options.map(([optionValue, text, iconName]) =>
        h(
          'button',
          {
            class: optionValue === value ? 'on' : '',
            role: 'radio',
            'aria-checked': String(optionValue === value),
            onclick: () => optionValue !== value && onchange(optionValue),
          },
          iconName ? icon(iconName, 15) : null,
          text,
        ),
      ),
    ),
  );
}

/** A labelled on/off switch. */
function toggle(label, checked, onchange, title) {
  return h(
    'label',
    { class: 'field toggle', title },
    h('span', null, label),
    h('input', { type: 'checkbox', role: 'switch', checked, onchange: (event) => onchange(event.target.checked) }),
  );
}

// Which groups are folded, remembered across panels and visits.
const GROUPS_KEY = 'clearcoat:groups';
const groupState = (() => {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(GROUPS_KEY)) || {}));
  } catch {
    return new Map();
  }
})();

/** A titled group of settings that folds away. `open` is how it starts the first time. */
function group(key, title, children, { open = true, title: hint } = {}) {
  const node = h(
    'details',
    {
      class: 'group',
      open: groupState.has(key) ? groupState.get(key) : open,
      ontoggle: () => {
        groupState.set(key, node.open);
        try {
          localStorage.setItem(GROUPS_KEY, JSON.stringify(Object.fromEntries(groupState)));
        } catch {
          // Not remembered then; nothing else depends on it.
        }
      },
    },
    h('summary', { title: hint }, title),
    h('div', { class: 'group-body' }, children),
  );
  return node;
}

/**
 * A slider with a number box beside it, so a value can be dragged or typed.
 * The box shows `toShown(position)` with the unit after it; a typed value goes
 * through `exact(number)` when given (for sliders on a curved scale, so the
 * typed value is kept as it is) or else is turned into a slider position with
 * `fromShown` and limited to the slider's range. `format` is only used for
 * sliders without a box (`typed: false`).
 */
function slider(
  label,
  { min, max, step = 1, value, format, oninput, onchange, disabled, title, unit = '', prefix = '', digits, toShown = (v) => v, fromShown = (v) => v, exact, limit = true, typed = true },
) {
  const places = digits ?? (Number.isInteger(step) ? 0 : 1);
  const round = (number) => String(Number(Number(number).toFixed(places)));
  let output;
  let box = null;
  if (typed) {
    box = h('input', {
      type: 'number',
      class: 'slider-value',
      step: 'any',
      value: round(toShown(value)),
      disabled,
      'aria-label': label,
      onkeydown: (event) => {
        if (event.key === 'Enter') event.target.blur();
      },
      onchange: (event) => {
        const typedValue = Number(event.target.value);
        if (event.target.value === '' || !Number.isFinite(typedValue)) {
          event.target.value = round(toShown(Number(input.value)));
          return;
        }
        if (exact) {
          const shown = exact(typedValue);
          input.value = fromShown(shown ?? typedValue);
          event.target.value = round(shown ?? typedValue);
          onchange?.(Number(input.value));
          return;
        }
        const position = limit ? Math.min(Math.max(fromShown(typedValue), min), max) : fromShown(typedValue);
        input.value = position;
        event.target.value = round(toShown(position));
        oninput(position);
        onchange?.(position);
      },
    });
    output = h('span', { class: 'slider-edit' }, prefix ? h('span', null, prefix) : null, box, unit ? h('span', { class: 'slider-unit' }, unit) : null);
  } else {
    output = h('output', null, format(value));
  }
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
    disabled,
    'aria-label': label,
    oninput: (event) => {
      const next = Number(event.target.value);
      if (box) box.value = round(toShown(next));
      else output.textContent = format(next);
      oninput(next);
    },
    // Fires once the slider is let go, for updates too costly to run while dragging.
    onchange: onchange ? () => onchange(Number(input.value)) : null,
  });
  const node = h(
    'div',
    { class: 'field', title },
    h('span', { class: 'field-label' }, label),
    h('span', { class: 'slider-control' }, input, h('span', { class: 'slider-output' }, output)),
  );
  /** Shows a value set elsewhere; `shown` is the box's number when it is not the slider's mapping. */
  node.set = (next, shown) => {
    if (document.activeElement !== input) input.value = next;
    if (box) {
      if (document.activeElement !== box) box.value = round(shown ?? toShown(next));
    } else {
      output.textContent = format(next);
    }
  };
  node.setDisabled = (off) => {
    input.disabled = off;
    if (box) box.disabled = off;
  };
  return node;
}

/**
 * A number box that commits on Enter, blur or the spin buttons, and can be
 * refreshed while not being edited. A unit at the end of the label ("X mm")
 * goes inside the box; a single axis letter is coloured like the axes.
 */
function numberBox(label, { value, step = 1, min, max, digits = 1, onchange, title }) {
  const round = (number) => String(Number(number.toFixed(digits)));
  const match = /^(.*?)\s*(mm|°|px|%)$/.exec(label);
  const name = match ? match[1] : label;
  const unit = match ? match[2] : '';
  const input = h('input', {
    type: 'number',
    step,
    min,
    max,
    value: round(value),
    'aria-label': label,
    onchange: (event) => {
      const next = Number(event.target.value);
      if (event.target.value !== '' && Number.isFinite(next)) onchange(next);
    },
  });
  const axis = ['X', 'Y', 'Z'].includes(name) ? ` axis-${name.toLowerCase()}` : '';
  const node = h(
    'label',
    { class: 'number-box', title: title || label },
    name ? h('span', { class: `number-name${axis}` }, name) : null,
    input,
    unit ? h('span', { class: 'number-unit' }, unit) : null,
  );
  node.set = (next) => {
    if (document.activeElement !== input) input.value = round(next);
  };
  return node;
}

function textField(label, value, oninput) {
  return field(label, h('input', { type: 'text', value, oninput: (event) => oninput(event.target.value) }));
}

function deleteButton(label, run) {
  return h('button', { class: 'danger', onclick: run }, icon('trash', 15), label);
}

/** A short message in a tinted box, with an optional button. `tone` is 'info' or 'warning'. */
function notice(text, action, tone = 'info') {
  return h(
    'div',
    { class: `notice ${tone}` },
    tone === 'warning' ? icon('alert', 15) : null,
    h('span', null, text),
    action ? h('button', { class: 'small', onclick: action.run }, action.icon ? icon(action.icon, 14) : null, action.label) : null,
  );
}

/** A small caption above a row of boxes that belong together. */
function caption(text) {
  return h('div', { class: 'caption' }, text);
}

function formatDuration(seconds) {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

const plural = (count, one, many) => `${numberFormat.format(count)} ${count === 1 ? one : many}`;


// --- Geometry -----------------------------------------------------------------

function geometryPanel({ actions }) {
  if (state.parts.length === 0) {
    return {
      title: 'Geometry',
      icon: 'file',
      editable: false,
      body: [
        h('p', { class: 'hint' }, 'Drop a STEP file anywhere on the window, or open one here.'),
        h('button', { class: 'primary', onclick: actions.openFile }, icon('folder', 15), 'Open STEP file …'),
      ],
    };
  }

  const parts = presentParts();
  const removed = state.parts.length - parts.length;
  const triangles = parts.reduce((sum, part) => sum + part.triangles, 0);
  const hidden = parts.filter((part) => !part.mesh.visible).length;
  const moved = new Set([...state.partOffsets.keys(), ...state.partRotations.keys()]).size;
  return {
    title: state.fileName,
    icon: 'file',
    body: [
      h(
        'p',
        { class: 'hint' },
        `${plural(parts.length, 'part', 'parts')} · ${plural(triangles, 'triangle', 'triangles')}` +
          (hidden > 0 ? ` · ${hidden} hidden` : ''),
      ),
      removed > 0
        ? notice(`${plural(removed, 'part was', 'parts were')} deleted from the model.`, {
            label: 'Bring back',
            icon: 'undo',
            run: actions.restoreParts,
          })
        : null,
      field(
        'Up axis',
        selectControl(Object.entries(UP_AXES), state.upAxis, (value) => {
          state.upAxis = value;
          emit('geometry');
        }),
      ),
      h('p', { class: 'hint' }, 'Which CAD axis points up in the scene. The floor, the turntable and the lighting follow it.'),
      toggle('Show axes', actions.axesVisible(), actions.toggleAxes, 'X red, Y green, Z blue, from the CAD origin (A)'),
      moved > 0
        ? notice(`${plural(moved, 'part', 'parts')} moved or turned from the CAD position.`, {
            label: 'Put all back',
            icon: 'undo',
            run: () => {
              state.partOffsets.clear();
              state.partRotations.clear();
              emit('geometry');
            },
          })
        : null,
    ],
    footer: [
      h('button', { onclick: actions.openFile }, icon('folder', 15), 'Open another file …'),
    ],
  };
}

/** Exploded view: how far apart the parts move, in which direction and from where. */
function explodePanel({ actions }) {
  return {
    title: 'Exploded view',
    icon: 'explode',
    body: [
      h('p', { class: 'hint' }, 'Pulls the parts of an assembly apart to show how it is built.'),
      explodeControls(false),
    ],
    footer: [deleteButton('Remove', actions.deleteExplode)],
  };
}

/** Several parts picked with Ctrl or Shift: what they can do together. */
function partsSelectionPanel(parts, { actions }) {
  const ids = parts.map((part) => part.id);
  const anyHidden = parts.some((part) => !part.mesh.visible);
  const placed = ids.some((id) => state.partOffsets.has(id) || state.partRotations.has(id));
  return {
    title: `${parts.length} parts`,
    icon: 'partGroup',
    body: [
      h('p', { class: 'hint' }, 'Ctrl or Shift + click parts in the tree or the viewport to add or remove them.'),
      partList(
        parts,
        (part) => [
          h('span', { class: 'swatch', style: { background: part.colorHex } }),
          h('span', { class: 'part-name' }, part.label),
          h(
            'button',
            {
              class: 'icon-button small',
              title: 'Take out of the selection',
              'aria-label': 'Take out of the selection',
              onclick: () => actions.selectPart(part.id, true),
            },
            icon('close', 14),
          ),
        ],
        actions,
      ),
      materialLink(parts),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => actions.setPartsVisible(ids, anyHidden) }, icon(anyHidden ? 'eye' : 'eyeOff', 15), anyHidden ? 'Show' : 'Hide'),
        h('button', { onclick: () => actions.isolatePart(ids) }, 'Show only these'),
      ),
      group('part-position', 'Position and rotation', [
        h('p', { class: 'hint' }, 'The parts move and turn together, about their common middle.'),
        moveToolRow(ids, placed, actions),
      ]),
    ],
    footer: [deleteButton(`Delete ${parts.length} parts`, () => actions.deleteParts(ids))],
  };
}

/**
 * Which material the parts have, as a button that opens it. Parts get their
 * material in the material's own panel, so there is one place for that.
 */
function materialLink(parts) {
  const entries = [...new Set(parts.map((part) => materialEntryOf(part.id)))];
  if (entries.length > 1) return field('Material', h('span', { class: 'field-text' }, 'Different materials'));
  const [entry] = entries;
  return field(
    'Material',
    h(
      'button',
      { class: 'link-button', onclick: () => select(entry ? `material:${entry.id}` : 'material:cad'), title: 'Open the material' },
      h('span', { class: 'swatch round', style: { background: entry ? entry.colorHex : parts[0].colorHex } }),
      h('span', { class: 'link-label' }, entry ? materialEntryLabel(entry) : 'CAD colour'),
      icon('chevronRight', 14),
    ),
  );
}

/** The switch for the move tool in the viewport and a button that puts parts back. */
function moveToolRow(ids, placed, actions) {
  const on = actions.isGizmoOn();
  return [
    h(
      'div',
      { class: 'button-row' },
      h(
        'button',
        {
          class: on ? 'active' : '',
          onclick: actions.toggleGizmo,
          title: `Arrows and squares move, rings turn, the ball moves freely. Shift snaps to 1 mm or 15° (${shortcutLabel('move')})`,
        },
        icon('move', 15),
        on ? 'Hide move tool' : 'Move and rotate',
      ),
      h(
        'button',
        { onclick: () => actions.resetPartPlacement(ids), disabled: !placed, title: 'Back to the CAD position' },
        icon('undo', 15),
        'Reset',
      ),
    ),
    on ? h('p', { class: 'hint' }, 'Drag a handle in the viewport. Afterwards, type the exact distance or angle and press Enter.') : null,
  ];
}

function partPanel(part, { actions }) {
  // Position: an offset from where the CAD model puts the part.
  const offset = () => state.partOffsets.get(part.id) || [0, 0, 0];
  const positionBoxes = ['X', 'Y', 'Z'].map((axis, i) =>
    numberBox(`${axis} mm`, {
      value: offset()[i],
      step: 1,
      digits: 2,
      onchange: (value) => {
        const next = [...offset()];
        next[i] = value;
        actions.setPartOffset(part.id, next);
      },
    }),
  );
  // Rotation: angles about the CAD axes, around the part's centre.
  const rotation = () => state.partRotations.get(part.id) || [0, 0, 0];
  const rotationBoxes = ['X', 'Y', 'Z'].map((axis, i) =>
    numberBox(`${axis} °`, {
      value: rotation()[i],
      step: 15,
      digits: 1,
      onchange: (value) => {
        const next = [...rotation()];
        next[i] = value;
        actions.setPartRotation(part.id, next);
      },
    }),
  );
  const placed = state.partOffsets.has(part.id) || state.partRotations.has(part.id);

  const own = partExplode(state.explode, part.id);
  const setOwn = (changes) => {
    setPartExplode(state.explode, part.id, changes);
    emit('explode');
  };

  return {
    title: part.label,
    icon: 'part',
    body: [
      materialLink([part]),
      h('div', { class: 'button-row' }, h('button', { onclick: () => actions.isolatePart(part.id) }, 'Show only this')),
      group('part-position', 'Position and rotation', [
        caption('Offset from the CAD position'),
        h('div', { class: 'field-grid three' }, positionBoxes),
        caption('Turn around the part\'s centre'),
        h('div', { class: 'field-grid three' }, rotationBoxes),
        moveToolRow([part.id], placed, actions),
      ]),
      state.parts.length > 1 && hasExplode(state.explode)
        ? group(
            'part-explode',
            'Exploded view',
            [
              toggle('Stays in place', own.fixed || state.explode.anchor === part.id, (checked) => setOwn({ fixed: checked }), 'The part does not move when the assembly is exploded'),
              toggle(
                'Centre of the explosion',
                state.explode.anchor === part.id,
                (checked) => {
                  state.explode.anchor = checked ? part.id : null;
                  emit('explode');
                },
                'The other parts move away from this one',
              ),
              field('Direction', selectControl(Object.entries(PART_EXPLODE_DIRECTIONS), own.direction, (value) => setOwn({ direction: value }))),
              slider('Distance', {
                min: 0,
                max: 300,
                step: 5,
                value: Math.round(own.factor * 100),
                unit: '% of the others',
                oninput: (value) => {
                  setPartExplode(state.explode, part.id, { factor: value / 100 });
                  emit('explode:live');
                },
                onchange: () => emit('explode'),
              }),
              state.explode.amount === 0
                ? h('p', { class: 'hint' }, 'Set how far the assembly is exploded under Geometry › Exploded view.')
                : null,
            ],
            { open: false },
          )
        : null,
      h('p', { class: 'hint' }, `${plural(part.triangles, 'triangle', 'triangles')} · Ctrl or Shift + click selects several parts`),
    ],
    footer: [deleteButton('Delete part', () => actions.deleteParts([part.id]))],
    live: () => {
      positionBoxes.forEach((box, i) => box.set(offset()[i]));
      rotationBoxes.forEach((box, i) => box.set(rotation()[i]));
    },
  };
}

// --- Sections -------------------------------------------------------------------

/** How the cut faces of all sections look: their colour and an optional hatching. */
function capControls({ viewer }) {
  const cap = state.sectionCap;
  const set = (key, live = false) => (value) => {
    cap[key] = value;
    emit(live ? 'sections:live' : 'sections');
  };
  const hatched = cap.hatch !== 'none';
  const spacing = hatchSpacing(cap, viewer.modelBox);
  return [
    field(
      'Colour',
      selectControl(
        [
          ['material', 'Like the part'],
          ['color', 'Own colour'],
        ],
        cap.mode,
        set('mode'),
      ),
    ),
    cap.mode === 'color'
      ? field('Own colour', h('input', { type: 'color', value: cap.color, oninput: (event) => set('color', true)(event.target.value) }))
      : null,
    segmented('Hatching', Object.entries(HATCH_PATTERNS), cap.hatch, set('hatch')),
    hatched
      ? [
          field(
            'Line colour',
            selectControl(
              [
                ['auto', 'Shade of the face'],
                ['color', 'Own colour'],
              ],
              cap.hatchAuto ? 'auto' : 'color',
              (value) => set('hatchAuto')(value === 'auto'),
            ),
          ),
          cap.hatchAuto
            ? null
            : field('Own line colour', h('input', { type: 'color', value: cap.hatchColor, oninput: (event) => set('hatchColor', true)(event.target.value) })),
          h(
            'div',
            { class: 'field-grid three' },
            numberBox('Spacing mm', {
              value: spacing,
              step: spacing >= 5 ? 1 : 0.1,
              min: 0.05,
              digits: 2,
              title: cap.hatchSpacing > 0 ? 'Distance between the lines' : 'Distance between the lines, chosen from the size of the model',
              onchange: (value) => set('hatchSpacing')(Math.max(value, 0.05)),
            }),
            // Stored as a share of the spacing, so lines keep their weight when the spacing changes.
            numberBox('Width mm', {
              value: spacing * cap.hatchWidth,
              step: Number((spacing * 0.02).toPrecision(1)),
              min: 0,
              digits: 3,
              title: 'Width of the lines',
              onchange: (value) => set('hatchWidth')(Math.min(Math.max(value / spacing, 0.02), 0.6)),
            }),
            numberBox('Angle °', { value: cap.hatchAngle, step: 15, digits: 1, onchange: (value) => set('hatchAngle')(((value % 180) + 180) % 180) }),
          ),
          toggle('Turn on every other part', cap.hatchAlternate, set('hatchAlternate'), 'Neighbouring parts get lines at right angles, as in a technical drawing'),
          toggle('Outline the cut faces', cap.outline, set('outline'), 'A line along the edges of each cut face, in the colour of the hatching'),
        ]
      : null,
    toggle('Mark overlapping parts', cap.overlaps, set('overlaps'), 'Where two parts take up the same space in the CAD model, e.g. a thread drawn larger than its hole, the cut shows red'),
    h('p', { class: 'hint' }, 'Applies to all sections, in the viewport and in the rendering.'),
  ];
}

function sectionPanel(section, { viewer, actions }) {
  const box = viewer.modelBox;
  const range = () => {
    const min = box.min.getComponent(section.axis);
    const max = box.max.getComponent(section.axis);
    return { min, max, step: Math.max((max - min) / 400, 1e-3) };
  };
  const { min, max, step } = range();
  const set = (key) => (value) => {
    section[key] = value;
    emit('sections');
  };

  return {
    title: section.name,
    icon: 'slice',
    body: [
      textField('Name', section.name, (value) => {
        section.name = value || 'Section';
        emit('sections:live');
      }),
      field(
        'Cuts across',
        selectControl(
          [
            ['0', 'X axis'],
            ['1', 'Y axis'],
            ['2', 'Z axis'],
          ],
          String(section.axis),
          (value) => {
            section.axis = Number(value);
            const next = range();
            section.position = (next.min + next.max) / 2;
            section.flip = actions.sectionFacesCamera(section.axis);
            emit('sections');
          },
        ),
      ),
      slider('Position', {
        min,
        max,
        step,
        value: section.position,
        digits: 2,
        unit: 'mm',
        // A typed position may lie beyond the model, e.g. to show the uncut model.
        limit: false,
        oninput: (value) => {
          section.position = value;
          emit('sections:live');
        },
        onchange: () => emit('sections'),
      }),
      toggle('Show the other side', section.flip, set('flip')),
      state.parts.length > 1
        ? group('section-parts', `Cut parts (${state.parts.length - section.uncut.size})`, [
            h('p', { class: 'hint' }, 'Click parts in the viewport to leave them whole, e.g. screws or shafts.'),
            h(
              'div',
              { class: 'button-row' },
              h(
                'button',
                {
                  onclick: () => {
                    section.uncut.clear();
                    emit('sections');
                  },
                },
                'Cut all',
              ),
              h(
                'button',
                {
                  onclick: () => {
                    for (const part of state.parts) section.uncut.add(part.id);
                    emit('sections');
                  },
                },
                'Cut none',
              ),
            ),
            toggle('Identical parts together', linkIdentical, (checked) => {
              linkIdentical = checked;
            }),
            partList(
              state.parts,
              (part) => [
                h('input', {
                  type: 'checkbox',
                  checked: !section.uncut.has(part.id),
                  onchange: (event) => {
                    for (const item of identicalParts(part)) {
                      if (event.target.checked) section.uncut.delete(item.id);
                      else section.uncut.add(item.id);
                    }
                    emit('sections');
                  },
                }),
                h('span', { class: 'part-name' }, part.label),
              ],
              actions,
            ),
          ])
        : null,
      group('section-caps', 'Cut faces', capControls({ viewer }), { open: false }),
    ],
    footer: [
      deleteButton('Delete', () => actions.deleteSection(section.id)),
    ],
  };
}

// --- Materials --------------------------------------------------------------------

function partList(parts, renderItem, actions, itemProps) {
  return h(
    'ul',
    { class: 'part-list', onmouseleave: () => actions.hover(null) },
    parts.map((part) =>
      h(
        'li',
        { onmouseenter: () => actions.hover([part.id]), title: part.label, 'data-anchor': `part:${part.id}`, ...itemProps?.(part) },
        renderItem(part),
      ),
    ),
  );
}

/** The part last clicked in a material's pick list, where a Shift click range starts. */
let pickAnchor = null;

/**
 * Every part with a checkbox for one material. A click on a row switches the
 * part (and its identical copies); Shift click sets the whole range from the
 * part clicked before to the same state.
 */
function pickList(entry, actions) {
  const parts = state.parts.filter((part) => !part.removed);
  const toggle = (part, event) => {
    const assigned = !entry.partIds.has(part.id);
    const index = parts.indexOf(part);
    const anchorIndex = pickAnchor?.entryId === entry.id ? parts.findIndex((item) => item.id === pickAnchor.partId) : -1;
    const range =
      event.shiftKey && anchorIndex >= 0
        ? parts.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1)
        : [part];
    pickAnchor = { entryId: entry.id, partId: part.id };
    const ids = new Set(range.flatMap((item) => identicalParts(item).map((p) => p.id)));
    setPartsAssigned(entry, [...ids], assigned);
  };
  return partList(
    parts,
    (part) => {
      const owner = materialEntryOf(part.id);
      return [
        h('input', { type: 'checkbox', checked: owner === entry, tabIndex: -1, 'aria-hidden': 'true' }),
        h('span', { class: 'part-name' }, part.label),
        owner && owner !== entry ? h('span', { class: 'part-owner' }, materialEntryLabel(owner)) : null,
      ];
    },
    actions,
    (part) => ({
      class: 'pickable',
      role: 'checkbox',
      'aria-checked': String(entry.partIds.has(part.id)),
      tabIndex: 0,
      // Keeps Shift click from selecting text across the rows.
      onmousedown: (event) => {
        if (event.shiftKey) event.preventDefault();
      },
      onclick: (event) => {
        event.preventDefault();
        toggle(part, event);
      },
      onkeydown: (event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        toggle(part, event);
      },
    }),
  );
}

function cadMaterialPanel({ actions }) {
  const parts = state.parts.filter((part) => !materialEntryOf(part.id));
  return {
    title: 'CAD colours',
    icon: 'palette',
    editable: false,
    body: [
      h('p', { class: 'hint' }, 'These parts have no material yet and keep the colour from the CAD file.'),
      partList(
        parts,
        (part) => [
          h('span', { class: 'swatch', style: { background: part.colorHex } }),
          h('span', { class: 'part-name' }, part.label),
        ],
        actions,
      ),
    ],
  };
}

/** The library as a select with one group per kind of material. */
function materialSelect(value, onchange) {
  const node = h('select', { onchange: (event) => onchange(event.target.value) });
  for (const [group, label] of Object.entries(MATERIAL_GROUPS)) {
    const optgroup = h('optgroup', { label });
    for (const material of MATERIALS.filter((item) => item.group === group)) {
      optgroup.append(new Option(material.label, material.id));
    }
    node.append(optgroup);
  }
  node.value = value;
  return node;
}

/** The parts assigned to something, as removable chips like a selection box. */
function selectionBox(partIds, onRemove, actions, empty) {
  const parts = state.parts.filter((part) => partIds.has(part.id));
  if (parts.length === 0) return h('div', { class: 'selection-box empty' }, empty);
  return h(
    'ul',
    { class: 'selection-box', onmouseleave: () => actions.hover(null) },
    parts.map((part) =>
      h(
        'li',
        { onmouseenter: () => actions.hover([part.id]), title: part.label },
        h('span', { class: 'part-name' }, part.label),
        h(
          'button',
          {
            class: 'icon-button small',
            title: 'Remove',
            'aria-label': `Remove ${part.label}`,
            onclick: () => onRemove(part),
          },
          icon('close', 12),
        ),
      ),
    ),
  );
}

function materialPanel(entry, { actions }) {
  const def = getMaterialDef(entry.materialId);
  const surface = getSurface(entry.materialId, entry.surfaceId);
  const finish = surface.finish ?? 'none';
  const libraryColor = surfaceColor(entry.materialId, entry.surfaceId);
  const { tuning } = entry;
  /** Switches material or surface; a colour the user picked stays, the library's follows the change. */
  const choose = (materialId, surfaceId) => {
    const keepColor = entry.colorHex !== libraryColor;
    entry.materialId = materialId;
    entry.surfaceId = getSurface(materialId, surfaceId).id;
    if (!keepColor) entry.colorHex = surfaceColor(materialId, entry.surfaceId);
    entry.tuning = { ...defaultTuning(materialId, entry.surfaceId), finishAxis: tuning.finishAxis, finishStrength: tuning.finishStrength };
    emit('materials');
  };
  const tune = (key, live = true) => (value) => {
    tuning[key] = value;
    emit(live ? 'materials:live' : 'materials');
  };
  const tuneSlider = (label, key, title) =>
    slider(label, {
      min: 0,
      max: 100,
      value: Math.round(tuning[key] * 100),
      unit: '%',
      title,
      oninput: (value) => tune(key)(value / 100),
      onchange: () => emit('materials'),
    });
  const modified = entry.colorHex !== libraryColor || !isDefaultTuning(entry.materialId, entry.surfaceId, tuning);

  return {
    title: materialEntryLabel(entry),
    icon: 'palette',
    badge: modified ? 'changed' : null,
    body: [
      field(
        'Material',
        materialSelect(entry.materialId, (value) => choose(value, entry.surfaceId)),
      ),
      def.surfaces.length > 1
        ? field(
            'Surface',
            selectControl(
              def.surfaces.map((item) => [item.id, item.label]),
              surface.id,
              (value) => choose(entry.materialId, value),
            ),
          )
        : null,
      field(
        'Colour',
        h('input', {
          type: 'color',
          value: entry.colorHex,
          oninput: (event) => {
            entry.colorHex = event.target.value;
            emit('materials:live');
          },
        }),
      ),
      group('material-tuning', 'Fine tuning', [
        tuneSlider('Roughness', 'roughness', 'Low mirrors, high scatters the light'),
        tuneSlider('Metallic', 'metalness', 'Metals are at 100 %, plastics and paints at 0 %'),
        tuneSlider('Clear coat', 'clearcoat', 'A glossy layer on top of the material'),
        finish !== 'none'
          ? [
              field(
                finish === 'turned' ? 'Turning axis' : 'Brushing direction',
                selectControl(Object.entries(FINISH_AXES), tuning.finishAxis, tune('finishAxis', false)),
              ),
              slider('Strength', {
                min: 0,
                max: 100,
                value: Math.round(tuning.finishStrength * 100),
                unit: '%',
                title: 'How much the reflections smear across the marks',
                oninput: (value) => tune('finishStrength')(value / 100),
                onchange: () => emit('materials'),
              }),
            ]
          : null,
      ]),
      group('material-parts', `Assigned parts (${entry.partIds.size})`, [
        h('p', { class: 'hint' }, 'Click parts in the viewport to add or remove them.'),
        selectionBox(
          entry.partIds,
          (part) => setPartsAssigned(entry, identicalParts(part).map((item) => item.id), false),
          actions,
          'No parts yet',
        ),
        h(
          'div',
          { class: 'button-row' },
          h('button', { onclick: () => setPartsAssigned(entry, state.parts.map((p) => p.id), true) }, 'All parts'),
          h('button', { onclick: () => setPartsAssigned(entry, [...entry.partIds], false), disabled: entry.partIds.size === 0 }, 'Clear list'),
        ),
        toggle('Identical parts together', linkIdentical, (checked) => {
          linkIdentical = checked;
        }),
        group(
          'material-pick-list',
          'Pick from list',
          [
            pickList(entry, actions),
          ],
          { open: false },
        ),
      ]),
    ],
    footer: [
      h(
        'button',
        {
          disabled: !modified,
          title: modified ? `Colour and fine tuning as in the library for ${materialEntryLabel(entry)}` : 'Already at the defaults',
          onclick: () => {
            entry.colorHex = libraryColor;
            entry.tuning = defaultTuning(entry.materialId, entry.surfaceId);
            emit('materials');
          },
        },
        icon('undo', 15),
        'Reset to defaults',
      ),
      deleteButton('Delete', () => actions.deleteMaterial(entry.id)),
    ],
  };
}

// --- Scene ------------------------------------------------------------------------

function scenePanel(which, { actions }) {
  const { scene } = state;
  const environment = scene.background === 'environment';
  const set = (key, live = false) => (value) => {
    scene[key] = value;
    emit(live ? 'scene:live' : 'scene');
  };
  const colorField = (label, key) =>
    field(label, h('input', { type: 'color', value: scene[key], oninput: (event) => set(key, true)(event.target.value) }));
  const custom = scene.background.startsWith('#');
  const colorKind = custom ? 'custom' : scene.background;

  if (which === 'floor') {
    return {
      title: 'Floor',
      icon: 'floor',
      body: environment
        ? [
            h('p', { class: 'hint' }, 'With a scene as background, the scene brings its own ground.'),
          ]
        : [
            field(
              'Shape',
              selectControl(
                Object.entries(FLOORS).filter(([value]) => value !== 'none'),
                scene.floor,
                set('floor'),
              ),
            ),
            scene.floor === 'cove' ? colorField('Cove colour', 'coveColor') : null,
            scene.floor === 'shadow' ? h('p', { class: 'hint' }, 'The floor blends into the background and only shows shadows and reflections.') : null,
            slider('Shadow', {
              min: 0,
              max: 100,
              value: Math.round(scene.shadow * 100),
              unit: '%',
              title: 'How dark the shadow under the model is. 100 % is the shadow the lights cast',
              oninput: (value) => set('shadow', true)(value / 100),
              onchange: () => emit('scene'),
            }),
            h('p', { class: 'hint' }, 'How soft the shadow is comes from the size of the lights.'),
            scene.floor !== 'none'
              ? group('scene-reflection', 'Reflections', [
                  slider('Reflection', {
                    min: 0,
                    max: 100,
                    value: Math.round(scene.reflection * 100),
                    unit: '%',
                    title: 'How strongly the floor mirrors the model and the light. On a dark background a dark lighting preset fits',
                    oninput: (value) => set('reflection', true)(value / 100),
                    onchange: () => emit('scene'),
                  }),
                  scene.reflection > 0
                    ? slider('Blur', {
                        min: 0,
                        max: 100,
                        value: Math.round(scene.reflectionBlur * 100),
                        unit: '%',
                        title: 'Sharp like a mirror, or soft like a glossy surface',
                        oninput: (value) => set('reflectionBlur', true)(value / 100),
                      })
                    : null,
                ])
              : null,
          ],
      footer: [deleteButton('Remove', actions.deleteFloor)],
    };
  }

  return {
    title: 'Background',
    icon: 'background',
    body: [
      segmented(
        null,
        [
          ['color', 'Colour', 'palette'],
          ['environment', 'Scene', 'scene'],
        ],
        environment ? 'environment' : 'color',
        (value) => set('background')(value === 'environment' ? 'environment' : 'light'),
      ),
      environment
        ? [
            h(
              'p',
              { class: 'hint' },
              state.lighting.presetId === 'custom'
                ? `The HDRI "${state.lighting.hdriName}" shows behind the model and brings its own ground.`
                : 'The lighting studio shows behind the model. A photo background is an HDRI file under Lighting › Light setup.',
            ),
          ]
        : [
            field(
              'Colour',
              selectControl(
                [...Object.entries(BACKGROUND_COLORS), ['custom', 'Own colour'], ['gradient', 'Gradient']],
                colorKind,
                (value) => set('background')(value === 'custom' ? '#dfe6ee' : value),
              ),
            ),
            custom
              ? field(
                  'Own colour',
                  h('input', { type: 'color', value: scene.background, oninput: (event) => set('background', true)(event.target.value) }),
                )
              : null,
            scene.background === 'gradient'
              ? [
                  field(
                    'Gradient',
                    selectControl(
                      [
                        ['linear', 'Top to bottom'],
                        ['radial', 'Centre outwards'],
                      ],
                      scene.gradientType,
                      set('gradientType'),
                    ),
                  ),
                  colorField(scene.gradientType === 'radial' ? 'Centre' : 'Top', 'gradientFrom'),
                  colorField(scene.gradientType === 'radial' ? 'Edge' : 'Bottom', 'gradientTo'),
                ]
              : null,
          ],
    ],
  };
}

// --- Lighting -----------------------------------------------------------------------


function lightingPanel({ actions }) {
  const { lighting } = state;
  return {
    title: 'Light setup',
    icon: 'sliders',
    body: [
      field(
        'Preset',
        selectControl(
          [...LIGHT_PRESETS.map((preset) => [preset.id, preset.label]), ['custom', 'Own HDRI file …']],
          lighting.presetId,
          (value) => {
            if (value === 'custom') {
              // Stays on the previous preset until a file has actually been loaded.
              emit('lighting');
              actions.loadHdri();
              return;
            }
            lighting.presetId = value;
            lighting.hdriName = null;
            // A preset brings its own softboxes, which replace the current ones.
            lighting.lights = withIds(presetLights(getLightPreset(value)));
            emit('lighting');
          },
        ),
      ),
      lighting.presetId === 'custom'
        ? [
            field('HDRI', h('div', { class: 'file-name' }, lighting.hdriName)),
            h('button', { onclick: actions.loadHdri }, icon('upload', 15), 'Other HDRI file …'),
          ]
        : null,
      slider('Rotation', {
        min: -180,
        max: 180,
        value: lighting.rotation,
        unit: '°',
        title: 'Turns all lights around the model',
        oninput: (value) => {
          lighting.rotation = value;
          emit('lighting:live');
        },
      }),
      // Exposure in thirds of a stop, like a camera. Each stop doubles the light.
      slider('Exposure', {
        min: -9,
        max: 9,
        value: Math.log2(lighting.intensity) * 3,
        unit: 'EV',
        digits: 2,
        toShown: (value) => value / 3,
        fromShown: (ev) => ev * 3,
        exact: (ev) => {
          const stops = Math.min(Math.max(ev, -3), 3);
          lighting.intensity = 2 ** stops;
          emit('lighting');
          return stops;
        },
        title: 'Brighter or darker in stops; the background stays',
        oninput: (value) => {
          lighting.intensity = 2 ** (value / 3);
          emit('lighting:live');
        },
      }),
    ],
  };
}

const SIZE_STEPS = 0.5;

function lightPanel(light, { actions }) {
  const set = (key, live = true) => (value) => {
    light[key] = value;
    emit(live ? 'lighting:live' : 'lighting');
  };
  const angle = (label, key, min, max, title) =>
    slider(label, { min, max, value: light[key], unit: '°', title, oninput: set(key) });
  // Power on a logarithmic slider from 0.1 to 1000.
  const toSlider = (power) => Math.log10(Math.max(power, 0.1)) * 50;
  const fromSlider = (value) => Number((10 ** (value / 50)).toPrecision(2));
  const picking = actions.isPickingHighlight(light);

  return {
    title: light.name,
    icon: 'softbox',
    body: [
      textField('Name', light.name, (value) => {
        light.name = value || 'Softbox';
        emit('lighting:live');
      }),
      group('light-position', 'Position', [
        h(
          'button',
          {
            class: picking ? 'active' : '',
            onclick: () => actions.pickHighlight(light),
            title: 'Places the softbox so that its highlight lands on the clicked point',
          },
          icon('target', 15),
          picking ? 'Click a point on the model …' : 'Place highlight',
        ),
        angle('Direction', 'az', -180, 180, '0° is the front, 90° the right'),
        angle('Height', 'el', -30, 90, '0° is level with the model, 90° straight above'),
      ]),
      group('light-size', 'Size', [
        slider('Width', {
          min: 1,
          max: MAX_LIGHT_SIZE,
          step: SIZE_STEPS,
          value: light.width,
          unit: '°',
          title: 'Larger softboxes give softer shadows at the same amount of light',
          oninput: set('width'),
        }),
        slider('Height', {
          min: 1,
          max: MAX_LIGHT_SIZE,
          step: SIZE_STEPS,
          value: light.height,
          unit: '°',
          oninput: set('height'),
        }),
        field(
          'Shape',
          selectControl(
            [
              ['rect', 'Rectangular'],
              ['round', 'Round'],
            ],
            light.round ? 'round' : 'rect',
            (value) => set('round', false)(value === 'round'),
          ),
        ),
      ]),
      group('light-power', 'Light', [
        slider('Power', {
          min: -50,
          max: 150,
          value: toSlider(light.power),
          digits: 2,
          toShown: fromSlider,
          fromShown: toSlider,
          exact: (power) => {
            const limited = Math.min(Math.max(power, 0.1), 1000);
            set('power', false)(limited);
            return limited;
          },
          oninput: (value) => set('power')(fromSlider(value)),
        }),
        field(
          'Colour',
          h('input', {
            type: 'color',
            value: light.color,
            oninput: (event) => set('color')(event.target.value),
          }),
        ),
      ]),
    ],
    footer: [deleteButton('Delete', () => actions.deleteLight(light.id))],
  };
}

// --- Camera -----------------------------------------------------------------------

function viewsPanel({ viewer, actions }) {
  const { camera } = state;
  const pose = viewer.getPose();
  const parallel = viewer.parallel;

  // The focal length slider is logarithmic, so wide and long lenses get equal room.
  const toSlider = (focal) => (Math.log(focal / FOCAL_MIN) / Math.log(FOCAL_MAX / FOCAL_MIN)) * 100;
  const fromSlider = (value) => FOCAL_MIN * (FOCAL_MAX / FOCAL_MIN) ** (value / 100);
  const clampFocal = (focal) => Math.min(Math.max(focal, FOCAL_MIN), FOCAL_MAX);
  const focal = slider('Focal length', {
    min: 0,
    max: 100,
    step: 0.5,
    value: toSlider(clampFocal(viewer.focalLength)),
    unit: 'mm',
    toShown: (value) => Math.round(fromSlider(value)),
    fromShown: (focal) => toSlider(clampFocal(focal)),
    exact: (length) => {
      const limited = clampFocal(length);
      viewer.setFocalLength(limited);
      return limited;
    },
    disabled: parallel,
    title: 'Long focal lengths show parts with little perspective distortion',
    oninput: (value) => viewer.setFocalLength(fromSlider(value)),
  });

  const boxes = {
    azimuth: numberBox('Turn °', { value: pose.azimuth, step: 5, onchange: (value) => viewer.setPose({ azimuth: value }) }),
    elevation: numberBox('Height °', {
      value: pose.elevation,
      step: 5,
      min: -90,
      max: 90,
      onchange: (value) => viewer.setPose({ elevation: value }),
    }),
    roll: numberBox('Roll °', { value: pose.roll, step: 5, onchange: (value) => viewer.setPose({ roll: value }) }),
    distance: numberBox('Distance mm', {
      value: pose.distance,
      step: 10,
      min: 0.1,
      onchange: (value) => viewer.setPose({ distance: Math.max(value, 0.1) }),
    }),
  };
  const targetBoxes = ['X', 'Y', 'Z'].map((axis, i) =>
    numberBox(axis, {
      value: pose.target[i],
      step: 1,
      onchange: (value) => {
        const target = viewer.getPose().target;
        target[i] = value;
        viewer.setPose({ target });
      },
    }),
  );

  return {
    title: 'Camera',
    icon: 'lens',
    body: [
      focal,
      toggle('Parallel projection', parallel, (checked) => {
        viewer.setParallel(checked);
        emit('views');
      }),
      group(
        'camera-numbers',
        'Camera in numbers',
        [
          h('div', { class: 'field-grid two', title: '0° is the front view, 90° the right' }, boxes.azimuth, boxes.elevation, boxes.roll, boxes.distance),
          h('p', { class: 'hint', title: 'The point the camera looks at and turns around' }, 'Target (mm)'),
          h('div', { class: 'field-grid three' }, targetBoxes),
        ],
        { open: false },
      ),
      camera.dof
        ? null
        : h(
            'p',
            { class: 'hint' },
            'For a blurred background or foreground, add Depth of field with the + of the camera.',
          ),
    ],
    live: () => {
      const current = viewer.getPose();
      for (const key of Object.keys(boxes)) boxes[key].set(current[key]);
      targetBoxes.forEach((box, i) => box.set(current.target[i]));
      const length = viewer.focalLength;
      focal.set(toSlider(clampFocal(length)), Math.round(clampFocal(length)));
      focal.setDisabled(viewer.parallel);
    },
  };
}

/** Depth of field: how blurred things in front of and behind the focus are, in the rendering. */
function depthOfFieldPanel({ actions }) {
  const { camera } = state;
  const focusText = h('p', { class: 'hint' });
  const updateFocus = () => {
    focusText.textContent = `Focus: ${camera.focusPoint ? 'chosen point' : 'pivot'} · ${numberFormat.format(
      Math.round(actions.focusDistance()),
    )} mm`;
  };
  updateFocus();
  const picking = actions.isPickingFocus();
  return {
    title: 'Depth of field',
    icon: 'target',
    body: [
      h('p', { class: 'hint' }, 'Shows in the rendering only; the viewport stays sharp.'),
      slider('Aperture', {
        min: 0,
        max: F_STOPS.length - 1,
        value: Math.max(F_STOPS.indexOf(camera.fStop), 0),
        prefix: 'f/',
        digits: 1,
        toShown: (index) => F_STOPS[index],
        // The nearest f-stop of the lens to a typed number.
        fromShown: (number) =>
          F_STOPS.reduce((best, stop, index) => (Math.abs(stop - number) < Math.abs(F_STOPS[best] - number) ? index : best), 0),
        title: 'A small f-number means more blur',
        oninput: (value) => {
          camera.fStop = F_STOPS[value];
          emit('camera:live');
        },
        onchange: () => emit('camera'),
      }),
      focusText,
      h(
        'div',
        { class: 'button-row' },
        h('button', { class: picking ? 'active' : '', onclick: actions.pickFocus }, icon('target', 15), picking ? 'Click a point …' : 'Pick focus'),
        camera.focusPoint
          ? h(
              'button',
              {
                onclick: () => {
                  camera.focusPoint = null;
                  emit('camera');
                },
              },
              'Use the pivot',
            )
          : null,
      ),
    ],
    footer: [deleteButton('Remove', actions.deleteDepthOfField)],
    live: updateFocus,
  };
}

/** Exploded view: how far apart the parts move, in which direction and from where. */
/**
 * Exploded view: how far apart the parts move, in which direction and from
 * where. As a foldable group inside a render job, or as a panel's body.
 */
function explodeControls(asGroup = true) {
  if (state.parts.length < 2) return null;
  const { explode } = state;
  const own = Object.keys(explode.parts || {}).length;
  const controls = [
      slider('Distance', {
        min: 0,
        max: 150,
        step: 1,
        value: Math.round(explode.amount * 100),
        unit: '%',
        title: 'How far the parts move apart: 100 % doubles their distance from the centre',
        oninput: (value) => {
          explode.amount = value / 100;
          emit('explode:live');
        },
        onchange: () => emit('explode'),
      }),
      field(
        'Direction',
        selectControl(Object.entries(EXPLODE_DIRECTIONS), explode.direction, (value) => {
          explode.direction = value;
          emit('explode');
        }),
      ),
      field(
        'Centre',
        selectControl(
          [['', 'Middle of the assembly'], ...state.parts.map((part) => [String(part.id), part.label])],
          explode.anchor === null ? '' : String(explode.anchor),
          (value) => {
            explode.anchor = value === '' ? null : Number(value);
            emit('explode');
          },
        ),
      ),
      h(
        'p',
        { class: 'hint' },
        own > 0
          ? `${plural(own, 'part has', 'parts have')} own settings.`
          : 'Open a part to keep it in place or send it in a direction of its own.',
      ),
      own > 0
        ? h(
            'button',
            {
              onclick: () => {
                explode.parts = {};
                emit('explode');
              },
            },
            'Reset part settings',
          )
        : null,
  ];
  return asGroup ? group('explode', 'Exploded view', controls, { open: explode.amount > 0, title: 'Pulls the parts of an assembly apart to show how it is built' }) : controls;
}

function viewPanel(view, { viewer, actions }) {
  return {
    title: view.name,
    icon: 'bookmark',
    body: [
      textField('Name', view.name, (value) => {
        view.name = value || 'View';
        emit('views:live');
      }),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => actions.showView(view) }, icon('eye', 15), 'Show'),
        h(
          'button',
          {
            title: 'Overwrite with the current view',
            onclick: () => {
              Object.assign(view, viewer.getViewState(), { explode: structuredClone(state.explode) });
              emit('views');
            },
          },
          icon('bookmark', 15),
          'Update',
        ),
      ),
    ],
    footer: [deleteButton('Delete', () => actions.deleteView(view.id))],
  };
}

// --- Output and render jobs --------------------------------------------------------

/** Image size, quality and file settings, shared by render jobs and their defaults. */
function imageSettings(settings, { actions, onchange }) {
  const size = actions.resolveOutputSize(settings);
  const set = (key) => (value) => {
    settings[key] = value;
    onchange();
  };
  const sizeInput = (key) =>
    h('input', {
      type: 'number',
      min: 64,
      max: 8192,
      step: 1,
      value: settings[key],
      onchange: (event) => set(key)(Math.min(Math.max(Math.round(Number(event.target.value) || 64), 64), 8192)),
    });
  return [
    group('job-image', 'Image', [
      field(
        'Aspect ratio',
        selectControl(
          Object.entries(OUTPUT_ASPECTS).map(([key, value]) => [key, value.label]),
          settings.aspect,
          set('aspect'),
        ),
      ),
      settings.aspect === 'custom'
        ? h('div', { class: 'field-grid two' }, field('Width px', sizeInput('width')), field('Height px', sizeInput('height')))
        : field(
            'Resolution',
            selectControl(
              Object.entries(OUTPUT_RESOLUTIONS).map(([key, label]) => [key, label]),
              String(settings.resolution),
              (value) => set('resolution')(Number(value)),
            ),
            `${size.width} × ${size.height}`,
          ),
    ]),
    group('job-edges', 'Edge lines', [
      toggle('Draw edge lines', settings.edges, set('edges'), 'The CAD edges and the outlines of cut faces, drawn over the rendering'),
      settings.edges
        ? [
            field(
              'Line colour',
              h('input', {
                type: 'color',
                value: settings.edgeColor,
                onchange: (event) => set('edgeColor')(event.target.value),
              }),
            ),
            slider('Line width', {
              min: 0.5,
              max: 6,
              step: 0.25,
              value: settings.edgeWidth,
              unit: 'px',
              digits: 2,
              title: 'On a Full HD image; larger images get proportionally wider lines',
              oninput: (value) => {
                settings.edgeWidth = value;
              },
              onchange: () => onchange(),
            }),
          ]
        : null,
    ]),
    group('job-quality', 'Quality', [
      field(
        'Samples',
        selectControl(
          Object.entries(QUALITY).map(([key, value]) => [key, `${value.label} (${value.samples})`]),
          settings.quality,
          set('quality'),
        ),
      ),
      toggle('Denoise', settings.denoise, set('denoise'), 'Smooths the remaining noise at the end of the rendering'),
    ]),
    group('job-background', 'Background', [
      toggle('Transparent background', settings.transparent, set('transparent'), 'Without background and floor; save as PNG to keep it'),
    ]),
  ];
}

/** Where renderings run: graphics card or processor, and the gentle mode. Shown in the app settings. */
/** How dragging rotates the view, an app setting (see settings.js and cad-controls.js). */
export function rotateControls(levelHorizon, onchange) {
  return field(
    'Rotating',
    selectControl(
      [
        ['free', 'Free, like Onshape'],
        ['level', 'Keep the horizon level'],
      ],
      levelHorizon ? 'level' : 'free',
      (value) => onchange(value === 'level'),
    ),
  );
}

/** Where the mouse wheel zooms to, an app setting (see settings.js). */
export function zoomControls(zoomToCenter, onchange) {
  return field(
    'Mouse wheel zooms',
    selectControl(
      [
        ['pointer', 'Towards the pointer'],
        ['center', 'Towards the middle'],
      ],
      zoomToCenter ? 'center' : 'pointer',
      (value) => onchange(value === 'center'),
    ),
  );
}

export function deviceControls() {
  const { output } = state;
  const set = (key) => (value) => {
    output[key] = value;
    emit('output');
  };
  return [
    field(
      'Render on',
      selectControl(
        Object.entries(RENDER_DEVICES).map(([key, value]) => [key, value.label]),
        output.device,
        set('device'),
      ),
    ),
    output.device === 'gpu'
      ? toggle('Gentle mode', output.gentle, set('gentle'), 'For laptops and weaker graphics cards: smaller portions, but slower')
      : h('p', { class: 'hint' }, 'Without a graphics card an image takes many times as long. Meant as a fallback.'),
  ];
}

/** Guide lines over the image area, for lining up the model. */
function jobPanel(job, { actions }) {
  const changed = () => actions.jobChanged(job);
  const set = (key) => (value) => {
    job[key] = value;
    changed();
  };
  return {
    title: job.name,
    icon: job.type === 'animation' ? 'film' : 'image',
    body: [
      textField('Name', job.name, (value) => {
        job.name = value || 'Render job';
        emit('jobs:live');
      }),
      h(
        'p',
        { class: 'hint' },
        'While this job is open it takes the camera along: move the view until the frame shows what you want.',
      ),
      job.type === 'animation'
        ? group('job-animation', 'Turntable', [
            field(
              'Images per turn',
              selectControl(
                TURNTABLE_FRAMES.map((frames) => [frames, `${frames} (every ${numberFormat.format(360 / frames)}°)`]),
                job.turntableFrames,
                (value) => set('turntableFrames')(Number(value)),
              ),
            ),
            field(
              'Length of one turn',
              selectControl(
                TURNTABLE_SECONDS.map((seconds) => [seconds, `${seconds} s`]),
                job.turntableSeconds,
                (value) => set('turntableSeconds')(Number(value)),
              ),
            ),
            h(
              'p',
              { class: 'hint' },
              'The model turns once around the vertical axis, like on a turntable; camera and light stay. ' +
                'The camera height sets the viewing angle. More images play more smoothly.',
            ),
          ])
        : null,
      imageSettings(job, { actions, onchange: changed }),
      actions.renderSupported ? null : notice(NO_WEBGPU, null, 'warning'),
    ],
    footer: [
      actions.renderSupported
        ? h('button', { class: 'primary', onclick: () => actions.renderJob(job) }, icon('play', 15), 'Render')
        : null,
      h('button', { class: 'icon-only', title: 'Duplicate', 'aria-label': 'Duplicate', onclick: () => actions.duplicateJob(job) }, icon('copy', 15)),
      deleteButton('Delete', () => actions.deleteJob(job)),
    ],
  };
}

// --- Renders --------------------------------------------------------------------

/** Sliders for the image adjustments of a finished rendering. */
function adjustControls(render) {
  render.adjust ??= defaultAdjust();
  const sliders = Object.entries(ADJUSTMENTS).map(([key, spec]) =>
    slider(spec.label, {
      min: spec.min,
      max: spec.max,
      value: render.adjust[key] || 0,

      oninput: (value) => {
        render.adjust[key] = value;
        emit('renders:live');
      },
      onchange: () => emit('renders'),
    }),
  );
  return group('render-adjust', 'Adjust', [
    sliders,
    h(
      'button',
      {
        disabled: isNeutral(render.adjust),
        onclick: () => {
          render.adjust = defaultAdjust();
          emit('renders');
        },
      },
      icon('undo', 15),
      'Reset adjustments',
    ),
    h('p', { class: 'hint' }, 'Applied when saving, also to the images and the video of a turntable.'),
  ]);
}

function renderPanelFor(render, { actions }) {
  const bar = h('div', { class: 'progress-bar' }, h('div', { class: 'progress-fill' }));
  const text = h('p', { class: 'hint' });
  const device = h('p', { class: 'hint' });
  const buttons = h('div', { class: 'footer-buttons' });
  const count = render.turntable;

  // Time left in a turntable series, from the images finished so far.
  const remaining = () => {
    const finished = render.frames.length;
    if (!count || finished === 0) return '';
    const spent = render.frames.reduce((sum, frame) => sum + frame.seconds, 0);
    const current = render.seconds - spent;
    const left = Math.max((spent / finished) * (count - finished) - current, 0);
    return ` · about ${formatDuration(left)} left`;
  };

  const update = () => {
    bar.firstChild.style.width = `${Math.round(render.progress * 100)}%`;
    bar.hidden = render.status !== 'running';
    device.hidden = !render.deviceName;
    device.textContent = render.deviceName ? `Rendered on: ${render.deviceName}` : '';
    const image = count ? `Image ${render.frameIndex + 1} of ${count} · ` : '';
    if (render.status === 'running') {
      text.textContent =
        render.stage === 'rendering'
          ? `${image}Sample ${Math.floor(render.samples)} of ${render.targetSamples} · ${formatDuration(render.seconds)}${remaining()}`
          : render.stage === 'denoising'
            ? `${image}Denoising … · ${formatDuration(render.seconds)}${remaining()}`
            : `${image}Preparing the scene …`;
    } else if (render.status === 'queued') {
      text.textContent = 'Waiting until the renderings before it are done.';
    } else if (render.status === 'done') {
      const images = render.frames.length || render.frameCount || count;
      text.textContent =
        `Done in ${formatDuration(render.seconds)} · ` +
        (count ? `${images} images` : `${Math.round(render.samples)} samples`) +
        (render.denoised ? ' · denoised' : '') +
        (render.note ? ` · ${render.note}` : '');
    } else if (render.status === 'failed') {
      text.textContent = `Failed: ${render.error}`;
    } else {
      text.textContent = 'Cancelled';
    }
  };

  // Browsing and playing a finished turntable series.
  let player = null;
  if (count && render.status === 'done' && render.frames.length > 0) {
    const frames = render.frames.length;
    const play = h('button', { onclick: () => actions.togglePlaying(render) });
    const scrub = slider('Image', {
      min: 1,
      max: frames,
      value: render.shownFrame + 1,
      unit: `of ${frames}`,
      oninput: (value) => actions.showFrame(render, value - 1),
    });
    player = h('div', null, scrub, h('div', { class: 'button-column' }, play));
    player.update = () => {
      scrub.set(render.shownFrame + 1);
      play.textContent = actions.isPlaying(render) ? 'Pause' : 'Play';
    };
    player.update();
  }

  if (render.status === 'running') {
    if (!count) {
      buttons.append(
        h(
          'button',
          { onclick: () => render.handle?.finishNow(), title: 'Ends the rendering with what it has reached so far' },
          'Finish now',
        ),
      );
    }
    buttons.append(
      h(
        'button',
        { class: 'danger', onclick: () => actions.cancelRender(render), title: count ? 'Finished images are kept' : null },
        'Cancel',
      ),
    );
  } else if (render.status === 'queued') {
    buttons.append(deleteButton('Take out of the queue', () => actions.deleteRender(render)));
  } else {
    if (render.status === 'done') {
      const formats = Object.keys(FILE_FORMATS);
      const formatTitle = (format) =>
        format === 'jpg' && render.transparent ? `${FILE_FORMATS[format].label}; no transparency, put on white` : FILE_FORMATS[format].label;
      if (count) {
        if (videoSupported()) {
          buttons.append(
            h(
              'button',
              { class: 'primary', onclick: () => actions.saveVideo(render), title: 'Recorded in real time; keep this tab in front' },
              icon('download', 15),
              'Video',
            ),
          );
        }
        for (const format of formats) {
          buttons.append(
            h(
              'button',
              { onclick: () => actions.saveRender(render, format), title: `All images in a ZIP file, ${formatTitle(format)}` },
              icon('download', 15),
              `${FILE_FORMATS[format].extension.toUpperCase()} images`,
            ),
          );
        }
      } else {
        // The file format is chosen only here, when saving; PNG comes first.
        for (const format of formats) {
          buttons.append(
            h(
              'button',
              { class: format === 'png' ? 'primary' : null, onclick: () => actions.saveRender(render, format), title: `Save as ${formatTitle(format)}` },
              icon('download', 15),
              FILE_FORMATS[format].extension.toUpperCase(),
            ),
          );
        }
      }
    }
    buttons.append(deleteButton('Delete', () => actions.deleteRender(render)));
  }
  update();

  return {
    title: render.name,
    icon: count ? 'film' : 'image',
    editable: false,
    body: [
      h(
        'p',
        { class: 'hint' },
        `${render.width} × ${render.height} pixels${render.transparent ? ' · transparent' : ''}` +
          (count ? ` · ${count} images per turn` : ''),
      ),
      bar,
      text,
      device,
      player,
      render.status === 'done' ? adjustControls(render) : null,
    ],
    footer: [buttons],
    live: () => {
      update();
      player?.update();
    },
  };
}

/**
 * Builds the settings panel for the selected tree node. Returns a function
 * that refreshes volatile values (render progress, camera numbers) without
 * rebuilding, or null. Panels that change the project get ✓ (keep) and ✗
 * (discard) in their header.
 */
/** Lists with their own scroll bar inside a panel; their position is kept when the panel is rebuilt. */
const INNER_SCROLLERS = '.part-list, .selection-box, .item-list';

export function renderPanel(container, context) {
  const key = state.selected;
  const [kind, idText] = key.split(':');
  const id = Number(idText);
  let panel = null;

  if (key === 'geometry') panel = geometryPanel(context);
  else if (state.parts.length === 0) panel = null;
  else if (kind === 'part') {
    const selected = [...state.selectedParts].map((item) => state.parts[item]).filter((part) => part && !part.removed);
    if (selected.length > 1) panel = partsSelectionPanel(selected, context);
    else panel = state.parts[id] && !state.parts[id].removed ? partPanel(state.parts[id], context) : null;
  } else if (key === 'explode') panel = state.parts.length > 1 && hasExplode(state.explode) ? explodePanel(context) : null;
  else if (kind === 'section') {
    const section = state.sections.find((item) => item.id === id);
    panel = section ? sectionPanel(section, context) : null;
  } else if (key === 'material:cad') panel = cadMaterialPanel(context);
  else if (kind === 'material') {
    const entry = state.materials.find((item) => item.id === id);
    panel = entry ? materialPanel(entry, context) : null;
  } else if (key === 'scene:background') panel = scenePanel('background', context);
  else if (key === 'scene:floor') panel = state.scene.floor !== 'none' ? scenePanel('floor', context) : null;
  else if (key === 'camera:dof') panel = state.camera.dof ? depthOfFieldPanel(context) : null;
  else if (key === 'lighting') panel = lightingPanel(context);
  else if (kind === 'light') {
    const light = state.lighting.lights.find((item) => item.id === id);
    panel = light ? lightPanel(light, context) : null;
  } else if (key === 'views') panel = viewsPanel(context);
  else if (kind === 'view') {
    const view = state.views.find((item) => item.id === id);
    panel = view ? viewPanel(view, context) : null;
  } else if (kind === 'job') {
    const job = state.jobs.find((item) => item.id === id);
    panel = job ? jobPanel(job, context) : null;
  } else if (kind === 'render') {
    const render = state.renders.find((item) => item.id === id);
    panel = render ? renderPanelFor(render, context) : null;
  }

  container.hidden = !panel;
  if (!panel) {
    container.replaceChildren();
    delete container.dataset.key;
    return null;
  }

  const { actions } = context;
  const editable = context.editable && panel.editable !== false;
  const headerButton = (name, title, run, className = 'icon-button') =>
    h('button', { class: className, title, 'aria-label': title, onclick: run }, icon(name, 16));
  const sameKey = container.dataset.key === key;
  const scroll = container.querySelector('.panel-body')?.scrollTop ?? 0;
  const innerScrolls = [...container.querySelectorAll(INNER_SCROLLERS)].map((node) => node.scrollTop);
  // The row under the pointer (or the pick list) stays where it is on screen, so lists don't jump.
  const anchorNode = [...container.querySelectorAll('[data-anchor]:hover')].pop() || container.querySelector('.panel-body .part-list');
  const anchor = anchorNode && { key: anchorNode.dataset.anchor, top: anchorNode.getBoundingClientRect().top, list: !anchorNode.dataset.anchor };
  const body = h('div', { class: 'panel-body' }, panel.body);
  const footer = (panel.footer || []).flat(Infinity).filter(Boolean);
  const header = h(
    'header',
    { class: 'panel-header' },
    panel.icon ? h('span', { class: 'panel-icon' }, icon(panel.icon, 18)) : null,
    h('h2', { title: panel.title }, panel.title),
    panel.badge ? h('span', { class: 'panel-badge' }, panel.badge) : null,
    h(
      'div',
      { class: 'panel-header-actions' },
      editable
        ? [
            headerButton('check', 'Keep changes and close', actions.applyPanel, 'icon-button apply'),
            headerButton('close', 'Discard changes made in this panel', actions.discardPanel, 'icon-button discard'),
          ]
        : headerButton('close', 'Close', actions.closePanel),
    ),
  );
  container.replaceChildren(header, body);
  if (footer.length > 0) container.append(h('footer', { class: 'panel-footer' }, footer));
  body.scrollTop = sameKey ? scroll : 0;
  if (sameKey) {
    const scrollers = body.querySelectorAll(INNER_SCROLLERS);
    innerScrolls.forEach((top, i) => {
      if (scrollers[i]) scrollers[i].scrollTop = top;
    });
    const again = anchor && (anchor.list ? body.querySelector('.part-list') : body.querySelector(`[data-anchor="${anchor.key}"]`));
    if (again) body.scrollTop += again.getBoundingClientRect().top - anchor.top;
  }
  container.dataset.key = key;
  return panel.live || null;
}
