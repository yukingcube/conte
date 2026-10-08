import { getStore } from '../store';

// 保存先から取ってきたファイル（画像・音源）を覚えておく場所。
// 同じファイルを何度も取りに行かないためのもの。

const blobs = new Map<string, Promise<Blob>>();
const images = new Map<string, HTMLImageElement>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function subscribeFiles(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 画像が新しく読み込まれるたびに増える番号。再描画のきっかけに使う */
export function filesVersion(): number {
  return version;
}

function bump(): void {
  version++;
  listeners.forEach((f) => f());
}

export function getBlob(path: string): Promise<Blob> {
  let p = blobs.get(path);
  if (!p) {
    p = getStore().downloadFile(path);
    blobs.set(path, p);
    p.catch(() => blobs.delete(path));
  }
  return p;
}

/** 保存した直後のファイルを覚えておき、取り直しを省く */
export function primeBlob(path: string, blob: Blob): void {
  blobs.set(path, Promise.resolve(blob));
}

/** 読み込み済みならその画像を返す。まだなら読み込みを始めて undefined を返す */
export function getImage(path: string): HTMLImageElement | undefined {
  const img = images.get(path);
  if (img) return img;
  if (!pending.has(path)) {
    pending.add(path);
    getBlob(path)
      .then((blob) => {
        const el = new Image();
        el.onload = () => {
          images.set(path, el);
          pending.delete(path);
          bump();
        };
        el.onerror = () => {
          pending.delete(path);
        };
        el.src = URL.createObjectURL(blob);
      })
      .catch(() => {
        pending.delete(path);
      });
  }
  return undefined;
}
