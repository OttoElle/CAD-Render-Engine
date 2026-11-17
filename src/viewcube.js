import * as THREE from 'three';
import { icon } from './icons.js';

// Faces in world space (Y up) with their outward normal in the cube's CSS space
// (x right, y down, z towards the viewer). The labels follow CAD convention,
// where Z is up and "front" looks along +Y, which is world -Z.
const FACES = [
  { label: 'Front', dir: [0, 0, 1], css: [0, 0, 1], transform: '' },
  { label: 'Back', dir: [0, 0, -1], css: [0, 0, -1], transform: 'rotateY(180deg)' },
  { label: 'Right', dir: [1, 0, 0], css: [1, 0, 0], transform: 'rotateY(90deg)' },
  { label: 'Left', dir: [-1, 0, 0], css: [-1, 0, 0], transform: 'rotateY(-90deg)' },
  { label: 'Top', dir: [0, 1, 0], css: [0, -1, 0], transform: 'rotateX(90deg)' },
  { label: 'Bottom', dir: [0, -1, 0], css: [0, 1, 0], transform: 'rotateX(-90deg)' },
];

const SIZE = 62;
const HALF = SIZE / 2;
const AXIS_LENGTH = SIZE * 1.42;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Axes start at the front-left-bottom corner, in CSS space.
const AXES = [
  { name: 'X', color: '#e5484d', css: [1, 0, 0] },
  { name: 'Y', color: '#3fb950', css: [0, 0, -1] },
  { name: 'Z', color: '#4a6cf7', css: [0, -1, 0] },
];

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.append(node);
  return node;
}

function svg(tag, attributes, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  parent?.append(node);
  return node;
}

/**
 * Orientation cube in the corner of the viewport. It mirrors the camera
 * orientation; clicking a face, edge or corner turns the view there, the chevrons
 * orbit and the curved arrows roll in 15 degree steps, and the house returns
 * to the standard view.
 */
export class ViewCube {
  constructor(container, viewer) {
    this.viewer = viewer;
    this.root = el('div', 'viewcube', container);
    this.scene = el('div', 'viewcube-scene', this.root);
    this.cube = el('div', 'viewcube-cube', this.scene);

    this.faces = [];
    for (const face of FACES) {
      const node = el('button', 'viewcube-face', this.cube);
      node.type = 'button';
      node.textContent = face.label;
      node.title = `${face.label} view`;
      node.style.transform = `${face.transform} translateZ(${HALF}px)`;
      node.addEventListener('click', () => viewer.lookFrom(new THREE.Vector3(...face.dir)));
      this.faces.push({ face, node });
    }

    // Corners give the eight isometric views.
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        for (const z of [-1, 1]) {
          const node = el('button', 'viewcube-corner', this.cube);
          node.type = 'button';
          node.title = 'Isometrische Ansicht';
          node.style.transform = `translate3d(${x * HALF}px, ${-y * HALF}px, ${z * HALF}px)`;
          node.addEventListener('click', () => viewer.lookFrom(new THREE.Vector3(x, y, z)));
        }
      }
    }

    // Edges give the twelve views halfway between two faces. Each edge is a
    // strip that lies along the cube's edge, tilted halfway between its faces.
    this.edges = [];
    const unit = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        const along = 3 - a - b;
        for (const sa of [-1, 1]) {
          for (const sb of [-1, 1]) {
            // Outward direction in CSS space, from the centre through the edge.
            const out = [0, 0, 0];
            out[a] = sa;
            out[b] = sb;
            const node = el('button', 'viewcube-edge', this.cube);
            node.type = 'button';
            node.title = 'Oblique view';
            const x = new THREE.Vector3(...unit[along]);
            const z = new THREE.Vector3(...out).normalize();
            const y = z.clone().cross(x);
            const t = new THREE.Vector3(...out).multiplyScalar(HALF);
            const m = [x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, t.x, t.y, t.z, 1];
            node.style.transform = `matrix3d(${m.map((v) => v.toFixed(5)).join(',')})`;
            // CSS space has y pointing down and the world has y pointing up.
            const world = new THREE.Vector3(out[0], -out[1], out[2]);
            node.addEventListener('click', () => viewer.lookFrom(world.clone()));
            this.edges.push({ node, out });
          }
        }
      }
    }

    // The axes are drawn flat on top, so their arrow heads always face the viewer.
    const overlay = svg('svg', { class: 'viewcube-axes', viewBox: '-90 -90 180 180' }, this.scene);
    this.axes = AXES.map((axis) => ({
      axis: { ...axis },
      line: svg('line', { stroke: axis.color, 'stroke-width': 1.4, 'stroke-linecap': 'round' }, overlay),
      head: svg('polygon', { fill: axis.color }, overlay),
      label: svg('text', { fill: axis.color, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, overlay),
    }));
    for (const { axis, label } of this.axes) label.textContent = axis.name;

    const buttons = [
      { className: 'up', title: 'Turn up', icon: 'chevronUp', run: () => viewer.orbitBy(0, 15) },
      { className: 'down', title: 'Turn down', icon: 'chevronDown', run: () => viewer.orbitBy(0, -15) },
      { className: 'left', title: 'Turn left', icon: 'chevronLeft', run: () => viewer.orbitBy(-15, 0) },
      { className: 'right', title: 'Turn right', icon: 'chevronRight', run: () => viewer.orbitBy(15, 0) },
      { className: 'home', title: 'Default view', icon: 'home', run: () => viewer.home() },
      { className: 'roll-left', title: 'Roll anticlockwise', icon: 'rollLeft', run: () => viewer.rollBy(-15) },
      { className: 'roll-right', title: 'Roll clockwise', icon: 'rollRight', run: () => viewer.rollBy(15) },
    ];
    for (const button of buttons) {
      const node = el('button', `viewcube-button ${button.className}`, this.root);
      node.type = 'button';
      node.title = button.title;
      node.setAttribute('aria-label', button.title);
      node.append(icon(button.icon, 18));
      node.addEventListener('click', button.run);
    }

    this._matrix = new THREE.Matrix4();
    this.update();
  }

  /** Call whenever the camera moved. */
  /**
   * Points the axis arrows the way the CAD axes lie in the scene, after the
   * model was turned to another up axis. `quaternion` is the model's rotation.
   */
  setModelRotation(quaternion) {
    for (const [i, { axis }] of this.axes.entries()) {
      const world = new THREE.Vector3().setComponent(i, 1).applyQuaternion(quaternion);
      axis.css = [world.x, -world.y, world.z].map((value) => Math.round(value));
    }
    this.update();
  }

  update() {
    const camera = this.viewer.camera;
    camera.updateMatrixWorld();
    // World-to-camera rotation, converted to CSS space by flipping Y on both sides.
    const e = this._matrix.extractRotation(camera.matrixWorldInverse).elements;
    const m = [
      e[0], -e[1], e[2], 0,
      -e[4], e[5], -e[6], 0,
      e[8], -e[9], e[10], 0,
      0, 0, 0, 1,
    ];
    this.cube.style.transform = `matrix3d(${m.map((v) => v.toFixed(5)).join(',')})`;

    // Faces pointing away are drawn dashed, like hidden edges in a drawing.
    for (const { face, node } of this.faces) {
      const depth = m[2] * face.css[0] + m[6] * face.css[1] + m[10] * face.css[2];
      node.classList.toggle('back', depth < 0.02);
    }
    for (const { node, out } of this.edges) {
      const depth = m[2] * out[0] + m[6] * out[1] + m[10] * out[2];
      node.classList.toggle('back', depth < 0.05);
    }

    const project = (point) => [
      m[0] * point[0] + m[4] * point[1] + m[8] * point[2],
      m[1] * point[0] + m[5] * point[1] + m[9] * point[2],
    ];
    const origin = [-HALF, HALF, HALF];
    const [ox, oy] = project(origin);
    for (const { axis, line, head, label } of this.axes) {
      const [tx, ty] = project(origin.map((value, i) => value + axis.css[i] * AXIS_LENGTH));
      const length = Math.hypot(tx - ox, ty - oy);
      const visible = length > 6;
      const ux = visible ? (tx - ox) / length : 0;
      const uy = visible ? (ty - oy) / length : 0;
      line.setAttribute('x1', ox.toFixed(1));
      line.setAttribute('y1', oy.toFixed(1));
      line.setAttribute('x2', (tx - ux * 5).toFixed(1));
      line.setAttribute('y2', (ty - uy * 5).toFixed(1));
      head.setAttribute(
        'points',
        [
          [tx, ty],
          [tx - ux * 8 - uy * 2.6, ty - uy * 8 + ux * 2.6],
          [tx - ux * 8 + uy * 2.6, ty - uy * 8 - ux * 2.6],
        ]
          .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
          .join(' '),
      );
      head.style.display = visible ? '' : 'none';
      // An axis pointing straight at the viewer has no direction on screen; park its letter above the origin.
      label.setAttribute('x', (visible ? tx + ux * 9 : ox).toFixed(1));
      label.setAttribute('y', (visible ? ty + uy * 9 : oy - 10).toFixed(1));
    }
  }
}
