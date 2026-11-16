import { h } from './dom.js';
import { state, select, materialEntryLabel } from './state.js';

const ICONS = {
  ok: '✓',
  todo: '',
  running: '',
};

function statusIcon(status) {
  if (!status) return h('span', { class: 'node-status none' });
  return h('span', { class: `node-status ${status}` }, ICONS[status] ?? '');
}

/**
 * Renders the guided tree. `actions` supplies what the plus buttons do:
 * openFile, addMaterial, addView, startRender.
 */
export function renderTree(container, actions) {
  const loaded = state.parts.length > 0;
  const unassigned = state.parts.filter(
    (part) => !state.materials.some((entry) => entry.partIds.has(part.id)),
  ).length;

  const nodes = [
    {
      key: 'geometry',
      label: 'Geometrie',
      detail: loaded ? state.fileName : null,
      status: loaded ? 'ok' : 'todo',
      plus: { title: 'STEP-Datei öffnen', run: actions.openFile },
      always: true,
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
          detail: `${entry.partIds.size} ${entry.partIds.size === 1 ? 'Bauteil' : 'Bauteile'}`,
          swatch: entry.colorHex,
          warn: entry.partIds.size === 0,
        })),
        ...(loaded && unassigned > 0
          ? [
              {
                key: 'material:cad',
                label: 'CAD-Farben',
                detail: `${unassigned} ${unassigned === 1 ? 'Bauteil' : 'Bauteile'}`,
                muted: true,
              },
            ]
          : []),
      ],
    },
    { key: 'scene', label: 'Szene', status: loaded ? 'ok' : null },
    { key: 'lighting', label: 'Beleuchtung', status: loaded ? 'ok' : null },
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

  const renderNode = (node, depth) => {
    const enabled = loaded || node.always;
    const row = h(
      'div',
      {
        class: [
          'node',
          `depth-${depth}`,
          state.selected === node.key ? 'selected' : '',
          enabled ? '' : 'disabled',
          node.muted ? 'muted' : '',
        ].join(' '),
        role: 'button',
        tabIndex: enabled ? 0 : -1,
        onclick: () => enabled && select(node.key),
        onkeydown: (event) => {
          if (enabled && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            select(node.key);
          }
        },
      },
      depth === 0 ? statusIcon(node.status) : node.status ? statusIcon(node.status) : null,
      node.swatch ? h('span', { class: 'swatch', style: { background: node.swatch } }) : null,
      h(
        'span',
        { class: 'node-label' },
        node.label,
        node.count ? h('span', { class: 'node-count' }, ` (${node.count})`) : null,
      ),
      node.detail ? h('span', { class: `node-detail${node.warn ? ' warn' : ''}` }, node.detail) : null,
      node.plus
        ? h(
            'button',
            {
              class: 'node-plus',
              title: node.plus.title,
              'aria-label': node.plus.title,
              disabled: !enabled,
              onclick: (event) => {
                event.stopPropagation();
                node.plus.run();
              },
            },
            '+',
          )
        : null,
    );
    return [row, ...(node.children || []).flatMap((child) => renderNode(child, depth + 1))];
  };

  container.replaceChildren(...nodes.flatMap((node) => renderNode(node, 0)));
}
