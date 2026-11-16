import { state, newId } from './state.js';
import { getMaterialDef } from './materials.js';
import { getLightPreset } from './environment.js';

/**
 * Keeps the user's settings across reloads in localStorage: scene, lighting
 * and output globally, and materials and saved views per STEP file name.
 * A custom HDRI is not stored because the file itself is not available later.
 */

const SETTINGS_KEY = 'cad-render-engine:settings';
const modelKey = (fileName) => `cad-render-engine:model:${fileName}`;

let saveTimer = null;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or disabled; the app works without it.
  }
}

function saveNow() {
  const custom = state.lighting.presetId === 'custom';
  write(SETTINGS_KEY, {
    scene: {
      ...state.scene,
      background: state.scene.background === 'environment' ? 'grey' : state.scene.background,
    },
    lighting: {
      presetId: custom ? 'studio-soft' : state.lighting.presetId,
      rotation: state.lighting.rotation,
      intensity: state.lighting.intensity,
    },
    output: state.output,
  });

  if (state.fileName && state.parts.length > 0) {
    write(modelKey(state.fileName), {
      partCount: state.parts.length,
      materials: state.materials.map((entry) => ({
        materialId: entry.materialId,
        colorHex: entry.colorHex,
        partIds: [...entry.partIds],
      })),
      views: state.views.map(({ name, position, target, fov }) => ({ name, position, target, fov })),
    });
  }
}

/** Saves shortly after the last change, so dragging a slider does not write constantly. */
export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 400);
}

// Do not lose the last change when the tab is closed or reloaded right after it.
window.addEventListener('pagehide', () => {
  if (saveTimer !== null) saveNow();
});

/** Restores scene, lighting and output settings at startup. */
export function restoreSettings() {
  const saved = read(SETTINGS_KEY);
  if (!saved) return;
  if (saved.scene) {
    if (typeof saved.scene.background === 'string') state.scene.background = saved.scene.background;
    if (typeof saved.scene.ground === 'boolean') state.scene.ground = saved.scene.ground;
  }
  if (saved.lighting) {
    state.lighting.presetId = getLightPreset(saved.lighting.presetId).id;
    if (Number.isFinite(saved.lighting.rotation)) state.lighting.rotation = saved.lighting.rotation;
    if (Number.isFinite(saved.lighting.intensity)) state.lighting.intensity = saved.lighting.intensity;
  }
  if (saved.output) {
    for (const key of Object.keys(state.output)) {
      if (typeof saved.output[key] === typeof state.output[key]) state.output[key] = saved.output[key];
    }
  }
}

/**
 * Restores materials and views for the model that was just loaded, if the
 * same file (by name and part count) was worked on before. Returns true if
 * anything was restored.
 */
export function restoreModel() {
  const saved = read(modelKey(state.fileName));
  if (!saved || saved.partCount !== state.parts.length) return false;

  state.materials = (saved.materials || []).map((entry) => ({
    id: newId(),
    materialId: getMaterialDef(entry.materialId).id,
    colorHex: entry.colorHex,
    partIds: new Set((entry.partIds || []).filter((id) => id >= 0 && id < state.parts.length)),
  }));
  state.views = (saved.views || []).map((view) => ({ id: newId(), ...view }));
  return state.materials.length > 0 || state.views.length > 0;
}
