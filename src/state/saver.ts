import type { Project } from '../types';
import { getStore } from '../store';
import { useEditor } from './editor';

// 変更をまとめて保存する仕組み。
// 変わったカットだけを覚えておき、操作が止まってから少し後にまとめて送る。

const dirty = {
  meta: false,
  cuts: new Set<string>(),
  deleted: new Set<string>(),
};

interface Batch {
  cutIds: string[];
  deleted: string[];
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** 今まさに送っている保存。次の保存はこれが終わってから始める */
let inFlight: Promise<void> | null = null;
const DELAY_MS = 1000;
const RETRY_MS = 5000;

function hasDirty(): boolean {
  return dirty.meta || dirty.cuts.size > 0 || dirty.deleted.size > 0;
}

function schedule(delay = DELAY_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

export function markMeta(): void {
  dirty.meta = true;
  useEditor.setState({ saveState: 'dirty' });
  schedule();
}

export function markCut(id: string): void {
  dirty.cuts.add(id);
  useEditor.setState({ saveState: 'dirty' });
  schedule();
}

export function markDeleted(id: string): void {
  dirty.cuts.delete(id);
  dirty.deleted.add(id);
  useEditor.setState({ saveState: 'dirty' });
  schedule();
}

export function resetDirty(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  dirty.meta = false;
  dirty.cuts.clear();
  dirty.deleted.clear();
}

export function isUnsaved(): boolean {
  return hasDirty() || inFlight !== null;
}

/** 覚えていた変更を取り出して空にする */
function take(): Batch | null {
  if (!hasDirty()) return null;
  const batch: Batch = { cutIds: [...dirty.cuts], deleted: [...dirty.deleted] };
  dirty.meta = false;
  dirty.cuts.clear();
  dirty.deleted.clear();
  return batch;
}

function putBack(batch: Batch): void {
  dirty.meta = true;
  batch.cutIds.forEach((id) => {
    if (!dirty.deleted.has(id)) dirty.cuts.add(id);
  });
  batch.deleted.forEach((id) => dirty.deleted.add(id));
}

async function send(p: Project, batch: Batch): Promise<void> {
  const store = getStore();
  if (batch.deleted.length > 0) await store.deleteCuts(p.id, batch.deleted);
  const cuts = p.cuts.filter((c) => batch.cutIds.includes(c.id));
  if (cuts.length > 0) await store.upsertCuts(p.id, cuts);
  // 更新日時を進めるため、カットだけの変更でも毎回送る
  await store.saveMeta(p);
}

async function flush(): Promise<void> {
  if (inFlight) {
    // 保存中に来た変更は、今の保存が終わった後にもう一度送る
    schedule(300);
    return;
  }
  const p = useEditor.getState().project;
  const batch = p ? take() : null;
  if (!p || !batch) return;
  useEditor.setState({ saveState: 'saving' });
  const job = send(p, batch);
  inFlight = job.then(
    () => undefined,
    () => undefined,
  );
  try {
    await job;
    inFlight = null;
    const stillOpen = useEditor.getState().project?.id === p.id;
    if (!stillOpen) return;
    if (hasDirty()) {
      useEditor.setState({ saveState: 'dirty' });
      schedule(200);
    } else {
      useEditor.setState({ saveState: 'saved' });
    }
  } catch (e) {
    inFlight = null;
    console.error(e);
    if (useEditor.getState().project?.id !== p.id) return;
    // 失敗した分は覚え直して、後でもう一度試す
    putBack(batch);
    useEditor.setState({ saveState: 'error' });
    schedule(RETRY_MS);
  }
}

/**
 * 画面を離れる前に、待たずにすぐ保存する。
 * 呼んだ時点の内容をその場で控えるので、直後に別のコンテを開いても取り違えない。
 */
export async function flushNow(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const p = useEditor.getState().project;
  const batch = p ? take() : null;
  const before = inFlight;
  if (!p || !batch) {
    if (before) await before;
    return;
  }
  const job = (before ?? Promise.resolve()).then(() => send(p, batch));
  const mine = job.then(
    () => undefined,
    (e) => console.error(e),
  );
  inFlight = mine;
  await mine;
  if (inFlight === mine) inFlight = null;
}
