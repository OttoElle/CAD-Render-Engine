import { h } from './dom.js';
import { icon } from './icons.js';
import { state } from './state.js';
import { adjustCss } from './adjust.js';
import { FILE_FORMATS, videoSupported } from './export.js';

/**
 * The project overview: all projects as tiles with a preview image, the date
 * of the last change and what they contain. Clicking a tile opens the
 * project. Dialogs on top create a project, change its name and template,
 * and show its renderings.
 */

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const count = (value, one, many) => `${value} ${value === 1 ? one : many}`;

const stop = (run) => (event) => {
  event.stopPropagation();
  run();
};

function iconButton(name, title, run, className = 'icon-button') {
  return h('button', { class: className, title, 'aria-label': title, onclick: stop(run) }, icon(name, 16));
}

/** A button that needs a second click, for deleting. */
function deleteButton(title, run) {
  let armed = false;
  const node = h(
    'button',
    {
      class: 'icon-button danger-hover',
      title,
      'aria-label': title,
      onclick: (event) => {
        event.stopPropagation();
        if (armed) {
          run();
          return;
        }
        armed = true;
        node.classList.add('armed');
        node.title = 'Click again to delete';
        setTimeout(() => {
          armed = false;
          node.classList.remove('armed');
          node.title = title;
        }, 3000);
      },
    },
    icon('trash', 16),
  );
  return node;
}

function tile(project, actions) {
  const current = project.id === state.project.id;
  const thumb = actions.thumbnailUrl(project.id);
  const facts = [
    project.partCount > 0 ? [icon('parts', 14), project.partCount] : null,
    project.materialCount > 0 ? [icon('palette', 14), project.materialCount] : null,
    project.viewCount > 0 ? [icon('camera', 14), project.viewCount] : null,
  ].filter(Boolean);
  return h(
    'article',
    {
      class: `project-tile${current ? ' current' : ''}`,
      tabIndex: 0,
      title: current ? 'Open project' : 'Open this project',
      onclick: () => actions.openFromOverview(project.id),
      onkeydown: (event) => event.key === 'Enter' && actions.openFromOverview(project.id),
    },
    h(
      'div',
      { class: 'tile-image' },
      thumb ? h('img', { src: thumb, alt: '' }) : h('span', { class: 'tile-placeholder' }, icon('parts', 44)),
      project.renderCount > 0
        ? h(
            'button',
            {
              class: 'tile-renders',
              title: 'Show the renderings',
              onclick: stop(() => actions.openGallery(project.id)),
            },
            icon('image', 14),
            count(project.renderCount, 'rendering', 'renderings'),
          )
        : null,
    ),
    h(
      'div',
      { class: 'tile-text' },
      h('strong', null, project.name),
      h('span', null, project.fileName || 'No model yet'),
      h('span', null, project.modifiedAt ? `Changed ${dateFormat.format(new Date(project.modifiedAt))}` : ''),
    ),
    h(
      'div',
      { class: 'tile-footer' },
      h(
        'span',
        {
          class: 'tile-facts',
          title: [
            count(project.partCount, 'part', 'parts'),
            count(project.materialCount, 'material', 'materials'),
            count(project.viewCount, 'view', 'views'),
          ].join(' · '),
        },
        facts.map((fact) => h('span', null, fact)),
      ),
      h(
        'span',
        { class: 'tile-actions' },
        iconButton('pencil', 'Name and template', () => actions.editProject(project.id)),
        iconButton('copy', 'Duplicate', () => actions.duplicateProject(project.id)),
        iconButton('download', 'Export as a file', () => actions.exportProject(project.id)),
        deleteButton('Delete project', () => actions.deleteProject(project.id)),
      ),
    ),
  );
}

function importNotice(actions) {
  const pending = actions.pendingImport();
  if (!pending) return null;
  const date = pending.exportedAt ? ` The file was exported on ${dateFormat.format(pending.exportedAt)}.` : '';
  return h(
    'div',
    { class: 'notice' },
    h('p', null, `"${pending.name}" is here already.${date} Replace it or import a copy?`),
    h(
      'div',
      { class: 'button-row' },
      h('button', { class: 'primary', onclick: () => actions.finishImport(true) }, 'Replace'),
      h('button', { onclick: () => actions.finishImport(false) }, 'Import a copy'),
      h('button', { onclick: actions.cancelImport }, 'Cancel'),
    ),
  );
}

function templateSelect(withNone) {
  const node = h('select', { name: 'template' });
  node.add(new Option(withNone, ''));
  for (const template of state.templates) node.add(new Option(template.name, template.id));
  return node;
}

/** A dialog box over the overview; clicking beside it closes it. */
function dialogShell(title, body, actions, className = '') {
  return h(
    'div',
    { class: 'dialog-backdrop', onclick: (event) => event.target === event.currentTarget && actions.closeDialog() },
    h(
      'div',
      { class: `dialog ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h(
        'header',
        { class: 'dialog-header' },
        h('h2', null, title),
        iconButton('close', 'Close', actions.closeDialog),
      ),
      body,
    ),
  );
}

/** Name and template of a new project, or of an existing one. */
function projectDialog(actions, record) {
  const name = h('input', { type: 'text', name: 'name', value: record ? record.name : actions.nextProjectName(), required: true });
  const template = templateSelect(record ? 'Keep the current settings' : 'No template (defaults)');
  const submit = (event) => {
    event.preventDefault();
    const templateId = template.value || null;
    if (record) actions.saveProjectSettings(record.id, name.value, templateId);
    else actions.createProject(name.value, templateId);
  };
  const form = h(
    'form',
    { class: 'dialog-body', onsubmit: submit },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name),
    state.templates.length > 0
      ? [
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, record ? 'Apply a template' : 'Template'), template),
          h(
            'p',
            { class: 'hint' },
            'A template brings materials, scene, lighting, camera lens and output settings.' +
              (record ? ' Applying it opens the project.' : ''),
          ),
        ]
      : h('p', { class: 'hint' }, 'No templates yet. Save the open project as a template below the projects.'),
    h(
      'div',
      { class: 'button-row' },
      h('button', { type: 'button', onclick: actions.closeDialog }, 'Cancel'),
      h('button', { type: 'submit', class: 'primary' }, record ? 'Save' : 'Create project'),
    ),
  );
  queueMicrotask(() => {
    name.focus();
    name.select();
  });
  return dialogShell(record ? 'Project settings' : 'New project', form, actions);
}

/** The renderings of a project as a grid; one of them large with its download buttons. */
function galleryDialog(actions, record, key) {
  const renders = [...actions.projectRenders(record.id)].sort((a, b) => b.createdAt - a.createdAt);
  const shown = key ? renders.find((item) => item.key === key) : null;
  let body;
  if (shown) {
    const loaded = actions.galleryRender();
    const ready = loaded && loaded.key === shown.key;
    const url = ready ? (loaded.turntable ? loaded.frames[0]?.url : loaded.url) : null;
    const css = adjustCss(shown.adjust, 'clearcoat-gallery-warmth');
    const image = url
      ? h('div', { class: 'gallery-image' }, h('img', { src: url, alt: shown.name, style: { filter: css.filter } }), css.vignette ? h('div', { class: 'vignette', style: { background: css.vignette } }) : null)
      : h('p', { class: 'render-placeholder' }, 'Loading …');
    const format = shown.format || 'png';
    const formats = [format, ...Object.keys(FILE_FORMATS).filter((item) => item !== format)];
    body = h(
      'div',
      { class: 'dialog-body gallery-large' },
      image,
      h(
        'p',
        { class: 'hint' },
        `${shown.width} × ${shown.height} pixels` +
          (shown.turntable ? ` · turntable with ${shown.frameCount} images` : '') +
          ` · ${dateFormat.format(new Date(shown.createdAt))}`,
      ),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => actions.showGalleryRender(record.id, null) }, icon('chevronLeft', 15), 'All renderings'),
        shown.turntable
          ? [
              videoSupported()
                ? h('button', { class: 'primary', disabled: !ready, onclick: () => actions.saveGalleryVideo() }, icon('download', 15), 'Video')
                : null,
              h('button', { disabled: !ready, onclick: () => actions.saveGalleryRender(format) }, icon('download', 15), `Images (${format.toUpperCase()}, ZIP)`),
            ]
          : formats.map((item, i) =>
              h(
                'button',
                { class: i === 0 ? 'primary' : '', disabled: !ready, onclick: () => actions.saveGalleryRender(item) },
                icon('download', 15),
                item.toUpperCase(),
              ),
            ),
      ),
    );
  } else {
    body = h(
      'div',
      { class: 'dialog-body' },
      renders.length === 0
        ? h('p', { class: 'hint' }, 'This project has no renderings yet.')
        : h(
            'div',
            { class: 'gallery-grid' },
            renders.map((item) => {
              const thumb = actions.renderThumbnailUrl(record.id, item.key);
              const css = adjustCss(item.adjust, 'clearcoat-gallery-warmth');
              return h(
                'button',
                { class: 'gallery-item', title: item.name, onclick: () => actions.showGalleryRender(record.id, item.key) },
                h(
                  'span',
                  { class: 'gallery-thumb' },
                  thumb ? h('img', { src: thumb, alt: '', style: { filter: css.filter } }) : null,
                  item.turntable ? h('span', { class: 'gallery-badge' }, icon('film', 13)) : null,
                ),
                h('span', { class: 'gallery-name' }, item.name),
                h('span', { class: 'gallery-size' }, `${item.width} × ${item.height}`),
              );
            }),
          ),
      h(
        'div',
        { class: 'button-row' },
        h('button', { onclick: () => actions.openFromOverview(record.id) }, 'Open the project'),
      ),
    );
  }
  return dialogShell(`Renderings of ${record.name}`, body, actions, 'gallery');
}

function templatesSection(actions) {
  const name = h('input', { type: 'text', placeholder: 'Name of the template' });
  const save = () => {
    if (!name.value.trim()) {
      name.focus();
      return;
    }
    actions.saveTemplate(name.value.trim());
  };
  name.onkeydown = (event) => event.key === 'Enter' && save();
  return h(
    'section',
    { class: 'templates' },
    h('h2', null, 'Templates'),
    h(
      'p',
      { class: 'hint' },
      'A template keeps materials, scene, lighting, camera lens and output settings for new projects.',
    ),
    state.templates.length > 0
      ? h(
          'ul',
          { class: 'template-list' },
          state.templates.map((template) =>
            h('li', null, h('span', null, template.name), deleteButton('Delete template', () => actions.deleteTemplate(template.id))),
          ),
        )
      : null,
    h(
      'div',
      { class: 'input-row' },
      name,
      h('button', { onclick: save, title: `Saves the settings of "${state.project.name}"` }, 'Save open project as template'),
    ),
  );
}

export function renderOverview(container, actions) {
  const projects = [...state.projects].sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
  const dialog = actions.dialog();
  let dialogNode = null;
  if (dialog?.mode === 'new') dialogNode = projectDialog(actions, null);
  else if (dialog?.mode === 'edit') {
    const record = state.projects.find((project) => project.id === dialog.id);
    if (record) dialogNode = projectDialog(actions, record);
  } else if (dialog?.mode === 'gallery') {
    const record = state.projects.find((project) => project.id === dialog.id);
    if (record) dialogNode = galleryDialog(actions, record, dialog.key);
  }
  // Rebuilding the dialog would lose what is being typed into it.
  const typing = container.querySelector('.dialog form');
  if (typing && dialog && (dialog.mode === 'new' || dialog.mode === 'edit') && container.dataset.dialog === `${dialog.mode}:${dialog.id ?? ''}`) {
    dialogNode = typing.closest('.dialog-backdrop');
  }
  container.dataset.dialog = dialog ? `${dialog.mode}:${dialog.id ?? ''}` : '';
  container.replaceChildren(
    h(
      'div',
      { class: 'overview-inner' },
      h(
        'header',
        { class: 'overview-header' },
        h('h1', null, 'Projects'),
        h(
          'div',
          { class: 'overview-buttons' },
          h(
            'button',
            { onclick: actions.importProject, title: 'Open a .clearcoat file from another computer' },
            icon('upload', 16),
            'Import',
          ),
          h('button', { class: 'primary', onclick: actions.newProject }, icon('plus', 16), 'New project'),
        ),
      ),
      importNotice(actions),
      h('div', { class: 'project-grid' }, projects.map((project) => tile(project, actions))),
      templatesSection(actions),
      h(
        'p',
        { class: 'hint' },
        'Projects are kept in this browser. To work on another computer, export a project and import it there.',
      ),
    ),
    dialogNode || '',
  );
}
