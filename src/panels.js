import { h } from './dom.js';
import {
  state,
  emit,
  select,
  QUALITY,
  OUTPUT_SIZES,
  materialEntryOf,
  materialEntryLabel,
  removeMaterial,
  setPartsAssigned,
} from './state.js';
import { MATERIALS, getMaterialDef } from './materials.js';
import { LIGHT_PRESETS } from './environment.js';

const numberFormat = new Intl.NumberFormat('de-DE');

/** Whether assigning one part also assigns all identical parts (e.g. all screws of one size). */
let linkIdentical = true;

/** Parts with the same name and triangle count are treated as copies of one another. */
export function identicalParts(part) {
  if (!linkIdentical) return [part];
  return state.parts.filter((other) => other.name === part.name && other.triangles === part.triangles);
}

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

function checkbox(label, checked, onchange) {
  return h(
    'label',
    { class: 'field check' },
    h('input', { type: 'checkbox', checked, onchange: (event) => onchange(event.target.checked) }),
    h('span', null, label),
  );
}

function formatDuration(seconds) {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

// --- Panels -------------------------------------------------------------------

function geometryPanel({ viewer, actions }) {
  if (state.parts.length === 0) {
    return {
      title: 'Geometrie',
      body: [
        h('p', { class: 'hint' }, 'Lade ein Bauteil oder eine Baugruppe als STEP-Datei. Die Datei bleibt auf deinem Rechner.'),
        h('button', { class: 'primary', onclick: actions.openFile }, 'STEP-Datei öffnen …'),
      ],
    };
  }

  const triangles = state.parts.reduce((sum, part) => sum + part.triangles, 0);
  const list = h(
    'ul',
    { class: 'part-list', onmouseleave: () => viewer.setHighlight([]) },
    state.parts.map((part) =>
      h(
        'li',
        { onmouseenter: () => viewer.setHighlight([part.id]), title: part.label },
        h('input', {
          type: 'checkbox',
          checked: part.mesh.visible,
          title: 'Sichtbar',
          onchange: (event) => viewer.setPartVisible(part.id, event.target.checked),
        }),
        h('span', { class: 'swatch', style: { background: part.colorHex } }),
        h('span', { class: 'part-name' }, part.label),
      ),
    ),
  );

  return {
    title: 'Geometrie',
    body: [
      h('div', { class: 'file-name' }, state.fileName),
      h(
        'p',
        { class: 'hint' },
        `${state.parts.length} ${state.parts.length === 1 ? 'Bauteil' : 'Bauteile'} · ${numberFormat.format(triangles)} Dreiecke`,
      ),
      h('button', { onclick: actions.openFile }, 'Andere STEP-Datei öffnen …'),
      h('h3', null, 'Bauteile'),
      h('p', { class: 'hint' }, 'Der Haken blendet ein Bauteil ein oder aus. Ausgeblendete Bauteile fehlen auch im Rendering.'),
      list,
    ],
  };
}

function materialsPanel({ actions }) {
  return {
    title: 'Materialien',
    body: [
      h(
        'p',
        { class: 'hint' },
        'Jeder Eintrag ist ein Material mit den Bauteilen, die es bekommen. Bauteile ohne Eintrag behalten ihre Farbe aus der CAD-Datei.',
      ),
      h('button', { class: 'primary', onclick: actions.addMaterial }, '+ Material anlegen'),
    ],
  };
}

function cadMaterialPanel({ viewer }) {
  const parts = state.parts.filter((part) => !materialEntryOf(part.id));
  return {
    title: 'CAD-Farben',
    body: [
      h(
        'p',
        { class: 'hint' },
        'Diese Bauteile haben noch kein Material und werden mit ihrer Farbe aus der CAD-Datei als matter Kunststoff dargestellt.',
      ),
      h(
        'ul',
        { class: 'part-list', onmouseleave: () => viewer.setHighlight([]) },
        parts.map((part) =>
          h(
            'li',
            { onmouseenter: () => viewer.setHighlight([part.id]), title: part.label },
            h('span', { class: 'swatch', style: { background: part.colorHex } }),
            h('span', { class: 'part-name' }, part.label),
          ),
        ),
      ),
    ],
  };
}

function materialPanel(entry, { viewer }) {
  const def = getMaterialDef(entry.materialId);
  const colorInput = h('input', {
    type: 'color',
    value: entry.colorHex,
    oninput: (event) => {
      entry.colorHex = event.target.value;
      emit('materials:live');
    },
  });

  const list = h(
    'ul',
    { class: 'part-list', onmouseleave: () => viewer.setHighlight([]) },
    state.parts.map((part) => {
      const owner = materialEntryOf(part.id);
      return h(
        'li',
        { onmouseenter: () => viewer.setHighlight([part.id]), title: part.label },
        h('input', {
          type: 'checkbox',
          checked: owner === entry,
          onchange: (event) => setPartsAssigned(entry, identicalParts(part).map((p) => p.id), event.target.checked),
        }),
        h('span', { class: 'part-name' }, part.label),
        owner && owner !== entry ? h('span', { class: 'part-owner' }, materialEntryLabel(owner)) : null,
      );
    }),
  );

  return {
    title: 'Material',
    body: [
      field(
        'Material',
        selectControl(
          MATERIALS.filter((material) => material.color !== null).map((material) => [material.id, material.label]),
          entry.materialId,
          (value) => {
            entry.materialId = value;
            entry.colorHex = getMaterialDef(value).color;
            emit('materials');
          },
        ),
      ),
      field('Farbe', colorInput),
      entry.colorHex !== def.color
        ? h(
            'button',
            {
              class: 'link',
              onclick: () => {
                entry.colorHex = def.color;
                emit('materials');
              },
            },
            'Standardfarbe wiederherstellen',
          )
        : null,
      h('h3', null, `Bauteile (${entry.partIds.size})`),
      h('p', { class: 'hint' }, 'Bauteile hier anhaken oder direkt im Modell anklicken.'),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => setPartsAssigned(entry, state.parts.map((p) => p.id), true) }, 'Alle'),
        h('button', { onclick: () => setPartsAssigned(entry, [...entry.partIds], false) }, 'Keine'),
      ),
      checkbox('Gleiche Bauteile gemeinsam zuweisen', linkIdentical, (checked) => {
        linkIdentical = checked;
      }),
      list,
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
  const isCustom = state.scene.background.startsWith('#');
  return {
    title: 'Szene',
    body: [
      field(
        'Hintergrund',
        selectControl(
          [
            ['dark', 'Dunkel'],
            ['grey', 'Hellgrau'],
            ['white', 'Weiß'],
            ['custom', 'Eigene Farbe'],
            ...(state.lighting.presetId === 'custom' ? [['environment', 'HDRI-Umgebung anzeigen']] : []),
          ],
          isCustom ? 'custom' : state.scene.background,
          (value) => {
            state.scene.background = value === 'custom' ? '#dfe6ee' : value;
            emit('scene');
          },
        ),
      ),
      isCustom
        ? field(
            'Farbe',
            h('input', {
              type: 'color',
              value: state.scene.background,
              oninput: (event) => {
                state.scene.background = event.target.value;
                emit('scene:live');
              },
            }),
          )
        : null,
      state.scene.background === 'environment'
        ? h('p', { class: 'hint' }, 'Die HDRI-Umgebung ist als Hintergrund sichtbar und bringt ihren eigenen Boden mit.')
        : checkbox('Boden mit Schatten', state.scene.ground, (checked) => {
            state.scene.ground = checked;
            emit('scene');
          }),
      h(
        'p',
        { class: 'hint' },
        'Für freigestellte Bilder gibt es unter „Output“ die Option „Transparenter Hintergrund“.',
      ),
    ],
  };
}

function lightingPanel({ actions }) {
  const rotationValue = h('output', null, `${state.lighting.rotation}°`);
  const intensityValue = h('output', null, `${Math.round(state.lighting.intensity * 100)} %`);
  return {
    title: 'Beleuchtung',
    body: [
      field(
        'Vorlage',
        selectControl(
          [...LIGHT_PRESETS.map((preset) => [preset.id, preset.label]), ['custom', 'Eigene HDRI-Datei …']],
          state.lighting.presetId,
          (value) => {
            if (value === 'custom') {
              // Stays on the previous preset until a file has actually been loaded.
              emit('lighting');
              actions.loadHdri();
              return;
            }
            state.lighting.presetId = value;
            if (state.scene.background === 'environment') state.scene.background = 'grey';
            emit('lighting');
          },
        ),
      ),
      state.lighting.presetId === 'custom'
        ? [
            h('div', { class: 'file-name' }, state.lighting.hdriName),
            h('button', { onclick: actions.loadHdri }, 'Andere HDRI-Datei laden …'),
          ]
        : h(
            'p',
            { class: 'hint' },
            'Mit „Eigene HDRI-Datei“ beleuchtest du das Modell mit einer echten Umgebung (.hdr oder .exr), zum Beispiel einem Studio oder einer Werkhalle.',
          ),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Drehung', rotationValue),
        h('input', {
          type: 'range',
          min: -180,
          max: 180,
          step: 1,
          value: state.lighting.rotation,
          oninput: (event) => {
            state.lighting.rotation = Number(event.target.value);
            rotationValue.textContent = `${state.lighting.rotation}°`;
            emit('lighting:live');
          },
        }),
      ),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Helligkeit', intensityValue),
        h('input', {
          type: 'range',
          min: 20,
          max: 300,
          step: 5,
          value: Math.round(state.lighting.intensity * 100),
          oninput: (event) => {
            state.lighting.intensity = Number(event.target.value) / 100;
            intensityValue.textContent = `${event.target.value} %`;
            emit('lighting:live');
          },
        }),
      ),
    ],
  };
}

function viewsPanel({ viewer, actions }) {
  const fovValue = h('output', null, `${Math.round(viewer.camera.fov)}°`);
  return {
    title: 'Perspektive',
    body: [
      h(
        'p',
        { class: 'hint' },
        'Richte das Modell mit der Maus oder dem Würfel oben rechts aus. Mit dem Plus speicherst du die aktuelle Ansicht, um sie später wieder aufzurufen.',
      ),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Blickwinkel', fovValue),
        h('input', {
          type: 'range',
          min: 8,
          max: 75,
          step: 1,
          value: Math.round(viewer.camera.fov),
          oninput: (event) => {
            viewer.setFov(Number(event.target.value));
            fovValue.textContent = `${event.target.value}°`;
          },
        }),
      ),
      h('p', { class: 'hint' }, 'Kleine Werte wirken wie ein Teleobjektiv und zeigen Bauteile mit wenig perspektivischer Verzerrung.'),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => viewer.fit() }, 'Einpassen'),
        h('button', { onclick: () => viewer.setView('iso') }, 'Standardansicht'),
      ),
      h('button', { class: 'primary', onclick: actions.addView }, '+ Aktuelle Ansicht speichern'),
    ],
  };
}

function viewPanel(view, { viewer }) {
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
      h('button', { onclick: () => viewer.applyViewState(view) }, 'Ansicht anzeigen'),
      h(
        'button',
        {
          onclick: () => {
            Object.assign(view, viewer.getViewState());
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
  const numberInput = (key) =>
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

  return {
    title: 'Output',
    body: [
      field(
        'Bildgröße',
        selectControl(
          Object.entries(OUTPUT_SIZES).map(([key, value]) => [key, value.label]),
          output.size,
          (value) => {
            output.size = value;
            emit('output');
          },
        ),
      ),
      output.size === 'custom'
        ? h('div', { class: 'field-row' }, field('Breite (px)', numberInput('width')), field('Höhe (px)', numberInput('height')))
        : h('p', { class: 'hint' }, `${size.width} × ${size.height} Pixel`),
      output.size !== 'view'
        ? h('p', { class: 'hint' }, 'Der Rahmen in der Ansicht zeigt genau den Bildausschnitt, der gerendert wird.')
        : h('p', { class: 'hint' }, 'Gerendert wird genau das, was die Ansicht gerade zeigt.'),
      h('button', { onclick: () => actions.fit() }, 'Modell in den Bildausschnitt einpassen'),
      field(
        'Qualität',
        selectControl(
          Object.entries(QUALITY).map(([key, value]) => [key, `${value.label} (${value.samples} Samples)`]),
          output.quality,
          (value) => {
            output.quality = value;
            emit('output');
          },
        ),
      ),
      h('p', { class: 'hint' }, 'Mehr Samples bedeuten weniger Bildrauschen und längere Renderzeit.'),
      checkbox('Transparenter Hintergrund', output.transparent, (checked) => {
        output.transparent = checked;
        emit('output');
      }),
      output.transparent
        ? h('p', { class: 'hint' }, 'Hintergrund und Boden werden weggelassen, das PNG enthält nur das Modell.')
        : null,
      checkbox('Entrauschen', output.denoise, (checked) => {
        output.denoise = checked;
        emit('output');
      }),
      h(
        'p',
        { class: 'hint' },
        'Glättet das Restrauschen am Ende des Renderings. Damit reichen oft schon „Entwurf“ oder „Standard“.',
      ),
      checkbox('Schonender Modus', output.gentle, (checked) => {
        output.gentle = checked;
        emit('output');
      }),
      h(
        'p',
        { class: 'hint' },
        'Für Laptops und schwächere Grafikkarten: rendert in kleineren Portionen, dauert dafür länger.',
      ),
      h('button', { class: 'primary', onclick: actions.startRender }, 'Rendering starten'),
    ],
  };
}

function rendersPanel({ actions }) {
  return {
    title: 'Renderings',
    body: [
      h(
        'p',
        { class: 'hint' },
        state.renders.length === 0
          ? 'Noch kein Rendering. Das Plus rendert die aktuelle Ansicht mit den Einstellungen aus „Output“.'
          : 'Wähle links ein Rendering, um es anzusehen oder zu speichern.',
      ),
      actions.renderSupported
        ? h('button', { class: 'primary', onclick: actions.startRender }, 'Rendering starten')
        : h(
            'p',
            { class: 'hint error' },
            'Dieser Browser unterstützt kein WebGPU. Das Rendern funktioniert in aktuellen Versionen von Chrome und Edge.',
          ),
    ],
  };
}

function renderPanelFor(render, { actions }) {
  const bar = h('div', { class: 'progress-bar' }, h('div', { class: 'progress-fill' }));
  const text = h('p', { class: 'hint' });
  const buttons = h('div', { class: 'button-column' });

  const update = () => {
    bar.firstChild.style.width = `${Math.round(render.progress * 100)}%`;
    bar.hidden = render.status !== 'running';
    if (render.status === 'running') {
      text.textContent =
        render.stage === 'rendering'
          ? `Sample ${Math.floor(render.samples)} von ${render.targetSamples} · ${formatDuration(render.seconds)}`
          : render.stage === 'denoising'
            ? `Bild wird entrauscht … · ${formatDuration(render.seconds)}`
            : 'Szene wird vorbereitet …';
    } else if (render.status === 'done') {
      text.textContent =
        `Fertig nach ${formatDuration(render.seconds)} · ${Math.round(render.samples)} Samples` +
        (render.denoised ? ' · entrauscht' : '') +
        (render.note ? ` · ${render.note}` : '');
    } else if (render.status === 'failed') {
      text.textContent = `Fehlgeschlagen: ${render.error}`;
    } else {
      text.textContent = 'Abgebrochen';
    }
  };
  update();

  if (render.status === 'running') {
    buttons.append(
      h('button', { onclick: () => render.handle?.finishNow(), title: 'Beendet das Rendering mit dem bisher erreichten Stand' }, 'Jetzt fertigstellen'),
      h('button', { class: 'danger', onclick: () => actions.cancelRender(render) }, 'Abbrechen'),
    );
  } else {
    if (render.status === 'done') {
      buttons.append(h('button', { class: 'primary', onclick: () => actions.saveRender(render) }, 'PNG speichern'));
    }
    buttons.append(h('button', { class: 'danger', onclick: () => actions.deleteRender(render) }, 'Rendering löschen'));
  }

  return {
    title: render.name,
    body: [
      h('p', { class: 'hint' }, `${render.width} × ${render.height} Pixel${render.transparent ? ' · transparent' : ''}`),
      bar,
      text,
      buttons,
    ],
    live: update,
  };
}

/**
 * Builds the settings panel for the selected tree node. Returns a function
 * that refreshes volatile values (render progress) without rebuilding, or null.
 */
export function renderPanel(container, context) {
  const key = state.selected;
  const [kind, idText] = key.split(':');
  const id = Number(idText);
  let panel = null;

  if (key === 'geometry') panel = geometryPanel(context);
  else if (state.parts.length === 0) panel = null;
  else if (key === 'materials') panel = materialsPanel(context);
  else if (key === 'material:cad') panel = cadMaterialPanel(context);
  else if (kind === 'material') {
    const entry = state.materials.find((item) => item.id === id);
    panel = entry ? materialPanel(entry, context) : null;
  } else if (key === 'scene') panel = scenePanel(context);
  else if (key === 'lighting') panel = lightingPanel(context);
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
      h('h2', null, panel.title),
      h('button', { class: 'panel-close', title: 'Schließen', 'aria-label': 'Schließen', onclick: context.actions.closePanel }, '×'),
    ),
    body,
  );
  body.scrollTop = container.dataset.key === key ? scroll : 0;
  container.dataset.key = key;
  return panel.live || null;
}
