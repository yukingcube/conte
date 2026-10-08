// データの型。座標はすべて「枠の左上を原点とした 1920×1080 の座標」で持つ。
// 枠の外の余白に描いたものは、負の値や 1920 / 1080 を超える値になる。

export type CutStatus = 'todo' | 'doing' | 'review' | 'done';

export interface StrokeItem {
  id: string;
  kind: 'stroke';
  color: string;
  width: number;
  /** x0, y0, x1, y1, ... の並び */
  points: number[];
}

export interface ImageItem {
  id: string;
  kind: 'image';
  /** 保存先でのファイルの場所 */
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextItem {
  id: string;
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
}

export type BoardItem = StrokeItem | ImageItem | TextItem;

export interface Cut {
  id: string;
  /** 並び順を決める数。小さいほど先。間に挟むときは前後の中間の値を使う */
  pos: number;
  /** 秒 */
  duration: number;
  lyric: string;
  desc: string;
  memo: string;
  status: CutStatus;
  /** 締切 YYYY-MM-DD */
  due: string | null;
  items: BoardItem[];
}

export interface Phase {
  id: string;
  name: string;
  /** YYYY-MM-DD。1日だけの工程（納品など）は end だけを入れる */
  start: string | null;
  end: string | null;
}

export interface AudioMeta {
  path: string;
  name: string;
  /** 秒 */
  duration: number;
  /** 波形。0〜255 の値を base64 にしたもの */
  peaks: string;
  peaksPerSec: number;
  /**
   * 保存したファイルの頭に付いた余分な無音の長さ（秒）。
   * MP3 に圧縮すると頭に数十ミリ秒の遅れが入るので、再生のときにこの分だけずらして
   * 元の音源と同じタイミングに合わせる。
   */
  offset?: number;
}

export interface Project {
  id: string;
  title: string;
  fps: number;
  audio: AudioMeta | null;
  phases: Phase[];
  cuts: Cut[];
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export const STATUS_LABEL: Record<CutStatus, string> = {
  todo: '未着手',
  doing: '作業中',
  review: '確認待ち',
  done: '完了',
};

export const STATUS_ORDER: CutStatus[] = ['todo', 'doing', 'review', 'done'];

export const FRAME_W = 1920;
export const FRAME_H = 1080;
export const MARGIN_X = 240;
export const MARGIN_Y = 180;
export const BOARD_W = FRAME_W + MARGIN_X * 2;
export const BOARD_H = FRAME_H + MARGIN_Y * 2;
