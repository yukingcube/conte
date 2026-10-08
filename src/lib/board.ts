import {
  type BoardItem,
  type StrokeItem,
  type TextItem,
  BOARD_H,
  BOARD_W,
  FRAME_H,
  FRAME_W,
  MARGIN_X,
  MARGIN_Y,
} from '../types';

export const PAPER = '#FAFAF7';
export const MARGIN_BG = '#DEDED8';
export const INK = '#1A1A1A';
export const FONT_FAMILY = '"Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic UI", sans-serif';
export const LINE_H = 1.3;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ImageGetter = (path: string) => CanvasImageSource | undefined;

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

export function textFont(size: number): string {
  return `700 ${size}px ${FONT_FAMILY}`;
}

export function textBox(t: TextItem): Box {
  const ctx = mctx();
  ctx.font = textFont(t.size);
  const lines = t.text.split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  return { x: t.x, y: t.y, w: Math.max(w, t.size * 0.5), h: lines.length * t.size * LINE_H };
}

export function itemBox(it: BoardItem): Box {
  if (it.kind === 'image') return { x: it.x, y: it.y, w: it.w, h: it.h };
  if (it.kind === 'text') return textBox(it);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < it.points.length; i += 2) {
    minX = Math.min(minX, it.points[i]);
    maxX = Math.max(maxX, it.points[i]);
    minY = Math.min(minY, it.points[i + 1]);
    maxY = Math.max(maxY, it.points[i + 1]);
  }
  const r = it.width / 2;
  return { x: minX - r, y: minY - r, w: maxX - minX + r * 2, h: maxY - minY + r * 2 };
}

/** 画面に表示する範囲。余白を表示するときは枠の外側まで含める */
export function viewOf(showMargin: boolean): { w: number; h: number; ox: number; oy: number } {
  return showMargin
    ? { w: BOARD_W, h: BOARD_H, ox: MARGIN_X, oy: MARGIN_Y }
    : { w: FRAME_W, h: FRAME_H, ox: 0, oy: 0 };
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  s: Pick<StrokeItem, 'color' | 'width' | 'points'>,
  minWidth: number,
): void {
  const p = s.points;
  if (p.length < 2) return;
  const width = Math.max(s.width, minWidth);
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  // 点と点の中間を通る曲線でつなぎ、線を滑らかにする
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2;
    const my = (p[i + 1] + p[i + 3]) / 2;
    ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
  ctx.stroke();
}

function drawItems(
  ctx: CanvasRenderingContext2D,
  items: BoardItem[],
  getImage: ImageGetter,
  minWidth: number,
): void {
  for (const it of items) {
    if (it.kind === 'stroke') {
      drawStroke(ctx, it, minWidth);
    } else if (it.kind === 'image') {
      const img = getImage(it.path);
      if (img) {
        ctx.drawImage(img, it.x, it.y, it.w, it.h);
      } else {
        ctx.fillStyle = '#D9D9D4';
        ctx.fillRect(it.x, it.y, it.w, it.h);
      }
    } else {
      ctx.font = textFont(it.size);
      ctx.fillStyle = it.color;
      ctx.textBaseline = 'top';
      const lines = it.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], it.x, it.y + i * it.size * LINE_H + it.size * 0.12);
      }
    }
  }
}

export interface RenderOpts {
  showMargin: boolean;
  getImage: ImageGetter;
  selectedId?: string | null;
  accent?: string;
  draft?: Pick<StrokeItem, 'color' | 'width' | 'points'> | null;
  /** 画面上での線の最小の太さ（px）。サムネイルで線が消えないようにする */
  minStrokePx?: number;
  /** 編集中で隠しておく項目 */
  hideId?: string | null;
}

export const HANDLE_PX = 12;

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  pxW: number,
  pxH: number,
  items: BoardItem[],
  opts: RenderOpts,
): void {
  const v = viewOf(opts.showMargin);
  const s = pxW / v.w;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pxW, pxH);
  ctx.fillStyle = opts.showMargin ? MARGIN_BG : PAPER;
  ctx.fillRect(0, 0, pxW, pxH);
  ctx.setTransform(s, 0, 0, s, v.ox * s, v.oy * s);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  const minWidth = (opts.minStrokePx ?? 0) / s;
  const shown = opts.hideId ? items.filter((i) => i.id !== opts.hideId) : items;
  drawItems(ctx, shown, opts.getImage, minWidth);
  if (opts.draft) drawStroke(ctx, opts.draft, minWidth);
  if (opts.showMargin) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5 / s;
    ctx.strokeRect(0, 0, FRAME_W, FRAME_H);
  }
  const sel = opts.selectedId ? shown.find((i) => i.id === opts.selectedId) : null;
  if (sel) {
    const b = itemBox(sel);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5 / s;
    ctx.setLineDash([6 / s, 4 / s]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    if (sel.kind !== 'stroke') {
      const hs = HANDLE_PX / s;
      ctx.fillStyle = opts.accent ?? '#F2CF3F';
      ctx.fillRect(b.x + b.w - hs / 2, b.y + b.h - hs / 2, hs, hs);
      ctx.strokeRect(b.x + b.w - hs / 2, b.y + b.h - hs / 2, hs, hs);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function distToStroke(s: StrokeItem, x: number, y: number): number {
  const p = s.points;
  if (p.length === 2) return Math.hypot(x - p[0], y - p[1]);
  let min = Infinity;
  for (let i = 0; i < p.length - 2; i += 2) {
    min = Math.min(min, distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]));
  }
  return min;
}

/** その位置にある一番手前の項目を返す */
export function hitItem(items: BoardItem[], x: number, y: number, tol: number): BoardItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'stroke') {
      if (distToStroke(it, x, y) <= it.width / 2 + tol) return it;
    } else {
      const b = itemBox(it);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return it;
    }
  }
  return null;
}

export function moveItem(it: BoardItem, dx: number, dy: number): BoardItem {
  if (it.kind === 'stroke') {
    const points = it.points.slice();
    for (let i = 0; i < points.length; i += 2) {
      points[i] += dx;
      points[i + 1] += dy;
    }
    return { ...it, points };
  }
  return { ...it, x: it.x + dx, y: it.y + dy };
}

/** カットの段に並べる小さな絵を作る。枠の中だけを描く */
export function renderThumb(items: BoardItem[], getImage: ImageGetter, w = 224, h = 126): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  renderBoard(ctx, w, h, items, { showMargin: false, getImage, minStrokePx: 1.6 });
  return c.toDataURL('image/webp', 0.8);
}
