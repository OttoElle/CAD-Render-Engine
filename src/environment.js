import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

/**
 * Lighting presets. Each one describes a procedural HDR environment: a vertical
 * colour gradient (`sky`) plus softboxes (or a sun disc). Generating them in
 * code keeps the app free of large HDRI downloads.
 *
 * The softboxes of a preset are only its starting point: choosing a preset
 * copies them into the project as editable lights (see presetLights).
 *
 * Angles are in degrees. Azimuth 0 is world +Z (in front of the model), 90 is
 * +X (to its right); elevation 90 is straight up. `width` and `height` are the
 * angular size, `intensity` the radiance of the preset definitions.
 */
export const LIGHT_PRESETS = [
  {
    id: 'studio-soft',
    label: 'Studio soft',
    sky: { top: [0.9, 0.9, 0.9], horizon: [0.55, 0.55, 0.55], bottom: [0.25, 0.25, 0.25] },
    lights: [
      { name: 'Key light', az: 10, el: 62, width: 70, height: 45, intensity: 5.5, color: [1, 0.99, 0.97] },
      { name: 'Fill light', az: -95, el: 25, width: 45, height: 50, intensity: 2.2, color: [0.95, 0.97, 1] },
      { name: 'Rim light', az: 150, el: 30, width: 40, height: 30, intensity: 2.0, color: [1, 1, 1] },
    ],
    shadow: { opacity: 0.28, radius: 9 },
  },
  {
    id: 'studio-high-key',
    label: 'Studio bright',
    sky: { top: [1.5, 1.5, 1.5], horizon: [1.15, 1.15, 1.15], bottom: [0.55, 0.55, 0.55] },
    lights: [
      { name: 'Top light', az: 0, el: 75, width: 80, height: 60, intensity: 4, color: [1, 1, 1] },
      { name: 'Strip left', az: -70, el: 20, width: 14, height: 60, intensity: 6, color: [1, 1, 1] },
      { name: 'Strip right', az: 70, el: 20, width: 14, height: 60, intensity: 6, color: [1, 1, 1] },
    ],
    shadow: { opacity: 0.18, radius: 12 },
  },
  {
    id: 'studio-contrast',
    label: 'Studio high contrast',
    sky: { top: [0.06, 0.06, 0.065], horizon: [0.04, 0.04, 0.045], bottom: [0.02, 0.02, 0.02] },
    lights: [
      { name: 'Key light', az: -35, el: 48, width: 26, height: 34, intensity: 22, color: [1, 0.98, 0.95] },
      { name: 'Rim light', az: 140, el: 30, width: 10, height: 50, intensity: 12, color: [0.9, 0.95, 1] },
      { name: 'Bounce', az: 75, el: 8, width: 30, height: 14, intensity: 1.5, color: [1, 1, 1] },
    ],
    shadow: { opacity: 0.5, radius: 4 },
  },
  {
    id: 'studio-rim',
    label: 'Studio rim light',
    sky: { top: [0.03, 0.03, 0.035], horizon: [0.02, 0.02, 0.025], bottom: [0.01, 0.01, 0.01] },
    lights: [
      { name: 'Strip left', az: -135, el: 22, width: 8, height: 70, intensity: 26, color: [0.92, 0.96, 1] },
      { name: 'Strip right', az: 135, el: 22, width: 8, height: 70, intensity: 26, color: [0.92, 0.96, 1] },
      { name: 'Top light', az: 0, el: 70, width: 40, height: 30, intensity: 4, color: [1, 0.98, 0.95] },
      { name: 'Bounce', az: 20, el: 10, width: 50, height: 20, intensity: 0.8, color: [1, 1, 1] },
    ],
    shadow: { opacity: 0.4, radius: 8 },
  },
  {
    id: 'studio-top',
    label: 'Studio top light',
    sky: { top: [0.35, 0.35, 0.35], horizon: [0.3, 0.3, 0.3], bottom: [0.12, 0.12, 0.12] },
    lights: [
      { name: 'Top light', az: 0, el: 82, width: 90, height: 90, intensity: 5, color: [1, 0.99, 0.97] },
      { name: 'Front reflector', az: 0, el: 12, width: 60, height: 18, intensity: 1.2, color: [1, 1, 1] },
    ],
    shadow: { opacity: 0.45, radius: 14 },
  },
  {
    id: 'daylight',
    label: 'Daylight',
    sky: { top: [0.35, 0.55, 1.0], horizon: [1.0, 1.05, 1.15], bottom: [0.35, 0.33, 0.3] },
    lights: [{ name: 'Sun', az: 40, el: 50, width: 3.5, height: 3.5, intensity: 420, color: [1, 0.96, 0.88], round: true }],
    shadow: { opacity: 0.45, radius: 2.5 },
  },
  {
    id: 'overcast',
    label: 'Overcast',
    sky: { top: [1.35, 1.38, 1.45], horizon: [1.05, 1.07, 1.12], bottom: [0.3, 0.29, 0.27] },
    lights: [],
    shadow: { opacity: 0.3, radius: 16 },
  },
  {
    id: 'hall',
    label: 'Workshop',
    sky: { top: [0.18, 0.17, 0.16], horizon: [0.28, 0.27, 0.25], bottom: [0.12, 0.11, 0.1] },
    lights: [
      { name: 'Ceiling light 1', az: -40, el: 55, width: 5, height: 28, intensity: 30, color: [1, 0.95, 0.86] },
      { name: 'Ceiling light 2', az: 20, el: 62, width: 5, height: 28, intensity: 30, color: [1, 0.95, 0.86] },
      { name: 'Ceiling light 3', az: 80, el: 55, width: 5, height: 28, intensity: 30, color: [1, 0.95, 0.86] },
      { name: 'Window band', az: 180, el: 18, width: 120, height: 10, intensity: 3, color: [0.85, 0.92, 1] },
    ],
    shadow: { opacity: 0.4, radius: 6 },
  },
];

const BY_ID = new Map(LIGHT_PRESETS.map((preset) => [preset.id, preset]));

export function getLightPreset(id) {
  return BY_ID.get(id) || LIGHT_PRESETS[0];
}

const DEG = Math.PI / 180;

/** Largest angular size of a softbox; beyond that the rectangle mapping breaks down. */
export const MAX_LIGHT_SIZE = 150;

function directionFromAngles(az, el) {
  const cosEl = Math.cos(el * DEG);
  return new THREE.Vector3(cosEl * Math.sin(az * DEG), Math.sin(el * DEG), cosEl * Math.cos(az * DEG));
}

/** Angular area of a light in square degrees. */
const lightArea = (light) => light.width * light.height * (light.round ? Math.PI / 4 : 1);

/**
 * Radiance of a light. Lights are described by their power, which is spread
 * over their angular area: a larger softbox gives the same amount of light,
 * only softer.
 */
const radianceOf = (light) => (light.power * 1000) / Math.max(lightArea(light), 0.01);

const linearToHex = (rgb) => `#${new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace).getHexString()}`;

/**
 * The softboxes of a preset as editable lights:
 * { name, az, el, width, height, power, color (hex), round, enabled }.
 */
export function presetLights(preset) {
  return preset.lights.map((light) => ({
    name: light.name,
    az: light.az,
    el: light.el,
    width: light.width,
    height: light.height,
    power: Number(((light.intensity * lightArea(light)) / 1000).toPrecision(3)),
    color: linearToHex(light.color),
    round: Boolean(light.round),
    enabled: true,
  }));
}

/** A new softbox, placed above and to the left of the camera's usual view. */
export function newLight(name) {
  return { name, az: -45, el: 40, width: 30, height: 30, power: 5, color: '#ffffff', round: false, enabled: true };
}

/** Checks a stored light and fills in what is missing. Returns null for unusable data. */
export function sanitizeLight(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const number = (value, min, max, fallback) =>
    Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
  const base = newLight('Softbox');
  return {
    name: typeof saved.name === 'string' && saved.name ? saved.name : base.name,
    az: number(saved.az, -360, 360, base.az),
    el: number(saved.el, -90, 90, base.el),
    width: number(saved.width, 0.5, MAX_LIGHT_SIZE, base.width),
    height: number(saved.height, 0.5, MAX_LIGHT_SIZE, base.height),
    power: number(saved.power, 0, 10000, base.power),
    color: /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : base.color,
    round: Boolean(saved.round),
    enabled: saved.enabled !== false,
  };
}

/** The light that drives the real-time ground shadow: the strongest one, or null without lights. */
function keyLight(lights) {
  let best = null;
  for (const light of lights) {
    if (light.enabled && light.power > 0 && (!best || light.power > best.power)) best = light;
  }
  return best;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Fills an equirectangular RGB buffer (bottom row first) with a sky gradient. */
function fillSky(data, width, height, sky) {
  const { top, horizon, bottom } = sky;
  for (let j = 0; j < height; j++) {
    const sinEl = Math.sin(((j + 0.5) / height - 0.5) * Math.PI);
    // Gradient: bottom -> horizon -> top, with most of the change near the horizon.
    const t = Math.pow(Math.abs(sinEl), 0.6);
    const to = sinEl >= 0 ? top : bottom;
    const r = horizon[0] + (to[0] - horizon[0]) * t;
    const g = horizon[1] + (to[1] - horizon[1]) * t;
    const b = horizon[2] + (to[2] - horizon[2]) * t;
    for (let i = 0, o = j * width * 3; i < width; i++, o += 3) {
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
    }
  }
}

/**
 * Adds one softbox to an equirectangular RGB buffer. Only the pixels around
 * the light are visited, so even many lights stay quick to update.
 */
function addLight(data, width, height, light) {
  const forward = directionFromAngles(light.az, light.el);
  const right = new THREE.Vector3(0, 1, 0).cross(forward);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const up = forward.clone().cross(right).normalize();
  const halfW = (Math.min(light.width, MAX_LIGHT_SIZE) / 2) * DEG;
  const halfH = (Math.min(light.height, MAX_LIGHT_SIZE) / 2) * DEG;
  const color = new THREE.Color(light.color);
  const radiance = radianceOf(light);

  // Angular radius around the light's centre that contains it, plus a pixel of margin.
  const pixel = Math.PI / height;
  const reach = Math.atan(Math.hypot(Math.tan(halfW), Math.tan(halfH))) + pixel;
  const el = light.el * DEG;
  const rowFrom = Math.max(Math.floor(((el - reach) / Math.PI + 0.5) * height), 0);
  const rowTo = Math.min(Math.ceil(((el + reach) / Math.PI + 0.5) * height), height - 1);
  let columnFrom = 0;
  let columnTo = width - 1;
  if (Math.abs(el) + reach < Math.PI / 2 - pixel) {
    const spread = Math.asin(Math.min(Math.sin(reach) / Math.cos(Math.abs(el) + reach), 1)) + pixel;
    if (spread < Math.PI) {
      const center = (((Math.PI / 2 - light.az * DEG) / (2 * Math.PI) + 0.5) * width) - 0.5;
      columnFrom = Math.floor(center - (spread / (2 * Math.PI)) * width);
      columnTo = Math.ceil(center + (spread / (2 * Math.PI)) * width);
    }
  }

  const dir = new THREE.Vector3();
  for (let j = rowFrom; j <= rowTo; j++) {
    const rowEl = ((j + 0.5) / height - 0.5) * Math.PI;
    const sinEl = Math.sin(rowEl);
    const cosEl = Math.cos(rowEl);
    for (let column = columnFrom; column <= columnTo; column++) {
      const i = ((column % width) + width) % width;
      const phi = ((i + 0.5) / width - 0.5) * 2 * Math.PI;
      dir.set(cosEl * Math.cos(phi), sinEl, cosEl * Math.sin(phi));
      const f = dir.dot(forward);
      if (f <= 0) continue;
      const x = Math.atan2(dir.dot(right), f) / halfW;
      const y = Math.atan2(dir.dot(up), f) / halfH;
      const distance = light.round ? Math.hypot(x, y) : Math.max(Math.abs(x), Math.abs(y));
      if (distance >= 1) continue;
      // Soft edge so the softboxes do not alias in reflections.
      const weight = (1 - smoothstep(0.8, 1, distance)) * radiance;
      const o = (j * width + i) * 3;
      data[o] += color.r * weight;
      data[o + 1] += color.g * weight;
      data[o + 2] += color.b * weight;
    }
  }
}

/** Irradiance arriving on a horizontal floor, used to match the floor to the background. */
function floorIrradiance(data, width, height) {
  const irradiance = [0, 0, 0];
  const solidAngleStep = (Math.PI / height) * ((2 * Math.PI) / width);
  for (let j = Math.floor(height / 2); j < height; j++) {
    const el = ((j + 0.5) / height - 0.5) * Math.PI;
    const weight = Math.sin(el) * Math.cos(el) * solidAngleStep;
    if (weight <= 0) continue;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0, o = j * width * 3; i < width; i++, o += 3) {
      r += data[o];
      g += data[o + 1];
      b += data[o + 2];
    }
    irradiance[0] += r * weight;
    irradiance[1] += g * weight;
    irradiance[2] += b * weight;
  }
  return irradiance.map((value) => Math.max(value, 1e-4));
}

/** Packs an RGB float buffer into a half float environment texture. */
function toEnvironmentTexture(data, width, height) {
  const half = new Uint16Array(width * height * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let p = 0; p < width * height; p++) {
    half[p * 4] = THREE.DataUtils.toHalfFloat(Math.min(data[p * 3], 65000));
    half[p * 4 + 1] = THREE.DataUtils.toHalfFloat(Math.min(data[p * 3 + 1], 65000));
    half[p * 4 + 2] = THREE.DataUtils.toHalfFloat(Math.min(data[p * 3 + 2], 65000));
    half[p * 4 + 3] = one;
  }

  const texture = new THREE.DataTexture(half, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  texture.userData.floorIrradiance = floorIrradiance(data, width, height);
  return texture;
}

/**
 * Renders the lighting into an equirectangular HDR texture (linear, half
 * float), which lights both the real-time view and the path tracer. `base` is
 * a preset (its sky gradient is used) or a user HDRI loaded with loadHdriFile;
 * `lights` are the editable softboxes on top of it.
 */
export function buildEnvironmentTexture(base, lights = [], width = 1024) {
  const active = lights.filter((light) => light.enabled && light.power > 0);
  let data;
  let height;
  if (base.isTexture) {
    ({ data, width, height } = hdriPixels(base));
    data = data.slice();
  } else {
    height = width / 2;
    data = new Float32Array(width * height * 3);
    fillSky(data, width, height, base.sky);
  }
  for (const light of active) addLight(data, width, height, light);

  const texture = toEnvironmentTexture(data, width, height);
  const key = keyLight(active);
  texture.userData.keyDirection = key
    ? directionFromAngles(key.az, Math.max(key.el, 20))
    : base.isTexture
      ? base.userData.keyDirection.clone()
      : new THREE.Vector3(0.3, 1, 0.3).normalize();
  return texture;
}

/** Widest HDRI that softboxes are painted into; larger files are scaled down for that. */
const MAX_COMPOSITE_WIDTH = 2048;

/**
 * The pixels of a loaded HDRI as linear RGB floats, bottom row first like the
 * procedural environments, scaled down to at most MAX_COMPOSITE_WIDTH. Cached
 * on the texture, since painting softboxes needs them on every change.
 */
function hdriPixels(texture) {
  if (texture.userData.pixels) return texture.userData.pixels;
  const { data: source, width: sourceWidth, height: sourceHeight } = texture.image;
  const channels = source.length / (sourceWidth * sourceHeight);
  const read =
    texture.type === THREE.HalfFloatType ? (index) => THREE.DataUtils.fromHalfFloat(source[index]) : (index) => source[index];
  const factor = Math.max(Math.ceil(sourceWidth / MAX_COMPOSITE_WIDTH), 1);
  const width = Math.floor(sourceWidth / factor);
  const height = Math.floor(sourceHeight / factor);
  const data = new Float32Array(width * height * 3);
  const scale = 1 / (factor * factor);

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < factor; dy++) {
        // With flipY the image rows run top to bottom.
        const sourceRow = j * factor + dy;
        const row = texture.flipY ? sourceHeight - 1 - sourceRow : sourceRow;
        for (let dx = 0; dx < factor; dx++) {
          const o = (row * sourceWidth + i * factor + dx) * channels;
          r += Math.min(read(o), 65000);
          g += Math.min(read(o + 1), 65000);
          b += Math.min(read(o + 2), 65000);
        }
      }
      const o = (j * width + i) * 3;
      data[o] = r * scale;
      data[o + 1] = g * scale;
      data[o + 2] = b * scale;
    }
  }
  texture.userData.pixels = { data, width, height };
  return texture.userData.pixels;
}

/** Shadow settings used for the real-time ground shadow under a user-supplied HDRI. */
export const CUSTOM_SHADOW = { opacity: 0.35, radius: 5 };

/**
 * Loads a user-supplied HDRI (.hdr or .exr, equirectangular) as lighting.
 * Besides the texture this works out what the procedural presets know by
 * construction: how much light reaches the floor, and where the brightest
 * light comes from (for the real-time ground shadow).
 */
export async function loadHdriFile(file) {
  const isExr = /\.exr$/i.test(file.name);
  if (!isExr && !/\.hdr$/i.test(file.name)) {
    throw new Error('Please choose an HDRI file in .hdr or .exr format.');
  }

  const url = URL.createObjectURL(file);
  let texture;
  try {
    texture = await (isExr ? new EXRLoader() : new HDRLoader()).loadAsync(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.wrapS = THREE.RepeatWrapping;

  const { data, width, height } = texture.image;
  const channels = data.length / (width * height);
  const read =
    texture.type === THREE.HalfFloatType ? (index) => THREE.DataUtils.fromHalfFloat(data[index]) : (index) => data[index];

  // Sample on a coarse grid; lighting statistics do not need every pixel.
  const stepX = Math.max(Math.floor(width / 512), 1);
  const stepY = Math.max(Math.floor(height / 256), 1);
  const solidAngleStep = ((Math.PI * stepY) / height) * ((2 * Math.PI * stepX) / width);
  const irradiance = [0, 0, 0];
  const key = new THREE.Vector3();
  const dir = new THREE.Vector3();

  for (let row = 0; row < height; row += stepY) {
    // Image rows run top to bottom when flipY is set, bottom to top otherwise.
    const v = texture.flipY ? 1 - (row + 0.5) / height : (row + 0.5) / height;
    const el = (v - 0.5) * Math.PI;
    const sinEl = Math.sin(el);
    const cosEl = Math.cos(el);
    for (let column = 0; column < width; column += stepX) {
      const o = (row * width + column) * channels;
      const r = Math.min(read(o), 5000);
      const g = Math.min(read(o + 1), 5000);
      const b = Math.min(read(o + 2), 5000);
      if (sinEl <= 0) continue;

      const weight = sinEl * cosEl * solidAngleStep;
      irradiance[0] += r * weight;
      irradiance[1] += g * weight;
      irradiance[2] += b * weight;

      // The light-weighted mean direction is a stable estimate of the main light.
      const phi = ((column + 0.5) / width - 0.5) * 2 * Math.PI;
      dir.set(cosEl * Math.cos(phi), sinEl, cosEl * Math.sin(phi));
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      key.addScaledVector(dir, luminance * luminance * cosEl);
    }
  }

  if (key.lengthSq() === 0) key.set(0.3, 1, 0.3);
  key.normalize();
  // Keep the shadow light well above the horizon so the ground shadow stays readable.
  key.y = Math.max(key.y, 0.35);
  key.normalize();

  texture.userData.floorIrradiance = irradiance.map((value) => Math.max(value, 1e-4));
  texture.userData.keyDirection = key;
  return texture;
}
