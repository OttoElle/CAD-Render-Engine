import { zipFiles, unzipFiles } from './export.js';

/**
 * A project as a single file, to move it between computers. The file is a
 * ZIP archive with the project's settings in `project.json`, its STEP model
 * and, if the lighting uses one, its HDRI.
 */

export const PROJECT_EXTENSION = 'clearcoat';
const FORMAT = 'clearcoat-project';
const VERSION = 1;

/** Packs a stored project record together with its files. */
export async function packProject(record, { step, hdri }) {
  const manifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    step: step ? `model/${step.name}` : null,
    hdri: hdri ? `hdri/${hdri.name}` : null,
    // Renderings stay on this computer; their images would make the file large.
    project: { ...record, renders: [] },
  };
  const entries = [
    { name: 'project.json', blob: new Blob([JSON.stringify(manifest, null, 2)]), compress: true },
  ];
  // STEP is text and shrinks a lot; EXR files are compressed already.
  if (step) entries.push({ name: manifest.step, blob: step, compress: true });
  if (hdri) entries.push({ name: manifest.hdri, blob: hdri, compress: /\.hdr$/i.test(hdri.name) });
  return zipFiles(entries);
}

/** Reads a project file. Resolves to { record, exportedAt, step, hdri } with the files as File objects. */
export async function unpackProject(file) {
  const invalid = () => new Error(`"${file.name}" is not a Clearcoat project file.`);
  let entries;
  try {
    entries = await unzipFiles(file);
  } catch {
    throw invalid();
  }
  const byName = new Map(entries.map((entry) => [entry.name, entry.blob]));
  let manifest;
  try {
    manifest = JSON.parse(await byName.get('project.json').text());
  } catch {
    throw invalid();
  }
  if (manifest?.format !== FORMAT || !manifest.project || typeof manifest.project !== 'object') throw invalid();
  if (manifest.version > VERSION) {
    throw new Error('This project file comes from a newer version of Clearcoat. Please update the app.');
  }
  const record = manifest.project;
  const asFile = (path, name) =>
    typeof path === 'string' && byName.has(path) ? new File([byName.get(path)], name || path.split('/').pop()) : null;
  return {
    record,
    exportedAt: manifest.exportedAt ? new Date(manifest.exportedAt) : null,
    // The model must keep its name: materials and views are matched to it.
    step: asFile(manifest.step, typeof record.fileName === 'string' ? record.fileName : null),
    hdri: asFile(manifest.hdri),
  };
}
