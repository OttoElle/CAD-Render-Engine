import * as THREE from 'three';

/**
 * Hatching on cut faces, as in a technical drawing. The lines are a small
 * repeating texture; the cap geometry gets texture coordinates in millimetres
 * across the cut plane, so the lines keep their spacing on every part and
 * show up the same in the real-time view and in the rendering.
 */
export const HATCH_PATTERNS = {
  none: 'None',
  lines: 'Lines',
  cross: 'Cross',
};

const TEXTURE_SIZE = 128;

const textures = new Map();

/** A tile with the line(s) of one period over the base colour; shared between parts of the same colours. */
function hatchTexture(base, line, pattern, share) {
  const key = `${base}|${line}|${pattern}|${share}`;
  if (textures.has(key)) return textures.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  context.fillStyle = line;
  const width = Math.max(Math.round(TEXTURE_SIZE * share), 1);
  context.fillRect(0, 0, TEXTURE_SIZE, width);
  if (pattern === 'cross') context.fillRect(0, 0, width, TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  textures.set(key, texture);
  return texture;
}

/** A spacing of about `lines` lines across the box, rounded up to 1, 2 or 5 times a power of ten. */
export function autoHatchSpacing(box, lines = 60) {
  const size = box.isEmpty() ? 100 : box.getSize(new THREE.Vector3()).length();
  const raw = size / lines;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((factor) => factor * power >= raw) * power;
  return Number(step.toPrecision(3));
}

/**
 * The line spacing in mm: the user's, or one chosen from the model. With a
 * part's box, a part much smaller than the model gets closer lines, so that a
 * screw or pin still shows a few of them, as in a drawing.
 */
export function hatchSpacing(capStyle, modelBox, partBox = null) {
  if (capStyle.hatchSpacing > 0) return capStyle.hatchSpacing;
  const model = autoHatchSpacing(modelBox);
  return partBox && !partBox.isEmpty() ? Math.min(model, autoHatchSpacing(partBox, 12)) : model;
}

/**
 * Gives a cap geometry texture coordinates along the plane (in the part's
 * own coordinates), turned by the hatching angle and scaled to the spacing.
 */
export function applyHatchUv(geometry, plane, spacing, angleDegrees) {
  const normal = plane.normal;
  const u = new THREE.Vector3(Math.abs(normal.x) > 0.9 ? 0 : 1, Math.abs(normal.x) > 0.9 ? 1 : 0, 0);
  u.addScaledVector(normal, -u.dot(normal)).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);
  const angle = THREE.MathUtils.degToRad(angleDegrees);
  const along = u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v, Math.sin(angle));
  const across = v.clone().multiplyScalar(Math.cos(angle)).addScaledVector(u, -Math.sin(angle));
  const position = geometry.attributes.position;
  const uv = new Float32Array(position.count * 2);
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    uv[i * 2] = point.dot(along) / spacing;
    uv[i * 2 + 1] = point.dot(across) / spacing;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * A shade of a colour that stands out on it without being harsh: darker on
 * light and mid colours (dark blue lines on a blue part), lighter on dark ones.
 */
export function contrastColor(hex) {
  const color = new THREE.Color(hex);
  const hsl = color.getHSL({});
  const lightness = hsl.l > 0.28 ? hsl.l * 0.45 : Math.min(hsl.l + 0.32, 0.85);
  return `#${color.setHSL(hsl.h, Math.min(hsl.s * 1.1, 1), lightness).getHexString()}`;
}

/** Colour of the lines and outlines on a cut face of the given colour. */
export function hatchLineColor(capStyle, faceColor) {
  return capStyle.hatchAuto ? contrastColor(faceColor) : capStyle.hatchColor;
}

/**
 * Width of the outline along the edges of a cut face, in mm: a little wider
 * than a hatching line, and never more than a small share of the part, so the
 * outline of a small part does not cover its whole cut face.
 */
export function outlineWidth(capStyle, modelBox, partBox = null) {
  const width = hatchSpacing(capStyle, modelBox, partBox) * capStyle.hatchWidth * 1.4;
  if (!partBox || partBox.isEmpty()) return width;
  return Math.min(width, partBox.getSize(new THREE.Vector3()).length() * 0.015);
}

/** Whether cut faces get an outline: only with hatching, as in a drawing. */
export const hasOutline = (capStyle) => capStyle.outline && capStyle.hatch !== 'none' && Boolean(HATCH_PATTERNS[capStyle.hatch]);

/** Material of the outline band of a cut face. */
export function createOutlineMaterial(capStyle, faceColor) {
  return new THREE.MeshPhysicalMaterial({
    color: hatchLineColor(capStyle, faceColor),
    roughness: 0.6,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** Angle of the lines on a part: every other part turned by 90°, if the user wants that. */
export function hatchAngleFor(capStyle, partId) {
  return capStyle.hatchAlternate && partId % 2 === 1 ? capStyle.hatchAngle + 90 : capStyle.hatchAngle;
}

/**
 * The material of a part's cut faces. Without hatching: the part's own
 * material (null) or one in the chosen colour. With hatching: the lines over
 * the part's colour or the chosen colour.
 */
export function createCapMaterial(capStyle, partMaterial, partColor) {
  if (capStyle.hatch === 'none' || !HATCH_PATTERNS[capStyle.hatch]) {
    if (capStyle.mode !== 'color') return null;
    return new THREE.MeshPhysicalMaterial({ color: capStyle.color, roughness: 0.6, side: THREE.DoubleSide });
  }
  const base = capStyle.mode === 'color' ? capStyle.color : partColor;
  const map = hatchTexture(base, hatchLineColor(capStyle, base), capStyle.hatch, capStyle.hatchWidth ?? 0.14);
  if (capStyle.mode === 'color') {
    return new THREE.MeshPhysicalMaterial({ color: 0xffffff, map, roughness: 0.6, side: THREE.DoubleSide });
  }
  // Like the part, but without brushed marks, which would need tangents across the cut.
  const material = partMaterial.clone();
  material.color.set(0xffffff);
  material.map = map;
  material.anisotropy = 0;
  material.emissive?.setScalar(0);
  material.side = THREE.DoubleSide;
  return material;
}
