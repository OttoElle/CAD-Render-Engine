import { h } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { state, select, materialEntryLabel, BACKGROUND_COLORS } from './state.js';
import { getLightPreset } from './environment.js';
import { FILE_FORMATS } from './export.js';

/** Keys of nodes whose children are folded away. */
const collapsed = new Set();

export function setCollapsed(key, value) {
  if (value) collapsed.add(key);
  else collapsed.delete(key);
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

const FLOOR_NAMES = { shadow: 'Flat', cove: 'Cove', none: 'None' };

function backgroundName(scene) {
  if (scene.background === 'environment') return 'Scene';
  if (scene.background === 'gradient') return 'Gradient';
  if (scene.background.startsWith('#')) return scene.background.toUpperCase();
  return BACKGROUND_COLORS[scene.background] || '';
}

/**
 * Renders the tree. Categories are titles: a click folds them, their buttons
 * add things or act on all their entries. Entries open their settings.
 * `actions` supplies what the buttons do (see main.js).
 */
export function renderTree(container, actions) {
  const loaded = state.parts.length > 0;
  const unassigned = state.parts.filter((part) => !state.materials.some((entry) => entry.partIds.has(part.id))).length;
  const hiddenParts = state.parts.filter((part) => !part.mesh.visible).length;
  const doneRenders = state.renders.filter((render) => render.status === 'done').length;
  const queued = state.renders.filter((render) => render.status === 'queued').length;

  const eye = (visible, titles, run) => ({
    icon: visible ? 'eye' : 'eyeOff',
    title: visible ? titles[0] : titles[1],
    sticky: !visible,
    run,
  });
  const more = (items) => ({ icon: 'more', title: 'More', menu: items });
  const remove = (label, run) => ({ label, icon: 'trash', danger: true, run });

  const renderDetail = (render) =>
    render.status === 'running'
      ? `${Math.round(render.progress * 100)} %`
      : render.status === 'queued'
        ? 'queued'
        : render.status === 'cancelled'
          ? 'cancelled'
          : render.status === 'failed'
            ? 'failed'
            : `${render.width} × ${render.height}`;

  const nodes = [
    {
      key: 'cat:geometry',
      category: true,
      always: true,
      label: 'Geometry',
      icon: 'cube',
      actions: [
        loaded
          ? { icon: 'plus', title: 'Add section', run: actions.addSection, add: true }
          : { icon: 'plus', title: 'Open STEP file', run: actions.openFile, add: true },
      ],
      children: [
        {
          key: 'geometry',
          always: true,
          label: loaded ? state.fileName : 'Open a STEP file',
          icon: 'file',
          muted: !loaded,
          detail: loaded ? `${state.upAxis.replace('+', '')} up` : null,
        },
        ...(loaded
          ? [
              {
                key: 'parts',
                group: true,
                label: 'Parts',
                icon: 'partGroup',
                detail: hiddenParts > 0 ? `${hiddenParts} of ${state.parts.length} hidden` : String(state.parts.length),
                actions: hiddenParts > 0 ? [{ icon: 'eyeOff', title: 'Show all parts', sticky: true, run: actions.showAllParts }] : [],
                children: state.parts.map((part) => ({
                  key: `part:${part.id}`,
                  label: part.label,
                  swatch: part.colorHex,
                  dimmed: !part.mesh.visible,
                  hover: [part.id],
                  actions: [eye(part.mesh.visible, ['Hide', 'Show'], () => actions.togglePart(part.id))],
                })),
              },
              state.parts.length > 1
                ? {
                    key: 'explode',
                    label: 'Exploded view',
                    icon: 'explode',
                    detail: state.explode.amount > 0 ? `${Math.round(state.explode.amount * 100)} %` : 'off',
                    muted: !(state.explode.amount > 0),
                  }
                : null,
              ...state.sections.map((section) => ({
                key: `section:${section.id}`,
                label: section.name,
                icon: 'slice',
                detail: `${'XYZ'[section.axis]} ${Math.round(section.position * 10) / 10} mm`,
                dimmed: !section.enabled,
                actions: [
                  eye(section.enabled, ['Turn section off', 'Turn section on'], () => actions.toggleSection(section.id)),
                  more([remove('Delete section', () => actions.deleteSection(section.id))]),
                ],
              })),
            ]
          : []),
      ],
    },
    {
      key: 'cat:materials',
      category: true,
      label: 'Materials',
      icon: 'palette',
      actions: [{ icon: 'plus', title: 'Add material', run: actions.addMaterial, add: true }],
      children: [
        {
          key: 'material:cad',
          label: 'CAD colours',
          swatch: 'linear-gradient(135deg, #c9ced6 50%, #7d8794 50%)',
          detail: plural(unassigned, 'part', 'parts'),
          muted: unassigned === 0,
        },
        ...state.materials.map((entry) => ({
          key: `material:${entry.id}`,
          label: materialEntryLabel(entry),
          swatch: entry.colorHex,
          round: true,
          detail: entry.partIds.size > 0 ? plural(entry.partIds.size, 'part', 'parts') : null,
          warning: entry.partIds.size === 0 ? 'No parts assigned yet' : null,
          hover: [...entry.partIds],
          actions: [more([remove('Delete material', () => actions.deleteMaterial(entry.id))])],
        })),
      ],
    },
    {
      key: 'cat:scene',
      category: true,
      label: 'Scene',
      icon: 'scene',
      children: [
        { key: 'scene:background', label: 'Background', icon: 'background', detail: backgroundName(state.scene) },
        {
          key: 'scene:floor',
          label: 'Floor',
          icon: 'floor',
          detail: state.scene.background === 'environment' ? 'from the scene' : FLOOR_NAMES[state.scene.floor],
          muted: state.scene.background === 'environment',
        },
      ],
    },
    {
      key: 'cat:lighting',
      category: true,
      label: 'Lighting',
      icon: 'lamp',
      actions: [{ icon: 'plus', title: 'Add softbox', run: actions.addLight, add: true }],
      children: [
        {
          key: 'lighting',
          label: 'Light setup',
          icon: 'sliders',
          detail: state.lighting.presetId === 'custom' ? state.lighting.hdriName : getLightPreset(state.lighting.presetId).label,
        },
        ...state.lighting.lights.map((light) => ({
          key: `light:${light.id}`,
          label: light.name,
          icon: 'softbox',
          dimmed: !light.enabled,
          warning: light.enabled && light.el < 0 ? 'Below the horizon: the floor hides this light in the rendering' : null,
          actions: [
            eye(light.enabled, ['Turn off', 'Turn on'], () => actions.toggleLight(light.id)),
            more([remove('Delete softbox', () => actions.deleteLight(light.id))]),
          ],
        })),
      ],
    },
    {
      key: 'cat:camera',
      category: true,
      label: 'Camera',
      icon: 'camera',
      actions: [{ icon: 'plus', title: 'Save the current view', run: actions.addView, add: true }],
      children: [
        { key: 'views', label: 'Lens', icon: 'lens', detail: actions.lensText() },
        ...state.views.map((view) => ({
          key: `view:${view.id}`,
          label: view.name,
          icon: 'bookmark',
          actions: [
            { icon: 'play', title: 'Show this view', run: () => actions.showView(view) },
            more([remove('Delete view', () => actions.deleteView(view.id))]),
          ],
        })),
      ],
    },
    {
      key: 'cat:output',
      category: true,
      label: 'Output',
      icon: 'clapper',
      actions: [
        state.jobs.length > 0 && actions.renderSupported
          ? { icon: 'play', title: state.jobs.length > 1 ? `Render all ${state.jobs.length} jobs` : 'Render the job', run: actions.renderAllJobs }
          : null,
        {
          icon: 'plus',
          title: 'Add render job',
          add: true,
          menu: () => [
            { label: 'Image', icon: 'image', run: () => actions.addJob('image') },
            { label: 'Turntable', icon: 'film', run: actions.addAnimationJob },
            state.views.length > 0
              ? { label: `One image per saved view (${state.views.length})`, icon: 'bookmark', run: actions.jobsFromViews }
              : null,
          ].filter(Boolean),
        },
      ],
      empty: 'No render jobs yet',
      children: state.jobs.map((job) => {
        const { width, height } = actions.resolveOutputSize(job);
        return {
          key: `job:${job.id}`,
          label: job.name,
          icon: job.type === 'animation' ? 'film' : 'image',
          detail: job.type === 'animation' ? `${job.turntableFrames} images` : `${width} × ${height}`,
          actions: [
            actions.renderSupported ? { icon: 'play', title: 'Render this job', run: () => actions.renderJob(job) } : null,
            more([
              { label: 'Duplicate', icon: 'copy', run: () => actions.duplicateJob(job) },
              remove('Delete job', () => actions.deleteJob(job)),
            ]),
          ],
        };
      }),
    },
    {
      key: 'cat:renders',
      category: true,
      label: 'Renders',
      icon: 'photos',
      actions: [
        doneRenders > 0 || queued > 0
          ? {
              icon: 'download',
              title: 'Save all or clear the queue',
              menu: () => [
                ...Object.entries(FILE_FORMATS).map(([key, value]) => ({
                  label: `Save all as ${value.extension.toUpperCase()} (ZIP)`,
                  icon: 'download',
                  disabled: doneRenders === 0,
                  run: () => actions.saveAllRenders(key),
                })),
                queued > 0 ? null : undefined,
                queued > 0 ? remove(`Clear the queue (${queued})`, actions.cancelQueue) : undefined,
              ].filter((item) => item !== undefined),
            }
          : null,
      ],
      empty: actions.renderSupported ? 'Rendered images appear here' : 'Rendering needs WebGPU (Chrome or Edge)',
      children: state.renders.map((render) => ({
        key: `render:${render.id}`,
        label: render.name,
        icon: render.turntable ? 'film' : 'image',
        detail: renderDetail(render),
        progress: render.status === 'running' ? render.progress : null,
        warning: render.status === 'failed' ? `Failed: ${render.error}` : null,
        muted: render.status === 'queued' || render.status === 'cancelled',
        actions: [more([remove(render.status === 'queued' ? 'Take out of the queue' : 'Delete rendering', () => actions.deleteRender(render))])],
      })),
    },
  ];

  const actionButton = (spec, enabled) =>
    h(
      'button',
      {
        class: ['node-action', spec.sticky ? 'sticky' : '', spec.add ? 'add' : ''].join(' '),
        title: spec.title,
        'aria-label': spec.title,
        disabled: !enabled,
        onclick: (event) => {
          event.stopPropagation();
          if (spec.menu) openMenu(event.currentTarget, typeof spec.menu === 'function' ? spec.menu() : spec.menu);
          else spec.run();
        },
      },
      icon(spec.icon, 15),
    );

  const renderNode = (node, depth) => {
    if (!node) return [];
    const enabled = loaded || node.always;
    const children = (node.children || []).filter(Boolean);
    const foldable = node.category || node.group;
    const folded = foldable && collapsed.has(node.key);
    const toggleFold = () => {
      setCollapsed(node.key, !folded);
      renderTree(container, actions);
    };
    const activate = () => {
      if (!enabled) return;
      if (foldable) toggleFold();
      else select(node.key);
    };
    const statusIcon = node.progress !== null && node.progress !== undefined
      ? h('span', { class: 'progress-ring', style: { '--p': `${Math.round(node.progress * 100)}%` }, title: 'Rendering' })
      : node.warning
        ? h('span', { class: 'node-warning', title: node.warning }, icon('alert', 14))
        : null;
    const row = h(
      'div',
      {
        class: [
          'node',
          node.category ? 'category' : `depth-${depth}`,
          state.selected === node.key ? 'selected' : '',
          enabled ? '' : 'disabled',
          node.muted ? 'muted' : '',
          node.dimmed ? 'dimmed' : '',
        ].join(' '),
        role: foldable ? 'treeitem' : 'button',
        'aria-expanded': foldable ? String(!folded) : null,
        tabIndex: enabled ? 0 : -1,
        title: node.warning || (node.detail ? `${node.label} · ${node.detail}` : node.label),
        onclick: activate,
        onmouseenter: node.hover ? () => actions.hover(node.hover) : null,
        onkeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
          }
        },
      },
      foldable ? h('span', { class: 'node-toggle' }, icon(folded ? 'chevronRight' : 'chevronDown', 14)) : null,
      node.swatch
        ? h('span', { class: `swatch${node.round ? ' round' : ''}`, style: { background: node.swatch } })
        : node.icon
          ? h('span', { class: 'node-icon' }, icon(node.icon, 16))
          : null,
      h('span', { class: 'node-label' }, node.label),
      node.detail ? h('span', { class: 'node-detail' }, node.detail) : h('span', { class: 'node-fill' }),
      statusIcon,
      (node.actions || []).filter(Boolean).map((spec) => actionButton(spec, enabled)),
    );
    // Without a model only Geometry has something to show.
    if (folded || !enabled) return [row];
    const rows = children.flatMap((child) => renderNode(child, node.category ? depth : depth + 1));
    if (node.category && rows.length === 0 && node.empty && enabled) {
      rows.push(h('div', { class: 'node depth-0 empty' }, node.empty));
    }
    return [row, ...rows];
  };

  container.onmouseleave = () => actions.hover(null);
  container.replaceChildren(...nodes.flatMap((node) => renderNode(node, 0)));
}
