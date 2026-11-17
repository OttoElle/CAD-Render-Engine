import { h } from './dom.js';
import { icon } from './icons.js';
import {
  state,
  emit,
  select,
  withIds,
  FLOORS,
  QUALITY,
  OUTPUT_SIZES,
  RENDER_DEVICES,
  TURNTABLE_FRAMES,
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
import { EXPLODE_DIRECTIONS } from './explode.js';
import { FILE_FORMATS, TURN_SECONDS, videoSupported } from './export.js';

const numberFormat = new Intl.NumberFormat('de-DE');
const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];
const FOCAL_MIN = 15;
const FOCAL_MAX = 200;

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

/** A labelled on/off switch. */
function toggle(label, checked, onchange, title) {
  return h(
    'label',
    { class: 'field toggle', title },
    h('span', null, label),
    h('input', { type: 'checkbox', role: 'switch', checked, onchange: (event) => onchange(event.target.checked) }),
  );
}

/** A range slider with its value shown next to the label. Returns the field; `set(value)` updates it from outside. */
function slider(label, { min, max, step = 1, value, format, oninput, onchange, disabled, title }) {
  const output = h('output', null, format(value));
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
    disabled,
    oninput: (event) => {
      const next = Number(event.target.value);
      output.textContent = format(next);
      oninput(next);
    },
    // Fires once the slider is let go, for updates too costly to run while dragging.
    onchange: onchange ? () => onchange(Number(input.value)) : null,
  });
  const node = h('label', { class: 'field', title }, h('span', { class: 'field-label' }, label, output), input);
  node.set = (next, text) => {
    if (document.activeElement !== input) input.value = next;
    output.textContent = text ?? format(next);
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

/** A button that asks for a second click before it runs. */
function confirmButton(label, run) {
  let armed = false;
  let timer = null;
  const node = h(
    'button',
    {
      class: 'danger',
      onclick: () => {
        if (armed) return run();
        armed = true;
        node.textContent = 'Wirklich löschen?';
        timer = setTimeout(() => {
          armed = false;
          node.textContent = label;
        }, 3000);
        return timer;
      },
    },
    label,
  );
  return node;
}

function formatDuration(seconds) {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

const plural = (count, one, many) => `${numberFormat.format(count)} ${count === 1 ? one : many}`;

// --- Panels -------------------------------------------------------------------

function projectPanel({ actions }) {
  const currentName = h('span', { class: 'item-name' }, state.project.name);
  const templateName = h('input', {
    type: 'text',
    placeholder: 'Name der Vorlage',
    onkeydown: (event) => event.key === 'Enter' && saveTemplate(),
  });
  function saveTemplate() {
    const name = templateName.value.trim();
    if (!name) {
      templateName.focus();
      return;
    }
    actions.saveTemplate(name);
  }

  return {
    title: 'Projekt',
    body: [
      field(
        'Name',
        h('input', {
          type: 'text',
          value: state.project.name,
          oninput: (event) => {
            state.project.name = event.target.value;
            emit('project:live');
          },
        }),
      ),
      h('h3', null, 'Projekte'),
      h(
        'ul',
        { class: 'item-list' },
        state.projects.map((project) => {
          const current = project.id === state.project.id;
          return h(
            'li',
            {
              class: current ? 'current' : '',
              role: 'button',
              tabIndex: 0,
              title: current ? 'Geöffnet' : 'Projekt öffnen',
              onclick: () => !current && actions.switchProject(project.id),
            },
            current ? currentName : h('span', { class: 'item-name' }, project.name),
            h('span', { class: 'item-detail' }, project.fileName || 'ohne Geometrie'),
          );
        }),
      ),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: actions.newProject }, 'Neu'),
        h('button', { onclick: actions.duplicateProject }, 'Duplizieren'),
        confirmButton('Löschen', actions.deleteProject),
      ),
      h('h3', null, 'Vorlagen'),
      state.templates.length > 0
        ? h(
            'ul',
            { class: 'item-list static' },
            state.templates.map((template) =>
              h(
                'li',
                null,
                h('span', { class: 'item-name' }, template.name),
                h('button', { class: 'small', onclick: () => actions.applyTemplate(template.id) }, 'Anwenden'),
                h(
                  'button',
                  {
                    class: 'icon-button',
                    title: 'Vorlage löschen',
                    'aria-label': 'Vorlage löschen',
                    onclick: () => actions.deleteTemplate(template.id),
                  },
                  icon('trash', 15),
                ),
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'input-row', title: 'Speichert Materialien, Szene, Licht, Kamera und Output zur Wiederverwendung in anderen Projekten' },
        templateName,
        h('button', { onclick: saveTemplate }, 'Speichern'),
      ),
    ],
    live: () => {
      currentName.textContent = state.project.name;
    },
  };
}

function geometryPanel({ actions }) {
  if (state.parts.length === 0) {
    return {
      title: 'Geometrie',
      body: [h('button', { class: 'primary', onclick: actions.openFile }, 'STEP-Datei öffnen …')],
    };
  }

  const triangles = state.parts.reduce((sum, part) => sum + part.triangles, 0);
  const hidden = state.parts.filter((part) => !part.mesh.visible).length;
  return {
    title: 'Geometrie',
    body: [
      h('div', { class: 'file-name' }, state.fileName),
      h(
        'p',
        { class: 'hint' },
        `${plural(state.parts.length, 'Bauteil', 'Bauteile')} · ${plural(triangles, 'Dreieck', 'Dreiecke')}` +
          (hidden > 0 ? ` · ${hidden} ausgeblendet` : ''),
      ),
      hidden > 0 ? h('button', { onclick: actions.showAllParts }, 'Alle einblenden') : null,
      h('button', { onclick: actions.openFile }, 'Andere STEP-Datei öffnen …'),
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

  return {
    title: part.label,
    body: [
      toggle('Sichtbar', part.mesh.visible, () => actions.togglePart(part.id)),
      field(
        'Material',
        selectControl(
          [
            ['cad', 'CAD-Farbe'],
            ...state.materials.map((item) => [String(item.id), materialEntryLabel(item)]),
            ['new', 'Neues Material …'],
          ],
          entry ? String(entry.id) : 'cad',
          assign,
        ),
      ),
      copies > 1
        ? toggle(`Gleiche Bauteile gemeinsam (${copies})`, linkIdentical, (checked) => {
            linkIdentical = checked;
          })
        : null,
      entry ? h('button', { onclick: () => select(`material:${entry.id}`) }, 'Material bearbeiten') : null,
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => actions.isolatePart(part.id) }, 'Nur dieses zeigen'),
        h('button', { onclick: actions.showAllParts }, 'Alle einblenden'),
      ),
      h('p', { class: 'hint' }, plural(part.triangles, 'Dreieck', 'Dreiecke')),
    ],
  };
}

function sectionsPanel({ actions }) {
  const cap = state.sectionCap;
  return {
    title: 'Schnitte',
    body: [
      h('button', { class: 'primary', onclick: actions.addSection }, 'Schnitt anlegen'),
      field(
        'Schnittflächen',
        selectControl(
          [
            ['material', 'Wie das Bauteil'],
            ['color', 'Eigene Farbe'],
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
            'Farbe',
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
  const positionBox = numberBox('Position mm', {
    value: section.position,
    step: Number(step.toPrecision(1)),
    digits: 2,
    onchange: (value) => {
      section.position = value;
      emit('sections');
    },
  });
  const set = (key) => (value) => {
    section[key] = value;
    emit('sections');
  };

  return {
    title: 'Schnitt',
    body: [
      field(
        'Name',
        h('input', {
          type: 'text',
          value: section.name,
          oninput: (event) => {
            section.name = event.target.value || 'Schnitt';
            emit('sections:live');
          },
        }),
      ),
      toggle('Aktiv', section.enabled, set('enabled')),
      field(
        'Ebene senkrecht zu',
        selectControl(
          [
            ['0', 'X-Achse'],
            ['1', 'Y-Achse'],
            ['2', 'Z-Achse'],
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
        oninput: (value) => {
          section.position = value;
          positionBox.set(value);
          emit('sections:live');
        },
      }),
      positionBox,
      toggle('Andere Seite zeigen', section.flip, set('flip')),
      state.parts.length > 1
        ? [
            h(
              'h3',
              { title: 'Abgewählte Bauteile bleiben ganz, zum Beispiel Schrauben oder Wellen' },
              `Geschnittene Bauteile (${state.parts.length - section.uncut.size})`,
            ),
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
                'Alle',
              ),
              h(
                'button',
                {
                  onclick: () => {
                    for (const part of state.parts) section.uncut.add(part.id);
                    emit('sections');
                  },
                },
                'Keine',
              ),
            ),
            toggle('Gleiche Bauteile gemeinsam', linkIdentical, (checked) => {
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
          ]
        : null,
      h(
        'button',
        {
          class: 'danger',
          onclick: () => {
            state.sections = state.sections.filter((other) => other !== section);
            select('sections');
          },
        },
        'Schnitt löschen',
      ),
    ],
  };
}

function materialsPanel({ actions }) {
  return {
    title: 'Materialien',
    body: [
      h('button', { class: 'primary', onclick: actions.addMaterial }, 'Material anlegen'),
      h('p', { class: 'hint' }, 'Bauteile ohne Material behalten ihre CAD-Farbe.'),
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
    title: 'CAD-Farben',
    body: [
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
      format: (value) => `${value} %`,
      title,
      oninput: (value) => tune(key)(value / 100),
      onchange: () => emit('materials'),
    });
  const modified = entry.colorHex !== def.color || !isDefaultTuning(entry.materialId, tuning);

  return {
    title: 'Material',
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
        'Farbe',
        h('input', {
          type: 'color',
          value: entry.colorHex,
          oninput: (event) => {
            entry.colorHex = event.target.value;
            emit('materials:live');
          },
        }),
      ),
      tuneSlider('Rauheit', 'roughness', 'Niedrig spiegelt, hoch streut das Licht'),
      tuneSlider('Metallisch', 'metalness', 'Metalle stehen auf 100 %, Kunststoffe und Lacke auf 0 %'),
      tuneSlider('Klarlack', 'clearcoat', 'Glänzende Schicht über dem Material'),
      field(
        'Oberfläche',
        selectControl(
          Object.entries(FINISHES).map(([key, value]) => [key, value.label]),
          tuning.finish,
          tune('finish', false),
        ),
      ),
      tuning.finish !== 'none'
        ? [
            field(
              tuning.finish === 'turned' ? 'Drehachse' : 'Schliffrichtung',
              selectControl(Object.entries(FINISH_AXES), tuning.finishAxis, tune('finishAxis', false)),
            ),
            slider('Ausprägung', {
              min: 0,
              max: 100,
              value: Math.round(tuning.finishStrength * 100),
              format: (value) => `${value} %`,
              title: 'Wie stark die Spiegelungen quer zu den Riefen verwischen',
              oninput: (value) => tune('finishStrength')(value / 100),
              onchange: () => emit('materials'),
            }),
          ]
        : null,
      modified
        ? h(
            'button',
            {
              class: 'link',
              onclick: () => {
                entry.colorHex = def.color;
                entry.tuning = defaultTuning(entry.materialId);
                emit('materials');
              },
            },
            'Auf Vorgabe zurücksetzen',
          )
        : null,
      h('h3', { title: 'Hier anhaken oder direkt im Modell anklicken' }, `Bauteile (${entry.partIds.size})`),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => setPartsAssigned(entry, state.parts.map((p) => p.id), true) }, 'Alle'),
        h('button', { onclick: () => setPartsAssigned(entry, [...entry.partIds], false) }, 'Keine'),
      ),
      toggle('Gleiche Bauteile gemeinsam', linkIdentical, (checked) => {
        linkIdentical = checked;
      }),
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
      h(
        'button',
        {
          class: 'danger',
          onclick: () => {
            removeMaterial(entry.id);
            select('materials');
          },
        },
        'Material löschen',
      ),
    ],
  };
}

function scenePanel() {
  const { scene } = state;
  const isCustom = scene.background.startsWith('#');
  const environment = scene.background === 'environment';
  const set = (key, live = false) => (value) => {
    scene[key] = value;
    emit(live ? 'scene:live' : 'scene');
  };
  const colorField = (label, key) =>
    field(label, h('input', { type: 'color', value: scene[key], oninput: (event) => set(key, true)(event.target.value) }));

  return {
    title: 'Szene',
    body: [
      field(
        'Hintergrund',
        selectControl(
          [
            ['light', 'Hell'],
            ['white', 'Weiß'],
            ['grey', 'Grau'],
            ['dark', 'Dunkel'],
            ['custom', 'Eigene Farbe'],
            ['gradient', 'Farbverlauf'],
            ...(state.lighting.presetId === 'custom' ? [['environment', 'HDRI-Umgebung']] : []),
          ],
          isCustom ? 'custom' : scene.background,
          (value) => set('background')(value === 'custom' ? '#dfe6ee' : value),
        ),
      ),
      isCustom
        ? field(
            'Farbe',
            h('input', {
              type: 'color',
              value: scene.background,
              oninput: (event) => set('background', true)(event.target.value),
            }),
          )
        : null,
      scene.background === 'gradient'
        ? [
            field(
              'Verlauf',
              selectControl(
                [
                  ['linear', 'Von oben nach unten'],
                  ['radial', 'Von der Mitte nach außen'],
                ],
                scene.gradientType,
                set('gradientType'),
              ),
            ),
            h(
              'div',
              { class: 'field-grid two' },
              colorField(scene.gradientType === 'radial' ? 'Mitte' : 'Oben', 'gradientFrom'),
              colorField(scene.gradientType === 'radial' ? 'Rand' : 'Unten', 'gradientTo'),
            ),
          ]
        : null,
      environment
        ? null
        : [
            field(
              'Boden',
              selectControl(Object.entries(FLOORS), scene.floor, set('floor')),
            ),
            scene.floor === 'cove' ? colorField('Farbe der Hohlkehle', 'coveColor') : null,
            scene.floor !== 'none'
              ? [
                  slider('Spiegelung', {
                    min: 0,
                    max: 100,
                    value: Math.round(scene.reflection * 100),
                    format: (value) => `${value} %`,
                    title: 'Der Boden spiegelt Modell und Licht. Auf dunklem Hintergrund passt eine dunkle Lichtvorlage',
                    oninput: (value) => set('reflection', true)(value / 100),
                    onchange: () => emit('scene'),
                  }),
                  scene.reflection > 0
                    ? slider('Unschärfe der Spiegelung', {
                        min: 0,
                        max: 100,
                        value: Math.round(scene.reflectionBlur * 100),
                        format: (value) => `${value} %`,
                        title: 'Nur im Rendering sichtbar',
                        oninput: (value) => set('reflectionBlur', true)(value / 100),
                      })
                    : null,
                ]
              : null,
          ],
    ],
  };
}

const evFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, signDisplay: 'exceptZero' });

function lightingPanel({ actions }) {
  const { lighting } = state;
  return {
    title: 'Beleuchtung',
    body: [
      field(
        'Vorlage',
        selectControl(
          [...LIGHT_PRESETS.map((preset) => [preset.id, preset.label]), ['custom', 'Eigene HDRI-Datei …']],
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
            if (state.scene.background === 'environment') state.scene.background = 'light';
            emit('lighting');
          },
        ),
      ),
      lighting.presetId === 'custom'
        ? [
            h('div', { class: 'file-name' }, lighting.hdriName),
            h('button', { onclick: actions.loadHdri }, 'Andere HDRI-Datei …'),
          ]
        : null,
      slider('Drehung', {
        min: -180,
        max: 180,
        value: lighting.rotation,
        format: (value) => `${value}°`,
        title: 'Dreht alle Lichter um das Modell',
        oninput: (value) => {
          lighting.rotation = value;
          emit('lighting:live');
        },
      }),
      // Exposure in thirds of a stop, like a camera. Each stop doubles the light.
      slider('Belichtung', {
        min: -9,
        max: 9,
        value: Math.round(Math.log2(lighting.intensity) * 3),
        format: (value) => `${evFormat.format(value / 3)} EV`,
        title: 'Heller oder dunkler in Blendenstufen, der Hintergrund bleibt',
        oninput: (value) => {
          lighting.intensity = 2 ** (value / 3);
          emit('lighting:live');
        },
      }),
      h('button', { class: 'primary', onclick: actions.addLight }, 'Softbox anlegen'),
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
    title: 'Softbox',
    body: [
      field(
        'Name',
        h('input', {
          type: 'text',
          value: light.name,
          oninput: (event) => {
            light.name = event.target.value || 'Softbox';
            emit('lighting:live');
          },
        }),
      ),
      toggle('Aktiv', light.enabled, set('enabled', false)),
      h(
        'button',
        {
          class: picking ? 'active' : '',
          onclick: () => actions.pickHighlight(light),
          title: 'Setzt die Softbox so, dass ihr Glanzlicht auf dem angeklickten Punkt liegt',
        },
        picking ? 'Punkt im Modell anklicken …' : 'Glanzlicht setzen',
      ),
      angle('Richtung', 'az', -180, 180, '0° ist vorne, 90° rechts'),
      angle('Höhe', 'el', -30, 90, '0° ist auf Höhe des Modells, 90° direkt darüber'),
      slider('Breite', {
        min: 1,
        max: MAX_LIGHT_SIZE,
        step: SIZE_STEPS,
        value: light.width,
        format: (value) => `${value}°`,
        title: 'Größere Softboxen geben weichere Schatten bei gleicher Lichtmenge',
        oninput: set('width'),
      }),
      slider('Höhe der Fläche', {
        min: 1,
        max: MAX_LIGHT_SIZE,
        step: SIZE_STEPS,
        value: light.height,
        format: (value) => `${value}°`,
        oninput: set('height'),
      }),
      field(
        'Form',
        selectControl(
          [
            ['rect', 'Rechteckig'],
            ['round', 'Rund'],
          ],
          light.round ? 'round' : 'rect',
          (value) => set('round', false)(value === 'round'),
        ),
      ),
      slider('Leistung', {
        min: -50,
        max: 150,
        value: toSlider(light.power),
        format: (value) => numberFormat.format(fromSlider(value)),
        oninput: (value) => set('power')(fromSlider(value)),
      }),
      field(
        'Farbe',
        h('input', {
          type: 'color',
          value: light.color,
          oninput: (event) => set('color')(event.target.value),
        }),
      ),
      h(
        'button',
        {
          class: 'danger',
          onclick: () => {
            state.lighting.lights = state.lighting.lights.filter((other) => other !== light);
            select('lighting');
          },
        },
        'Softbox löschen',
      ),
    ],
  };
}

function viewsPanel({ viewer, actions }) {
  const { camera } = state;
  const pose = viewer.getPose();
  const parallel = viewer.parallel;

  // The focal length slider is logarithmic, so wide and long lenses get equal room.
  const toSlider = (focal) => (Math.log(focal / FOCAL_MIN) / Math.log(FOCAL_MAX / FOCAL_MIN)) * 100;
  const fromSlider = (value) => FOCAL_MIN * (FOCAL_MAX / FOCAL_MIN) ** (value / 100);
  const clampFocal = (focal) => Math.min(Math.max(focal, FOCAL_MIN), FOCAL_MAX);
  const focalText = (focal) => (viewer.parallel ? 'parallel' : `${Math.round(focal)} mm`);
  const focal = slider('Brennweite', {
    min: 0,
    max: 100,
    step: 0.5,
    value: toSlider(clampFocal(viewer.focalLength)),
    format: (value) => focalText(fromSlider(value)),
    disabled: parallel,
    title: 'Lange Brennweiten zeigen Bauteile mit wenig perspektivischer Verzerrung',
    oninput: (value) => viewer.setFocalLength(fromSlider(value)),
  });

  const boxes = {
    azimuth: numberBox('Drehung °', { value: pose.azimuth, step: 5, onchange: (value) => viewer.setPose({ azimuth: value }) }),
    elevation: numberBox('Höhe °', {
      value: pose.elevation,
      step: 5,
      min: -90,
      max: 90,
      onchange: (value) => viewer.setPose({ elevation: value }),
    }),
    roll: numberBox('Rollen °', { value: pose.roll, step: 5, onchange: (value) => viewer.setPose({ roll: value }) }),
    distance: numberBox('Abstand mm', {
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
    focusText.textContent = `Fokus: ${camera.focusPoint ? 'gewählter Punkt' : 'Drehpunkt'} · ${numberFormat.format(
      Math.round(actions.focusDistance()),
    )} mm`;
  };
  updateFocus();
  const picking = actions.isPickingFocus();

  return {
    title: 'Perspektive',
    body: [
      focal,
      toggle('Parallelprojektion', parallel, (checked) => {
        viewer.setParallel(checked);
        emit('views');
      }),
      h('h3', { title: '0° ist die Ansicht von vorne, 90° von rechts' }, 'Kamera'),
      h('div', { class: 'field-grid two' }, boxes.azimuth, boxes.elevation, boxes.roll, boxes.distance),
      h('h3', { title: 'Punkt im Modell, um den die Kamera dreht' }, 'Drehpunkt (mm)'),
      h('div', { class: 'field-grid three' }, targetBoxes),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => viewer.fit() }, 'Einpassen'),
        h('button', { onclick: () => viewer.home() }, 'Standardansicht'),
      ),
      h('h3', null, 'Tiefenunschärfe'),
      toggle(
        'Im Rendering anwenden',
        camera.dof,
        (checked) => {
          camera.dof = checked;
          emit('camera');
        },
        'Die Echtzeit-Ansicht bleibt scharf',
      ),
      camera.dof
        ? [
            slider('Blende', {
              min: 0,
              max: F_STOPS.length - 1,
              value: Math.max(F_STOPS.indexOf(camera.fStop), 0),
              format: (value) => `f/${F_STOPS[value]}`,
              title: 'Kleine Blendenzahl bedeutet stärkere Unschärfe',
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
                picking ? 'Punkt anklicken …' : 'Fokus wählen',
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
                    'Zurücksetzen',
                  )
                : null,
            ),
          ]
        : null,
      ...explodeControls(),
      h('button', { class: 'primary', onclick: actions.addView }, 'Ansicht speichern'),
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

/** Exploded view: how far apart the parts move, and in which direction. */
function explodeControls() {
  if (state.parts.length < 2) return [];
  const { explode } = state;
  return [
    h('h3', { title: 'Zieht die Bauteile einer Baugruppe auseinander, um ihren Aufbau zu zeigen' }, 'Explosionsansicht'),
    slider('Abstand', {
      min: 0,
      max: 150,
      step: 1,
      value: Math.round(explode.amount * 100),
      format: (value) => (value === 0 ? 'zusammengebaut' : `${value} %`),
      title: 'Wie weit die Bauteile auseinanderrücken: 100 % verdoppelt ihren Abstand zur Mitte der Baugruppe',
      oninput: (value) => {
        explode.amount = value / 100;
        emit('explode:live');
      },
      onchange: () => emit('explode'),
    }),
    field(
      'Richtung',
      selectControl(
        Object.entries(EXPLODE_DIRECTIONS),
        explode.direction,
        (value) => {
          explode.direction = value;
          emit('explode');
        },
      ),
    ),
  ];
}

function viewPanel(view, { viewer, actions }) {
  return {
    title: 'Gespeicherte Ansicht',
    body: [
      field(
        'Name',
        h('input', {
          type: 'text',
          value: view.name,
          oninput: (event) => {
            view.name = event.target.value || 'Ansicht';
            emit('views:live');
          },
        }),
      ),
      h('button', { onclick: () => actions.showView(view) }, 'Anzeigen'),
      h(
        'button',
        {
          onclick: () => {
            Object.assign(view, viewer.getViewState(), { explode: { ...state.explode } });
            emit('views');
          },
        },
        'Mit aktueller Ansicht überschreiben',
      ),
      h(
        'button',
        {
          class: 'danger',
          onclick: () => {
            state.views = state.views.filter((other) => other !== view);
            select('views');
          },
        },
        'Ansicht löschen',
      ),
    ],
  };
}

function outputPanel({ actions }) {
  const { output } = state;
  const size = actions.resolveOutputSize();
  const sizeInput = (key) =>
    h('input', {
      type: 'number',
      min: 64,
      max: 8192,
      step: 1,
      value: output[key],
      onchange: (event) => {
        output[key] = Math.min(Math.max(Math.round(Number(event.target.value) || 64), 64), 8192);
        emit('output');
      },
    });
  const set = (key) => (value) => {
    output[key] = value;
    emit('output');
  };

  return {
    title: 'Output',
    body: [
      field(
        'Bildgröße',
        selectControl(
          Object.entries(OUTPUT_SIZES).map(([key, value]) => [key, value.label]),
          output.size,
          set('size'),
        ),
        output.size === 'custom' ? null : `${size.width} × ${size.height}`,
      ),
      output.size === 'custom'
        ? h('div', { class: 'field-grid two' }, field('Breite px', sizeInput('width')), field('Höhe px', sizeInput('height')))
        : null,
      h(
        'button',
        { onclick: () => actions.fit(), title: 'Der Rahmen in der Ansicht zeigt den Bildausschnitt' },
        'Modell in den Ausschnitt einpassen',
      ),
      field(
        'Qualität',
        selectControl(
          Object.entries(QUALITY).map(([key, value]) => [key, `${value.label} (${value.samples} Samples)`]),
          output.quality,
          set('quality'),
        ),
      ),
      toggle('Transparenter Hintergrund', output.transparent, set('transparent'), 'PNG ohne Hintergrund und Boden'),
      field(
        'Dateiformat',
        selectControl(
          Object.entries(FILE_FORMATS).map(([key, value]) => [key, value.label]),
          output.format,
          set('format'),
        ),
      ),
      output.transparent && output.format === 'jpg'
        ? h('p', { class: 'hint' }, 'JPG kennt keine Transparenz: Bilder werden beim Speichern auf Weiß gesetzt.')
        : null,
      toggle('Entrauschen', output.denoise, set('denoise'), 'Glättet das Restrauschen am Ende des Renderings'),
      field(
        'Rendern auf',
        selectControl(
          Object.entries(RENDER_DEVICES).map(([key, value]) => [key, value.label]),
          output.device,
          set('device'),
        ),
      ),
      output.device === 'gpu'
        ? toggle(
            'Schonender Modus',
            output.gentle,
            set('gentle'),
            'Für Laptops und schwächere Grafikkarten: kleinere Portionen, dafür langsamer',
          )
        : h('p', { class: 'hint' }, 'Ohne Grafikkarte dauert ein Bild ein Vielfaches. Als Notlösung gedacht.'),
      ...renderButtons(actions),
    ],
  };
}

/** Buttons that start renderings: the current view, all saved views, or a turntable series. */
function renderButtons(actions) {
  if (!actions.renderSupported) {
    return [h('p', { class: 'hint error' }, 'Dieser Browser unterstützt kein WebGPU. Bitte Chrome oder Edge verwenden.')];
  }
  const { output } = state;
  const views = state.views.length;
  return [
    h('button', { class: 'primary', onclick: actions.startRender }, 'Rendering starten'),
    h('h3', null, 'Mehrere Bilder'),
    h(
      'button',
      {
        onclick: actions.renderAllViews,
        disabled: views === 0,
        title: views === 0 ? 'Unter „Perspektive“ lassen sich Ansichten speichern' : 'Rendert jede gespeicherte Ansicht nacheinander',
      },
      views === 0 ? 'Alle Ansichten rendern (noch keine gespeichert)' : `Alle ${views} Ansichten rendern`,
    ),
    field(
      'Drehteller',
      selectControl(
        TURNTABLE_FRAMES.map((frames) => [frames, `${frames} Bilder (alle ${numberFormat.format(360 / frames)}°)`]),
        output.turntableFrames,
        (value) => {
          output.turntableFrames = Number(value);
          emit('output');
        },
      ),
    ),
    h(
      'button',
      {
        onclick: actions.renderTurntable,
        title: 'Das Modell dreht sich einmal um die senkrechte Achse; Kamera und Licht bleiben stehen',
      },
      'Drehteller rendern',
    ),
    h(
      'p',
      { class: 'hint' },
      `Ein Drehteller wird als Video (eine Umdrehung in ${TURN_SECONDS} Sekunden) oder als Einzelbilder gespeichert. ` +
        'Je mehr Bilder, desto flüssiger das Video und desto länger das Rendern.',
    ),
  ];
}

function rendersPanel({ actions }) {
  const done = state.renders.filter((render) => render.status === 'done').length;
  const queued = state.renders.filter((render) => render.status === 'queued').length;
  const format = FILE_FORMATS[state.output.format].extension.toUpperCase();
  return {
    title: 'Renderings',
    body: [
      done > 0
        ? h(
            'button',
            { onclick: actions.saveAllRenders, title: 'Alle fertigen Bilder in einer ZIP-Datei, im Format aus „Output“' },
            `Alle fertigen Bilder speichern (${format}, ZIP)`,
          )
        : null,
      queued > 0 ? h('button', { class: 'danger', onclick: actions.cancelQueue }, `Warteschlange leeren (${queued})`) : null,
      ...renderButtons(actions),
    ],
  };
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
    return ` · noch etwa ${formatDuration(left)}`;
  };

  const update = () => {
    bar.firstChild.style.width = `${Math.round(render.progress * 100)}%`;
    bar.hidden = render.status !== 'running';
    device.hidden = !render.deviceName;
    device.textContent = render.deviceName ? `Gerendert auf: ${render.deviceName}` : '';
    const image = count ? `Bild ${render.frameIndex + 1} von ${count} · ` : '';
    if (render.status === 'running') {
      text.textContent =
        render.stage === 'rendering'
          ? `${image}Sample ${Math.floor(render.samples)} von ${render.targetSamples} · ${formatDuration(render.seconds)}${remaining()}`
          : render.stage === 'denoising'
            ? `${image}Entrauschen … · ${formatDuration(render.seconds)}${remaining()}`
            : `${image}Szene wird vorbereitet …`;
    } else if (render.status === 'queued') {
      text.textContent = 'Wartet, bis die Renderings davor fertig sind.';
    } else if (render.status === 'done') {
      text.textContent =
        `Fertig nach ${formatDuration(render.seconds)} · ` +
        (count ? `${render.frames.length} Bilder` : `${Math.round(render.samples)} Samples`) +
        (render.denoised ? ' · entrauscht' : '') +
        (render.note ? ` · ${render.note}` : '');
    } else if (render.status === 'failed') {
      text.textContent = `Fehlgeschlagen: ${render.error}`;
    } else {
      text.textContent = 'Abgebrochen';
    }
  };

  // Browsing and playing a finished turntable series.
  let player = null;
  if (count && render.status === 'done') {
    const frames = render.frames.length;
    const play = h('button', { onclick: () => actions.togglePlaying(render) });
    const scrub = slider('Bild', {
      min: 1,
      max: frames,
      value: render.shownFrame + 1,
      format: (value) => `${value} von ${frames}`,
      oninput: (value) => actions.showFrame(render, value - 1),
    });
    player = h('div', null, scrub, h('div', { class: 'button-column' }, play));
    player.update = () => {
      scrub.set(render.shownFrame + 1);
      play.textContent = actions.isPlaying(render) ? 'Anhalten' : 'Abspielen';
    };
    player.update();
  }

  if (render.status === 'running') {
    if (!count) {
      buttons.append(
        h(
          'button',
          { onclick: () => render.handle?.finishNow(), title: 'Beendet das Rendering mit dem bisher erreichten Stand' },
          'Jetzt fertigstellen',
        ),
      );
    }
    buttons.append(
      h(
        'button',
        { class: 'danger', onclick: () => actions.cancelRender(render), title: count ? 'Fertige Bilder bleiben erhalten' : null },
        'Abbrechen',
      ),
    );
  } else if (render.status === 'queued') {
    buttons.append(h('button', { class: 'danger', onclick: () => actions.deleteRender(render) }, 'Aus der Warteschlange nehmen'));
  } else {
    if (render.status === 'done') {
      const chosen = state.output.format;
      if (count) {
        if (videoSupported()) {
          buttons.append(h('button', { class: 'primary', onclick: () => actions.saveVideo(render) }, 'Video speichern'));
        }
        buttons.append(
          h(
            'button',
            { onclick: () => actions.saveRender(render, chosen) },
            `Einzelbilder speichern (${FILE_FORMATS[chosen].extension.toUpperCase()}, ZIP)`,
          ),
        );
      } else {
        // The format chosen under "Output" comes first.
        for (const format of [chosen, ...Object.keys(FILE_FORMATS).filter((key) => key !== chosen)]) {
          buttons.append(
            h(
              'button',
              { class: format === chosen ? 'primary' : null, onclick: () => actions.saveRender(render, format) },
              `${FILE_FORMATS[format].extension.toUpperCase()} speichern`,
            ),
          );
        }
      }
    }
    buttons.append(h('button', { class: 'danger', onclick: () => actions.deleteRender(render) }, 'Rendering löschen'));
  }
  update();

  return {
    title: render.name,
    body: [
      h(
        'p',
        { class: 'hint' },
        `${render.width} × ${render.height} Pixel${render.transparent ? ' · transparent' : ''}` +
          (count ? ` · ${count} Bilder für eine Umdrehung` : ''),
      ),
      bar,
      text,
      device,
      player,
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
 * rebuilding, or null.
 */
export function renderPanel(container, context) {
  const key = state.selected;
  const [kind, idText] = key.split(':');
  const id = Number(idText);
  let panel = null;

  if (key === 'project') panel = projectPanel(context);
  else if (key === 'geometry') panel = geometryPanel(context);
  else if (state.parts.length === 0) panel = null;
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
  }
  else if (key === 'views') panel = viewsPanel(context);
  else if (kind === 'view') {
    const view = state.views.find((item) => item.id === id);
    panel = view ? viewPanel(view, context) : null;
  } else if (key === 'output') panel = outputPanel(context);
  else if (key === 'renders') panel = rendersPanel(context);
  else if (kind === 'render') {
    const render = state.renders.find((item) => item.id === id);
    panel = render ? renderPanelFor(render, context) : null;
  }

  container.hidden = !panel;
  if (!panel) {
    container.replaceChildren();
    return null;
  }

  const scroll = container.querySelector('.panel-body')?.scrollTop ?? 0;
  const body = h('div', { class: 'panel-body' }, panel.body);
  container.replaceChildren(
    h(
      'header',
      { class: 'panel-header' },
      h('h2', { title: panel.title }, panel.title),
      h(
        'button',
        { class: 'icon-button', title: 'Schließen', 'aria-label': 'Schließen', onclick: context.actions.closePanel },
        icon('close', 16),
      ),
    ),
    body,
  );
  body.scrollTop = container.dataset.key === key ? scroll : 0;
  container.dataset.key = key;
  return panel.live || null;
}
