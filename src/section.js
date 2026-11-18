import * as THREE from 'three';

/**
 * Section cuts: clipping part geometry at planes and closing the cut with a
 * cap, so that a cut solid looks solid instead of hollow.
 *
 * All planes here are THREE.Plane objects in the model's own (CAD) coordinates.
 * A plane keeps the side its normal points to; a vertex exactly on the plane
 * counts as kept. Using the same rule and the same arithmetic everywhere makes
 * the clipped surface and its cap meet without gaps.
 */

/** The plane of a section entry: perpendicular to a CAD axis at `position`, keeping the positive side unless flipped. */
export function sectionToPlane(section) {
  const sign = section.flip ? -1 : 1;
  const normal = new THREE.Vector3().setComponent(section.axis, sign);
  return new THREE.Plane(normal, -sign * section.position);
}

/** 1 if the box lies completely on the kept side of the plane, -1 if completely on the removed side, 0 if it is cut. */
export function boxSide(box, plane) {
  const { normal, constant } = plane;
  const near = new THREE.Vector3(
    normal.x >= 0 ? box.min.x : box.max.x,
    normal.y >= 0 ? box.min.y : box.max.y,
    normal.z >= 0 ? box.min.z : box.max.z,
  );
  const far = new THREE.Vector3(
    normal.x >= 0 ? box.max.x : box.min.x,
    normal.y >= 0 ? box.max.y : box.min.y,
    normal.z >= 0 ? box.max.z : box.min.z,
  );
  if (normal.dot(near) + constant >= 0) return 1;
  if (normal.dot(far) + constant < 0) return -1;
  return 0;
}

class FloatBuffer {
  constructor(capacity) {
    this.array = new Float32Array(Math.max(capacity, 64));
    this.length = 0;
  }

  reserve(extra) {
    if (this.length + extra <= this.array.length) return;
    const grown = new Float32Array(Math.max(this.array.length * 2, this.length + extra));
    grown.set(this.array.subarray(0, this.length));
    this.array = grown;
  }

  finish() {
    return this.array.slice(0, this.length);
  }
}

/**
 * Returns the part of a geometry that all planes keep, as a non-indexed
 * geometry with positions and normals, or null if nothing is left.
 */
export function clipGeometry(geometry, planes) {
  const position = geometry.attributes.position.array;
  const normal = geometry.attributes.normal?.array ?? null;
  const index = geometry.index?.array ?? null;
  const triangleCount = (index ? index.length : position.length / 3) / 3;
  const planeCount = planes.length;
  const planeData = planes.map((plane) => [plane.normal.x, plane.normal.y, plane.normal.z, plane.constant]);

  const outPosition = new FloatBuffer(triangleCount * 9);
  const outNormal = new FloatBuffer(triangleCount * 9);

  // Polygon being clipped: up to 3 + planeCount corners, 6 numbers each (position, normal).
  const maxCorners = 3 + planeCount + 1;
  let polygon = new Float64Array(maxCorners * 6);
  let scratch = new Float64Array(maxCorners * 6);
  const distance = new Float64Array(maxCorners);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = (index ? index[triangle * 3 + corner] : triangle * 3 + corner) * 3;
      const o = corner * 6;
      polygon[o] = position[vertex];
      polygon[o + 1] = position[vertex + 1];
      polygon[o + 2] = position[vertex + 2];
      polygon[o + 3] = normal ? normal[vertex] : 0;
      polygon[o + 4] = normal ? normal[vertex + 1] : 0;
      polygon[o + 5] = normal ? normal[vertex + 2] : 0;
    }
    let count = 3;

    for (let p = 0; p < planeCount && count > 0; p += 1) {
      const [nx, ny, nz, constant] = planeData[p];
      let kept = 0;
      for (let i = 0; i < count; i += 1) {
        const o = i * 6;
        distance[i] = nx * polygon[o] + ny * polygon[o + 1] + nz * polygon[o + 2] + constant;
        if (distance[i] >= 0) kept += 1;
      }
      if (kept === count) continue;
      if (kept === 0) {
        count = 0;
        break;
      }

      // Sutherland-Hodgman against this plane.
      let next = 0;
      for (let i = 0; i < count; i += 1) {
        const j = (i + 1) % count;
        const di = distance[i];
        const dj = distance[j];
        const a = i * 6;
        const b = j * 6;
        if (di >= 0) {
          for (let k = 0; k < 6; k += 1) scratch[next * 6 + k] = polygon[a + k];
          next += 1;
        }
        if (di >= 0 !== dj >= 0) {
          // Always interpolate from the kept corner, so neighbouring triangles get the identical point.
          const from = di >= 0 ? a : b;
          const to = di >= 0 ? b : a;
          const t = di >= 0 ? di / (di - dj) : dj / (dj - di);
          for (let k = 0; k < 6; k += 1) scratch[next * 6 + k] = polygon[from + k] + t * (polygon[to + k] - polygon[from + k]);
          next += 1;
        }
      }
      [polygon, scratch] = [scratch, polygon];
      count = next;
    }
    if (count < 3) continue;

    // Fan triangulation of the clipped polygon.
    const numbers = (count - 2) * 9;
    outPosition.reserve(numbers);
    outNormal.reserve(numbers);
    for (let i = 1; i < count - 1; i += 1) {
      for (const corner of [0, i, i + 1]) {
        const o = corner * 6;
        outPosition.array[outPosition.length++] = polygon[o];
        outPosition.array[outPosition.length++] = polygon[o + 1];
        outPosition.array[outPosition.length++] = polygon[o + 2];
        outNormal.array[outNormal.length++] = polygon[o + 3];
        outNormal.array[outNormal.length++] = polygon[o + 4];
        outNormal.array[outNormal.length++] = polygon[o + 5];
      }
    }
  }

  if (outPosition.length === 0) return null;
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(outPosition.finish(), 3));
  if (normal) result.setAttribute('normal', new THREE.BufferAttribute(outNormal.finish(), 3));
  else result.computeVertexNormals();
  return result;
}

/** Even-odd test whether point (x, y) lies inside the polygon given as flat [x0, y0, x1, y1, ...]. */
function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const xi = polygon[i];
    const yi = polygon[i + 1];
    const xj = polygon[j];
    const yj = polygon[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function signedArea(polygon) {
  let area = 0;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    area += polygon[j] * polygon[i + 1] - polygon[i] * polygon[j + 1];
  }
  return area / 2;
}

/**
 * Builds the cap that closes a solid where the plane cuts it: the outlines of
 * the cut are collected, sorted into outer contours and holes, and filled.
 * Returns a geometry with positions and normals facing the removed side, or
 * null if the plane does not cut the geometry or it is not a closed solid.
 *
 * `offset` moves the cap by that distance into the kept side, which keeps a
 * renderer from clipping the cap at its own plane.
 */
export function buildCap(geometry, plane, offset = 0) {
  const position = geometry.attributes.position.array;
  const index = geometry.index?.array ?? null;
  const triangleCount = (index ? index.length : position.length / 3) / 3;
  const { normal, constant } = plane;
  const nx = normal.x;
  const ny = normal.y;
  const nz = normal.z;

  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (boxSide(geometry.boundingBox, plane) !== 0) return null;
  const size = geometry.boundingBox.getSize(new THREE.Vector3()).length() || 1;

  // 2D coordinates in the plane.
  const u = new THREE.Vector3(Math.abs(nx) > 0.9 ? 0 : 1, Math.abs(nx) > 0.9 ? 1 : 0, 0);
  u.addScaledVector(normal, -u.dot(normal)).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);

  // Points where the outline passes, welded on a fine grid.
  const cell = size * 1e-5;
  const pointIds = new Map();
  const points = []; // x, y per point in plane coordinates
  const pointId = (x, y, z) => {
    const px = u.x * x + u.y * y + u.z * z;
    const py = v.x * x + v.y * y + v.z * z;
    const key = `${Math.round(px / cell)},${Math.round(py / cell)}`;
    let id = pointIds.get(key);
    if (id === undefined) {
      id = points.length / 2;
      pointIds.set(key, id);
      points.push(px, py);
    }
    return id;
  };

  const segments = []; // pairs of point ids
  const corner = [0, 0, 0];
  const d = [0, 0, 0];
  const cut = (from, to, dFrom, dTo) => {
    // Interpolated from the kept corner, exactly like clipGeometry does.
    const t = dFrom / (dFrom - dTo);
    return pointId(
      position[from] + t * (position[to] - position[from]),
      position[from + 1] + t * (position[to + 1] - position[from + 1]),
      position[from + 2] + t * (position[to + 2] - position[from + 2]),
    );
  };

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    let kept = 0;
    for (let i = 0; i < 3; i += 1) {
      corner[i] = (index ? index[triangle * 3 + i] : triangle * 3 + i) * 3;
      d[i] = nx * position[corner[i]] + ny * position[corner[i] + 1] + nz * position[corner[i] + 2] + constant;
      if (d[i] >= 0) kept += 1;
    }
    if (kept === 0 || kept === 3) continue;

    // The corner that is alone on its side; the outline crosses its two edges.
    const loneKept = kept === 1;
    const lone = d.findIndex((value) => value >= 0 === loneKept);
    const ends = [];
    for (let i = 0; i < 3; i += 1) {
      if (i === lone) continue;
      ends.push(
        loneKept ? cut(corner[lone], corner[i], d[lone], d[i]) : cut(corner[i], corner[lone], d[i], d[lone]),
      );
    }
    if (ends[0] !== ends[1]) segments.push(ends[0], ends[1]);
  }
  if (segments.length === 0) return null;

  // Chain the segments into closed loops.
  const pointCount = points.length / 2;
  const neighbours = Array.from({ length: pointCount }, () => []);
  for (let s = 0; s < segments.length; s += 2) {
    neighbours[segments[s]].push(s);
    neighbours[segments[s + 1]].push(s);
  }

  // Tessellated CAD faces do not always meet exactly (threads are a typical case), which
  // leaves the outline with small gaps. Loose ends are joined to the nearest other loose
  // end, closest pairs first, as long as the gap is tiny compared to the part.
  const loose = [];
  for (let id = 0; id < pointCount; id += 1) if (neighbours[id].length === 1) loose.push(id);
  if (loose.length > 1 && loose.length < 3000) {
    const tolerance = (size * 2e-3) ** 2;
    const pairs = [];
    for (let i = 0; i < loose.length; i += 1) {
      for (let j = i + 1; j < loose.length; j += 1) {
        const a = loose[i];
        const b = loose[j];
        const distance = (points[a * 2] - points[b * 2]) ** 2 + (points[a * 2 + 1] - points[b * 2 + 1]) ** 2;
        if (distance < tolerance) pairs.push([distance, a, b]);
      }
    }
    pairs.sort((first, second) => first[0] - second[0]);
    const merged = new Set();
    for (const [, a, b] of pairs) {
      if (merged.has(a) || merged.has(b)) continue;
      merged.add(a).add(b);
      // Redirect the one segment ending in b to end in a instead.
      const s = neighbours[b][0];
      if (segments[s] === b) segments[s] = a;
      else segments[s + 1] = a;
      neighbours[a].push(s);
      neighbours[b].length = 0;
    }
  }

  const used = new Uint8Array(segments.length / 2);
  const loops = [];
  for (let start = 0; start < segments.length; start += 2) {
    if (used[start / 2]) continue;
    used[start / 2] = 1;
    const first = segments[start];
    let current = segments[start + 1];
    const loop = [first];
    let closed = false;
    while (true) {
      if (current === first) {
        closed = true;
        break;
      }
      loop.push(current);
      const s = neighbours[current].find((candidate) => !used[candidate / 2]);
      if (s === undefined) break;
      used[s / 2] = 1;
      current = segments[s] === current ? segments[s + 1] : segments[s];
    }
    if (!closed || loop.length < 3) continue;
    const polygon = new Float64Array(loop.length * 2);
    loop.forEach((id, i) => {
      polygon[i * 2] = points[id * 2];
      polygon[i * 2 + 1] = points[id * 2 + 1];
    });
    const area = Math.abs(signedArea(polygon));
    if (area > cell * cell) loops.push({ polygon, area, depth: 0, holes: [] });
  }
  if (loops.length === 0) return null;

  // A loop inside an odd number of other loops is a hole of the smallest loop around it.
  loops.sort((a, b) => b.area - a.area);
  for (let i = 0; i < loops.length; i += 1) {
    const loop = loops[i];
    let parent = null;
    for (let j = 0; j < i; j += 1) {
      if (pointInPolygon(loop.polygon[0], loop.polygon[1], loops[j].polygon)) {
        loop.depth += 1;
        parent = loops[j];
      }
    }
    if (loop.depth % 2 === 1 && parent) parent.holes.push(loop);
  }

  const outPosition = [];
  const origin = normal.clone().multiplyScalar(offset - constant);
  const toVectors = (polygon) => {
    const vectors = [];
    for (let i = 0; i < polygon.length; i += 2) vectors.push(new THREE.Vector2(polygon[i], polygon[i + 1]));
    return vectors;
  };
  for (const loop of loops) {
    if (loop.depth % 2 === 1) continue;
    const contour = toVectors(loop.polygon);
    const holes = loop.holes.map((hole) => toVectors(hole.polygon));
    const all = [contour, ...holes].flat();
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      // Wind the triangle so it faces the removed side (against the plane normal).
      const pa = all[a];
      const pb = all[b];
      const pc = all[c];
      const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      for (const p of cross > 0 ? [pa, pc, pb] : [pa, pb, pc]) {
        outPosition.push(
          origin.x + u.x * p.x + v.x * p.y,
          origin.y + u.y * p.x + v.y * p.y,
          origin.z + u.z * p.x + v.z * p.y,
        );
      }
    }
  }
  if (outPosition.length === 0) return null;

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outPosition), 3));
  const normals = new Float32Array(outPosition.length);
  for (let i = 0; i < normals.length; i += 3) {
    normals[i] = -nx;
    normals[i + 1] = -ny;
    normals[i + 2] = -nz;
  }
  result.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  // Kept for drawing the outlines of the cut faces (see buildCapOutline).
  result.userData.outline = { loops, u, v, normal: normal.clone(), constant };
  return result;
}

/**
 * A thin band along every outline of a cap, inside the cut face, like the
 * border of a cut face in a CAD drawing. A band of triangles rather than
 * lines, so it shows in the path-traced rendering as well. `offset` places it
 * at that distance from the plane on the kept side, just in front of the cap.
 */
export function buildCapOutline(cap, width, offset = 0) {
  const outline = cap?.userData.outline;
  if (!outline || !(width > 0)) return null;
  const { loops, u, v, normal, constant } = outline;
  const origin = normal.clone().multiplyScalar(offset - constant);
  const out = [];
  const put = (x, y) => out.push(origin.x + u.x * x + v.x * y, origin.y + u.y * x + v.y * y, origin.z + u.z * x + v.z * y);

  for (const loop of loops) {
    const p = loop.polygon;
    const n = p.length / 2;
    if (n < 3) continue;
    // The cut face lies left of a counter-clockwise outer outline and right of a counter-clockwise hole.
    const side = (signedArea(p) > 0) === (loop.depth % 2 === 0) ? 1 : -1;
    // Each corner moves inwards along the mitre of its two edges, limited at sharp corners.
    const inner = new Float64Array(n * 2);
    for (let i = 0; i < n; i += 1) {
      const prev = (i - 1 + n) % n;
      const next = (i + 1) % n;
      let ax = p[i * 2] - p[prev * 2];
      let ay = p[i * 2 + 1] - p[prev * 2 + 1];
      let bx = p[next * 2] - p[i * 2];
      let by = p[next * 2 + 1] - p[i * 2 + 1];
      const la = Math.hypot(ax, ay) || 1;
      const lb = Math.hypot(bx, by) || 1;
      ax /= la;
      ay /= la;
      bx /= lb;
      by /= lb;
      // Left normals of both edges, averaged.
      let mx = -ay - by;
      let my = ax + bx;
      const lm = Math.hypot(mx, my);
      if (lm < 1e-9) {
        mx = -ay;
        my = ax;
      } else {
        mx /= lm;
        my /= lm;
      }
      const cos = Math.max(mx * -ay + my * ax, 0.35);
      const reach = Math.min(width / cos, Math.min(la, lb) * 4 + width);
      inner[i * 2] = p[i * 2] + side * mx * reach;
      inner[i * 2 + 1] = p[i * 2 + 1] + side * my * reach;
    }
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const ox0 = p[i * 2];
      const oy0 = p[i * 2 + 1];
      const ox1 = p[j * 2];
      const oy1 = p[j * 2 + 1];
      const ix0 = inner[i * 2];
      const iy0 = inner[i * 2 + 1];
      const ix1 = inner[j * 2];
      const iy1 = inner[j * 2 + 1];
      // Two triangles per edge; the band's material is double-sided.
      put(ox0, oy0);
      put(ox1, oy1);
      put(ix1, iy1);
      put(ox0, oy0);
      put(ix1, iy1);
      put(ix0, iy0);
    }
  }
  if (out.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
  const normals = new Float32Array(out.length);
  for (let i = 0; i < normals.length; i += 3) {
    normals[i] = -normal.x;
    normals[i + 1] = -normal.y;
    normals[i + 2] = -normal.z;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}
