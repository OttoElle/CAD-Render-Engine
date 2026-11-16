import * as THREE from 'three/webgpu';
import { WebGPUPathTracer, OIDNDenoiser } from 'three-gpu-pathtracer/webgpu';
import { initUNetFromURL } from 'oidn-webgpu';

// Open Image Denoise model, shipped with the app so rendering works offline.
const DENOISE_WEIGHTS_URL = `${import.meta.env.BASE_URL}oidn/rt_hdr_alb_nrm_small.tza`;

/**
 * Builds a clean copy of the viewer scene for the path tracer: visible parts
 * only, without edges, selection highlight or helper objects.
 */
function buildRenderScene(viewer, { transparent, ground }) {
  const scene = new THREE.Scene();

  const root = new THREE.Group();
  root.rotation.copy(viewer.modelRoot.rotation);
  for (const part of viewer.parts) {
    if (!part.mesh.visible) continue;
    const material = part.mesh.material.clone();
    material.emissive.setScalar(0);
    root.add(new THREE.Mesh(part.mesh.geometry, material));
  }
  scene.add(root);

  scene.environment = viewer.environmentTexture;
  scene.environmentRotation.copy(viewer.scene.environmentRotation);
  scene.environmentIntensity = viewer.scene.environmentIntensity;
  const environmentBackground = viewer.showsEnvironmentBackground;
  if (transparent) {
    scene.background = null;
  } else if (environmentBackground) {
    scene.background = viewer.environmentTexture;
    scene.backgroundRotation.copy(viewer.scene.backgroundRotation);
    scene.backgroundIntensity = viewer.scene.backgroundIntensity;
  } else {
    scene.background = viewer.backgroundColor.clone();
  }

  // An HDRI background brings its own ground, so no floor is added there.
  if (ground && !transparent && !environmentBackground) {
    // The path tracer has no shadow catcher, so the floor is a real surface.
    // Its albedo is chosen so that the unshadowed floor reflects exactly the
    // background colour and fades into it without a visible horizon.
    const { center, radius } = viewer.bounds;
    const background = viewer.backgroundColor;
    const irradiance = viewer.environmentTexture.userData.floorIrradiance;
    const intensity = Math.max(viewer.scene.environmentIntensity, 1e-3);
    const albedo = new THREE.Color().setRGB(
      Math.min((background.r * Math.PI) / (irradiance[0] * intensity), 0.98),
      Math.min((background.g * Math.PI) / (irradiance[1] * intensity), 0.98),
      Math.min((background.b * Math.PI) / (irradiance[2] * intensity), 0.98),
      THREE.LinearSRGBColorSpace,
    );
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 60, 96),
      new THREE.MeshPhysicalMaterial({ color: albedo, roughness: 1, metalness: 0, specularIntensity: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(center.x, viewer.ground.position.y, center.z);
    scene.add(floor);
  }

  scene.updateMatrixWorld(true);
  return scene;
}

/**
 * Starts a path traced rendering of the current view.
 *
 * Returns a handle with the output `canvas` (shows the image as it converges
 * and goes blank once finished), `done` (resolves with a PNG blob, or null if
 * cancelled), `cancel()`, and `finishNow()` to stop early and keep the image
 * accumulated so far.
 */
export async function startRender(viewer, options) {
  const { width, height, transparent, ground, fov, denoise, gentle, onProgress } = options;
  // Test hook for trying settings from the console, e.g. window.__renderDebug = { samples: 4 }.
  const debug = window.__renderDebug;
  const samples = debug?.samples ?? options.samples;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: true, trackTimestamp: true });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) {
    renderer.dispose();
    throw new Error('Dieser Browser stellt kein WebGPU bereit.');
  }
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.toneMapping = viewer.renderer.toneMapping;
  renderer.setClearColor(0x000000, 0);

  const scene = buildRenderScene(viewer, { transparent, ground });

  const camera = viewer.camera.clone();
  camera.aspect = width / height;
  if (fov) camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const pathTracer = new WebGPUPathTracer(renderer);
  pathTracer.maxSamples = samples;
  pathTracer.dynamicLowRes = false;
  pathTracer.renderDelay = 0;
  pathTracer.fadeDuration = 0;
  pathTracer.minSamples = 1;
  if (gentle) {
    // Small, fixed work packages keep weaker graphics hardware responsive
    // and avoid driver timeouts, at the cost of a longer render.
    pathTracer.adaptiveFrameBudget = false;
    pathTracer.frameBudget = 60000;
  } else {
    // Use most of each frame for path tracing; the page only shows a progress bar meanwhile.
    pathTracer.targetFrameTime = 30;
  }

  let denoiser = null;
  if (denoise) {
    denoiser = new OIDNDenoiser({ initUNetFromURL, auxWeightsUrl: DENOISE_WEIGHTS_URL });
    pathTracer.setDenoiser(denoiser);
  }

  if (debug) {
    if (debug.frameBudget) {
      pathTracer.adaptiveFrameBudget = false;
      pathTracer.frameBudget = debug.frameBudget;
    }
    if (debug.mega) pathTracer.useMegakernel(true);
  }

  let state = 'running'; // running | finishing | cancelled | complete
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // The caller may not be listening yet when a failure happens during setup.
  done.catch(() => {});

  function fail(error) {
    if (state === 'failed' || state === 'complete' || state === 'cancelled') return;
    state = 'failed';
    try {
      cleanup();
    } catch {
      // The device may already be gone; nothing left to free.
    }
    rejectDone(error);
  }

  renderer.onDeviceLost = (info) => {
    fail(
      new Error(
        `Die Grafikkarte hat das Rendering abgebrochen (${info.message || 'Gerät verloren'}). ` +
          'Versuche eine kleinere Bildgröße oder den schonenden Modus unter „Output“.',
      ),
    );
  };

  // If the denoiser cannot run (for example its model fails to load), keep the raw image.
  denoiser?.addEventListener('error', (event) => {
    console.warn('Denoising failed, keeping the raw image.', event.error);
    onProgress?.({ stage: 'denoise-failed', progress: null, samples });
    if (state === 'running') state = 'finishing';
  });

  pathTracer.addEventListener('progress', (event) => {
    if (state !== 'running') return;
    onProgress?.({ stage: event.stage, progress: event.progress, samples: event.samples?.avg ?? null });
  });
  pathTracer.addEventListener('complete', () => {
    if (state === 'running') state = 'finishing';
  });

  function cleanup() {
    pathTracer.dispose();
    for (const object of scene.children) {
      object.traverse((child) => {
        if (child.isMesh) child.material.dispose();
      });
    }
    renderer.dispose();
  }

  function frame() {
    if (state === 'failed') return;
    if (state === 'cancelled') {
      cleanup();
      resolveDone(null);
      return;
    }

    try {
      pathTracer.renderSample();
    } catch (error) {
      fail(error);
      return;
    }

    if (state === 'finishing') {
      // A WebGPU canvas only holds its image until the frame is presented,
      // so the PNG has to be captured right after drawing.
      state = 'complete';
      canvas.toBlob((blob) => {
        cleanup();
        resolveDone(blob);
      }, 'image/png');
      return;
    }
    requestAnimationFrame(frame);
  }

  try {
    pathTracer.setScene(scene, camera);
  } catch (error) {
    fail(error);
    throw error;
  }
  requestAnimationFrame(frame);

  return {
    canvas,
    done,
    cancel() {
      if (state === 'running' || state === 'finishing') state = 'cancelled';
    },
    finishNow() {
      if (state === 'running') state = 'finishing';
    },
  };
}
