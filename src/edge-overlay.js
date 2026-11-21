import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * Edge lines for a rendering, as in a CAD view with edges. The path tracer
 * cannot draw lines, so they are drawn separately with WebGL from the same
 * camera, hidden where the model covers them, and laid over the finished
 * image. The lines are the CAD edges of the visible parts, their outlines
 * against the background (silhouettes of curved faces, which have no CAD
 * edge) and the outlines of cut faces.
 */

/** Line width is given for a Full HD image and scaled with the image, so previews and large images look alike. */
const REFERENCE_SIZE = 1920;

/**
 * For every edge shared by two triangles: its ends and both face normals,
 * kept per geometry. The triangles of neighbouring CAD faces have their own
 * vertices, so corners are matched by position.
 */
const adjacencyCache = new WeakMap();

function adjacency(geometry) {
  if (adjacencyCache.has(geometry)) return adjacencyCache.get(geometry);
  const position = geometry.attributes.position.array;
  const index = geometry.index?.array ?? null;
  const triangleCount = (index ? index.length : position.length / 3) / 3;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3()).length() || 1;
  const cell = size * 1e-6;
  const ids = new Map();
  const vertexId = (v) => {
    const key = `${Math.round(position[v * 3] / cell)},${Math.round(position[v * 3 + 1] / cell)},${Math.round(position[v * 3 + 2] / cell)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = v;
      ids.set(key, id);
    }
    return id;
  };
  const welded = new Int32Array(position.length / 3);
  for (let v = 0; v < welded.length; v += 1) welded[v] = vertexId(v);

  const normals = new Float32Array(triangleCount * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const corner = (t, k) => (index ? index[t * 3 + k] : t * 3 + k);
  for (let t = 0; t < triangleCount; t += 1) {
    a.fromArray(position, corner(t, 0) * 3);
    b.fromArray(position, corner(t, 1) * 3).sub(a);
    c.fromArray(position, corner(t, 2) * 3).sub(a);
    b.cross(c).normalize();
    normals[t * 3] = b.x;
    normals[t * 3 + 1] = b.y;
    normals[t * 3 + 2] = b.z;
  }

  const firstTriangle = new Map();
  const pairs = [];
  const vertexCount = welded.length;
  for (let t = 0; t < triangleCount; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const p = welded[corner(t, k)];
      const q = welded[corner(t, (k + 1) % 3)];
      if (p === q) continue;
      const key = p < q ? p * vertexCount + q : q * vertexCount + p;
      const other = firstTriangle.get(key);
      if (other === undefined) firstTriangle.set(key, t);
      else if (other >= 0) {
        pairs.push(p, q, other, t);
        firstTriangle.set(key, -1);
      }
    }
  }
  const result = { position, normals, pairs: Int32Array.from(pairs) };
  adjacencyCache.set(geometry, result);
  return result;
}

/** Edges where a front-facing and a back-facing triangle meet, as seen from `eye` (in the part's coordinates). */
function silhouetteSegments(geometry, eye) {
  const { position, normals, pairs } = adjacency(geometry);
  const out = [];
  for (let i = 0; i < pairs.length; i += 4) {
    const p = pairs[i] * 3;
    const q = pairs[i + 1] * 3;
    const mx = (position[p] + position[q]) / 2 - eye.x;
    const my = (position[p + 1] + position[q + 1]) / 2 - eye.y;
    const mz = (position[p + 2] + position[q + 2]) / 2 - eye.z;
    const s = pairs[i + 2] * 3;
    const t = pairs[i + 3] * 3;
    const front1 = normals[s] * mx + normals[s + 1] * my + normals[s + 2] * mz < 0;
    const front2 = normals[t] * mx + normals[t + 1] * my + normals[t + 2] * mz < 0;
    if (front1 !== front2) out.push(position[p], position[p + 1], position[p + 2], position[q], position[q + 1], position[q + 2]);
  }
  return out;
}

/** Line segments (flat x, y, z pairs) along the outlines of a cap, in the part's coordinates. */
function capOutlineSegments(cap) {
  const outline = cap.geometry.userData.outline;
  if (!outline) return [];
  const { loops, u, v, normal, constant } = outline;
  const origin = normal.clone().multiplyScalar(-constant);
  const out = [];
  const point = new THREE.Vector3();
  for (const loop of loops) {
    const p = loop.polygon;
    const n = p.length / 2;
    for (let i = 0; i < n; i += 1) {
      for (const k of [i, (i + 1) % n]) {
        point.copy(origin).addScaledVector(u, p[k * 2]).addScaledVector(v, p[k * 2 + 1]);
        out.push(point.x, point.y, point.z);
      }
    }
  }
  return out;
}

/**
 * Draws the edges of the viewer's visible parts as seen by `camera` into a
 * new canvas of the given size, transparent except for the lines.
 */
export function renderEdgeOverlay(viewer, camera, { width, height, color, lineWidth }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.position.copy(viewer.modelRoot.position);
  root.quaternion.copy(viewer.modelRoot.quaternion);
  root.scale.copy(viewer.modelRoot.scale);
  scene.add(root);

  root.updateMatrixWorld(true);
  const eyeWorld = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const pixels = Math.max(lineWidth * (Math.max(width, height) / REFERENCE_SIZE), 0.5);
  const owned = [];
  for (const part of viewer.parts) {
    if (!part.mesh.visible || part.removed) continue;
    const planes = part.worldPlanes?.length > 0 ? part.worldPlanes : null;
    // Only depth, pushed back a little, so lines on the surface win and lines behind it are hidden.
    const depth = new THREE.MeshBasicMaterial({
      colorWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      clippingPlanes: planes,
    });
    const holder = new THREE.Mesh(part.mesh.geometry, depth);
    holder.position.copy(part.mesh.position);
    holder.quaternion.copy(part.mesh.quaternion);
    holder.scale.copy(part.mesh.scale);
    root.add(holder);
    owned.push(depth);
    holder.updateMatrixWorld(true);

    const lists = [];
    const edges = part.edges?.geometry.attributes.position;
    if (edges) lists.push(edges.array);
    const eye = eyeWorld.clone().applyMatrix4(holder.matrixWorld.clone().invert());
    lists.push(silhouetteSegments(part.mesh.geometry, eye));
    for (const cap of part.caps || []) {
      // Caps hide what lies behind the cut face; their outlines are edges too.
      holder.add(new THREE.Mesh(cap.geometry, depth));
      lists.push(capOutlineSegments(cap));
    }
    const total = lists.reduce((sum, list) => sum + list.length, 0);
    if (total === 0) continue;
    const segments = new Float32Array(total);
    let at = 0;
    for (const list of lists) {
      segments.set(list, at);
      at += list.length;
    }
    const geometry = new LineSegmentsGeometry().setPositions(segments);
    const material = new LineMaterial({
      color,
      linewidth: pixels,
      worldUnits: false,
      clippingPlanes: planes,
    });
    material.resolution.set(width, height);
    const lines = new LineSegments2(geometry, material);
    // After every surface, so lines behind any part fail the depth test; three.js would otherwise sort by distance.
    lines.renderOrder = 1;
    holder.add(lines);
    owned.push(geometry, material);
  }

  // A plain camera with the same matrices, as the given one may come from the WebGPU build of three.js.
  const view = new THREE.PerspectiveCamera();
  view.matrixAutoUpdate = false;
  view.matrixWorldAutoUpdate = false;
  view.matrixWorld.copy(camera.matrixWorld);
  view.matrixWorldInverse.copy(camera.matrixWorld).invert();
  view.projectionMatrix.copy(camera.projectionMatrix);
  view.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  scene.updateMatrixWorld(true);
  renderer.render(scene, view);
  for (const item of owned) item.dispose();
  renderer.dispose();
  return canvas;
}
