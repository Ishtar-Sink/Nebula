/**
 * Browser-only helpers shared by the player and the backoffice.
 *
 * Cover images picked by the listener, made small enough to keep.
 *
 * A photo straight from a phone is several megabytes; a cover is never shown larger than a
 * few hundred pixels. Downscaling before storing keeps the offline database small (where the
 * image is inlined as a data URL) and the upload quick.
 */

const MAX_SIDE = 640;
const QUALITY = 0.82;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('não foi possível ler a imagem')); };
    img.src = url;
  });
}

/** Square, centre-cropped canvas — covers are always shown square, so crop once and store it. */
async function square(file: Blob): Promise<HTMLCanvasElement> {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const size = Math.min(side, MAX_SIDE);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas indisponível neste navegador');

  ctx.drawImage(
    img,
    (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
    0, 0, size, size,
  );
  return canvas;
}

/** For the offline library, where the image is stored inline alongside the metadata. */
export async function imageToDataUrl(file: Blob): Promise<string> {
  return (await square(file)).toDataURL('image/jpeg', QUALITY);
}

/** For the server, which stores the bytes as a file. */
export async function imageToBlob(file: Blob): Promise<Blob> {
  const canvas = await square(file);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('falha ao converter a imagem'))),
      'image/jpeg',
      QUALITY,
    );
  });
}
