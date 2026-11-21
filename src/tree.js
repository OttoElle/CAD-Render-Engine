import { h } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { state, select, materialEntryLabel, presentParts, BACKGROUND_COLORS } from './state.js';
import { getLightPreset } from './environment.js';
import { FILE_FORMATS } from './export.js';
import { hasExplode } from './explode.js';

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
  const parts = presentParts();
  const removedParts = state.parts.length - parts.length;
  const unassigned = parts.filter((part) => !state.materials.some((entry) => entry.partIds.has(part.id))).length;
  const assignedCount = (entry) => parts.filter((part) => entry.partIds.has(part.id)).length;
  const hiddenParts = parts.filter((part) => !part.mesh.visible).length;
  const additive = (event) => Boolean(event.ctrlKey || event.metaKey || event.shiftKey);
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
  /**
   * The + of a category. With several things to add it opens a menu; with
   * one it adds that right away; with nothing to add there is no +. Choices
   * an entry's panel offers anyway (which axis, which material) are made there.
   */
  const addButton = (title, items) => {
    const list = items.filter(Boolean);
    if (list.length === 0) return null;
    if (list.length === 1) return { icon: 'plus', title: list[0].title || `Add ${list[0].label.toLowerCase()}`, add: true, run: list[0].run };
    return { icon: 'plus', title, add: true, menu: list };
  };

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
        addButton('Add to the geometry', [
          { label: 'Part', title: loaded ? 'Add a part from a STEP file' : 'Open a STEP file', icon: 'part', run: actions.addPart },
          loaded ? { label: 'Section', icon: 'slice', run: () => actions.addSection() } : null,
          parts.length > 1 && !hasExplode(state.explode) ? { label: 'Exploded view', icon: 'explode', run: actions.addExplode } : null,
        ]),
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
                detail: hiddenParts > 0 ? `${hiddenParts} of ${parts.length} hidden` : String(parts.length),
                actions: [
                  hiddenParts > 0 ? { icon: 'eyeOff', title: 'Show all parts', sticky: true, run: actions.showAllParts } : null,
                  removedParts > 0
                    ? more([{ label: `Bring back deleted parts (${removedParts})`, icon: 'undo', run: actions.restoreParts }])
                    : null,
                ],
                children: parts.map((part) => ({
                  key: `part:${part.id}`,
                  label: part.label,
                  swatch: part.colorHex,
                  dimmed: !part.mesh.visible,
                  hover: [part.id],
                  alsoSelected: state.selectedParts.has(part.id),
                  pick: (event) => actions.selectPart(part.id, additive(event)),
                  title: `${part.label} · Ctrl or Shift + click to select several`,
                  actions: [
                    eye(part.mesh.visible, ['Hide', 'Show'], () => actions.togglePart(part.id)),
                    more([remove('Delete part', () => actions.deleteParts([part.id]))]),
                  ],
                })),
              },
              parts.length > 1 && hasExplode(state.explode)
                ? {
                    key: 'explode',
                    label: 'Exploded view',
                    icon: 'explode',
                    detail: state.explode.amount > 0 ? `${Math.round(state.explode.amount * 100)} %` : 'assembled',
                    muted: !(state.explode.amount > 0),
                    actions: [more([remove('Remove exploded view', actions.deleteExplode)])],
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
      actions: [addButton('Add material', [{ label: 'Material', run: () => actions.addMaterial() }])],
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
          detail: assignedCount(entry) > 0 ? plural(assignedCount(entry), 'part', 'parts') : null,
          warning: assignedCount(entry) === 0 ? 'No parts assigned yet' : null,
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
      actions: [
        addButton('Add to the scene', [
          state.scene.floor === 'none' ? { label: 'Floor', run: () => actions.addFloor('shadow') } : null,
        ]),
      ],
      children: [
        { key: 'scene:background', label: 'Background', icon: 'background', detail: backgroundName(state.scene) },
        state.scene.floor !== 'none'
          ? {
              key: 'scene:floor',
              label: 'Floor',
              icon: 'floor',
              detail: state.scene.background === 'environment' ? 'from the scene' : FLOOR_NAMES[state.scene.floor],
              muted: state.scene.background === 'environment',
              actions: [more([remove('Remove floor', actions.deleteFloor)])],
            }
          : null,
      ],
    },
    {
      key: 'cat:lighting',
      category: true,
      label: 'Lighting',
      icon: 'lamp',
      actions: [addButton('Add light', [{ label: 'Softbox', run: () => actions.addLight() }])],
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
      actions: [
        addButton('Add to the camera', [
          { label: 'Saved view', title: 'Save the current view', icon: 'bookmark', run: actions.addView },
          state.camera.dof ? null : { label: 'Depth of field', icon: 'target', run: actions.addDepthOfField },
        ]),
      ],
      children: [
        { key: 'views', label: 'Lens', icon: 'lens', detail: actions.lensText() },
        state.camera.dof
          ? {
              key: 'camera:dof',
              label: 'Depth of field',
              icon: 'target',
              detail: `f/${state.camera.fStop}`,
              actions: [more([remove('Remove depth of field', actions.deleteDepthOfField)])],
            }
          : null,
        ...state.views.map((view) => ({
          key: `view:${view.id}`,
          label: view.name,
          icon: 'bookmark',
          actions: [
            { icon: 'play', title: 'Show this view', run: () => actions.showView(view) },
            more([
              { label: 'Update to the current view', icon: 'refresh', run: () => actions.updateView(view) },
              remove('Delete view', () => actions.deleteView(view.id)),
            ]),
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
        addButton('Add render job', [
          { label: 'Image', icon: 'image', run: () => actions.addJob('image') },
          { label: 'Turntable', icon: 'film', run: () => actions.addJob('animation') },
          state.views.length > 0
            ? { label: `One image per saved view (${state.views.length})`, icon: 'bookmark', run: actions.jobsFromViews }
            : null,
        ]),
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
              { label: 'Update to the current view', icon: 'refresh', run: () => actions.updateJobView(job) },
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
    const activate = (event) => {
      if (!enabled) return;
      if (foldable) toggleFold();
      else if (node.pick) node.pick(event);
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
          state.selected === node.key || node.alsoSelected ? 'selected' : '',
          enabled ? '' : 'disabled',
          node.muted ? 'muted' : '',
          node.dimmed ? 'dimmed' : '',
        ].join(' '),
        role: foldable ? 'treeitem' : 'button',
        'aria-expanded': foldable ? String(!folded) : null,
        tabIndex: enabled ? 0 : -1,
        title: node.warning || node.title || (node.detail ? `${node.label} · ${node.detail}` : node.label),
        onclick: activate,
        onmouseenter: node.hover ? () => actions.hover(node.hover) : null,
        onkeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate(event);
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
