import * as THREE from 'three';
import { createMaterial } from './materials.js';

/*
 * STEP files are converted in web workers. Two kinds of work share them:
 * files the user is waiting for (an upload, a project being opened) and
 * stored projects converted ahead of time in the background, so that opening
 * them later is instant. User work always goes first: background work runs on
 * one worker at a time, only while no user work waits, and a user import that
 * finds both workers busy stops a background one and takes its place. The
 * stopped file is converted again later.
 */

const WORKER_COUNT = 2;
/** Converted files kept in memory, most recently used last. */
const CACHE_LIMIT_BYTES = 1.5e9;

const slots = Array.from({ length: WORKER_COUNT }, () => ({ worker: null, job: null }));
/** Jobs waiting for a worker, in order of arrival. */
const queue = [];
/** All jobs not finished yet, by file key. */
const jobs = new Map();
/** Finished conversions by file key: { result, bytes }. */
const cache = new Map();
let cacheBytes = 0;

const hashes = new WeakMap();

/**
 * Identifies a file by its content, since stored files come back from the
 * database as new File objects without their original date.
 */
function fileKey(file) {
  let key = hashes.get(file);
  if (!key) {
    key = file.arrayBuffer().then(async (buffer) => {
      if (!crypto.subtle) return `${file.name}|${file.size}`;
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
      return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    });
    hashes.set(file, key);
  }
  return key;
}

/** A job is user work while anyone who waits for it still cares. */
const isUserJob = (job) => job.requesters.some((alive) => alive());

function resultBytes({ meshes }) {
  let bytes = 0;
  for (const mesh of meshes) {
    for (const array of [mesh.position, mesh.normal, mesh.index, mesh.edges]) bytes += array?.byteLength || 0;
  }
  return bytes;
}

function remember(key, result) {
  const bytes = resultBytes(result);
  if (bytes > CACHE_LIMIT_BYTES) return;
  cache.set(key, { result, bytes });
  cacheBytes += bytes;
  for (const [oldKey, entry] of cache) {
    if (cacheBytes <= CACHE_LIMIT_BYTES) break;
    cache.delete(oldKey);
    cacheBytes -= entry.bytes;
  }
}

function takeCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  // Most recently used moves to the end, so it is the last to be dropped.
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
}

function stopWorker(slot) {
  slot.worker?.terminate();
  slot.worker = null;
  slot.job = null;
}

function startJob(slot, job) {
  slot.job = job;
  job.slot = slot;
  job.run += 1;
  const run = job.run;
  if (!slot.worker) {
    const worker = new Worker(new URL('./step-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const current = slot.job;
      if (!current) return;
      const { ok, message, progress, ...payload } = event.data;
      if (progress) {
        current.report(progress);
        return;
      }
      slot.job = null;
      finishJob(current, ok ? payload : null, ok ? null : new Error(message));
    };
    worker.onerror = (event) => {
      const current = slot.job;
      stopWorker(slot);
      if (current) finishJob(current, null, new Error(event.message || 'The STEP import crashed.'));
    };
    slot.worker = worker;
  }
  job.file.arrayBuffer().then(
    (buffer) => {
      // Stopped in the meantime to make room for user work.
      if (job.run !== run || slot.job !== job) return;
      slot.worker.postMessage({ id: run, buffer }, [buffer]);
    },
    (error) => {
      if (job.run !== run || slot.job !== job) return;
      slot.job = null;
      finishJob(job, null, error);
    },
  );
}

function finishJob(job, result, error) {
  job.slot = null;
  jobs.delete(job.key);
  if (result) {
    remember(job.key, result);
    job.resolve(result);
  } else {
    job.reject(error);
  }
  pump();
}

/** Hands waiting jobs to workers, user work first. */
function pump() {
  const waiting = queue.filter(isUserJob);
  for (const job of waiting) {
    let slot = slots.find((candidate) => !candidate.job);
    if (!slot) {
      slot = slots.find((candidate) => !isUserJob(candidate.job));
      if (!slot) break;
      // The background file starts over later; the user should not wait for it.
      const stopped = slot.job;
      stopped.slot = null;
      stopWorker(slot);
      queue.unshift(stopped);
    }
    queue.splice(queue.indexOf(job), 1);
    startJob(slot, job);
  }
  // Background work waits while the user waits for anything; one file at a time.
  if (queue.some(isUserJob) || slots.some((slot) => slot.job)) return;
  const free = slots.find((slot) => !slot.job);
  const next = queue[0];
  if (!free || !next) return;
  queue.shift();
  startJob(free, next);
}

/**
 * Converts a STEP file, or returns the result of an earlier conversion of the
 * same file. `alive()` says whether the caller still waits for it; a job whose
 * callers all stopped caring becomes background work.
 */
async function convert(file, { onProgress, alive } = {}) {
  const key = await fileKey(file);
  const cached = takeCached(key);
  if (cached) return cached;
  let job = jobs.get(key);
  if (!job) {
    job = { key, file, requesters: [], listeners: [], last: null, slot: null, run: 0 };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    job.report = (progress) => {
      job.last = progress;
      for (const listener of job.listeners) listener(progress);
    };
    jobs.set(key, job);
    queue.push(job);
  }
  if (alive) job.requesters.push(alive);
  if (onProgress) {
    job.listeners.push(onProgress);
    if (job.last) onProgress(job.last);
  }
  pump();
  return await job.promise;
}

/** Call when a caller's `alive()` may have changed, e.g. the overview closed. */
export function reprioritizeImports() {
  pump();
}

/**
 * Converts a stored file in the background so it opens instantly later.
 * Errors are left for the moment the file is really opened.
 */
export function preloadStepFile(file) {
  if (file) convert(file).catch(() => {});
}

const DEFAULT_COLOR = new THREE.Color(0xb8bcc4);

/**
 * Loads a STEP file and returns a list of parts. Each part is one THREE.Mesh
 * plus the metadata the UI needs (name, colour, triangle count).
 * `onProgress({ stage, done, total })` reports the steps: 'read', 'engine'
 * (starting OpenCascade), 'parse' (no finer progress available), 'edges'
 * (done of total meshes) and 'build'. `alive()` tells whether the caller
 * still waits for the result; while it does, the file has priority over
 * background conversions. The geometry arrays are shared with the cache and
 * must not be changed in place.
 */
export async function loadStepFile(file, onProgress, { alive = () => true } = {}) {
  onProgress?.({ stage: 'read', done: 0, total: 0 });
  const { root, meshes } = await convert(file, { onProgress, alive });
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
