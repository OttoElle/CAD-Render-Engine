import * as THREE from 'three';

/**
 * Lighting presets. Each one describes a procedural HDR environment: a vertical
 * colour gradient plus rectangular softboxes (or a sun disc). Generating them in
 * code keeps the app free of large HDRI downloads.
 *
 * Angles are in degrees. Azimuth 0 is world +Z, 90 is +X; elevation 90 is straight up.
 * The first light is the key light and also drives the ground shadow in the
 * real-time view.
 */
export const LIGHT_PRESETS = [
  {
    id: 'studio-soft',
    label: 'Studio weich',
    sky: { top: [0.9, 0.9, 0.9], horizon: [0.55, 0.55, 0.55], bottom: [0.25, 0.25, 0.25] },
    lights: [
      { az: 10, el: 62, width: 70, height: 45, intensity: 5.5, color: [1, 0.99, 0.97] },
      { az: -95, el: 25, width: 45, height: 50, intensity: 2.2, color: [0.95, 0.97, 1] },
      { az: 150, el: 30, width: 40, height: 30, intensity: 2.0, color: [1, 1, 1] },
    ],
    shadow: { opacity: 0.28, radius: 9 },
  },
  {
    id: 'studio-contrast',
    label: 'Studio kontrastreich',
    sky: { top: [0.06, 0.06, 0.065], horizon: [0.04, 0.04, 0.045], bottom: [0.02, 0.02, 0.02] },
    lights: [
      { az: -35, el: 48, width: 26, height: 34, intensity: 22, color: [1, 0.98, 0.95] },
      { az: 140, el: 30, width: 10, height: 50, intensity: 12, color: [0.9, 0.95, 1] },
      { az: 75, el: 8, width: 30, height: 14, intensity: 1.5, color: [1, 1, 1] },
    ],
    shadow: { opacity: 0.5, radius: 4 },
  },
  {
    id: 'daylight',
    label: 'Tageslicht',
    sky: { top: [0.35, 0.55, 1.0], horizon: [1.0, 1.05, 1.15], bottom: [0.35, 0.33, 0.3] },
    lights: [{ az: 40, el: 50, width: 3.5, height: 3.5, intensity: 420, color: [1, 0.96, 0.88], round: true }],
    shadow: { opacity: 0.45, radius: 2.5 },
  },
];

const BY_ID = new Map(LIGHT_PRESETS.map((preset) => [preset.id, preset]));

export function getLightPreset(id) {
  return BY_ID.get(id) || LIGHT_PRESETS[0];
}

const DEG = Math.PI / 180;

function directionFromAngles(az, el) {
  const cosEl = Math.cos(el * DEG);
  return new THREE.Vector3(cosEl * Math.sin(az * DEG), Math.sin(el * DEG), cosEl * Math.cos(az * DEG));
}

/** Direction from the scene towards the key light of a preset. */
export function keyLightDirection(preset) {
  const key = preset.lights[0];
  return directionFromAngles(key.az, key.el);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Renders a preset into an equirectangular HDR texture (linear, half float).
 * The same texture lights the real-time view and, later, the path tracer.
 */
export function buildEnvironmentTexture(preset, width = 1024) {
  const height = width / 2;
  const data = new Float32Array(width * height * 3);

  const lights = preset.lights.map((light) => {
    const forward = directionFromAngles(light.az, light.el);
    const right = new THREE.Vector3(0, 1, 0).cross(forward).normalize();
    const up = forward.clone().cross(right).normalize();
    return { ...light, forward, right, up, halfW: (light.width / 2) * DEG, halfH: (light.height / 2) * DEG };
  });

  const { top, horizon, bottom } = preset.sky;
  const dir = new THREE.Vector3();

  for (let j = 0; j < height; j++) {
    const el = ((j + 0.5) / height - 0.5) * Math.PI;
    const sinEl = Math.sin(el);
    const cosEl = Math.cos(el);
    // Gradient: bottom -> horizon -> top, with most of the change near the horizon.
    const t = Math.pow(Math.abs(sinEl), 0.6);
    const from = horizon;
    const to = sinEl >= 0 ? top : bottom;
    const skyR = from[0] + (to[0] - from[0]) * t;
    const skyG = from[1] + (to[1] - from[1]) * t;
    const skyB = from[2] + (to[2] - from[2]) * t;

    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width - 0.5) * 2 * Math.PI;
      dir.set(cosEl * Math.cos(phi), sinEl, cosEl * Math.sin(phi));

      let r = skyR;
      let g = skyG;
      let b = skyB;

      for (const light of lights) {
        const f = dir.dot(light.forward);
        if (f <= 0) continue;
        const x = Math.atan2(dir.dot(light.right), f) / light.halfW;
        const y = Math.atan2(dir.dot(light.up), f) / light.halfH;
        const distance = light.round ? Math.hypot(x, y) : Math.max(Math.abs(x), Math.abs(y));
        if (distance >= 1) continue;
        // Soft edge so the softboxes do not alias in reflections.
        const weight = (1 - smoothstep(0.8, 1, distance)) * light.intensity;
        r += light.color[0] * weight;
        g += light.color[1] * weight;
        b += light.color[2] * weight;
      }

      const o = (j * width + i) * 3;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
    }
  }

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
  return texture;
}
