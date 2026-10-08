import { create } from 'zustand';
import type { BoardItem, Cut, Project } from '../types';

export type Tool = 'select' | 'pen' | 'eraser' | 'text';
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export interface HistoryEntry {
  cutId: string;
  before: BoardItem[];
  after: BoardItem[];
}

export interface EditorState {
  project: Project | null;
  loadState: 'idle' | 'loading' | 'ready' | 'missing' | 'error';
  loadError: string;
  /** 再生位置（秒）。モニターに出すカットもこの位置から決まる */
  time: number;
  playing: boolean;
  tool: Tool;
  color: string;
  width: number;
  showMargin: boolean;
  selectedItemId: string | null;
  zoom: number;
  saveState: SaveState;
  busy: { label: string; ratio: number } | null;
  notice: string | null;
  audioUrl: string | null;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}

export const PEN_COLORS = ['#1A1A1A', '#8A8A86', '#2F62E0'] as const;
export const PEN_WIDTHS = [4, 9, 18] as const;

export const initialEditor: EditorState = {
  project: null,
  loadState: 'idle',
  loadError: '',
  time: 0,
  playing: false,
  tool: 'pen',
  color: PEN_COLORS[0],
  width: PEN_WIDTHS[1],
  showMargin: true,
  selectedItemId: null,
  zoom: 1,
  saveState: 'saved',
  busy: null,
  notice: null,
  audioUrl: null,
  undoStack: [],
  redoStack: [],
};

export const useEditor = create<EditorState>(() => ({ ...initialEditor }));

/** カットの最短の長さ（秒） */
export const MIN_CUT = 0.1;

export function cutsTotal(cuts: Cut[]): number {
  let t = 0;
  for (const c of cuts) t += c.duration;
  return t;
}

export function cutStart(cuts: Cut[], index: number): number {
  let t = 0;
  for (let i = 0; i < index; i++) t += cuts[i].duration;
  return t;
}

/** タイムライン全体の長さ。音源とカットの合計のうち長いほう */
export function totalDuration(p: Project): number {
  return Math.max(p.audio?.duration ?? 0, cutsTotal(p.cuts));
}

/** その時刻にあるカットの番号。どのカットにも入らない区間なら -1 */
export function cutIndexAt(p: Project, t: number): number {
  let acc = 0;
  for (let i = 0; i < p.cuts.length; i++) {
    acc += p.cuts[i].duration;
    if (t < acc - 1e-9) return i;
  }
  if (p.cuts.length === 0) return -1;
  // カットの終わりより後に音源が続いていれば「未割り当て」の区間
  const audioDur = p.audio?.duration ?? 0;
  return audioDur > acc + 1e-3 ? -1 : p.cuts.length - 1;
}

export function useCurrentCutIndex(): number {
  return useEditor((s) => (s.project ? cutIndexAt(s.project, s.time) : -1));
}

export function useCurrentCut(): Cut | null {
  return useEditor((s) => {
    if (!s.project) return null;
    const i = cutIndexAt(s.project, s.time);
    return i >= 0 ? s.project.cuts[i] : null;
  });
}

export function cutLabel(index: number): string {
  return `C${String(index + 1).padStart(2, '0')}`;
}
