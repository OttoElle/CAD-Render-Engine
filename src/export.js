/**
 * Turns finished renderings into files: PNG or JPG images, ZIP archives of
 * several images, and videos of a turntable series. Runs entirely in the
 * browser, without extra libraries.
 */

export const FILE_FORMATS = {
  png: { label: 'PNG (verlustfrei, auch transparent)', extension: 'png', type: 'image/png' },
  jpg: { label: 'JPG (kleinere Dateien)', extension: 'jpg', type: 'image/jpeg' },
};

const JPG_QUALITY = 0.92;

/** Lets the browser download a file. */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the download a moment to start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Makes a text safe for use in a file name. */
export function safeFileName(text) {
  return text
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');
}

/**
 * Converts a rendered PNG into the given format. JPG has no transparency, so a
 * transparent image is put on white.
 */
export async function convertImage(blob, format) {
  if (format !== 'jpg') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('JPG konnte nicht erzeugt werden.'))), 'image/jpeg', JPG_QUALITY);
  });
}

// --- ZIP --------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Date and time in the MS-DOS format that ZIP files use. */
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Packs files ({ name, blob }) into a ZIP archive. Images are already
 * compressed, so they are stored as they are, which keeps this fast.
 */
export async function zipFiles(files) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(new Date());
  const parts = [];
  const directory = [];
  let offset = 0;

  for (const file of files) {
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const name = encoder.encode(file.name);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // file names in UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local, name, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    directory.push(central, name);

    offset += 30 + name.length + data.length;
  }

  const directorySize = directory.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}

// --- Video ------------------------------------------------------------------------

/** One turn of the turntable takes this long in the video. */
export const TURN_SECONDS = 6;

/** The best video format the browser can record: MP4 where possible, otherwise WebM. */
function videoFormat() {
  const candidates = [
    ['video/mp4;codecs=avc1.640033', 'mp4'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm', 'webm'],
  ];
  if (typeof MediaRecorder === 'undefined') return null;
  const found = candidates.find(([type]) => MediaRecorder.isTypeSupported(type));
  return found ? { type: found[0], extension: found[1] } : null;
}

export const videoSupported = () => videoFormat() !== null;

/**
 * Records the images of a turntable series as a video of one full turn.
 * The browser's recorder works in real time, so this takes TURN_SECONDS.
 * Resolves to { blob, extension }.
 */
export async function recordVideo(blobs, { onProgress } = {}) {
  const format = videoFormat();
  if (!format) throw new Error('Dieser Browser kann keine Videos aufnehmen.');
  const bitmaps = await Promise.all(blobs.map((blob) => createImageBitmap(blob)));
  const { width, height } = bitmaps[0];
  const canvas = document.createElement('canvas');
  // Video encoders need even sizes.
  canvas.width = width - (width % 2);
  canvas.height = height - (height % 2);
  const context = canvas.getContext('2d');
  const draw = (bitmap) => {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
  };
  draw(bitmaps[0]);

  // A steady 30 frames per second plays everywhere; each image is held as long as its share of the turn.
  const fps = 30;
  const videoFrames = Math.round(TURN_SECONDS * fps);
  const stream = canvas.captureStream(0);
  const [track] = stream.getVideoTracks();
  const recorder = new MediaRecorder(stream, {
    mimeType: format.type,
    videoBitsPerSecond: Math.round(Math.min(Math.max(width * height * fps * 0.1, 8e6), 50e6)),
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  recorder.start();
  const start = performance.now();
  // One frame more than the turn, so the last image keeps its full length.
  for (let i = 0; i <= videoFrames; i++) {
    const image = Math.min(Math.floor((i / videoFrames) * bitmaps.length), bitmaps.length - 1);
    // Drawn every time: the browser only records a frame when the canvas was painted.
    draw(bitmaps[image]);
    track.requestFrame();
    onProgress?.(i / videoFrames);
    // Keep to the clock, so the video plays at the right speed.
    const wait = start + ((i + 1) * 1000) / fps - performance.now();
    await new Promise((resolve) => setTimeout(resolve, Math.max(wait, 0)));
  }
  recorder.stop();
  await stopped;
  track.stop();
  for (const bitmap of bitmaps) bitmap.close();
  onProgress?.(1);
  return { blob: new Blob(chunks, { type: format.type.split(';')[0] }), extension: format.extension };
}
