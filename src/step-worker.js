// Runs the OpenCascade STEP import off the main thread so the UI stays responsive.
import occtimportjs from 'occt-import-js';
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';

let occtPromise = null;

function getOcct() {
  if (!occtPromise) {
    occtPromise = occtimportjs({ locateFile: () => wasmUrl });
  }
  return occtPromise;
}

// Tessellation fine enough that curved faces stay smooth in close-up renderings.
const IMPORT_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.0005,
  angularDeflection: 0.2,
};

/**
 * Builds line segments along the boundaries between B-rep faces. These are the
 * real CAD edges, independent of how finely the surfaces were tessellated.
 */
function buildFaceEdges(position, index, brepFaces) {
  const triangleCount = index.length / 3;
  if (!brepFaces || brepFaces.length === 0 || triangleCount === 0) return null;

  const faceOfTriangle = new Int32Array(triangleCount).fill(-1);
  brepFaces.forEach((face, faceIndex) => {
    for (let t = face.first; t <= face.last && t < triangleCount; t++) faceOfTriangle[t] = faceIndex;
  });

  // Each face has its own vertices, so weld them by position first.
  const vertexCount = position.length / 3;
  const welded = new Uint32Array(vertexCount);
  const byPosition = new Map();
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < position.length; i++) {
    if (position[i] < min) min = position[i];
    if (position[i] > max) max = position[i];
  }
  const scale = 1e5 / Math.max(max - min, 1e-9);
  for (let v = 0; v < vertexCount; v++) {
    const key =
      Math.round((position[v * 3] - min) * scale) +
      '_' +
      Math.round((position[v * 3 + 1] - min) * scale) +
      '_' +
      Math.round((position[v * 3 + 2] - min) * scale);
    let id = byPosition.get(key);
    if (id === undefined) {
      id = v;
      byPosition.set(key, id);
    }
    welded[v] = id;
  }

  // An edge is a CAD edge if its triangles belong to different faces, or if it is open.
  const edges = new Map();
  for (let t = 0; t < triangleCount; t++) {
    const face = faceOfTriangle[t];
    for (let e = 0; e < 3; e++) {
      const a = welded[index[t * 3 + e]];
      const b = welded[index[t * 3 + ((e + 1) % 3)]];
      if (a === b) continue;
      const key = a < b ? a * vertexCount + b : b * vertexCount + a;
      const entry = edges.get(key);
      if (!entry) edges.set(key, { a, b, face, count: 1, boundary: false });
      else {
        entry.count += 1;
        if (entry.face !== face) entry.boundary = true;
      }
    }
  }

  const out = [];
  for (const { a, b, count, boundary } of edges.values()) {
    if (!boundary && count !== 1) continue;
    out.push(
      position[a * 3], position[a * 3 + 1], position[a * 3 + 2],
      position[b * 3], position[b * 3 + 1], position[b * 3 + 2],
    );
  }
  return new Float32Array(out);
}

self.onmessage = async (event) => {
  const { id, buffer } = event.data;
  try {
    const occt = await getOcct();
    const result = occt.ReadStepFile(new Uint8Array(buffer), IMPORT_PARAMS);
    if (!result || !result.success) {
      throw new Error('Die Datei konnte nicht als STEP gelesen werden.');
    }

    const transfer = [];
    const meshes = result.meshes.map((mesh) => {
      const position = new Float32Array(mesh.attributes.position.array);
      const normal = mesh.attributes.normal
        ? new Float32Array(mesh.attributes.normal.array)
        : null;
      const index = new Uint32Array(mesh.index.array);
      const edges = buildFaceEdges(position, index, mesh.brep_faces);
      transfer.push(position.buffer, index.buffer);
      if (normal) transfer.push(normal.buffer);
      if (edges) transfer.push(edges.buffer);
      return {
        name: mesh.name || '',
        color: mesh.color || null,
        position,
        normal,
        index,
        edges,
      };
    });

    self.postMessage({ id, ok: true, root: result.root, meshes }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, message: error?.message || String(error) });
  }
};
