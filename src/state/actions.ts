import type { BoardItem, Cut, ImageItem, Phase, Project } from '../types';
import { FRAME_H, FRAME_W } from '../types';
import { getStore } from '../store';
import { newId } from '../lib/id';
import { snap } from '../lib/time';
import { PEAKS_PER_SEC, prepareAudio } from '../lib/audio';
import { prepareImage } from '../lib/image';
import { getBlob, primeBlob } from '../lib/files';
import {
  MIN_CUT,
  cutIndexAt,
  cutStart,
  cutsTotal,
  initialEditor,
  useEditor,
} from './editor';
import { flushNow, markCut, markDeleted, markMeta, resetDirty } from './saver';
import { pause, seek, setAudioSrc } from './player';

const HISTORY_LIMIT = 100;

/** この時間より新しいファイルは掃除しない（貼った直後でまだ保存されていない画像を守るため） */
const KEEP_NEW_MS = 60 * 60 * 1000;

/**
 * 保存するファイルの名前を作る。例: img-tmgj3k2a1-<ID>.webp
 * 「t」に続く部分が作成時刻で、掃除のときに新しいファイルを見分けるのに使う。
 */
function fileName(kind: 'img' | 'audio', ext: string): string {
  return `${kind}-t${Date.now().toString(36)}-${newId()}.${ext}`;
}

/** ファイル名から作成時刻を取り出す。時刻が入っていない古い形式は 0（十分古い扱い） */
function fileTime(path: string): number {
  const m = /\/(?:img|audio)-t([0-9a-z]+)-/.exec(path);
  return m ? parseInt(m[1], 36) : 0;
}

/**
 * どのコマからも使われていない画像と、差し替えで不要になった音源を置き場から消す。
 * コンテを開いた直後（取り消しの履歴がないとき）にだけ呼ぶ。
 */
async function cleanupFiles(projectId: string): Promise<void> {
  try {
    const paths = await getStore().listFiles(projectId);
    // 一覧を取っている間に貼られた画像も守れるよう、使用中の判定は今の状態で行う
    const p = useEditor.getState().project;
    if (!p || p.id !== projectId) return;
    const used = new Set<string>();
    if (p.audio) used.add(p.audio.path);
    for (const c of p.cuts) {
      for (const it of c.items) if (it.kind === 'image') used.add(it.path);
    }
    const now = Date.now();
    const stale = paths.filter(
      (path) =>
        /\/(?:img|audio)-/.test(path) && !used.has(path) && now - fileTime(path) > KEEP_NEW_MS,
    );
    if (stale.length > 0) await getStore().removeFiles(stale);
  } catch (e) {
    // 掃除に失敗しても編集には影響しないので、記録だけ残す
    console.warn(e);
  }
}

function setProject(fn: (p: Project) => Project): void {
  const p = useEditor.getState().project;
  if (!p) return;
  useEditor.setState({ project: fn(p) });
}

function patchCut(id: string, fn: (c: Cut) => Cut): void {
  setProject((p) => ({ ...p, cuts: p.cuts.map((c) => (c.id === id ? fn(c) : c)) }));
  markCut(id);
}

function newCut(pos: number, duration: number): Cut {
  return {
    id: newId(),
    pos,
    duration,
    lyric: '',
    desc: '',
    memo: '',
    status: 'todo',
    due: null,
    items: [],
  };
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export function notify(message: string): void {
  useEditor.setState({ notice: message });
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => useEditor.setState({ notice: null }), 6000);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---- 開く・閉じる ----

async function loadAudio(p: Project): Promise<void> {
  if (!p.audio) {
    setAudioSrc(null);
    useEditor.setState({ audioUrl: null });
    return;
  }
  try {
    const blob = await getBlob(p.audio.path);
    if (useEditor.getState().project?.id !== p.id) return;
    const url = URL.createObjectURL(blob);
    setAudioSrc(url);
    useEditor.setState({ audioUrl: url });
  } catch (e) {
    notify(`音源を取得できなかった。${errorText(e)}`);
  }
}

/** 開く・閉じるが続けて起きたときに、古い処理が新しい状態を壊さないための番号 */
let session = 0;

function keepTools() {
  const prev = useEditor.getState();
  // 道具の設定は開き直しても引き継ぐ
  return { tool: prev.tool, color: prev.color, width: prev.width, showMargin: prev.showMargin };
}

export async function openProject(id: string): Promise<void> {
  const mine = ++session;
  pause();
  resetDirty();
  setAudioSrc(null);
  useEditor.setState({ ...initialEditor, ...keepTools(), loadState: 'loading' });
  try {
    const p = await getStore().loadProject(id);
    if (mine !== session) return;
    if (!p) {
      useEditor.setState({ loadState: 'missing' });
      return;
    }
    // 並び順の数が詰まりすぎていたら振り直す
    let renumber = false;
    for (let i = 1; i < p.cuts.length; i++) {
      if (p.cuts[i].pos - p.cuts[i - 1].pos < 1e-6) renumber = true;
    }
    if (renumber) p.cuts = p.cuts.map((c, i) => ({ ...c, pos: i + 1 }));
    useEditor.setState({ project: p, loadState: 'ready', time: 0 });
    if (renumber) p.cuts.forEach((c) => markCut(c.id));
    void loadAudio(p);
    void cleanupFiles(p.id);
  } catch (e) {
    if (mine !== session) return;
    useEditor.setState({ loadState: 'error', loadError: errorText(e) });
  }
}

export async function closeProject(): Promise<void> {
  const mine = session;
  pause();
  // 保存する内容は呼んだ瞬間に控えられる。送り終わるのを待つ間に別のコンテが開かれてもよい
  await flushNow();
  if (mine !== session) return;
  session++;
  setAudioSrc(null);
  useEditor.setState({ ...initialEditor, ...keepTools() });
}

// ---- プロジェクト全体 ----

export function setTitle(title: string): void {
  setProject((p) => ({ ...p, title }));
  markMeta();
}

export function setPhases(phases: Phase[]): void {
  setProject((p) => ({ ...p, phases }));
  markMeta();
}

// ---- カット ----

export function selectCut(id: string): void {
  const p = useEditor.getState().project;
  if (!p) return;
  const i = p.cuts.findIndex((c) => c.id === id);
  if (i >= 0) seek(cutStart(p.cuts, i));
}

export function stepCut(dir: -1 | 1): void {
  const s = useEditor.getState();
  const p = s.project;
  if (!p || p.cuts.length === 0) return;
  const cur = cutIndexAt(p, s.time);
  let next: number;
  if (cur < 0) next = dir < 0 ? p.cuts.length - 1 : -1;
  else next = cur + dir;
  if (next < 0 || next >= p.cuts.length) return;
  seek(cutStart(p.cuts, next));
}

/** 再生位置にカットの切れ目を入れる（再生しながら打つための操作） */
export function tapCut(): void {
  const s = useEditor.getState();
  const p = s.project;
  if (!p) return;
  const t = snap(s.time, p.fps);
  const total = cutsTotal(p.cuts);
  if (t >= total + MIN_CUT - 1e-9) {
    // カットの終わりより後ろで打ったら、そこまでを新しいカットにする
    const pos = p.cuts.length > 0 ? p.cuts[p.cuts.length - 1].pos + 1 : 1;
    const c = newCut(pos, t - total);
    setProject((pp) => ({ ...pp, cuts: [...pp.cuts, c] }));
    markCut(c.id);
    return;
  }
  let acc = 0;
  for (let i = 0; i < p.cuts.length; i++) {
    const c = p.cuts[i];
    const start = acc;
    const end = acc + c.duration;
    if (t > start + MIN_CUT - 1e-9 && t < end - MIN_CUT + 1e-9) {
      // カットの途中で打ったら、そこで2つに分ける。絵は前半に残す
      const nextPos = i + 1 < p.cuts.length ? p.cuts[i + 1].pos : c.pos + 2;
      const a: Cut = { ...c, duration: t - start };
      const b = newCut((c.pos + nextPos) / 2, end - t);
      setProject((pp) => ({
        ...pp,
        cuts: [...pp.cuts.slice(0, i), a, b, ...pp.cuts.slice(i + 1)],
      }));
      markCut(a.id);
      markCut(b.id);
      return;
    }
    acc = end;
  }
}

/** 末尾にカットを足す。音源の残りがあればその長さ、なければ2秒 */
export function addCutAtEnd(): void {
  const p = useEditor.getState().project;
  if (!p) return;
  const total = cutsTotal(p.cuts);
  const remain = (p.audio?.duration ?? 0) - total;
  const duration = remain > 0.2 ? Math.max(MIN_CUT, remain) : 2;
  const pos = p.cuts.length > 0 ? p.cuts[p.cuts.length - 1].pos + 1 : 1;
  const c = newCut(pos, duration);
  setProject((pp) => ({ ...pp, cuts: [...pp.cuts, c] }));
  markCut(c.id);
  seek(total);
}

/**
 * カットの終わりの境界を動かす。
 * 次のカットがあるときは、その分だけ次のカットを伸び縮みさせる（全体の長さは変えない）。
 */
export function moveBoundary(index: number, tEnd: number): void {
  const p = useEditor.getState().project;
  if (!p) return;
  const cur = p.cuts[index];
  if (!cur) return;
  const next = p.cuts[index + 1];
  const start = cutStart(p.cuts, index);
  const end = start + cur.duration;
  const lo = start + MIN_CUT;
  const hi = next ? end + next.duration - MIN_CUT : Infinity;
  const t = Math.max(lo, Math.min(hi, snap(tEnd, p.fps)));
  const delta = t - end;
  if (Math.abs(delta) < 1e-9) return;
  setProject((pp) => ({
    ...pp,
    cuts: pp.cuts.map((c, i) => {
      if (i === index) return { ...c, duration: t - start };
      if (i === index + 1) return { ...c, duration: c.duration - delta };
      return c;
    }),
  }));
  markCut(cur.id);
  if (next) markCut(next.id);
}

export function deleteCut(id: string): void {
  const s = useEditor.getState();
  const p = s.project;
  if (!p) return;
  const i = p.cuts.findIndex((c) => c.id === id);
  if (i < 0) return;
  const cuts = p.cuts.filter((c) => c.id !== id);
  useEditor.setState({
    project: { ...p, cuts },
    undoStack: s.undoStack.filter((e) => e.cutId !== id),
    redoStack: s.redoStack.filter((e) => e.cutId !== id),
    selectedItemId: null,
  });
  markDeleted(id);
  seek(cutStart(cuts, Math.min(i, Math.max(0, cuts.length - 1))));
}

export function duplicateCut(id: string): void {
  const p = useEditor.getState().project;
  if (!p) return;
  const i = p.cuts.findIndex((c) => c.id === id);
  if (i < 0) return;
  const src = p.cuts[i];
  const nextPos = i + 1 < p.cuts.length ? p.cuts[i + 1].pos : src.pos + 2;
  const copy: Cut = {
    ...src,
    id: newId(),
    pos: (src.pos + nextPos) / 2,
    items: src.items.map((it) => ({ ...it, id: newId() })),
  };
  const cuts = [...p.cuts.slice(0, i + 1), copy, ...p.cuts.slice(i + 1)];
  setProject((pp) => ({ ...pp, cuts }));
  markCut(copy.id);
  seek(cutStart(cuts, i + 1));
}

export type CutFields = Partial<Pick<Cut, 'lyric' | 'desc' | 'memo' | 'status' | 'due'>>;

export function updateCut(id: string, patch: CutFields): void {
  patchCut(id, (c) => ({ ...c, ...patch }));
}

// ---- 絵（取り消しができる変更） ----

export function commitBoard(cutId: string, after: BoardItem[]): void {
  const s = useEditor.getState();
  const cut = s.project?.cuts.find((c) => c.id === cutId);
  if (!cut || cut.items === after) return;
  useEditor.setState({
    undoStack: [...s.undoStack, { cutId, before: cut.items, after }].slice(-HISTORY_LIMIT),
    redoStack: [],
  });
  patchCut(cutId, (c) => ({ ...c, items: after }));
}

function showCut(cutId: string): void {
  const s = useEditor.getState();
  const p = s.project;
  if (!p) return;
  const i = p.cuts.findIndex((c) => c.id === cutId);
  if (i >= 0 && cutIndexAt(p, s.time) !== i) seek(cutStart(p.cuts, i));
}

export function undo(): void {
  const s = useEditor.getState();
  const e = s.undoStack[s.undoStack.length - 1];
  if (!e) return;
  useEditor.setState({
    undoStack: s.undoStack.slice(0, -1),
    redoStack: [...s.redoStack, e],
    selectedItemId: null,
  });
  patchCut(e.cutId, (c) => ({ ...c, items: e.before }));
  showCut(e.cutId);
}

export function redo(): void {
  const s = useEditor.getState();
  const e = s.redoStack[s.redoStack.length - 1];
  if (!e) return;
  useEditor.setState({
    redoStack: s.redoStack.slice(0, -1),
    undoStack: [...s.undoStack, e],
    selectedItemId: null,
  });
  patchCut(e.cutId, (c) => ({ ...c, items: e.after }));
  showCut(e.cutId);
}

// ---- 音源 ----

export async function importAudio(file: File): Promise<void> {
  const p0 = useEditor.getState().project;
  if (!p0) return;
  if (useEditor.getState().busy) return;
  pause();
  useEditor.setState({ busy: { label: '音源を読み込み中', ratio: 0 } });
  try {
    const prepared = await prepareAudio(file, (label, ratio) =>
      useEditor.setState({ busy: { label, ratio } }),
    );
    useEditor.setState({ busy: { label: '音源を保存中', ratio: 1 } });
    const path = await getStore().uploadFile(
      p0.id,
      fileName('audio', prepared.ext),
      prepared.blob,
    );
    primeBlob(path, prepared.blob);
    const cur = useEditor.getState().project;
    if (!cur || cur.id !== p0.id) return;
    const old = cur.audio?.path;
    setProject((p) => ({
      ...p,
      audio: {
        path,
        name: file.name,
        duration: prepared.duration,
        peaks: prepared.peaks,
        peaksPerSec: PEAKS_PER_SEC,
        offset: prepared.offset,
      },
    }));
    markMeta();
    const url = URL.createObjectURL(prepared.blob);
    setAudioSrc(url);
    useEditor.setState({ audioUrl: url, time: 0 });
    if (old) void getStore().removeFiles([old]);
  } catch (e) {
    notify(`音源を読み込めなかった。対応していない形式の可能性がある。（${errorText(e)}）`);
  } finally {
    useEditor.setState({ busy: null });
  }
}

// ---- 画像 ----

/** 画像を今のカットに貼る。at は置く位置の中心（枠の座標） */
export async function addImage(blob: Blob, at?: { x: number; y: number }): Promise<void> {
  const s0 = useEditor.getState();
  const p0 = s0.project;
  if (!p0 || s0.playing) return;
  if (cutIndexAt(p0, s0.time) < 0) addCutAtEnd();
  useEditor.setState({ busy: { label: '画像を保存中', ratio: 1 } });
  try {
    const prepared = await prepareImage(blob);
    const path = await getStore().uploadFile(
      p0.id,
      fileName('img', prepared.ext),
      prepared.blob,
    );
    primeBlob(path, prepared.blob);
    const s = useEditor.getState();
    const p = s.project;
    if (!p || p.id !== p0.id) return;
    const idx = cutIndexAt(p, s.time);
    if (idx < 0) return;
    const cut = p.cuts[idx];
    // 置いた直後は枠の6割までの大きさに収める
    const k = Math.min(1, (FRAME_W * 0.6) / prepared.w, (FRAME_H * 0.6) / prepared.h);
    const w = prepared.w * k;
    const h = prepared.h * k;
    const cx = at?.x ?? FRAME_W / 2;
    const cy = at?.y ?? FRAME_H / 2;
    const item: ImageItem = {
      id: newId(),
      kind: 'image',
      path,
      x: cx - w / 2,
      y: cy - h / 2,
      w,
      h,
    };
    commitBoard(cut.id, [...cut.items, item]);
    useEditor.setState({ tool: 'select', selectedItemId: item.id });
  } catch (e) {
    notify(`画像を貼れなかった。（${errorText(e)}）`);
  } finally {
    useEditor.setState({ busy: null });
  }
}

/** 選択中の絵・文字・画像を消す */
export function deleteSelectedItem(): void {
  const s = useEditor.getState();
  const p = s.project;
  if (!p || !s.selectedItemId) return;
  const idx = cutIndexAt(p, s.time);
  if (idx < 0) return;
  const cut = p.cuts[idx];
  if (!cut.items.some((i) => i.id === s.selectedItemId)) return;
  const after: BoardItem[] = cut.items.filter((i) => i.id !== s.selectedItemId);
  commitBoard(cut.id, after);
  useEditor.setState({ selectedItemId: null });
}
