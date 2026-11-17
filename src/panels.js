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
  removeMaterial,
  setPartsAssigned,
} from './state.js';
import {
  MATERIALS,
  MATERIAL_GROUPS,
  FINISHES,
  FINISH_AXES,
  getMaterialDef,
  defaultTuning,
  isDefaultTuning,
} from './materials.js';
import { LIGHT_PRESETS, MAX_LIGHT_SIZE, getLightPreset, presetLights } from './environment.js';
import { EXPLODE_DIRECTIONS, PART_EXPLODE_DIRECTIONS, partExplode, setPartExplode } from './explode.js';
import { FILE_FORMATS, videoSupported } from './export.js';
import { ADJUSTMENTS, isNeutral } from './adjust.js';
import { GUIDE_TYPES } from './guides.js';

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

function field(label, control, value) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label, value ? h('output', null, value) : null),
    control,
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
    { class: 'field' },
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
 * A range slider with its value shown next to the label. Returns the field;
 * `set(value)` updates it from outside. With `edit` ({ digits, unit }) the
 * value is a number box that can be typed into, beyond the slider's range.
 */
function slider(label, { min, max, step = 1, value, format, oninput, onchange, disabled, title, edit }) {
  let output = h('output', null, format(value));
  if (edit) {
    const round = (number) => String(Number(number.toFixed(edit.digits ?? 1)));
    const box = h('input', {
      type: 'number',
      class: 'slider-value',
      step,
      value: round(value),
      onchange: (event) => {
        const next = Number(event.target.value);
        if (event.target.value === '' || !Number.isFinite(next)) return;
        input.value = next;
        oninput(next);
        onchange?.(next);
      },
    });
    output = h('span', { class: 'slider-edit' }, box, edit.unit ? h('span', null, edit.unit) : null);
    output.box = box;
    output.round = round;
  }
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
    disabled,
    oninput: (event) => {
      const next = Number(event.target.value);
      if (edit) output.box.value = output.round(next);
      else output.textContent = format(next);
      oninput(next);
    },
    // Fires once the slider is let go, for updates too costly to run while dragging.
    onchange: onchange ? () => onchange(Number(input.value)) : null,
  });
  const node = h(edit ? 'div' : 'label', { class: 'field', title }, h('span', { class: 'field-label' }, label, output), input);
  node.set = (next, text) => {
    if (document.activeElement !== input) input.value = next;
    if (edit) {
      if (document.activeElement !== output.box) output.box.value = output.round(next);
    } else {
      output.textContent = text ?? format(next);
    }
  };
  return node;
}

/** A number box that commits on Enter, blur or the spin buttons, and can be refreshed while not being edited. */
function numberBox(label, { value, step = 1, min, max, digits = 1, onchange }) {
  const round = (number) => String(Number(number.toFixed(digits)));
  const input = h('input', {
    type: 'number',
    step,
    min,
    max,
    value: round(value),
    onchange: (event) => {
      const next = Number(event.target.value);
      if (event.target.value !== '' && Number.isFinite(next)) onchange(next);
    },
  });
  const node = h('label', { class: 'field compact' }, h('span', { class: 'field-label' }, label), input);
  node.set = (next) => {
    if (document.activeElement !== input) input.value = round(next);
  };
  return node;
}

function textField(label, value, oninput) {
  return field(label, h('input', { type: 'text', value, oninput: (event) => oninput(event.target.value) }));
}

function deleteButton(label, run) {
  return h('button', { class: 'danger', onclick: run }, label);
}

function formatDuration(seconds) {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

const plural = (count, one, many) => `${numberFormat.format(count)} ${count === 1 ? one : many}`;

const percent = (value) => `${value} %`;

// --- Geometry -----------------------------------------------------------------

function geometryPanel({ actions }) {
  if (state.parts.length === 0) {
    return {
      title: 'Geometry',
      editable: false,
      body: [
        h('p', { class: 'hint' }, 'Drop a STEP file anywhere on the window, or open one here.'),
        h('button', { class: 'primary', onclick: actions.openFile }, 'Open STEP file …'),
      ],
    };
  }

  const triangles = state.parts.reduce((sum, part) => sum + part.triangles, 0);
  const hidden = state.parts.filter((part) => !part.mesh.visible).length;
  const moved = new Set([...state.partOffsets.keys(), ...state.partRotations.keys()]).size;
  return {
    title: 'Geometry',
    body: [
      h('div', { class: 'file-name' }, state.fileName),
      h(
        'p',
        { class: 'hint' },
        `${plural(state.parts.length, 'part', 'parts')} · ${plural(triangles, 'triangle', 'triangles')}` +
          (hidden > 0 ? ` · ${hidden} hidden` : ''),
      ),
      hidden > 0 ? h('button', { onclick: actions.showAllParts }, 'Show all parts') : null,
      h('button', { onclick: actions.openFile }, 'Open another STEP file …'),
      group('coordinates', 'Coordinate system', [
        field(
          'Up axis',
          selectControl(Object.entries(UP_AXES), state.upAxis, (value) => {
            state.upAxis = value;
            emit('geometry');
          }),
        ),
        h(
          'p',
          { class: 'hint' },
          'Which CAD axis points up in the scene. The floor, the turntable and the lighting follow it.',
        ),
        toggle('Show axes', actions.axesVisible(), actions.toggleAxes, 'X red, Y green, Z blue, from the CAD origin (A)'),
        moved > 0
          ? [
              h('p', { class: 'hint' }, `${plural(moved, 'part', 'parts')} moved or turned from the CAD position.`),
              h(
                'button',
                {
                  onclick: () => {
                    state.partOffsets.clear();
                    state.partRotations.clear();
                    emit('geometry');
                  },
                },
                'Put all parts back',
              ),
            ]
          : null,
      ]),
    ],
  };
}

function partsPanel({ actions }) {
  const hidden = state.parts.filter((part) => !part.mesh.visible).length;
  return {
    title: 'Parts',
    editable: false,
    body: [
      h('p', { class: 'hint' }, 'Click a part in the viewport or in the tree to open it.'),
      hidden > 0 ? h('button', { onclick: actions.showAllParts }, `Show all parts (${hidden} hidden)`) : null,
    ],
  };
}

function partPanel(part, { actions }) {
  const entry = materialEntryOf(part.id);
  const copies = state.parts.filter((other) => other.name === part.name && other.triangles === part.triangles).length;
  const assign = (value) => {
    const ids = identicalParts(part).map((item) => item.id);
    if (value === 'cad') {
      setPartsAssigned(null, ids, false);
    } else if (value === 'new') {
      const created = addMaterial(undefined, { claimAll: false });
      setPartsAssigned(created, ids, true);
      select(`material:${created.id}`);
    } else {
      const target = state.materials.find((item) => item.id === Number(value));
      if (target) setPartsAssigned(target, ids, true);
    }
  };

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
  const moving = actions.isGizmoOn(part.id, 'translate');
  const turning = actions.isGizmoOn(part.id, 'rotate');
  const placed = state.partOffsets.has(part.id) || state.partRotations.has(part.id);

  const own = partExplode(state.explode, part.id);
  const setOwn = (changes) => {
    setPartExplode(state.explode, part.id, changes);
    emit('explode');
  };

  return {
    title: part.label,
    body: [
      toggle('Visible', part.mesh.visible, () => actions.togglePart(part.id)),
      field(
        'Material',
        selectControl(
          [
            ['cad', 'CAD colour'],
            ...state.materials.map((item) => [String(item.id), materialEntryLabel(item)]),
            ['new', 'New material …'],
          ],
          entry ? String(entry.id) : 'cad',
          assign,
        ),
      ),
      copies > 1
        ? toggle(`Identical parts together (${copies})`, linkIdentical, (checked) => {
            linkIdentical = checked;
          })
        : null,
      entry ? h('button', { onclick: () => select(`material:${entry.id}`) }, 'Edit material') : null,
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => actions.isolatePart(part.id) }, 'Show only this'),
        h('button', { onclick: actions.showAllParts }, 'Show all'),
      ),
      group('part-position', 'Position and rotation', [
        h('p', { class: 'hint' }, 'Offset from the CAD position along the CAD axes, and turn about the CAD axes around the part\'s centre.'),
        h('div', { class: 'field-grid three' }, positionBoxes),
        h('div', { class: 'field-grid three' }, rotationBoxes),
        h(
          'div',
          { class: 'button-row' },
          h(
            'button',
            {
              class: moving ? 'active' : '',
              onclick: () => actions.toggleGizmo(part.id, 'translate'),
              title: 'Drag the arrows in the viewport to move the part',
            },
            icon('move', 15),
            'Move',
          ),
          h(
            'button',
            {
              class: turning ? 'active' : '',
              onclick: () => actions.toggleGizmo(part.id, 'rotate'),
              title: 'Drag the rings in the viewport to turn the part',
            },
            icon('rotate', 15),
            'Rotate',
          ),
          h(
            'button',
            { onclick: () => actions.resetPartPlacement(part.id), disabled: !placed, title: 'Back to the CAD position' },
            'Reset',
          ),
        ),
      ]),
      state.parts.length > 1
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
                format: (value) => `${value} % of the others`,
                oninput: (value) => {
                  setPartExplode(state.explode, part.id, { factor: value / 100 });
                  emit('explode:live');
                },
                onchange: () => emit('explode'),
              }),
              state.explode.amount === 0
                ? h('p', { class: 'hint' }, 'Set how far the assembly is exploded under Camera or in a render job.')
                : null,
            ],
            { open: false },
          )
        : null,
      h('p', { class: 'hint' }, plural(part.triangles, 'triangle', 'triangles')),
    ],
    live: () => {
      positionBoxes.forEach((box, i) => box.set(offset()[i]));
      rotationBoxes.forEach((box, i) => box.set(rotation()[i]));
    },
  };
}

// --- Sections -------------------------------------------------------------------

function sectionsPanel({ actions }) {
  const cap = state.sectionCap;
  return {
    title: 'Sections',
    body: [
      h('button', { class: 'primary', onclick: actions.addSection }, 'Add section'),
      field(
        'Cut faces',
        selectControl(
          [
            ['material', 'Like the part'],
            ['color', 'Own colour'],
          ],
          cap.mode,
          (value) => {
            cap.mode = value;
            emit('sections');
          },
        ),
      ),
      cap.mode === 'color'
        ? field(
            'Colour',
            h('input', {
              type: 'color',
              value: cap.color,
              oninput: (event) => {
                cap.color = event.target.value;
                emit('sections:live');
              },
            }),
          )
        : null,
    ],
  };
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
    body: [
      textField('Name', section.name, (value) => {
        section.name = value || 'Section';
        emit('sections:live');
      }),
      toggle('Active', section.enabled, set('enabled')),
      field(
        'Plane at right angles to',
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
        format: (value) => `${numberFormat.format(Math.round(value * 10) / 10)} mm`,
        edit: { digits: 2, unit: 'mm' },
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
      deleteButton('Delete section', () => {
        state.sections = state.sections.filter((other) => other !== section);
        select('sections');
      }),
    ],
  };
}

// --- Materials --------------------------------------------------------------------

function materialsPanel({ actions }) {
  return {
    title: 'Materials',
    body: [
      h('button', { class: 'primary', onclick: actions.addMaterial }, 'Add material'),
      h('p', { class: 'hint' }, 'Parts without a material keep their CAD colour.'),
    ],
  };
}

function partList(parts, renderItem, actions) {
  return h(
    'ul',
    { class: 'part-list', onmouseleave: () => actions.hover(null) },
    parts.map((part) =>
      h('li', { onmouseenter: () => actions.hover([part.id]), title: part.label }, renderItem(part)),
    ),
  );
}

function cadMaterialPanel({ actions }) {
  const parts = state.parts.filter((part) => !materialEntryOf(part.id));
  return {
    title: 'CAD colours',
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
  const { tuning } = entry;
  const tune = (key, live = true) => (value) => {
    tuning[key] = value;
    emit(live ? 'materials:live' : 'materials');
  };
  const tuneSlider = (label, key, title) =>
    slider(label, {
      min: 0,
      max: 100,
      value: Math.round(tuning[key] * 100),
      format: percent,
      title,
      oninput: (value) => tune(key)(value / 100),
      onchange: () => emit('materials'),
    });
  const modified = entry.colorHex !== def.color || !isDefaultTuning(entry.materialId, tuning);

  return {
    title: materialEntryLabel(entry),
    body: [
      field(
        'Material',
        materialSelect(entry.materialId, (value) => {
          entry.materialId = value;
          entry.colorHex = getMaterialDef(value).color;
          entry.tuning = defaultTuning(value);
          emit('materials');
        }),
      ),
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
        field(
          'Surface',
          selectControl(
            Object.entries(FINISHES).map(([key, value]) => [key, value.label]),
            tuning.finish,
            tune('finish', false),
          ),
        ),
        tuning.finish !== 'none'
          ? [
              field(
                tuning.finish === 'turned' ? 'Turning axis' : 'Brushing direction',
                selectControl(Object.entries(FINISH_AXES), tuning.finishAxis, tune('finishAxis', false)),
              ),
              slider('Strength', {
                min: 0,
                max: 100,
                value: Math.round(tuning.finishStrength * 100),
                format: percent,
                title: 'How much the reflections smear across the marks',
                oninput: (value) => tune('finishStrength')(value / 100),
                onchange: () => emit('materials'),
              }),
            ]
          : null,
      ]),
      h(
        'button',
        {
          disabled: !modified,
          title: modified ? `Colour and fine tuning as in the library for ${def.label}` : 'Already at the defaults',
          onclick: () => {
            entry.colorHex = def.color;
            entry.tuning = defaultTuning(entry.materialId);
            emit('materials');
          },
        },
        icon('undo', 15),
        'Reset to defaults',
      ),
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
            partList(
              state.parts,
              (part) => {
                const owner = materialEntryOf(part.id);
                return [
                  h('input', {
                    type: 'checkbox',
                    checked: owner === entry,
                    onchange: (event) =>
                      setPartsAssigned(entry, identicalParts(part).map((p) => p.id), event.target.checked),
                  }),
                  h('span', { class: 'part-name' }, part.label),
                  owner && owner !== entry ? h('span', { class: 'part-owner' }, materialEntryLabel(owner)) : null,
                ];
              },
              actions,
            ),
          ],
          { open: false },
        ),
      ]),
      deleteButton('Delete material', () => {
        removeMaterial(entry.id);
        select('materials');
      }),
    ],
  };
}

// --- Scene ------------------------------------------------------------------------

function scenePanel({ actions }) {
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

  return {
    title: 'Scene',
    body: [
      segmented(
        'Background',
        [
          ['color', 'Colour'],
          ['environment', 'Scene'],
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
                : 'The lighting studio shows behind the model. For a photo background, load an HDRI file.',
            ),
            h('button', { onclick: actions.loadHdri }, state.lighting.presetId === 'custom' ? 'Other HDRI file …' : 'Load HDRI file …'),
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
                  h(
                    'div',
                    { class: 'field-grid two' },
                    colorField(scene.gradientType === 'radial' ? 'Centre' : 'Top', 'gradientFrom'),
                    colorField(scene.gradientType === 'radial' ? 'Edge' : 'Bottom', 'gradientTo'),
                  ),
                ]
              : null,
          ],
      environment
        ? null
        : group('scene-floor', 'Floor', [
            field('Shape', selectControl(Object.entries(FLOORS), scene.floor, set('floor'))),
            scene.floor === 'cove' ? colorField('Colour of the cove', 'coveColor') : null,
            scene.floor === 'shadow' ? h('p', { class: 'hint' }, 'The floor blends into the background and only shows shadows and reflections.') : null,
          ]),
      !environment && scene.floor !== 'none'
        ? group('scene-reflection', 'Reflections', [
            slider('Reflection', {
              min: 0,
              max: 100,
              value: Math.round(scene.reflection * 100),
              format: (value) => (value === 0 ? 'off' : percent(value)),
              title: 'How strongly the floor mirrors the model and the light. On a dark background a dark lighting preset fits',
              oninput: (value) => set('reflection', true)(value / 100),
              onchange: () => emit('scene'),
            }),
            scene.reflection > 0
              ? slider('Blur', {
                  min: 0,
                  max: 100,
                  value: Math.round(scene.reflectionBlur * 100),
                  format: (value) => (value === 0 ? 'sharp mirror' : percent(value)),
                  title: 'Sharp like a mirror, or soft like a glossy surface',
                  oninput: (value) => set('reflectionBlur', true)(value / 100),
                })
              : null,
          ])
        : null,
    ],
  };
}

// --- Lighting -----------------------------------------------------------------------

const evFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, signDisplay: 'exceptZero' });

function lightingPanel({ actions }) {
  const { lighting } = state;
  return {
    title: 'Lighting',
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
            h('div', { class: 'file-name' }, lighting.hdriName),
            h('button', { onclick: actions.loadHdri }, 'Other HDRI file …'),
          ]
        : null,
      slider('Rotation', {
        min: -180,
        max: 180,
        value: lighting.rotation,
        format: (value) => `${value}°`,
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
        value: Math.round(Math.log2(lighting.intensity) * 3),
        format: (value) => `${evFormat.format(value / 3)} EV`,
        title: 'Brighter or darker in stops; the background stays',
        oninput: (value) => {
          lighting.intensity = 2 ** (value / 3);
          emit('lighting:live');
        },
      }),
      h('button', { class: 'primary', onclick: actions.addLight }, 'Add softbox'),
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
    slider(label, { min, max, value: light[key], format: (value) => `${value}°`, title, oninput: set(key) });
  // Power on a logarithmic slider from 0.1 to 1000.
  const toSlider = (power) => Math.round(Math.log10(Math.max(power, 0.1)) * 50);
  const fromSlider = (value) => Number((10 ** (value / 50)).toPrecision(2));
  const picking = actions.isPickingHighlight(light);

  return {
    title: light.name,
    body: [
      textField('Name', light.name, (value) => {
        light.name = value || 'Softbox';
        emit('lighting:live');
      }),
      toggle('Active', light.enabled, set('enabled', false)),
      group('light-position', 'Position', [
        h(
          'button',
          {
            class: picking ? 'active' : '',
            onclick: () => actions.pickHighlight(light),
            title: 'Places the softbox so that its highlight lands on the clicked point',
          },
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
          format: (value) => `${value}°`,
          title: 'Larger softboxes give softer shadows at the same amount of light',
          oninput: set('width'),
        }),
        slider('Height', {
          min: 1,
          max: MAX_LIGHT_SIZE,
          step: SIZE_STEPS,
          value: light.height,
          format: (value) => `${value}°`,
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
          format: (value) => numberFormat.format(fromSlider(value)),
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
      deleteButton('Delete softbox', () => {
        state.lighting.lights = state.lighting.lights.filter((other) => other !== light);
        select('lighting');
      }),
    ],
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
  const focalText = (focal) => (viewer.parallel ? 'parallel' : `${Math.round(focal)} mm`);
  const focal = slider('Focal length', {
    min: 0,
    max: 100,
    step: 0.5,
    value: toSlider(clampFocal(viewer.focalLength)),
    format: (value) => focalText(fromSlider(value)),
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

  const focusText = h('p', { class: 'hint' });
  const updateFocus = () => {
    focusText.textContent = `Focus: ${camera.focusPoint ? 'chosen point' : 'pivot'} · ${numberFormat.format(
      Math.round(actions.focusDistance()),
    )} mm`;
  };
  updateFocus();
  const picking = actions.isPickingFocus();

  return {
    title: 'Camera',
    body: [
      focal,
      toggle('Parallel projection', parallel, (checked) => {
        viewer.setParallel(checked);
        emit('views');
      }),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => viewer.fit() }, 'Fit'),
        h('button', { onclick: () => viewer.home() }, 'Default view'),
      ),
      guidesControls(actions),
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
      group(
        'depth-of-field',
        'Depth of field',
        [
          toggle(
            'Use in the rendering',
            camera.dof,
            (checked) => {
              camera.dof = checked;
              emit('camera');
            },
            'The real-time view stays sharp',
          ),
          camera.dof
            ? [
                slider('Aperture', {
                  min: 0,
                  max: F_STOPS.length - 1,
                  value: Math.max(F_STOPS.indexOf(camera.fStop), 0),
                  format: (value) => `f/${F_STOPS[value]}`,
                  title: 'A small f-number means more blur',
                  oninput: (value) => {
                    camera.fStop = F_STOPS[value];
                    emit('camera:live');
                  },
                }),
                focusText,
                h(
                  'div',
                  { class: 'button-row' },
                  h(
                    'button',
                    { class: picking ? 'active' : '', onclick: actions.pickFocus },
                    picking ? 'Click a point …' : 'Pick focus',
                  ),
                  camera.focusPoint
                    ? h(
                        'button',
                        {
                          onclick: () => {
                            camera.focusPoint = null;
                            emit('camera');
                          },
                        },
                        'Reset',
                      )
                    : null,
                ),
              ]
            : null,
        ],
        { open: camera.dof },
      ),
      explodeControls(),
      h('button', { class: 'primary', onclick: actions.addView }, 'Save view'),
    ],
    live: () => {
      const current = viewer.getPose();
      for (const key of Object.keys(boxes)) boxes[key].set(current[key]);
      targetBoxes.forEach((box, i) => box.set(current.target[i]));
      const length = viewer.focalLength;
      focal.set(toSlider(clampFocal(length)), focalText(length));
      updateFocus();
    },
  };
}

/** Exploded view: how far apart the parts move, in which direction and from where. */
function explodeControls() {
  if (state.parts.length < 2) return null;
  const { explode } = state;
  const own = Object.keys(explode.parts || {}).length;
  return group(
    'explode',
    'Exploded view',
    [
      slider('Distance', {
        min: 0,
        max: 150,
        step: 1,
        value: Math.round(explode.amount * 100),
        format: (value) => (value === 0 ? 'assembled' : percent(value)),
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
    ],
    { open: explode.amount > 0, title: 'Pulls the parts of an assembly apart to show how it is built' },
  );
}

function viewPanel(view, { viewer, actions }) {
  return {
    title: view.name,
    body: [
      textField('Name', view.name, (value) => {
        view.name = value || 'View';
        emit('views:live');
      }),
      h('button', { onclick: () => actions.showView(view) }, 'Show'),
      h(
        'button',
        {
          onclick: () => {
            Object.assign(view, viewer.getViewState(), { explode: structuredClone(state.explode) });
            emit('views');
          },
        },
        'Overwrite with the current view',
      ),
      deleteButton('Delete view', () => {
        state.views = state.views.filter((other) => other !== view);
        select('views');
      }),
    ],
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
    group('job-file', 'File', [
      field(
        'File format',
        selectControl(
          Object.entries(FILE_FORMATS).map(([key, value]) => [key, value.label]),
          settings.format,
          set('format'),
        ),
      ),
      toggle('Transparent background', settings.transparent, set('transparent'), 'Without background and floor; PNG only'),
      settings.transparent && settings.format === 'jpg'
        ? h('p', { class: 'hint' }, 'JPG has no transparency: images are put on white when saved.')
        : null,
    ]),
  ];
}

function deviceGroup() {
  const { output } = state;
  const set = (key) => (value) => {
    output[key] = value;
    emit('output');
  };
  return group(
    'output-device',
    'Rendering device',
    [
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
    ],
    { open: false },
  );
}

function jobSummary(job, actions) {
  const { width, height } = actions.resolveOutputSize(job);
  return job.type === 'animation' ? `${job.turntableFrames} images · ${width} × ${height}` : `${width} × ${height}`;
}

function outputPanel({ actions }) {
  const jobs = state.jobs;
  const views = state.views.length;
  return {
    title: 'Output',
    body: [
      h(
        'p',
        { class: 'hint' },
        'A render job keeps its camera, explosion and image settings. Set up as many as you like, then render them all.',
      ),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => actions.addJob('image') }, icon('image', 15), 'Image'),
        h('button', { onclick: actions.addAnimationJob }, icon('film', 15), 'Animation'),
      ),
      views > 0
        ? h(
            'button',
            { onclick: actions.jobsFromViews, title: 'One image job for each saved view that has none yet' },
            `Jobs from saved views (${views})`,
          )
        : null,
      jobs.length > 0
        ? h(
            'ul',
            { class: 'item-list' },
            jobs.map((job) =>
              h(
                'li',
                { tabIndex: 0, onclick: () => select(`job:${job.id}`), onkeydown: (event) => event.key === 'Enter' && select(`job:${job.id}`) },
                icon(job.type === 'animation' ? 'film' : 'image', 15),
                h('span', { class: 'item-name' }, job.name),
                h('span', { class: 'item-detail' }, jobSummary(job, actions)),
              ),
            ),
          )
        : null,
      actions.renderSupported
        ? h(
            'button',
            { class: 'primary', onclick: actions.renderAllJobs, disabled: jobs.length === 0 },
            jobs.length > 1 ? `Render all ${jobs.length} jobs` : 'Render job',
          )
        : h('p', { class: 'hint error' }, NO_WEBGPU),
      deviceGroup(),
    ],
  };
}

/** Guide lines over the image area, for lining up the model. */
function guidesControls(actions) {
  const guides = actions.guides();
  return [
    toggle('Guide lines', guides.visible, (checked) => actions.setGuides({ visible: checked }), 'Lines over the image area for lining up the model; they are not rendered (G)'),
    guides.visible
      ? field('Lines', selectControl(Object.entries(GUIDE_TYPES), guides.type, (value) => actions.setGuides({ type: value })))
      : null,
  ];
}

function jobPanel(job, { actions }) {
  const changed = () => actions.jobChanged(job);
  const set = (key) => (value) => {
    job[key] = value;
    changed();
  };
  return {
    title: job.name,
    body: [
      textField('Name', job.name, (value) => {
        job.name = value || 'Render job';
        emit('jobs:live');
      }),
      segmented(
        'Render',
        [
          ['image', 'Image', 'image'],
          ['animation', 'Turntable', 'film'],
        ],
        job.type,
        set('type'),
      ),
      h(
        'p',
        { class: 'hint' },
        'While this job is open it takes the camera along: move the view until the frame shows what you want.',
      ),
      h(
        'button',
        { onclick: () => actions.fit(), title: 'The dashed frame in the viewport shows the image' },
        'Fit the model into the frame',
      ),
      guidesControls(actions),
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
      explodeControls(),
      actions.renderSupported
        ? h('button', { class: 'primary', onclick: () => actions.renderJob(job) }, job.type === 'animation' ? 'Render this turntable' : 'Render this image')
        : h('p', { class: 'hint error' }, NO_WEBGPU),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => actions.duplicateJob(job) }, icon('copy', 15), 'Duplicate'),
        h('button', { class: 'danger', onclick: () => actions.deleteJob(job) }, icon('trash', 15), 'Delete'),
      ),
    ],
  };
}

// --- Renders --------------------------------------------------------------------

function rendersPanel({ actions }) {
  if (!actions.renderSupported) {
    return { title: 'Renders', editable: false, body: [h('p', { class: 'hint error' }, NO_WEBGPU)] };
  }
  const done = state.renders.filter((render) => render.status === 'done').length;
  const queued = state.renders.filter((render) => render.status === 'queued').length;
  const running = state.renders.some((render) => render.status === 'running');
  return {
    title: 'Renders',
    editable: false,
    body: [
      state.renders.length === 0
        ? h('p', { class: 'hint' }, 'Set up render jobs under Output and render them. Finished images stay with the project.')
        : h(
            'p',
            { class: 'hint' },
            [
              running ? 'One rendering is running' : null,
              queued > 0 ? `${queued} waiting` : null,
              done > 0 ? `${done} done` : null,
            ]
              .filter(Boolean)
              .join(' · '),
          ),
      h('button', { onclick: () => select('output') }, 'Go to the render jobs'),
      queued > 0 ? h('button', { class: 'danger', onclick: actions.cancelQueue }, `Clear the queue (${queued})`) : null,
      done > 0
        ? group('renders-save', 'Save all', [
            h(
              'div',
              { class: 'button-row' },
              Object.entries(FILE_FORMATS).map(([key, value]) =>
                h('button', { onclick: () => actions.saveAllRenders(key) }, `${value.extension.toUpperCase()} (ZIP)`),
              ),
            ),
            h('p', { class: 'hint' }, 'All finished renderings with their adjustments, turntables in folders of their own.'),
          ])
        : null,
    ],
  };
}

/** Sliders for the image adjustments of a finished rendering. */
function adjustControls(render) {
  render.adjust ??= defaultAdjust();
  const sliders = Object.entries(ADJUSTMENTS).map(([key, spec]) =>
    slider(spec.label, {
      min: spec.min,
      max: spec.max,
      value: render.adjust[key] || 0,
      format: (value) => (value > 0 && spec.min < 0 ? `+${value}` : String(value)),
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
  const buttons = h('div', { class: 'button-column' });
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
      format: (value) => `${value} of ${frames}`,
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
    buttons.append(h('button', { class: 'danger', onclick: () => actions.deleteRender(render) }, 'Take out of the queue'));
  } else {
    if (render.status === 'done') {
      const chosen = render.format || 'png';
      if (count) {
        if (videoSupported()) {
          buttons.append(
            h(
              'button',
              { class: 'primary', onclick: () => actions.saveVideo(render), title: 'Recorded in real time; keep this tab in front' },
              'Save video',
            ),
          );
        }
        buttons.append(
          h(
            'button',
            { onclick: () => actions.saveRender(render, chosen) },
            `Save images (${FILE_FORMATS[chosen].extension.toUpperCase()}, ZIP)`,
          ),
        );
      } else {
        // The format chosen in the job comes first.
        for (const format of [chosen, ...Object.keys(FILE_FORMATS).filter((key) => key !== chosen)]) {
          buttons.append(
            h(
              'button',
              { class: format === chosen ? 'primary' : null, onclick: () => actions.saveRender(render, format) },
              `Save ${FILE_FORMATS[format].extension.toUpperCase()}`,
            ),
          );
        }
      }
    }
    buttons.append(h('button', { class: 'danger', onclick: () => actions.deleteRender(render) }, 'Delete rendering'));
  }
  update();

  return {
    title: render.name,
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
      buttons,
    ],
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
export function renderPanel(container, context) {
  const key = state.selected;
  const [kind, idText] = key.split(':');
  const id = Number(idText);
  let panel = null;

  if (key === 'geometry') panel = geometryPanel(context);
  else if (state.parts.length === 0) panel = null;
  else if (key === 'parts') panel = partsPanel(context);
  else if (kind === 'part') panel = state.parts[id] ? partPanel(state.parts[id], context) : null;
  else if (key === 'sections') panel = sectionsPanel(context);
  else if (kind === 'section') {
    const section = state.sections.find((item) => item.id === id);
    panel = section ? sectionPanel(section, context) : null;
  } else if (key === 'materials') panel = materialsPanel(context);
  else if (key === 'material:cad') panel = cadMaterialPanel(context);
  else if (kind === 'material') {
    const entry = state.materials.find((item) => item.id === id);
    panel = entry ? materialPanel(entry, context) : null;
  } else if (key === 'scene') panel = scenePanel(context);
  else if (key === 'lighting') panel = lightingPanel(context);
  else if (kind === 'light') {
    const light = state.lighting.lights.find((item) => item.id === id);
    panel = light ? lightPanel(light, context) : null;
  } else if (key === 'views') panel = viewsPanel(context);
  else if (kind === 'view') {
    const view = state.views.find((item) => item.id === id);
    panel = view ? viewPanel(view, context) : null;
  } else if (key === 'output') panel = outputPanel(context);
  else if (kind === 'job') {
    const job = state.jobs.find((item) => item.id === id);
    panel = job ? jobPanel(job, context) : null;
  } else if (key === 'renders') panel = rendersPanel(context);
  else if (kind === 'render') {
    const render = state.renders.find((item) => item.id === id);
    panel = render ? renderPanelFor(render, context) : null;
  }

  container.hidden = !panel;
  if (!panel) {
    container.replaceChildren();
    return null;
  }

  const { actions } = context;
  const editable = context.editable && panel.editable !== false;
  const headerButton = (name, title, run, className = 'icon-button') =>
    h('button', { class: className, title, 'aria-label': title, onclick: run }, icon(name, 16));
  const scroll = container.querySelector('.panel-body')?.scrollTop ?? 0;
  const body = h('div', { class: 'panel-body' }, panel.body);
  container.replaceChildren(
    h(
      'header',
      { class: 'panel-header' },
      h('h2', { title: panel.title }, panel.title),
      editable
        ? [
            headerButton('check', 'Keep changes and close', actions.applyPanel, 'icon-button apply'),
            headerButton('close', 'Discard changes made in this panel', actions.discardPanel, 'icon-button discard'),
          ]
        : headerButton('close', 'Close', actions.closePanel),
    ),
    body,
  );
  body.scrollTop = container.dataset.key === key ? scroll : 0;
  container.dataset.key = key;
  return panel.live || null;
}
