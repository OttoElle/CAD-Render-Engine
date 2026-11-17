import * as THREE from 'three/webgpu';
import { WebGPUPathTracer, OIDNDenoiser } from 'three-gpu-pathtracer/webgpu';
import { keepRunningInBackground } from './background.js';
import { PhysicalCamera } from 'three-gpu-pathtracer/src/objects/PhysicalCamera.js';
import { initUNetFromURL } from 'oidn-webgpu';
import { fovToFocalLength } from './viewer.js';
import { boxSide, buildCap, clipGeometry } from './section.js';
import { applyFinishTangents } from './materials.js';
import {
  buildFloorGeometry,
  buildCoveGeometry,
  placeCove,
  floorMaterialParams,
  floorFresnel,
  gradientAt,
  paintGradient,
  renderedGradientCss,
  environmentSampler,
  coveAlbedo,
} from './backdrop.js';

// Open Image Denoise model, shipped with the app so rendering works offline.
const DENOISE_WEIGHTS_URL = `${import.meta.env.BASE_URL}oidn/rt_hdr_alb_nrm_small.tza`;

/**
 * Builds a clean copy of the viewer scene for the path tracer: visible parts
 * only, without edges, selection highlight or helper objects.
 */
function buildRenderScene(viewer, { transparent, backdrop, camera, width, height, orbit = 0 }) {
  const scene = new THREE.Scene();

  const root = new THREE.Group();
  root.rotation.copy(viewer.modelRoot.rotation);
  for (const part of viewer.parts) {
    if (!part.mesh.visible) continue;
    const material = part.mesh.material.clone();
    material.emissive.setScalar(0);
    // The viewport lets the graphics card clip; the path tracer needs real cut geometry.
    material.clippingPlanes = null;

    const source = part.mesh.geometry;
    const planes = viewer.sectionPlanesFor(part);
    const sides = planes.map((plane) => boxSide(source.boundingBox, plane));
    if (sides.includes(-1)) continue; // cut away completely
    const cutting = planes.filter((plane, i) => sides[i] === 0);
    // Moved, turned or exploded parts take their cut faces along.
    const add = (mesh) => {
      mesh.position.copy(part.mesh.position);
      mesh.quaternion.copy(part.mesh.quaternion);
      root.add(mesh);
      return mesh;
    };
    if (cutting.length === 0) {
      add(new THREE.Mesh(source, material));
      continue;
    }

    const geometry = clipGeometry(source, cutting);
    if (!geometry) continue;
    // Brushed or turned marks need tangents on the new geometry as well.
    const finish = part.finishFrame ? (target) => applyFinishTangents(target, part.look.finish, part.finishFrame) : null;
    finish?.(geometry);
    const own = (mesh) => {
      mesh.userData.ownGeometry = true;
      add(mesh);
    };
    own(new THREE.Mesh(geometry, material));

    // Close the cut faces, each cap trimmed by the other planes.
    const capMaterial =
      viewer.capStyle.mode === 'color'
        ? new THREE.MeshPhysicalMaterial({ color: viewer.capStyle.color, roughness: 0.6 })
        : material;
    for (const plane of cutting) {
      let cap = buildCap(source, plane);
      if (cap && cutting.length > 1) {
        const trimmed = clipGeometry(
          cap,
          cutting.filter((other) => other !== plane),
        );
        cap.dispose();
        cap = trimmed;
      }
      if (!cap) continue;
      if (capMaterial === material) finish?.(cap);
      own(new THREE.Mesh(cap, capMaterial));
    }
  }
  scene.add(root);

  scene.environment = viewer.environmentTexture;
  scene.environmentRotation.copy(viewer.scene.environmentRotation);
  // On a turntable the lights stay with the camera while it circles the model.
  scene.environmentRotation.y += orbit;
  scene.environmentIntensity = viewer.scene.environmentIntensity;
  const environmentBackground = viewer.showsEnvironmentBackground;
  if (transparent) {
    scene.background = null;
  } else if (environmentBackground) {
    scene.background = viewer.environmentTexture;
    scene.backgroundRotation.copy(viewer.scene.backgroundRotation);
    scene.backgroundRotation.y += orbit;
    scene.backgroundIntensity = viewer.scene.backgroundIntensity;
  } else {
    scene.background = viewer.backgroundColor.clone();
  }

  if (backdrop.gradient && !transparent && !environmentBackground) {
    // The gradient is painted behind the finished image (see startRender).
    scene.background = null;
  }

  // An HDRI background brings its own ground, so no floor is added there.
  if (!transparent && !environmentBackground) {
    if (backdrop.floor === 'shadow') scene.add(buildFloor(viewer, camera, backdrop, width / height, scene.environmentRotation.y));
    if (backdrop.floor === 'cove') scene.add(buildCove(viewer, camera, backdrop));
  }

  scene.updateMatrixWorld(true);
  return scene;
}

/**
 * The path tracer has no shadow catcher, so the floor is a real surface. Its
 * colour is chosen per vertex so that, where nothing shades it, it shows
 * exactly the background behind it and fades into it without a visible
 * horizon: a flat colour, or the colour gradient at that point of the image.
 * A reflective floor also mirrors the environment; that light is taken off
 * its colour, so it stays seamless apart from reflections of the model and of
 * bright lights.
 */
function buildFloor(viewer, camera, backdrop, aspect, environmentRotation) {
  const { center, radius } = viewer.bounds;
  const groundY = viewer.ground.position.y;
  const geometry = buildFloorGeometry(radius, radius * 60);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 4);
  const irradiance = viewer.environmentTexture.userData.floorIrradiance;
  const intensity = Math.max(viewer.scene.environmentIntensity, 1e-3);
  const { gradient, reflection, reflectionBlur } = backdrop;
  const sample =
    reflection > 0 ? environmentSampler(viewer.environmentTexture, environmentRotation) : null;
  const roughness = floorMaterialParams(reflection, reflectionBlur).roughness;
  // Rough reflections average the environment over a small cone around the mirror direction.
  const spread = Math.tan(Math.atan(roughness * roughness) * 1.5);

  const world = new THREE.Vector3();
  const local = new THREE.Vector3();
  const view = new THREE.Vector3();
  const mirror = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const target = new THREE.Color();
  const env = new THREE.Color();
  const sum = new THREE.Color();
  camera.updateMatrixWorld();

  for (let i = 0; i < position.count; i++) {
    world.fromBufferAttribute(position, i);
    world.x += center.x;
    world.y = groundY;
    world.z += center.z;

    if (gradient) {
      local.copy(world).applyMatrix4(camera.matrixWorldInverse);
      const ndc = world.clone().project(camera);
      // Points behind the camera only show up in reflections; they get the bottom of the gradient.
      const x = local.z < 0 ? (ndc.x + 1) / 2 : 0.5;
      const y = local.z < 0 ? (1 - ndc.y) / 2 : 1;
      target.copy(gradientAt(gradient, x, y, aspect)).convertSRGBToLinear();
    } else {
      target.copy(viewer.backgroundColor);
    }

    let fresnel = 0;
    if (sample) {
      view.copy(world).sub(camera.position).normalize();
      fresnel = floorFresnel(reflection, Math.abs(view.y));
      mirror.set(view.x, Math.abs(view.y), view.z);
      sum.setRGB(0, 0, 0);
      if (spread < 1e-3) {
        sample(mirror, sum);
      } else {
        u.set(0, 1, 0).cross(mirror);
        if (u.lengthSq() < 1e-8) u.set(1, 0, 0);
        u.normalize();
        v.crossVectors(mirror, u);
        const taps = 12;
        for (let k = 0; k < taps; k++) {
          const angle = (k / taps) * Math.PI * 2;
          const reach = spread * (k % 2 ? 0.45 : 0.9);
          probe
            .copy(mirror)
            .addScaledVector(u, Math.cos(angle) * reach)
            .addScaledVector(v, Math.sin(angle) * reach)
            .normalize();
          if (probe.y < 0) probe.y = -probe.y;
          sum.add(sample(probe, env));
        }
        sum.multiplyScalar(1 / taps);
      }
      target.r -= fresnel * sum.r * intensity;
      target.g -= fresnel * sum.g * intensity;
      target.b -= fresnel * sum.b * intensity;
    }

    const scale = Math.PI / (Math.max(1 - fresnel, 1e-3) * intensity);
    colors[i * 4] = Math.min(Math.max((target.r * scale) / irradiance[0], 0), 0.98);
    colors[i * 4 + 1] = Math.min(Math.max((target.g * scale) / irradiance[1], 0), 0.98);
    colors[i * 4 + 2] = Math.min(Math.max((target.b * scale) / irradiance[2], 0), 0.98);
    colors[i * 4 + 3] = 1;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));

  const floor = new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, ...floorMaterialParams(reflection, reflectionBlur) }),
  );
  floor.position.set(center.x, groundY, center.z);
  floor.userData.ownGeometry = true;
  return floor;
}

/**
 * A studio cove behind the model, turned to the camera like in the real-time
 * view. Lights behind it at infinity would be blocked completely, which a
 * real studio avoids by putting the lights inside the cove; letting shadow
 * rays pass through it does the same here.
 */
function buildCove(viewer, camera, backdrop) {
  const cove = new THREE.Mesh(
    buildCoveGeometry(viewer.bounds.radius),
    new THREE.MeshPhysicalMaterial({
      color: coveAlbedo(
        backdrop.coveColor,
        viewer.environmentTexture.userData.floorIrradiance,
        viewer.scene.environmentIntensity,
      ),
      ...floorMaterialParams(backdrop.reflection, backdrop.reflectionBlur, 0.9),
    }),
  );
  cove.userData.ownGeometry = true;
  cove.visibleToShadowRays = false;
  placeCove(cove, camera, viewer.controls.target, viewer.bounds.center, viewer.ground.position.y);
  return cove;
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Requests the graphics device to render on: the graphics card, or with
 * `kind` 'cpu' the browser's software implementation. Returns the device and
 * a readable name of what was actually picked.
 */
async function requestDevice(kind) {
  if (!navigator.gpu) throw new Error('This browser does not provide WebGPU.');
  const cpu = kind === 'cpu';
  const adapter = await navigator.gpu.requestAdapter({
    featureLevel: 'compatibility',
    ...(cpu ? { forceFallbackAdapter: true } : { powerPreference: 'high-performance' }),
  });
  if (!adapter) {
    throw new Error(
      cpu
        ? 'This browser does not offer rendering on the CPU. Please choose the graphics card under Output.'
        : 'No graphics card with WebGPU was found.',
    );
  }
  const device = await adapter.requestDevice({ requiredFeatures: [...adapter.features] });

  const info = adapter.info || {};
  const software = Boolean(info.isFallbackAdapter ?? adapter.isFallbackAdapter);
  const hardware = info.description || [info.vendor, info.architecture].filter(Boolean).map(capitalize).join(' ');
  const name = software ? ['CPU', hardware && `(${hardware})`].filter(Boolean).join(' ') : hardware || 'Grafikkarte';
  return { device, name };
}

/**
 * Starts a path traced rendering of the current view.
 *
 * Returns a handle with the output `canvas` (shows the image as it converges
 * and goes blank once finished), `done` (resolves with a PNG blob, or null if
 * cancelled), `cancel()`, and `finishNow()` to stop early and keep the image
 * accumulated so far.
 */
/**
 * Starts a path-traced rendering of what the viewer shows. `prepare`, if
 * given, runs right before the scene is read and returns { fov, dof }; it can
 * put the viewer into the state to be rendered. `orbit` (radians) turns the
 * camera and the lights together around the pivot, as if the model stood on a
 * turntable. Returns a handle with the live canvas and a `done` promise for
 * the PNG.
 */
export async function startRender(viewer, options) {
  const { width, height, transparent, backdrop, denoise, gentle, onProgress, orbit = 0 } = options;
  const gradient = !transparent && !viewer.showsEnvironmentBackground ? backdrop.gradient : null;
  // Test hook for trying settings from the console, e.g. window.__renderDebug = { samples: 4 }.
  const debug = window.__renderDebug;
  const samples = debug?.samples ?? options.samples;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const { device, name: deviceName } = await requestDevice(options.device);
  const renderer = new THREE.WebGPURenderer({ canvas, device, antialias: false, alpha: true, trackTimestamp: true });
  try {
    await renderer.init();
    if (!renderer.backend.isWebGPUBackend) throw new Error('This browser does not provide WebGPU.');
  } catch (error) {
    renderer.dispose();
    device.destroy();
    throw error;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.toneMapping = viewer.renderer.toneMapping;
  renderer.setClearColor(0x000000, 0);

  const { fov, dof } = options.prepare ? options.prepare() : options;
  // With depth of field the camera gets a real aperture; otherwise everything is sharp.
  const camera = dof ? new PhysicalCamera() : new THREE.PerspectiveCamera();
  camera.copy(viewer.camera);
  // The viewport shifts its image to make room for the sidebar; the rendering does not.
  camera.clearViewOffset();
  if (orbit) {
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), orbit);
    const pivot = viewer.controls.target;
    camera.position.sub(pivot).applyQuaternion(turn).add(pivot);
    camera.quaternion.premultiply(turn);
  }
  camera.aspect = width / height;
  if (fov) camera.fov = fov;
  if (dof) {
    // The path tracer reads the aperture diameter in millimetres and assumes a
    // scene in metres. CAD models are in millimetres, hence the factor 1000.
    camera.bokehSize = (fovToFocalLength(viewer.camera.fov) / dof.fStop) * 1000;
    camera.focusDistance = dof.focusDistance;
    camera.apertureBlades = 0;
    camera.apertureRotation = 0;
    camera.anamorphicRatio = 1;
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const scene = buildRenderScene(viewer, { transparent, backdrop, camera, width, height, orbit });
  // While rendering, the gradient shows behind the canvas; at the end it is painted into the image.
  if (gradient) canvas.style.background = renderedGradientCss(gradient);

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
        `The graphics card stopped the rendering (${info.message || 'device lost'}). ` +
          'A smaller image size or the gentle mode under Output can help.',
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

  // Keeps going in a background tab, one step whenever the graphics card has finished the last one.
  const releaseBackground = keepRunningInBackground(() => device.queue.onSubmittedWorkDone());

  function cleanup() {
    releaseBackground();
    pathTracer.dispose();
    for (const object of scene.children) {
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.material.dispose();
        if (child.userData.ownGeometry) child.geometry.dispose();
      });
    }
    renderer.dispose();
    // The renderer only destroys devices it created itself.
    device.destroy();
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
      let source = canvas;
      if (gradient) {
        source = document.createElement('canvas');
        source.width = width;
        source.height = height;
        const context = source.getContext('2d');
        paintGradient(context, gradient, width, height);
        context.drawImage(canvas, 0, 0);
      }
      source.toBlob((blob) => {
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
    deviceName,
    done,
    cancel() {
      if (state === 'running' || state === 'finishing') state = 'cancelled';
    },
    finishNow() {
      if (state === 'running') state = 'finishing';
    },
  };
}
