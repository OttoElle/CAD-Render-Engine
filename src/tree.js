import { h } from './dom.js';
import { icon } from './icons.js';
import { state, select, materialEntryLabel } from './state.js';
import { getLightPreset } from './environment.js';

/** Keys of nodes whose children are folded away. */
const collapsed = new Set();

export function setCollapsed(key, value) {
  if (value) collapsed.add(key);
  else collapsed.delete(key);
}

function statusIcon(status) {
  if (!status) return h('span', { class: 'node-status none' });
  return h('span', { class: `node-status ${status}` }, status === 'ok' ? icon('check', 11) : null);
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * Renders the guided tree. `actions` supplies what the buttons do: openFile,
 * newProject, addSection, toggleSection, addMaterial, addView, startRender, togglePart and hover (tints
 * parts in the model while the pointer is over their row).
 */
export function renderTree(container, actions) {
  const loaded = state.parts.length > 0;
  const unassigned = state.parts.filter(
    (part) => !state.materials.some((entry) => entry.partIds.has(part.id)),
  ).length;

  const nodes = [
    {
      key: 'project',
      label: 'Projekt',
      detail: state.project.name,
      status: 'ok',
      plus: { title: 'Neues Projekt', run: actions.newProject },
      always: true,
    },
    {
      key: 'geometry',
      label: 'Geometrie',
      count: state.parts.length,
      detail: loaded ? state.fileName : null,
      status: loaded ? 'ok' : 'todo',
      plus: { title: 'STEP-Datei öffnen', run: actions.openFile },
      always: true,
      children: state.parts.map((part) => {
        const visible = part.mesh.visible;
        return {
          key: `part:${part.id}`,
          label: part.label,
          swatch: part.colorHex,
          dimmed: !visible,
          hover: [part.id],
          action: {
            icon: visible ? 'eye' : 'eyeOff',
            title: visible ? 'Ausblenden' : 'Einblenden',
            sticky: !visible,
            run: () => actions.togglePart(part.id),
          },
        };
      }),
    },
    {
      key: 'sections',
      label: 'Schnitte',
      count: state.sections.length,
      status: loaded ? 'ok' : null,
      plus: { title: 'Schnitt anlegen', run: actions.addSection },
      children: state.sections.map((section) => ({
        key: `section:${section.id}`,
        label: section.name,
        detail: `${'XYZ'[section.axis]} ${Math.round(section.position * 10) / 10} mm`,
        dimmed: !section.enabled,
        action: {
          icon: section.enabled ? 'eye' : 'eyeOff',
          title: section.enabled ? 'Schnitt ausschalten' : 'Schnitt einschalten',
          sticky: !section.enabled,
          run: () => actions.toggleSection(section.id),
        },
      })),
    },
    {
      key: 'materials',
      label: 'Materialien',
      count: state.materials.length,
      status: loaded ? 'ok' : null,
      plus: { title: 'Material anlegen', run: actions.addMaterial },
      children: [
        ...state.materials.map((entry) => ({
          key: `material:${entry.id}`,
          label: materialEntryLabel(entry),
          detail: plural(entry.partIds.size, 'Bauteil', 'Bauteile'),
          swatch: entry.colorHex,
          warn: entry.partIds.size === 0,
          hover: [...entry.partIds],
        })),
        ...(loaded && unassigned > 0
          ? [
              {
                key: 'material:cad',
                label: 'CAD-Farben',
                detail: plural(unassigned, 'Bauteil', 'Bauteile'),
                muted: true,
              },
            ]
          : []),
      ],
    },
    { key: 'scene', label: 'Szene', status: loaded ? 'ok' : null },
    {
      key: 'lighting',
      label: 'Beleuchtung',
      count: state.lighting.lights.length,
      detail: state.lighting.presetId === 'custom' ? state.lighting.hdriName : getLightPreset(state.lighting.presetId).label,
      status: loaded ? 'ok' : null,
      plus: { title: 'Softbox anlegen', run: actions.addLight },
      children: state.lighting.lights.map((light) => ({
        key: `light:${light.id}`,
        label: light.name,
        dimmed: !light.enabled,
        action: {
          icon: light.enabled ? 'eye' : 'eyeOff',
          title: light.enabled ? 'Ausschalten' : 'Einschalten',
          sticky: !light.enabled,
          run: () => actions.toggleLight(light.id),
        },
      })),
    },
    {
      key: 'views',
      label: 'Perspektive',
      count: state.views.length,
      status: loaded ? 'ok' : null,
      plus: { title: 'Aktuelle Ansicht speichern', run: actions.addView },
      children: state.views.map((view) => ({ key: `view:${view.id}`, label: view.name })),
    },
    { key: 'output', label: 'Output', status: loaded ? 'ok' : null },
    {
      key: 'renders',
      label: 'Renderings',
      count: state.renders.length,
      status: state.renders.some((render) => render.status === 'running')
        ? 'running'
        : state.renders.length > 0
          ? 'ok'
          : null,
      plus: { title: 'Rendering starten', run: actions.startRender },
      children: state.renders.map((render) => ({
        key: `render:${render.id}`,
        label: render.name,
        detail:
          render.status === 'running'
            ? `${Math.round(render.progress * 100)} %`
            : `${render.width} × ${render.height}`,
        status: render.status === 'running' ? 'running' : render.status === 'done' ? 'ok' : null,
      })),
    },
  ];

  const iconButton = (className, spec, enabled = true) =>
    h(
      'button',
      {
        class: className,
        title: spec.title,
        'aria-label': spec.title,
        disabled: !enabled,
        onclick: (event) => {
          event.stopPropagation();
          spec.run();
        },
      },
      icon(spec.icon, 14),
    );

  const renderNode = (node, depth) => {
    const enabled = loaded || node.always;
    const children = node.children || [];
    const folded = collapsed.has(node.key);
    const row = h(
      'div',
      {
        class: [
          'node',
          `depth-${depth}`,
          state.selected === node.key ? 'selected' : '',
          enabled ? '' : 'disabled',
          node.muted ? 'muted' : '',
          node.dimmed ? 'dimmed' : '',
        ].join(' '),
        role: 'button',
        tabIndex: enabled ? 0 : -1,
        title: node.detail ? `${node.label} · ${node.detail}` : node.label,
        onclick: () => enabled && select(node.key),
        onmouseenter: node.hover ? () => actions.hover(node.hover) : null,
        onkeydown: (event) => {
          if (enabled && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            select(node.key);
          }
        },
      },
      depth === 0
        ? children.length > 0
          ? iconButton('node-toggle', {
              icon: folded ? 'chevronRight' : 'chevronDown',
              title: folded ? 'Aufklappen' : 'Zuklappen',
              run: () => {
                setCollapsed(node.key, !folded);
                renderTree(container, actions);
              },
            })
          : h('span', { class: 'node-toggle' })
        : null,
      depth === 0 || node.status ? statusIcon(node.status) : null,
      node.swatch ? h('span', { class: 'swatch', style: { background: node.swatch } }) : null,
      h(
        'span',
        { class: 'node-label' },
        node.label,
        node.count ? h('span', { class: 'node-count' }, ` (${node.count})`) : null,
      ),
      node.detail ? h('span', { class: `node-detail${node.warn ? ' warn' : ''}` }, node.detail) : null,
      node.action ? iconButton(`node-action${node.action.sticky ? ' sticky' : ''}`, node.action) : null,
      node.plus ? iconButton('node-plus', { ...node.plus, icon: 'plus' }, enabled) : null,
    );
    if (folded) return [row];
    return [row, ...children.flatMap((child) => renderNode(child, depth + 1))];
  };

  container.onmouseleave = () => actions.hover(null);
  container.replaceChildren(...nodes.flatMap((node) => renderNode(node, 0)));
}
