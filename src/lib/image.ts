const MAX_SIDE = 1920;

export interface PreparedImage {
  blob: Blob;
  ext: string;
  w: number;
  h: number;
}

function toBlob(canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, q));
}

/** 画像を長辺 1920px までに縮め、WebP（使えなければ JPEG）にして容量を抑える */
export async function prepareImage(src: Blob): Promise<PreparedImage> {
  const bmp = await createImageBitmap(src);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を処理できなかった');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  let blob = await toBlob(canvas, 'image/webp', 0.82);
  let ext = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await toBlob(canvas, 'image/jpeg', 0.85);
    ext = 'jpg';
  }
  if (!blob) throw new Error('画像を変換できなかった');
  return { blob, ext, w, h };
}
