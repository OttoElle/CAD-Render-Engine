import * as THREE from 'three';

/**
 * Where the cut faces of two parts lie on top of each other, the parts
 * overlap in the CAD model, e.g. a threaded plug modelled at its full
 * diameter in a hole that only shows the core diameter. Both caps would
 * fight for the same pixels and flicker; instead the overlap is found and
 * drawn in red on top, as CAD programs do.
 *
 * The caps are triangulated polygons, so the overlap is the union of the
 * overlaps of their triangles, and two triangles overlap in a convex polygon.
 * Faces that merely touch (a bolt in a hole of the same size) overlap in thin
 * slivers, because both circles are approximated by straight pieces; a piece
 * of overlap that lies close to the outlines of both faces is such a sliver
 * and is left out.
 */

export const OVERLAP_COLOR = '#e5352b';

/**
 * Width up to which an overlap counts as touching. Twice the deviation the
 * STEP import allows between a curved face and its triangles (see
 * step-worker.js), measured on the size of the model.
 */
export function overlapTolerance(box) {
  const size = box.isEmpty() ? 100 : box.getSize(new THREE.Vector3()).length();
  return size * 1e-3;
}

/** Basis of a plane: two directions along it, as used for the caps. */
function planeBasis(normal) {
  const u = new THREE.Vector3(Math.abs(normal.x) > 0.9 ? 0 : 1, Math.abs(normal.x) > 0.9 ? 1 : 0, 0);
  u.addScaledVector(normal, -u.dot(normal)).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);
  return { u, v };
}

/** A cap's triangles and outline in 2D plane coordinates, with bounds. */
function flatten(cap, matrix, u, v) {
  const position = cap.geometry.attributes.position;
  const point = new THREE.Vector3();
  const tris = new Float64Array((position.count / 3) * 6);
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i).applyMatrix4(matrix);
    const x = point.dot(u);
    const y = point.dot(v);
    tris[i * 2] = x;
    tris[i * 2 + 1] = y;
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], y);
  }
  // The outlines, from the plane coordinates of the cap's own (part) plane.
  const edges = [];
  const outline = cap.geometry.userData.outline;
  if (outline) {
    const origin = outline.normal.clone().multiplyScalar(-outline.constant);
    for (const loop of outline.loops) {
      const p = loop.polygon;
      const n = p.length / 2;
      let px = 0;
      let py = 0;
      for (let i = 0; i <= n; i += 1) {
        const k = i % n;
        point.copy(origin).addScaledVector(outline.u, p[k * 2]).addScaledVector(outline.v, p[k * 2 + 1]).applyMatrix4(matrix);
        const x = point.dot(u);
        const y = point.dot(v);
        if (i > 0) edges.push(px, py, x, y);
        px = x;
        py = y;
      }
    }
  }
  return { tris, box, edges };
}

/** A grid over a region that lists, per cell, the items whose bounds touch it. */
function makeGrid(box, count) {
  const cells = Math.max(1, Math.min(256, Math.round(Math.sqrt(count))));
  const width = Math.max(box[2] - box[0], 1e-12);
  const height = Math.max(box[3] - box[1], 1e-12);
  const lists = new Map();
  const cellOf = (x, y) => [
    Math.min(cells - 1, Math.max(0, Math.floor(((x - box[0]) / width) * cells))),
    Math.min(cells - 1, Math.max(0, Math.floor(((y - box[1]) / height) * cells))),
  ];
  return {
    add(item, x0, y0, x1, y1) {
      const [a, b] = cellOf(x0, y0);
      const [c, d] = cellOf(x1, y1);
      for (let i = a; i <= c; i += 1) {
        for (let j = b; j <= d; j += 1) {
          const key = i * cells + j;
          let list = lists.get(key);
          if (!list) lists.set(key, (list = []));
          list.push(item);
        }
      }
    },
    query(x0, y0, x1, y1, visit) {
      const [a, b] = cellOf(x0, y0);
      const [c, d] = cellOf(x1, y1);
      for (let i = a; i <= c; i += 1) for (let j = b; j <= d; j += 1) for (const item of lists.get(i * cells + j) || []) visit(item);
    },
  };
}

/** Clips a convex polygon (flat x, y list) by the triangle's edges; returns the remaining polygon. */
function clipByTriangle(polygon, t, k) {
  let out = polygon;
  let ax = t[k];
  let ay = t[k + 1];
  let bx = t[k + 2];
  let by = t[k + 3];
  let cx = t[k + 4];
  let cy = t[k + 5];
  // Counter-clockwise, so the inside is left of each edge.
  if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0) {
    [bx, cx] = [cx, bx];
    [by, cy] = [cy, by];
  }
  const corners = [ax, ay, bx, by, cx, cy];
  for (let e = 0; e < 3 && out.length >= 6; e += 1) {
    const x0 = corners[e * 2];
    const y0 = corners[e * 2 + 1];
    const x1 = corners[((e + 1) % 3) * 2];
    const y1 = corners[((e + 1) % 3) * 2 + 1];
    const side = (x, y) => (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
    const next = [];
    const n = out.length / 2;
    for (let i = 0; i < n; i += 1) {
      const px = out[i * 2];
      const py = out[i * 2 + 1];
      const qx = out[((i + 1) % n) * 2];
      const qy = out[((i + 1) % n) * 2 + 1];
      const sp = side(px, py);
      const sq = side(qx, qy);
      if (sp >= 0) next.push(px, py);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        next.push(px + t * (qx - px), py + t * (qy - py));
      }
    }
    out = next;
  }
  return out;
}

function polygonArea(p) {
  let area = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) area += p[j] * p[i + 1] - p[i] * p[j + 1];
  return Math.abs(area) / 2;
}

/** Whether a point lies within `reach` of any outline edge in the grid. */
function nearOutline(grid, edges, x, y, reach) {
  let near = false;
  const r2 = reach * reach;
  grid.query(x - reach, y - reach, x + reach, y + reach, (e) => {
    if (near) return;
    const ax = edges[e];
    const ay = edges[e + 1];
    const dx = edges[e + 2] - ax;
    const dy = edges[e + 3] - ay;
    const length2 = dx * dx + dy * dy || 1e-30;
    const t = Math.min(Math.max(((x - ax) * dx + (y - ay) * dy) / length2, 0), 1);
    const ex = ax + t * dx - x;
    const ey = ay + t * dy - y;
    if (ex * ex + ey * ey <= r2) near = true;
  });
  return near;
}

function edgeGrid(flat) {
  const { edges, box } = flat;
  const grid = makeGrid(box, edges.length / 4);
  for (let e = 0; e < edges.length; e += 4) {
    grid.add(e, Math.min(edges[e], edges[e + 2]), Math.min(edges[e + 1], edges[e + 3]), Math.max(edges[e], edges[e + 2]), Math.max(edges[e + 1], edges[e + 3]));
  }
  return grid;
}

/**
 * The overlaps between the caps of different parts on one section plane.
 * `caps` are { geometry (from buildCap), matrix (part to model), partId };
 * `plane` is the section plane in model coordinates; `tolerance` the width
 * below which an overlap counts as touching; `lift` moves the result towards
 * the viewer side of the plane. Returns a geometry in model coordinates, or null.
 */
export function buildOverlaps(caps, plane, { tolerance, lift = 0 }) {
  if (caps.length < 2) return null;
  const { u, v } = planeBasis(plane.normal);
  const flats = caps.map((cap) => flatten(cap, cap.matrix, u, v));
  const out = [];

  for (let i = 0; i < flats.length; i += 1) {
    for (let j = i + 1; j < flats.length; j += 1) {
      if (caps[i].partId === caps[j].partId) continue;
      const a = flats[i];
      const b = flats[j];
      const box = [Math.max(a.box[0], b.box[0]), Math.max(a.box[1], b.box[1]), Math.min(a.box[2], b.box[2]), Math.min(a.box[3], b.box[3])];
      if (box[0] >= box[2] || box[1] >= box[3]) continue;

      // B's triangles in a grid over the shared region.
      const grid = makeGrid(box, b.tris.length / 6);
      for (let k = 0; k < b.tris.length; k += 6) {
        const t = b.tris;
        const x0 = Math.min(t[k], t[k + 2], t[k + 4]);
        const y0 = Math.min(t[k + 1], t[k + 3], t[k + 5]);
        const x1 = Math.max(t[k], t[k + 2], t[k + 4]);
        const y1 = Math.max(t[k + 1], t[k + 3], t[k + 5]);
        if (x1 < box[0] || y1 < box[1] || x0 > box[2] || y0 > box[3]) continue;
        grid.add(k, x0, y0, x1, y1);
      }
      let edgesA = null;
      let edgesB = null;
      const seen = new Set();
      for (let k = 0; k < a.tris.length; k += 6) {
        const t = a.tris;
        const x0 = Math.min(t[k], t[k + 2], t[k + 4]);
        const y0 = Math.min(t[k + 1], t[k + 3], t[k + 5]);
        const x1 = Math.max(t[k], t[k + 2], t[k + 4]);
        const y1 = Math.max(t[k + 1], t[k + 3], t[k + 5]);
        if (x1 < box[0] || y1 < box[1] || x0 > box[2] || y0 > box[3]) continue;
        seen.clear();
        grid.query(x0, y0, x1, y1, (m) => {
          if (seen.has(m)) return;
          seen.add(m);
          const piece = clipByTriangle([t[k], t[k + 1], t[k + 2], t[k + 3], t[k + 4], t[k + 5]], b.tris, m);
          if (piece.length < 6 || polygonArea(piece) < tolerance * tolerance * 1e-3) return;
          // A sliver where the faces only touch lies along both outlines.
          let cx = 0;
          let cy = 0;
          for (let q = 0; q < piece.length; q += 2) {
            cx += piece[q];
            cy += piece[q + 1];
          }
          cx /= piece.length / 2;
          cy /= piece.length / 2;
          edgesA ??= edgeGrid(a);
          edgesB ??= edgeGrid(b);
          if (nearOutline(edgesA, a.edges, cx, cy, tolerance) && nearOutline(edgesB, b.edges, cx, cy, tolerance)) return;
          for (let q = 2; q + 2 < piece.length; q += 2) out.push(piece[0], piece[1], piece[q], piece[q + 1], piece[q + 2], piece[q + 3]);
        });
      }
    }
  }
  if (out.length === 0) return null;

  // Back to 3D, on the plane and lifted towards the side that was cut away.
  const origin = plane.normal.clone().multiplyScalar(-plane.constant - lift);
  const positions = new Float32Array((out.length / 2) * 3);
  for (let i = 0; i < out.length / 2; i += 1) {
    const x = out[i * 2];
    const y = out[i * 2 + 1];
    positions[i * 3] = origin.x + u.x * x + v.x * y;
    positions[i * 3 + 1] = origin.y + u.y * x + v.y * y;
    positions[i * 3 + 2] = origin.z + u.z * x + v.z * y;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) {
    normals[i] = -plane.normal.x;
    normals[i + 1] = -plane.normal.y;
    normals[i + 2] = -plane.normal.z;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}

export function createOverlapMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: OVERLAP_COLOR,
    roughness: 0.55,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}
