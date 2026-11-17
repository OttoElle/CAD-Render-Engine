/**
 * Basic image adjustments for finished renderings: exposure, contrast,
 * saturation, warmth and a vignette. The image viewer previews them with CSS
 * filters; saving applies the same maths to the pixels, so the file looks
 * like the preview.
 */

export const ADJUSTMENTS = {
  exposure: { label: 'Brightness', min: -100, max: 100 },
  contrast: { label: 'Contrast', min: -100, max: 100 },
  saturation: { label: 'Saturation', min: -100, max: 100 },
  warmth: { label: 'Warmth', min: -100, max: 100 },
  vignette: { label: 'Vignette', min: 0, max: 100 },
};

export const isNeutral = (adjust) => !adjust || Object.keys(ADJUSTMENTS).every((key) => !adjust[key]);

/** The factors behind the sliders. */
function factors(adjust) {
  return {
    brightness: 2 ** ((adjust.exposure || 0) / 100),
    contrast: 1 + (adjust.contrast || 0) / 100,
    saturation: 1 + (adjust.saturation || 0) / 100,
    // Warmer lifts red and lowers blue, cooler the other way round.
    warmth: ((adjust.warmth || 0) / 100) * 0.12,
    vignette: ((adjust.vignette || 0) / 100) * 0.7,
  };
}

const WARMTH_FILTER_ID = 'clearcoat-warmth';

function warmthMatrix(warmth) {
  return [1 + warmth, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1 - warmth, 0, 0, 0, 0, 0, 1, 0].join(' ');
}

/** CSS for previewing an adjusted image: `filter` for the image, `vignette` for an overlay on top of it. */
export function adjustCss(adjust, filterId = WARMTH_FILTER_ID) {
  if (isNeutral(adjust)) return { filter: '', vignette: '' };
  const f = factors(adjust);
  let filter = '';
  if (f.warmth) {
    // CSS has no warmth filter; an SVG colour matrix in the page does it.
    let svg = document.getElementById(`${filterId}-svg`);
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = `${filterId}-svg`;
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.style.position = 'absolute';
      svg.innerHTML = `<filter id="${filterId}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" /></filter>`;
      document.body.append(svg);
    }
    svg.querySelector('feColorMatrix').setAttribute('values', warmthMatrix(f.warmth));
    filter += `url(#${filterId}) `;
  }
  filter += `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation})`;
  const vignette = f.vignette
    ? `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${f.vignette.toFixed(3)}) 100%)`
    : '';
  return { filter, vignette };
}

const clamp = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Applies the adjustments to the pixels of a canvas, in the order the CSS preview uses. */
function adjustPixels(context, width, height, f) {
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const s = f.saturation;
  // Saturation as in the CSS filter specification.
  const m = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;
    r = clamp(r * (1 + f.warmth));
    b = clamp(b * (1 - f.warmth));
    r = clamp(r * f.brightness);
    g = clamp(g * f.brightness);
    b = clamp(b * f.brightness);
    r = clamp((r - 0.5) * f.contrast + 0.5);
    g = clamp((g - 0.5) * f.contrast + 0.5);
    b = clamp((b - 0.5) * f.contrast + 0.5);
    const r2 = m[0] * r + m[1] * g + m[2] * b;
    const g2 = m[3] * r + m[4] * g + m[5] * b;
    const b2 = m[6] * r + m[7] * g + m[8] * b;
    data[i] = clamp(r2) * 255 + 0.5;
    data[i + 1] = clamp(g2) * 255 + 0.5;
    data[i + 2] = clamp(b2) * 255 + 0.5;
  }
  context.putImageData(image, 0, 0);
}

/** Darkens the corners like the CSS overlay: an ellipse through the corners, clear up to 45 %. */
function drawVignette(context, width, height, strength) {
  context.save();
  // Only where the image has pixels, so a transparent background stays transparent.
  context.globalCompositeOperation = 'source-atop';
  context.translate(width / 2, height / 2);
  context.scale(1, height / width);
  const radius = (width / 2) * Math.SQRT2;
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0.45, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, `rgba(0,0,0,${strength})`);
  context.fillStyle = gradient;
  context.fillRect(-width / 2, -width / 2, width, width);
  context.restore();
}

/** Returns the image with the adjustments applied, as a PNG blob. Neutral settings return it unchanged. */
export async function adjustImage(blob, adjust) {
  if (isNeutral(adjust)) return blob;
  const f = factors(adjust);
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  adjustPixels(context, canvas.width, canvas.height, f);
  if (f.vignette) drawVignette(context, canvas.width, canvas.height, f.vignette);
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('The image could not be adjusted.'))), 'image/png');
  });
}
