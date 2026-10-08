import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { AudioMeta, BoardItem, Cut, CutStatus, Phase, Project } from '../types';
import { STATUS_ORDER } from '../types';

// 編集データの書き出しと読み込み。
// 書き出すファイル（拡張子 .conte）の実体は zip で、中身は次のとおり。
//   conte.json      カット・絵・歌詞・予定など
//   audio.<拡張子>   音源
//   images/<番号>.<拡張子>  コマに貼った画像
// conte.json の中では、ファイルの場所をこの zip の中での名前で書く。

export const ARCHIVE_EXT = 'conte';
const FORMAT = 'conte';
const VERSION = 1;
const JSON_NAME = 'conte.json';
const MAX_CUTS = 2000;
const MAX_ITEMS = 5000;
const MAX_POINTS = 200000;

interface ArchiveCut {
  duration: number;
  lyric: string;
  desc: string;
  memo: string;
  status: CutStatus;
  due: string | null;
  items: BoardItem[];
}

export interface ArchiveData {
  format: string;
  version: number;
  exportedAt: string;
  title: string;
  fps: number;
  phases: Phase[];
  audio: AudioMeta | null;
  cuts: ArchiveCut[];
}

export interface ParsedArchive {
  data: ArchiveData;
  /** zip の中での名前 → ファイルの中身 */
  files: Map<string, Uint8Array>;
}

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : 'bin';
}

export function mimeOf(path: string): string {
  return MIME[extOf(path)] ?? 'application/octet-stream';
}

// ---------- 書き出し ----------

export async function buildArchive(
  p: Project,
  fetchBlob: (path: string) => Promise<Blob>,
  onProgress?: (ratio: number) => void,
): Promise<{ blob: Blob; missing: number }> {
  // 保存先での場所 → zip の中での名前
  const names = new Map<string, string>();
  if (p.audio) names.set(p.audio.path, `audio.${extOf(p.audio.path)}`);
  let n = 0;
  for (const c of p.cuts) {
    for (const it of c.items) {
      if (it.kind === 'image' && !names.has(it.path)) {
        n++;
        names.set(it.path, `images/${n}.${extOf(it.path)}`);
      }
    }
  }

  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const missingPaths = new Set<string>();
  let done = 0;
  for (const [path, name] of names) {
    try {
      const blob = await fetchBlob(path);
      // 音源と画像はすでに圧縮済みなので、zip では圧縮せずそのまま入れる
      entries[name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    } catch {
      missingPaths.add(path);
    }
    done++;
    onProgress?.(done / names.size);
  }

  const audioOk = p.audio && !missingPaths.has(p.audio.path);
  const data: ArchiveData = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    title: p.title,
    fps: p.fps,
    phases: p.phases,
    audio: p.audio && audioOk ? { ...p.audio, path: names.get(p.audio.path)! } : null,
    cuts: p.cuts.map((c) => ({
      duration: c.duration,
      lyric: c.lyric,
      desc: c.desc,
      memo: c.memo,
      status: c.status,
      due: c.due,
      // 取得できなかった画像は、読み込み先で壊れた表示にならないよう項目ごと外す
      items: c.items
        .filter((it) => it.kind !== 'image' || !missingPaths.has(it.path))
        .map((it) => (it.kind === 'image' ? { ...it, path: names.get(it.path)! } : it)),
    })),
  };
  entries[JSON_NAME] = [strToU8(JSON.stringify(data)), { level: 6 }];

  const zipped = zipSync(entries);
  return { blob: new Blob([zipped], { type: 'application/zip' }), missing: missingPaths.size };
}

/** ファイル名に使えない文字を除く */
export function archiveFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 80);
  return `${safe || 'conte'}.${ARCHIVE_EXT}`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- 読み込み ----------
// 読み込むファイルは誰が作ったものか分からないので、形を1つずつ確かめてから使う。

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const FILE_RE = /^(audio\.[a-z0-9]{1,5}|images\/[0-9]{1,6}\.[a-z0-9]{1,5})$/;

function dateOrNull(v: unknown): string | null {
  return typeof v === 'string' && DATE_RE.test(v) ? v : null;
}

function cleanItem(raw: unknown, files: Map<string, Uint8Array>): BoardItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64) || 'x';
  if (r.kind === 'stroke') {
    if (!Array.isArray(r.points) || r.points.length < 2 || r.points.length > MAX_POINTS) return null;
    const points = r.points.map((v) => num(v, 0));
    if (points.length % 2 === 1) points.pop();
    const color = typeof r.color === 'string' && COLOR_RE.test(r.color) ? r.color : '#1A1A1A';
    return {
      id,
      kind: 'stroke',
      color,
      width: Math.max(0.5, Math.min(200, num(r.width, 8))),
      points,
    };
  }
  if (r.kind === 'image') {
    const path = str(r.path, 40);
    if (!FILE_RE.test(path) || !path.startsWith('images/') || !files.has(path)) return null;
    return {
      id,
      kind: 'image',
      path,
      x: num(r.x, 0),
      y: num(r.y, 0),
      w: Math.max(1, num(r.w, 100)),
      h: Math.max(1, num(r.h, 100)),
    };
  }
  if (r.kind === 'text') {
    const text = str(r.text, 2000);
    if (!text) return null;
    const color = typeof r.color === 'string' && COLOR_RE.test(r.color) ? r.color : '#1A1A1A';
    return {
      id,
      kind: 'text',
      x: num(r.x, 0),
      y: num(r.y, 0),
      text,
      size: Math.max(8, Math.min(800, num(r.size, 72))),
      color,
    };
  }
  return null;
}

function cleanCut(raw: unknown, files: Map<string, Uint8Array>): ArchiveCut | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const duration = num(r.duration, 0);
  if (duration <= 0 || duration > 36000) return null;
  const status = STATUS_ORDER.includes(r.status as CutStatus) ? (r.status as CutStatus) : 'todo';
  const rawItems = Array.isArray(r.items) ? r.items.slice(0, MAX_ITEMS) : [];
  const items: BoardItem[] = [];
  for (const it of rawItems) {
    const c = cleanItem(it, files);
    if (c) items.push(c);
  }
  return {
    duration,
    lyric: str(r.lyric, 5000),
    desc: str(r.desc, 5000),
    memo: str(r.memo, 5000),
    status,
    due: dateOrNull(r.due),
    items,
  };
}

function cleanAudio(raw: unknown, files: Map<string, Uint8Array>): AudioMeta | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const path = str(r.path, 40);
  if (!FILE_RE.test(path) || !path.startsWith('audio.') || !files.has(path)) return null;
  const duration = num(r.duration, 0);
  if (duration <= 0) return null;
  const peaks = typeof r.peaks === 'string' && /^[A-Za-z0-9+/=]*$/.test(r.peaks) ? r.peaks : '';
  return {
    path,
    name: str(r.name, 200) || path,
    duration,
    // 波形が入っていない・壊れているときは空にしておき、読み込み側で作り直す
    peaks,
    peaksPerSec: Math.max(1, Math.min(1000, num(r.peaksPerSec, 50))),
    offset: Math.max(0, Math.min(1, num(r.offset, 0))),
  };
}

export async function readArchive(file: Blob): Promise<ParsedArchive> {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('ファイルを開けなかった。書き出した .conte ファイルではない可能性がある');
  }
  const jsonBytes = unzipped[JSON_NAME];
  if (!jsonBytes) throw new Error('中に編集データ（conte.json）が見つからない');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(strFromU8(jsonBytes)) as Record<string, unknown>;
  } catch {
    throw new Error('編集データを読み取れなかった（内容が壊れている）');
  }
  if (typeof raw !== 'object' || raw === null || raw.format !== FORMAT) {
    throw new Error('このアプリの編集データではない');
  }
  if (num(raw.version, 0) > VERSION) {
    throw new Error('このファイルは新しい版のアプリで作られていて、読み込めない');
  }

  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(unzipped)) {
    if (FILE_RE.test(name)) files.set(name, bytes);
  }

  const rawCuts = Array.isArray(raw.cuts) ? raw.cuts.slice(0, MAX_CUTS) : [];
  const cuts: ArchiveCut[] = [];
  for (const c of rawCuts) {
    const cc = cleanCut(c, files);
    if (cc) cuts.push(cc);
  }

  const rawPhases = Array.isArray(raw.phases) ? raw.phases.slice(0, 50) : [];
  const phases: Phase[] = [];
  for (const ph of rawPhases) {
    if (typeof ph !== 'object' || ph === null) continue;
    const r = ph as Record<string, unknown>;
    phases.push({
      id: str(r.id, 64) || 'x',
      name: str(r.name, 100),
      start: dateOrNull(r.start),
      end: dateOrNull(r.end),
    });
  }

  const fps = num(raw.fps, 30);
  return {
    data: {
      format: FORMAT,
      version: VERSION,
      exportedAt: str(raw.exportedAt, 40),
      title: str(raw.title, 200) || '読み込んだコンテ',
      fps: fps > 0 && fps <= 240 ? fps : 30,
      phases,
      audio: cleanAudio(raw.audio, files),
      cuts,
    },
    files,
  };
}

/** カットの形に戻す（ID と並び順は読み込み側で新しく振る） */
export function toCutFields(c: ArchiveCut): Omit<Cut, 'id' | 'pos'> {
  return {
    duration: c.duration,
    lyric: c.lyric,
    desc: c.desc,
    memo: c.memo,
    status: c.status,
    due: c.due,
    items: c.items,
  };
}
