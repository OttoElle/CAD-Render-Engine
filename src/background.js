/**
 * Keeps a rendering going while the tab is in the background.
 *
 * Browsers stop animation frames for hidden tabs and slow timers down to about
 * one per second, which would halt the path tracer and the denoiser. While a
 * rendering runs, requestAnimationFrame is wrapped: in a visible tab it works
 * as usual, in a hidden one the callbacks run through a message to the page
 * itself, which browsers do not hold back. `pace` (for example "the graphics
 * card has finished") sets how fast they come, so work does not pile up.
 */

const native = {
  request: window.requestAnimationFrame.bind(window),
  cancel: window.cancelAnimationFrame.bind(window),
};

/** Waiting callbacks: id → { callback, nativeId }. */
const pending = new Map();
let nextId = 1;
let users = 0;
let pace = null;
let flushQueued = false;

const channel = new MessageChannel();
channel.port1.onmessage = () => {
  flushQueued = false;
  const now = performance.now();
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) {
    native.cancel(entry.nativeId);
    try {
      entry.callback(now);
    } catch (error) {
      // As with a real animation frame, one failing callback does not stop the others.
      console.error(error);
    }
  }
};

function queueFlush() {
  if (flushQueued || pending.size === 0) return;
  flushQueued = true;
  const ready = pace ? Promise.resolve(pace()).catch(() => {}) : Promise.resolve();
  ready.then(() => channel.port2.postMessage(0));
}

function request(callback) {
  const id = nextId++;
  const nativeId = native.request((time) => {
    pending.delete(id);
    callback(time);
  });
  pending.set(id, { callback, nativeId });
  if (document.hidden) queueFlush();
  return id;
}

function cancel(id) {
  const entry = pending.get(id);
  if (entry) {
    native.cancel(entry.nativeId);
    pending.delete(id);
  } else {
    native.cancel(id);
  }
}

// Callbacks that were waiting for a frame when the tab was hidden would wait until it is shown again.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && users > 0) queueFlush();
});

/**
 * Lets animation frames run on in a hidden tab until the returned function is
 * called. Also holds a Web Lock meanwhile, which tells the browser that work is
 * going on and keeps some browsers from freezing the tab.
 */
export function keepRunningInBackground(paceFunction) {
  if (users++ === 0) {
    window.requestAnimationFrame = request;
    window.cancelAnimationFrame = cancel;
  }
  pace = paceFunction;
  let releaseLock = null;
  navigator.locks
    ?.request(`clearcoat-render-${nextId++}`, () => new Promise((resolve) => (releaseLock = resolve)))
    .catch(() => {});
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseLock?.();
    if (--users === 0) {
      window.requestAnimationFrame = native.request;
      window.cancelAnimationFrame = native.cancel;
      pace = null;
      // Callbacks still waiting keep their real animation frame as well.
    }
  };
}
