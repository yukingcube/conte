import {
  type CSSProperties,
  type PointerEvent as RPointerEvent,
  type DragEvent as RDragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { BoardItem, ImageItem, StrokeItem, TextItem } from '../types';
import { BOARD_H, BOARD_W, FRAME_H, FRAME_W } from '../types';
import {
  type Box,
  HANDLE_PX,
  distToStroke,
  hitItem,
  itemBox,
  moveItem,
  renderBoard,
  viewOf,
} from '../lib/board';
import { filesVersion, getImage, subscribeFiles } from '../lib/files';
import { newId } from '../lib/id';
import { fmtTime } from '../lib/time';
import {
  PEN_COLORS,
  PEN_WIDTHS,
  type Tool,
  cutIndexAt,
  totalDuration,
  useCurrentCut,
  useEditor,
} from '../state/editor';
import {
  addCutAtEnd,
  addImage,
  commitBoard,
  importAudio,
  redo,
  stepCut,
  tapCut,
  undo,
} from '../state/actions';
import { togglePlay } from '../state/player';
import { Icon } from './Icon';

const COLOR_NAMES = ['黒', 'グレー', '青'];
const WIDTH_NAMES = ['細', '中', '太'];
const WIDTH_DOTS = [4, 8, 13];
const MAX_STAGE_W = 960;

// ---------- 道具の並び ----------

function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const color = useEditor((s) => s.color);
  const width = useEditor((s) => s.width);
  const showMargin = useEditor((s) => s.showMargin);
  const canUndo = useEditor((s) => s.undoStack.length > 0);
  const canRedo = useEditor((s) => s.redoStack.length > 0);
  const fileRef = useRef<HTMLInputElement>(null);

  const tools: { id: Tool; label: string; icon: string }[] = [
    { id: 'select', label: '選択と移動（V）', icon: 'select' },
    { id: 'pen', label: 'ペン（B）', icon: 'pen' },
    { id: 'eraser', label: '消しゴム（E）', icon: 'eraser' },
    { id: 'text', label: '文字を置く（T）', icon: 'text' },
  ];

  return (
    <div className="toolbar">
      {tools.map((t) => (
        <button
          key={t.id}
          className={`icon-btn${tool === t.id ? ' on' : ''}`}
          aria-label={t.label}
          title={t.label}
          aria-pressed={tool === t.id}
          onClick={() => useEditor.setState({ tool: t.id, selectedItemId: null })}
        >
          <Icon name={t.icon} size={22} />
        </button>
      ))}
      <button
        className="icon-btn tool-text"
        title="画像を貼る（ドラッグ＆ドロップ、Ctrl+V でも貼れる）"
        onClick={() => fileRef.current?.click()}
      >
        <Icon name="image" size={22} />
        <span>画像</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addImage(f);
          e.target.value = '';
        }}
      />
      <div className="sep" />
      <button
        className="icon-btn"
        aria-label="取り消し（Ctrl+Z）"
        title="取り消し（Ctrl+Z）"
        disabled={!canUndo}
        onClick={undo}
      >
        <Icon name="undo" size={22} />
      </button>
      <button
        className="icon-btn"
        aria-label="やり直し（Ctrl+Y）"
        title="やり直し（Ctrl+Y）"
        disabled={!canRedo}
        onClick={redo}
      >
        <Icon name="redo" size={22} />
      </button>
      <div className="sep" />
      {PEN_COLORS.map((c, i) => (
        <button
          key={c}
          className={`icon-btn${color === c ? ' picked' : ''}`}
          aria-label={`色：${COLOR_NAMES[i]}`}
          title={`色：${COLOR_NAMES[i]}`}
          aria-pressed={color === c}
          onClick={() => useEditor.setState({ color: c })}
        >
          <span className="swatch" style={{ background: c }} />
        </button>
      ))}
      <div className="sep" />
      {PEN_WIDTHS.map((w, i) => (
        <button
          key={w}
          className={`icon-btn${width === w ? ' on-soft' : ''}`}
          aria-label={`太さ：${WIDTH_NAMES[i]}`}
          title={`太さ：${WIDTH_NAMES[i]}`}
          aria-pressed={width === w}
          onClick={() => useEditor.setState({ width: w })}
        >
          <span className="dot" style={{ width: WIDTH_DOTS[i], height: WIDTH_DOTS[i] }} />
        </button>
      ))}
      <div className="spacer" />
      <button
        className="switch-btn"
        aria-pressed={showMargin}
        title="枠の外の余白を表示する"
        onClick={() => useEditor.setState({ showMargin: !showMargin })}
      >
        <span>枠の外</span>
        <span className={`switch${showMargin ? ' on' : ''}`}>
          <i />
        </span>
      </button>
    </div>
  );
}

// ---------- 描く場所 ----------

type Drag =
  | { mode: 'pen' }
  | { mode: 'erase'; items: BoardItem[]; changed: boolean }
  | { mode: 'move'; id: string; x0: number; y0: number; orig: BoardItem; moved: boolean }
  | { mode: 'resize'; id: string; orig: ImageItem | TextItem; box: Box; moved: boolean };

interface TextEdit {
  /** どのカットに置く文字か。入力中にカットが切り替わっても取り違えないために持つ */
  cutId: string;
  id: string | null;
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
}

function eraseAt(items: BoardItem[], x: number, y: number, r: number): BoardItem[] {
  let hit = false;
  const out = items.filter((it) => {
    if (it.kind !== 'stroke') return true;
    if (distToStroke(it, x, y) <= r + it.width / 2) {
      hit = true;
      return false;
    }
    return true;
  });
  return hit ? out : items;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

function Stage() {
  const cut = useCurrentCut();
  const showMargin = useEditor((s) => s.showMargin);
  const tool = useEditor((s) => s.tool);
  const playing = useEditor((s) => s.playing);
  const selectedId = useEditor((s) => s.selectedItemId);
  const ver = useSyncExternalStore(subscribeFiles, filesVersion);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dropOn, setDropOn] = useState(false);
  const [editing, setEditing] = useState<TextEdit | null>(null);
  const editingRef = useRef<TextEdit | null>(null);
  editingRef.current = editing;

  const drag = useRef<Drag | null>(null);
  const liveItems = useRef<BoardItem[] | null>(null);
  const draft = useRef<Pick<StrokeItem, 'color' | 'width' | 'points'> | null>(null);

  // 置ける広さに合わせて、縦横比を保ったまま大きさを決める
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ratio = showMargin ? BOARD_W / BOARD_H : FRAME_W / FRAME_H;
    const fit = () => {
      const availW = Math.min(el.clientWidth, MAX_STAGE_W);
      const availH = el.clientHeight;
      // 縦に並ぶ狭い画面では高さが中身しだいになるので、幅から決める
      const byWidth = window.matchMedia('(max-width: 900px)').matches || availH < 40;
      const w = byWidth ? availW : Math.max(120, Math.min(availW, availH * ratio));
      setSize({ w: Math.floor(w), h: Math.floor(w / ratio) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showMargin]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const st = useEditor.getState();
    const p = st.project;
    if (!p) return;
    const idx = cutIndexAt(p, st.time);
    const items = liveItems.current ?? (idx >= 0 ? p.cuts[idx].items : []);
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(size.w * dpr);
    const ph = Math.round(size.h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderBoard(ctx, pw, ph, items, {
      showMargin: st.showMargin,
      getImage,
      selectedId: st.playing ? null : st.selectedItemId,
      draft: draft.current,
      hideId: editingRef.current?.id ?? null,
    });
  }, [size]);

  useEffect(() => {
    paint();
  }, [paint, cut, showMargin, selectedId, ver, editing, playing]);

  const toBoard = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = viewOf(useEditor.getState().showMargin);
    const s = rect.width / v.w;
    return { x: (e.clientX - rect.left) / s - v.ox, y: (e.clientY - rect.top) / s - v.oy, s };
  };

  const commitText = useCallback(() => {
    const ed = editingRef.current;
    if (!ed) return;
    setEditing(null);
    const c = useEditor.getState().project?.cuts.find((x) => x.id === ed.cutId);
    if (!c) return;
    const text = ed.text.replace(/\s+$/, '');
    if (ed.id) {
      const exists = c.items.some((i) => i.id === ed.id);
      if (!exists) return;
      if (text === '') {
        commitBoard(c.id, c.items.filter((i) => i.id !== ed.id));
      } else {
        commitBoard(
          c.id,
          c.items.map((i) => (i.id === ed.id && i.kind === 'text' ? { ...i, text } : i)),
        );
      }
    } else if (text !== '') {
      const item: TextItem = {
        id: newId(),
        kind: 'text',
        x: round1(ed.x),
        y: round1(ed.y),
        text,
        size: ed.size,
        color: ed.color,
      };
      commitBoard(c.id, [...c.items, item]);
    }
  }, []);

  // カットが切り替わったら、入力途中の文字を確定する
  const cutId = cut?.id ?? null;
  useEffect(() => {
    return () => {
      if (editingRef.current) commitText();
    };
  }, [cutId, commitText]);

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (playing || !cut) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (editingRef.current) {
      commitText();
      return;
    }
    const st = useEditor.getState();
    const { x, y, s } = toBoard(e);
    if (tool === 'text') {
      const hit = hitItem(cut.items, x, y, 4 / s);
      if (hit && hit.kind === 'text') {
        setEditing({
          cutId: cut.id,
          id: hit.id,
          x: hit.x,
          y: hit.y,
          text: hit.text,
          size: hit.size,
          color: hit.color,
        });
      } else {
        const sizePx = Math.round(st.width * 5 + 28);
        setEditing({
          cutId: cut.id,
          id: null,
          x,
          y: y - sizePx / 2,
          text: '',
          size: sizePx,
          color: st.color,
        });
      }
      e.preventDefault();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pen') {
      draft.current = { color: st.color, width: st.width, points: [round1(x), round1(y)] };
      drag.current = { mode: 'pen' };
      paint();
    } else if (tool === 'eraser') {
      const items = eraseAt(cut.items, x, y, 14 / s);
      drag.current = { mode: 'erase', items, changed: items !== cut.items };
      liveItems.current = items;
      paint();
    } else {
      const sel = cut.items.find((i) => i.id === st.selectedItemId);
      if (sel && sel.kind !== 'stroke') {
        const b = itemBox(sel);
        const hs = (HANDLE_PX / s) * 1.3;
        if (Math.abs(x - (b.x + b.w)) <= hs && Math.abs(y - (b.y + b.h)) <= hs) {
          drag.current = { mode: 'resize', id: sel.id, orig: sel, box: b, moved: false };
          return;
        }
      }
      const hit = hitItem(cut.items, x, y, 8 / s);
      if (hit) {
        useEditor.setState({ selectedItemId: hit.id });
        drag.current = { mode: 'move', id: hit.id, x0: x, y0: y, orig: hit, moved: false };
      } else {
        useEditor.setState({ selectedItemId: null });
      }
    }
  };

  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || !cut) return;
    if (d.mode === 'pen') {
      const dr = draft.current;
      if (!dr) return;
      const native = e.nativeEvent;
      const evs = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
      const list = evs.length > 0 ? evs : [native];
      for (const ev of list) {
        const { x, y, s } = toBoard(ev);
        const n = dr.points.length;
        if (Math.hypot(x - dr.points[n - 2], y - dr.points[n - 1]) >= 1.5 / s) {
          dr.points.push(round1(x), round1(y));
        }
      }
      paint();
      return;
    }
    const { x, y, s } = toBoard(e);
    if (d.mode === 'erase') {
      const items = eraseAt(d.items, x, y, 14 / s);
      if (items !== d.items) {
        d.items = items;
        d.changed = true;
        liveItems.current = items;
        paint();
      }
    } else if (d.mode === 'move') {
      const dx = x - d.x0;
      const dy = y - d.y0;
      if (Math.abs(dx) + Math.abs(dy) > 1 / s) d.moved = true;
      const moved = moveItem(d.orig, round1(dx), round1(dy));
      liveItems.current = cut.items.map((i) => (i.id === d.id ? moved : i));
      paint();
    } else {
      const k = Math.max(0.05, Math.max((x - d.box.x) / d.box.w, (y - d.box.y) / d.box.h));
      d.moved = true;
      const o = d.orig;
      const next: BoardItem =
        o.kind === 'image'
          ? { ...o, w: round1(o.w * k), h: round1(o.h * k) }
          : { ...o, size: Math.round(Math.max(12, Math.min(800, o.size * k))) };
      liveItems.current = cut.items.map((i) => (i.id === d.id ? next : i));
      paint();
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !cut) return;
    if (d.mode === 'pen') {
      const dr = draft.current;
      draft.current = null;
      if (dr) {
        const stroke: StrokeItem = { id: newId(), kind: 'stroke', ...dr };
        commitBoard(cut.id, [...cut.items, stroke]);
      }
    } else if (d.mode === 'erase') {
      liveItems.current = null;
      if (d.changed) commitBoard(cut.id, d.items);
      else paint();
    } else {
      const items = liveItems.current;
      liveItems.current = null;
      if (items && d.moved) commitBoard(cut.id, items);
      else paint();
    }
  };

  const onDragOver = (e: RDragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      setDropOn(true);
    }
  };

  const onDrop = (e: RDragEvent) => {
    e.preventDefault();
    setDropOn(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (f.type.startsWith('image/')) {
      const at = canvasRef.current ? toBoard(e) : undefined;
      void addImage(f, at ? { x: at.x, y: at.y } : undefined);
    } else if (f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name)) {
      void importAudio(f);
    }
  };

  const cursor =
    playing || !cut
      ? 'default'
      : tool === 'pen'
        ? 'crosshair'
        : tool === 'eraser'
          ? 'cell'
          : tool === 'text'
            ? 'text'
            : 'default';

  // 文字入力の位置と大きさ（画面上の px）
  let editStyle: CSSProperties | undefined;
  if (editing && size.w > 0) {
    const v = viewOf(showMargin);
    const s = size.w / v.w;
    const lines = editing.text.split('\n');
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    editStyle = {
      left: (editing.x + v.ox) * s,
      top: (editing.y + v.oy) * s,
      fontSize: editing.size * s,
      width: `${Math.max(4, longest + 1.5)}em`,
      height: `${lines.length * 1.3}em`,
      color: editing.color,
    };
  }

  return (
    <div className="stage-wrap" ref={wrapRef}>
      {cut ? (
        <div
          className={`stage${dropOn ? ' drop-on' : ''}`}
          style={{ width: size.w, height: size.h }}
          onDragOver={onDragOver}
          onDragLeave={() => setDropOn(false)}
          onDrop={onDrop}
        >
          <canvas
            ref={canvasRef}
            style={{ cursor }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
          {showMargin && <div className="stage-note">枠の外 ・ 再生と書き出しには出ない</div>}
          {editing && (
            <textarea
              className="text-edit"
              style={editStyle}
              autoFocus
              value={editing.text}
              placeholder="文字"
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              onBlur={commitText}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  commitText();
                } else if (e.key === 'Escape') {
                  setEditing(null);
                }
              }}
            />
          )}
        </div>
      ) : (
        <div className="stage-empty">
          <div>この位置にはまだカットがない。</div>
          <button className="btn primary" onClick={addCutAtEnd}>
            <Icon name="plus" size={18} />
            カットを追加
          </button>
          <div style={{ fontSize: 12 }}>
            再生しながら <span className="kbd">C</span> を押して、切れ目を打つこともできる。
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 再生の操作 ----------

function Timecode() {
  const now = useEditor((s) => fmtTime(s.time));
  const total = useEditor((s) => (s.project ? fmtTime(totalDuration(s.project)) : '0:00.00'));
  return (
    <div className="timecode">
      {now} <small>／ {total}</small>
    </div>
  );
}

function Transport() {
  const playing = useEditor((s) => s.playing);
  return (
    <div className="transport">
      <button className="icon-btn outline" aria-label="前のカットへ" onClick={() => stepCut(-1)}>
        <Icon name="prev" />
      </button>
      <button
        className="play-btn"
        aria-label={playing ? '停止（スペース）' : '再生（スペース）'}
        title={playing ? '停止（スペース）' : '再生（スペース）'}
        onClick={togglePlay}
      >
        <Icon name={playing ? 'pause' : 'play'} size={22} />
      </button>
      <button className="icon-btn outline" aria-label="次のカットへ" onClick={() => stepCut(1)}>
        <Icon name="next" />
      </button>
      <Timecode />
      <div className="spacer" />
      <button className="btn" onClick={tapCut} title="再生位置にカットの切れ目を入れる">
        <span className="tap-dot" />
        <span>カットを打つ</span>
        <span className="kbd">C</span>
      </button>
    </div>
  );
}

export function Monitor() {
  return (
    <section className="monitor">
      <Toolbar />
      <Stage />
      <Transport />
    </section>
  );
}
