import { Mp3Encoder } from '@breezystack/lamejs';

export const PEAKS_PER_SEC = 50;
const SAMPLE_RATE = 44100;
/** これより大きい圧縮済み音源は、さらに圧縮し直す */
const MAX_PASSTHROUGH_BYTES = 12 * 1024 * 1024;

export interface PreparedAudio {
  blob: Blob;
  ext: string;
  duration: number;
  peaks: string;
  compressed: boolean;
  /** 圧縮で頭に入った遅れ（秒） */
  offset: number;
}

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const data = await blob.arrayBuffer();
  // 44.1kHz に揃えて読み込む（圧縮するときの前提を固定するため）
  const ctx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
  return await ctx.decodeAudioData(data);
}

export function computePeaks(buf: AudioBuffer, perSec = PEAKS_PER_SEC): Uint8Array {
  const step = buf.sampleRate / perSec;
  const count = Math.max(1, Math.ceil(buf.length / step));
  const out = new Uint8Array(count);
  const chans: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c));
  for (let i = 0; i < count; i++) {
    const from = Math.floor(i * step);
    const to = Math.min(buf.length, Math.floor((i + 1) * step));
    let max = 0;
    for (const ch of chans) {
      for (let j = from; j < to; j++) {
        const v = ch[j] < 0 ? -ch[j] : ch[j];
        if (v > max) max = v;
      }
    }
    out[i] = Math.min(255, Math.round(max * 255));
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toInt16(f: Float32Array, from: number, to: number): Int16Array {
  const out = new Int16Array(to - from);
  for (let i = from; i < to; i++) {
    const v = Math.max(-1, Math.min(1, f[i]));
    out[i - from] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** MP3（128kbps）に圧縮する。長い曲は数秒かかるので進み具合を返す */
export async function encodeMp3(
  buf: AudioBuffer,
  onProgress?: (ratio: number) => void,
  kbps = 128,
): Promise<Blob> {
  const channels = Math.min(2, buf.numberOfChannels);
  const enc = new Mp3Encoder(channels, buf.sampleRate, kbps);
  const left = buf.getChannelData(0);
  const right = channels > 1 ? buf.getChannelData(1) : null;
  const block = 1152 * 40;
  const parts: BlobPart[] = [];
  for (let i = 0; i < buf.length; i += block) {
    const end = Math.min(buf.length, i + block);
    const l = toInt16(left, i, end);
    const out = right ? enc.encodeBuffer(l, toInt16(right, i, end)) : enc.encodeBuffer(l);
    if (out.length > 0) parts.push(new Uint8Array(out));
    onProgress?.(end / buf.length);
    // 画面が固まらないよう、区切りごとに処理を譲る
    await new Promise((r) => setTimeout(r, 0));
  }
  const tail = enc.flush();
  if (tail.length > 0) parts.push(new Uint8Array(tail));
  return new Blob(parts, { type: 'audio/mpeg' });
}

/**
 * 圧縮後の音が、元の音より何秒遅れて始まるかを測る。
 * 元の音と圧縮後の音を少しずつずらして重ね、一番よく重なるずれを探す。
 */
export function measureLag(orig: AudioBuffer, dec: AudioBuffer): number {
  const a = orig.getChannelData(0);
  const b = dec.getChannelData(0);
  const sr = orig.sampleRate;
  // 音が鳴り始める位置を探す（無音の区間では重なり具合を比べられない）
  let start = 0;
  while (start < a.length && Math.abs(a[start]) < 0.02) start++;
  if (start >= a.length) return 0;
  const win = Math.min(sr, a.length - start);
  const maxLag = 4000;
  const step = 3;
  let best = 0;
  let bestScore = 0;
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    const end = Math.min(start + win, b.length - lag);
    for (let i = start; i < end; i += step) sum += a[i] * b[i + lag];
    if (sum > bestScore) {
      bestScore = sum;
      best = lag;
    }
  }
  return best / sr;
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/**
 * 読み込んだ音源を保存用に整える。
 * WAV などの非圧縮音源と大きすぎる音源は MP3 に圧縮し、それ以外はそのまま使う。
 * 圧縮で頭に入る遅れは測っておき、再生のときに打ち消す。
 */
export async function prepareAudio(
  file: File,
  onProgress?: (label: string, ratio: number) => void,
): Promise<PreparedAudio> {
  onProgress?.('音源を読み込み中', 0);
  const ext = extOf(file.name);
  const lossless =
    /wav|aiff|flac/.test(file.type) || ['wav', 'aif', 'aiff', 'flac'].includes(ext);
  const first = await decodeAudio(file);
  let blob: Blob = file;
  let outExt = ext || 'mp3';
  let compressed = false;
  let offset = 0;
  if (lossless || file.size > MAX_PASSTHROUGH_BYTES) {
    blob = await encodeMp3(first, (r) => onProgress?.('音源を圧縮中', r));
    outExt = 'mp3';
    compressed = true;
    onProgress?.('タイミングを確認中', 1);
    offset = measureLag(first, await decodeAudio(blob));
  }
  // 波形と長さは元の音源から作る。再生は offset の分だけずらして元と合わせる
  const peaks = bytesToBase64(computePeaks(first));
  return { blob, ext: outExt, duration: first.duration, peaks, compressed, offset };
}
