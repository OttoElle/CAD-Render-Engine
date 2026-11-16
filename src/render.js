import * as THREE from 'three/webgpu';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';

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
  scene.background = transparent ? null : viewer.scene.background.clone();

  if (ground && !transparent) {
    // The path tracer has no shadow catcher, so the floor is a real surface.
    // Its albedo is chosen so that the unshadowed floor reflects exactly the
    // background colour and fades into it without a visible horizon.
    const { center, radius } = viewer.bounds;
    const background = viewer.scene.background;
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
  const { width, height, transparent, ground, fov, onProgress } = options;
  // Test hook for trying settings from the console, e.g. window.__renderDebug = { samples: 4 }.
  const debug = window.__renderDebug;
  const samples = debug?.samples ?? options.samples;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: true, trackTimestamp: true });
  await renderer.init();
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
  // Use most of each frame for path tracing; the page only shows a progress bar meanwhile.
  pathTracer.targetFrameTime = 30;

  if (debug) {
    if (debug.frameBudget) {
      pathTracer.adaptiveFrameBudget = false;
      pathTracer.frameBudget = debug.frameBudget;
    }
    if (debug.mega) pathTracer.useMegakernel(true);
  }

  let state = 'running'; // running | finishing | cancelled | complete
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  pathTracer.addEventListener('progress', (event) => {
    if (state !== 'running') return;
    onProgress?.({ stage: event.stage, progress: event.progress, samples: event.samples?.avg ?? 0 });
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
    if (state === 'cancelled') {
      cleanup();
      resolveDone(null);
      return;
    }

    pathTracer.renderSample();

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

  await pathTracer.setSceneAsync(scene, camera).catch(() => pathTracer.setScene(scene, camera));
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
