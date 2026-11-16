import * as THREE from 'three';

// Faces in world space (Y up). The labels follow CAD convention, where Z is up
// and "front" looks along +Y, which is world -Z.
const FACES = [
  { label: 'Vorne', dir: [0, 0, 1], transform: '' },
  { label: 'Hinten', dir: [0, 0, -1], transform: 'rotateY(180deg)' },
  { label: 'Rechts', dir: [1, 0, 0], transform: 'rotateY(90deg)' },
  { label: 'Links', dir: [-1, 0, 0], transform: 'rotateY(-90deg)' },
  { label: 'Oben', dir: [0, 1, 0], transform: 'rotateX(90deg)' },
  { label: 'Unten', dir: [0, -1, 0], transform: 'rotateX(-90deg)' },
];

const SIZE = 64;
const HALF = SIZE / 2;
const AXIS_LENGTH = SIZE * 1.3;

// Axes start at the front-left-bottom corner. Directions are given in the
// cube's CSS space (x right, y down, z towards the viewer).
const AXES = [
  { name: 'X', color: '#e5484d', css: [1, 0, 0], transform: '' },
  { name: 'Y', color: '#46a758', css: [0, 0, -1], transform: 'rotateY(90deg)' },
  { name: 'Z', color: '#3e63dd', css: [0, -1, 0], transform: 'rotateZ(-90deg)' },
];

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.append(node);
  return node;
}

/**
 * Orientation cube in the corner of the viewport. It mirrors the camera
 * orientation; clicking a face or corner turns the view there, and the arrows
 * orbit in 15 degree steps.
 */
export class ViewCube {
  constructor(container, viewer) {
    this.viewer = viewer;
    this.root = el('div', 'viewcube', container);
    this.scene = el('div', 'viewcube-scene', this.root);
    this.cube = el('div', 'viewcube-cube', this.scene);

    for (const face of FACES) {
      const node = el('button', 'viewcube-face', this.cube);
      node.type = 'button';
      node.textContent = face.label;
      node.title = `Ansicht ${face.label}`;
      node.style.transform = `${face.transform} translateZ(${HALF}px)`;
      node.addEventListener('click', () => viewer.lookFrom(new THREE.Vector3(...face.dir)));
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
          this._corners = this._corners || [];
          this._corners.push(node);
        }
      }
    }

    this.axisLabels = [];
    for (const axis of AXES) {
      const line = el('div', 'viewcube-axis', this.cube);
      line.style.width = `${AXIS_LENGTH}px`;
      line.style.background = axis.color;
      line.style.transform = `translate3d(${-HALF}px, ${HALF}px, ${HALF}px) ${axis.transform}`;
      const label = el('span', 'viewcube-axis-label', this.scene);
      label.textContent = axis.name;
      label.style.color = axis.color;
      this.axisLabels.push({ axis, label });
    }

    const arrows = [
      { className: 'left', title: 'Nach links drehen', step: [-15, 0], glyph: '◀' },
      { className: 'right', title: 'Nach rechts drehen', step: [15, 0], glyph: '▶' },
      { className: 'up', title: 'Nach oben drehen', step: [0, 15], glyph: '▲' },
      { className: 'down', title: 'Nach unten drehen', step: [0, -15], glyph: '▼' },
    ];
    for (const arrow of arrows) {
      const node = el('button', `viewcube-arrow ${arrow.className}`, this.root);
      node.type = 'button';
      node.title = arrow.title;
      node.textContent = arrow.glyph;
      node.addEventListener('click', () => viewer.orbitBy(arrow.step[0], arrow.step[1]));
    }

    this._matrix = new THREE.Matrix4();
    this.update();
  }

  /** Call whenever the camera moved. */
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

    // Axis letters stay upright, so they are positioned in 2D at the projected axis tips.
    const origin = [-HALF, HALF, HALF];
    for (const { axis, label } of this.axisLabels) {
      const tip = origin.map((value, i) => value + axis.css[i] * (AXIS_LENGTH + 9));
      const x = m[0] * tip[0] + m[4] * tip[1] + m[8] * tip[2];
      const y = m[1] * tip[0] + m[5] * tip[1] + m[9] * tip[2];
      label.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }
}
