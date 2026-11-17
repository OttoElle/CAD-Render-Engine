import * as THREE from 'three';

/**
 * Everything behind and below the model: colour gradients, the seamless
 * floor and the cove (a backdrop that curves up behind the model, as in a
 * photo studio). Shared by the real-time view and the path tracer.
 */

/** Gradient settings of a scene: { type: 'linear' | 'radial', from, to } with hex colours. */
export function sceneGradient(scene) {
  return { type: scene.gradientType, from: scene.gradientFrom, to: scene.gradientTo };
}

const srgb = (hex) => new THREE.Color(hex).convertLinearToSRGB();

/**
 * Colour of the gradient at a point of the image, as an sRGB colour. `x` and
 * `y` run from 0 to 1 across the image (y downwards). A linear gradient runs
 * from top to bottom, a radial one from the centre to the corners.
 */
export function gradientAt(gradient, x, y, aspect) {
  let t;
  if (gradient.type === 'radial') {
    const dx = (x - 0.5) * aspect;
    const dy = y - 0.5;
    t = Math.hypot(dx, dy) / Math.hypot(aspect / 2, 0.5);
  } else {
    t = y;
  }
  t = Math.min(Math.max(t, 0), 1);
  return srgb(gradient.from).lerp(srgb(gradient.to), t);
}

/**
 * CSS for the gradient behind the real-time view, laid out so that it spans
 * the output frame (the part of the view that is rendered).
 */
export function gradientCss(gradient, frame) {
  if (gradient.type === 'radial') {
    const radius = Math.hypot(frame.width, frame.height) / 2;
    const cx = frame.x + frame.width / 2;
    const cy = frame.y + frame.height / 2;
    return `radial-gradient(circle ${radius}px at ${cx}px ${cy}px, ${gradient.from}, ${gradient.to})`;
  }
  return `linear-gradient(to bottom, ${gradient.from} ${frame.y}px, ${gradient.to} ${frame.y + frame.height}px)`;
}

// --- Tone mapping -----------------------------------------------------------------

/** three.js NeutralToneMapping (Khronos PBR Neutral) for one linear colour. */
export function neutralToneMap(color) {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  const c = color.clone();
  const x = Math.min(c.r, c.g, c.b);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c.r -= offset;
  c.g -= offset;
  c.b -= offset;
  const peak = Math.max(c.r, c.g, c.b);
  if (peak < startCompression) return c;
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  c.multiplyScalar(newPeak / peak);
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return c.lerp(new THREE.Color(newPeak, newPeak, newPeak), g);
}

/**
 * Paints the gradient as the path tracer would show a background of these
 * colours: the colours count as light and go through the same tone mapping as
 * the rendering, so the floor, which is matched to them, blends in seamlessly.
 */
export function paintGradient(context, gradient, width, height) {
  const stops = 32;
  const fill =
    gradient.type === 'radial'
      ? context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.hypot(width, height) / 2)
      : context.createLinearGradient(0, 0, 0, height);
  const from = srgb(gradient.from);
  const to = srgb(gradient.to);
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const linear = from.clone().lerp(to, t).convertSRGBToLinear();
    const shown = neutralToneMap(linear).convertLinearToSRGB();
    fill.addColorStop(t, `#${shown.getHexString(THREE.NoColorSpace)}`);
  }
  context.fillStyle = fill;
  context.fillRect(0, 0, width, height);
}

/** The same as CSS, for the live preview of a rendering. */
export function renderedGradientCss(gradient) {
  const stops = [];
  const from = srgb(gradient.from);
  const to = srgb(gradient.to);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const shown = neutralToneMap(from.clone().lerp(to, t).convertSRGBToLinear()).convertLinearToSRGB();
    stops.push(`#${shown.getHexString(THREE.NoColorSpace)} ${t * 100}%`);
  }
  return gradient.type === 'radial'
    ? `radial-gradient(farthest-corner at 50% 50%, ${stops.join(', ')})`
    : `linear-gradient(to bottom, ${stops.join(', ')})`;
}

// --- Floor ------------------------------------------------------------------------

/** How much more a reflective floor reflects at grazing angles than from straight above. */
export const REFLECTION_F90_SCALE = 2.5;

/** Reflectance of a reflective floor towards a viewer at angle `cosTheta` (Schlick). */
export function floorFresnel(reflection, cosTheta) {
  const f90 = Math.min(1, reflection * REFLECTION_F90_SCALE);
  return reflection + (f90 - reflection) * Math.pow(1 - Math.min(Math.max(cosTheta, 0), 1), 5);
}

/**
 * Material settings of a floor or cove: matte, or with `reflection` (0 to 1)
 * a glossy surface whose reflections blur with `blur` (0 to 1).
 */
export function floorMaterialParams(reflection, blur, matteRoughness = 1) {
  if (!(reflection > 0)) {
    return { roughness: matteRoughness, metalness: 0, specularIntensity: 0 };
  }
  // A dielectric reflects 4 % head-on; the specular colour scales that to `reflection`.
  const f90 = Math.min(1, reflection * REFLECTION_F90_SCALE);
  const scale = Math.min(reflection / (0.04 * f90), 25);
  return {
    roughness: 0.02 + 0.45 * blur * blur,
    metalness: 0,
    ior: 1.5,
    specularIntensity: f90,
    specularColor: new THREE.Color(scale, scale, scale),
  };
}

/**
 * A large round floor as rings around the model that get wider outwards, so
 * that per-vertex colours are fine near the model and coarse far away.
 * Positions are relative to the centre below the model.
 */
export function buildFloorGeometry(radius, outerRadius) {
  const segments = 96;
  const rings = 44;
  const inner = radius * 0.02;
  const growth = Math.pow(outerRadius / inner, 1 / (rings - 1));
  const positions = [0, 0, 0];
  for (let ring = 0; ring < rings; ring++) {
    const r = inner * growth ** ring;
    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    }
  }
  const index = [];
  for (let s = 0; s < segments; s++) index.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let ring = 0; ring < rings - 1; ring++) {
    const a = 1 + ring * segments;
    const b = a + segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      index.push(a + s, a + s1, b + s, a + s1, b + s1, b + s);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}

// --- Cove -------------------------------------------------------------------------

/**
 * A studio cove: a floor that curves up into a back wall. Built facing +Z (the
 * wall stands at negative Z), with the floor at y = 0 and the model's centre
 * above the origin; the caller turns it to face the camera.
 */
export function buildCoveGeometry(radius) {
  const behind = radius * 2.2; // distance from the model's centre to the start of the curve
  const bend = radius * 2.5; // radius of the curve
  const front = radius * 60;
  const height = radius * 60;
  const width = radius * 120;

  // Profile in the z/y plane from the front edge, along the floor, around the curve and up the wall.
  const profile = [];
  const steps = 24;
  profile.push([front, 0], [front * 0.25, 0], [radius * 4, 0], [radius, 0], [-behind * 0.5, 0], [-behind, 0]);
  for (let i = 1; i <= steps; i++) {
    const angle = (i / steps) * (Math.PI / 2);
    profile.push([-behind - Math.sin(angle) * bend, bend - Math.cos(angle) * bend]);
  }
  profile.push([-behind - bend, bend + radius * 3], [-behind - bend, bend + radius * 12], [-behind - bend, height]);

  const columns = [-width / 2, -width / 8, -radius * 4, -radius, 0, radius, radius * 4, width / 8, width / 2];
  const positions = [];
  const normals = [];
  profile.forEach(([z, y], i) => {
    // Normal of the profile: up on the floor, towards +Z on the wall.
    const [zPrev, yPrev] = profile[Math.max(i - 1, 0)];
    const [zNext, yNext] = profile[Math.min(i + 1, profile.length - 1)];
    const tangent = new THREE.Vector2(zNext - zPrev, yNext - yPrev).normalize();
    for (const x of columns) {
      positions.push(x, y, z);
      normals.push(0, -tangent.x, tangent.y);
    }
  });
  const index = [];
  const n = columns.length;
  for (let i = 0; i < profile.length - 1; i++) {
    for (let c = 0; c < n - 1; c++) {
      const a = i * n + c;
      const b = a + n;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * Surface colour (linear) of the cove that makes its floor, where unshaded,
 * look exactly like the chosen colour, as a photographer exposes for the
 * backdrop. The wall gets less light and falls off naturally.
 */
export function coveAlbedo(coveColor, irradiance, intensity) {
  const target = new THREE.Color(coveColor);
  const scale = Math.PI / Math.max(intensity, 1e-3);
  return target.setRGB(
    Math.min((target.r * scale) / irradiance[0], 0.98),
    Math.min((target.g * scale) / irradiance[1], 0.98),
    Math.min((target.b * scale) / irradiance[2], 0.98),
    THREE.LinearSRGBColorSpace,
  );
}

/** Turns and places a cove so its wall stands behind the model as seen from the camera. */
export function placeCove(cove, camera, target, center, groundY) {
  const direction = camera.position.clone().sub(target);
  cove.rotation.set(0, Math.atan2(direction.x, direction.z), 0);
  cove.position.set(center.x, groundY, center.z);
  cove.updateMatrixWorld();
}

// --- Environment lookups ------------------------------------------------------------

/**
 * Reads the radiance of an equirectangular environment texture in a world
 * direction, taking the scene's environment rotation into account.
 */
export function environmentSampler(texture, rotation) {
  const { data, width, height } = texture.image;
  const channels = data.length / (width * height);
  const half = texture.type === THREE.HalfFloatType;
  const read = half ? (i) => THREE.DataUtils.fromHalfFloat(data[i]) : (i) => data[i];
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  return (direction, out) => {
    // The environment is turned by `rotation` around the vertical axis.
    const x = direction.x * cos + direction.z * sin;
    const z = -direction.x * sin + direction.z * cos;
    const y = Math.min(Math.max(direction.y, -1), 1);
    const u = Math.atan2(z, x) / (2 * Math.PI) + 0.5;
    const v = Math.asin(y) / Math.PI + 0.5;
    const column = Math.min(Math.floor(u * width), width - 1);
    let row = Math.min(Math.floor(v * height), height - 1);
    if (texture.flipY) row = height - 1 - row;
    const o = (row * width + column) * channels;
    return out.setRGB(read(o), read(o + 1), read(o + 2), THREE.LinearSRGBColorSpace);
  };
}
