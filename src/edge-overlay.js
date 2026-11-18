import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * Edge lines for a rendering, as in a CAD view with edges. The path tracer
 * cannot draw lines, so they are drawn separately with WebGL from the same
 * camera, hidden where the model covers them, and laid over the finished
 * image. The lines are the CAD edges of the visible parts plus the outlines
 * of cut faces.
 */

/** Line width is given for a Full HD image and scaled with the image, so previews and large images look alike. */
const REFERENCE_SIZE = 1920;

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

    const lists = [];
    const edges = part.edges?.geometry.attributes.position;
    if (edges) lists.push(edges.array);
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
