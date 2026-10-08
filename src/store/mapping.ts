import type { AudioMeta, BoardItem, Cut, CutStatus, Phase, Project } from '../types';
import { STATUS_ORDER } from '../types';
import { newId } from '../lib/id';

// 保存するときの形と、アプリの中で使う形の変換。
// 保存データに欠けがあっても動くよう、読み込み時に必ず初期値で埋める。

export interface MetaJson {
  fps?: number;
  audio?: AudioMeta | null;
  phases?: Phase[];
}

export interface CutDataJson {
  lyric?: string;
  desc?: string;
  memo?: string;
  status?: CutStatus;
  due?: string | null;
  items?: BoardItem[];
}

export function defaultPhases(): Phase[] {
  return ['コンテ確定', '制作', '確認', '納品'].map((name) => ({
    id: newId(),
    name,
    start: null,
    end: null,
  }));
}

export function metaOf(p: Project): MetaJson {
  return { fps: p.fps, audio: p.audio, phases: p.phases };
}

export function cutDataOf(c: Cut): CutDataJson {
  return {
    lyric: c.lyric,
    desc: c.desc,
    memo: c.memo,
    status: c.status,
    due: c.due,
    items: c.items,
  };
}

export function toCut(
  id: string,
  pos: number,
  duration: number,
  data: CutDataJson | null | undefined,
): Cut {
  const d = data ?? {};
  return {
    id,
    pos,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 1,
    lyric: d.lyric ?? '',
    desc: d.desc ?? '',
    memo: d.memo ?? '',
    status: d.status && STATUS_ORDER.includes(d.status) ? d.status : 'todo',
    due: d.due ?? null,
    items: Array.isArray(d.items) ? d.items : [],
  };
}

export function toProject(
  id: string,
  title: string,
  meta: MetaJson | null | undefined,
  updatedAt: string,
  cuts: Cut[],
): Project {
  const m = meta ?? {};
  return {
    id,
    title,
    fps: m.fps && m.fps > 0 ? m.fps : 30,
    audio: m.audio ?? null,
    phases: Array.isArray(m.phases) ? m.phases : defaultPhases(),
    cuts,
    updatedAt,
  };
}
