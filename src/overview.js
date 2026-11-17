import { h } from './dom.js';
import { icon } from './icons.js';
import { state } from './state.js';

/**
 * The project overview: all projects as tiles with a preview image, the date
 * of the last change and what they contain. Clicking a tile opens the project.
 */

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const count = (value, one, many) => `${value} ${value === 1 ? one : many}`;

/** A button that needs a second click, for deleting. */
function deleteButton(run) {
  let armed = false;
  const node = h(
    'button',
    {
      class: 'icon-button danger-hover',
      title: 'Projekt löschen',
      'aria-label': 'Projekt löschen',
      onclick: (event) => {
        event.stopPropagation();
        if (armed) {
          run();
          return;
        }
        armed = true;
        node.classList.add('armed');
        node.title = 'Zum Löschen noch einmal klicken';
        setTimeout(() => {
          armed = false;
          node.classList.remove('armed');
          node.title = 'Projekt löschen';
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
  const stop = (run) => (event) => {
    event.stopPropagation();
    run();
  };
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
      title: current ? 'Geöffnetes Projekt' : 'Projekt öffnen',
      onclick: () => actions.openFromOverview(project.id),
      onkeydown: (event) => event.key === 'Enter' && actions.openFromOverview(project.id),
    },
    h(
      'div',
      { class: 'tile-image' },
      thumb ? h('img', { src: thumb, alt: '' }) : h('span', { class: 'tile-placeholder' }, icon('parts', 44)),
    ),
    h(
      'div',
      { class: 'tile-text' },
      h('strong', null, project.name),
      h('span', null, project.fileName || 'Noch kein Modell'),
      h('span', null, project.modifiedAt ? `Geändert ${dateFormat.format(new Date(project.modifiedAt))}` : ''),
    ),
    h(
      'div',
      { class: 'tile-footer' },
      h(
        'span',
        {
          class: 'tile-facts',
          title: [
            count(project.partCount, 'Bauteil', 'Bauteile'),
            count(project.materialCount, 'Material', 'Materialien'),
            count(project.viewCount, 'Ansicht', 'Ansichten'),
          ].join(' · '),
        },
        facts.map((fact) => h('span', null, fact)),
      ),
      h(
        'span',
        { class: 'tile-actions' },
        h(
          'button',
          {
            class: 'icon-button',
            title: 'Duplizieren',
            'aria-label': 'Duplizieren',
            onclick: stop(() => actions.duplicateProject(project.id)),
          },
          icon('copy', 16),
        ),
        h(
          'button',
          {
            class: 'icon-button',
            title: 'Als Datei exportieren',
            'aria-label': 'Exportieren',
            onclick: stop(() => actions.exportProject(project.id)),
          },
          icon('download', 16),
        ),
        deleteButton(() => actions.deleteProject(project.id)),
      ),
    ),
  );
}

function importNotice(actions) {
  const pending = actions.pendingImport();
  if (!pending) return null;
  const date = pending.exportedAt ? ` Die Datei wurde am ${dateFormat.format(pending.exportedAt)} exportiert.` : '';
  return h(
    'div',
    { class: 'notice' },
    h('p', null, `„${pending.name}“ ist hier schon vorhanden.${date} Ersetzen oder als Kopie importieren?`),
    h(
      'div',
      { class: 'button-row' },
      h('button', { class: 'primary', onclick: () => actions.finishImport(true) }, 'Ersetzen'),
      h('button', { onclick: () => actions.finishImport(false) }, 'Als Kopie'),
      h('button', { onclick: actions.cancelImport }, 'Abbrechen'),
    ),
  );
}

export function renderOverview(container, actions) {
  const projects = [...state.projects].sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
  container.replaceChildren(
    h(
      'div',
      { class: 'overview-inner' },
      h(
        'header',
        { class: 'overview-header' },
        h('h1', null, 'Projekte'),
        h(
          'div',
          { class: 'overview-buttons' },
          h(
            'button',
            { onclick: actions.importProject, title: 'Eine .clearcoat-Datei von einem anderen Rechner öffnen' },
            icon('upload', 16),
            'Importieren',
          ),
          h('button', { class: 'primary', onclick: actions.newProject }, icon('plus', 16), 'Neues Projekt'),
        ),
      ),
      importNotice(actions),
      h('div', { class: 'project-grid' }, projects.map((project) => tile(project, actions))),
      h(
        'p',
        { class: 'hint' },
        'Projekte liegen im Speicher dieses Browsers. Zum Weiterarbeiten an einem anderen Rechner ein Projekt exportieren und dort importieren.',
      ),
    ),
  );
}
