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

const TEXTURE_SIZE = 64;
/** Share of the spacing a line is wide. */
const LINE_WIDTH = 0.14;

const textures = new Map();

/** A tile with the line(s) of one period over the base colour; shared between parts of the same colours. */
function hatchTexture(base, line, pattern) {
  const key = `${base}|${line}|${pattern}`;
  if (textures.has(key)) return textures.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  context.fillStyle = line;
  const width = Math.max(Math.round(TEXTURE_SIZE * LINE_WIDTH), 1);
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

/** A line spacing that suits the model: about 60 lines across it, rounded to 1, 2 or 5 times a power of ten. */
export function autoHatchSpacing(box) {
  const size = box.isEmpty() ? 100 : box.getSize(new THREE.Vector3()).length();
  const raw = size / 60;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((factor) => factor * power >= raw) * power;
  return Number(step.toPrecision(3));
}

/** The line spacing in mm: the user's, or one chosen from the model. */
export function hatchSpacing(capStyle, box) {
  return capStyle.hatchSpacing > 0 ? capStyle.hatchSpacing : autoHatchSpacing(box);
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
  const map = hatchTexture(base, capStyle.hatchColor, capStyle.hatch);
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
