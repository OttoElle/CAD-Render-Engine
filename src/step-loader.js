import * as THREE from 'three';
import { createMaterial } from './materials.js';

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./step-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id, ok, message, progress, ...payload } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      if (progress) {
        entry.onProgress?.(progress);
        return;
      }
      pending.delete(id);
      if (ok) entry.resolve(payload);
      else entry.reject(new Error(message));
    };
    worker.onerror = (event) => {
      for (const entry of pending.values()) {
        entry.reject(new Error(event.message || 'The STEP import crashed.'));
      }
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function importStep(buffer, onProgress) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, buffer }, [buffer]);
  });
}

const DEFAULT_COLOR = new THREE.Color(0xb8bcc4);

/**
 * Loads a STEP file and returns a list of parts. Each part is one THREE.Mesh
 * plus the metadata the UI needs (name, colour, triangle count).
 * `onProgress({ stage, done, total })` reports the steps: 'read', 'engine'
 * (starting OpenCascade), 'parse' (no finer progress available), 'edges'
 * (done of total meshes) and 'build'.
 */
export async function loadStepFile(file, onProgress) {
  onProgress?.({ stage: 'read', done: 0, total: 0 });
  const buffer = await file.arrayBuffer();
  const { root, meshes } = await importStep(buffer, onProgress);
  onProgress?.({ stage: 'build', done: 0, total: 0 });

  const parts = [];
  const usedNames = new Map();

  const visit = (node, path) => {
    const here = node.name ? [...path, node.name] : path;
    for (const meshIndex of node.meshes || []) {
      const data = meshes[meshIndex];
      if (!data || data.index.length === 0) continue;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
      if (data.normal) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
      } else {
        geometry.computeVertexNormals();
      }
      geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
      geometry.computeBoundingBox();

      const color = data.color
        ? new THREE.Color().setRGB(data.color[0], data.color[1], data.color[2], THREE.SRGBColorSpace)
        : DEFAULT_COLOR.clone();

      const baseName = data.name || node.name || 'Bauteil';
      const count = (usedNames.get(baseName) || 0) + 1;
      usedNames.set(baseName, count);

      const part = {
        id: parts.length,
        name: baseName,
        instance: count,
        path: here,
        edgePositions: data.edges,
        cadColor: color,
        materialId: 'cad',
        colorHex: `#${color.getHexString()}`,
        triangles: data.index.length / 3,
      };
      part.mesh = new THREE.Mesh(geometry, createMaterial(part));
      part.mesh.name = baseName;
      parts.push(part);
    }
    for (const child of node.children || []) visit(child, here);
  };
  visit(root, []);

  // Number repeated names (e.g. 12 identical screws) so they can be told apart.
  for (const part of parts) {
    part.label = usedNames.get(part.name) > 1 ? `${part.name} (${part.instance})` : part.name;
  }

  if (parts.length === 0) {
    throw new Error('The STEP file contains no geometry that can be shown.');
  }
  return parts;
}
