import {
  type PointerEvent as RPointerEvent,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AudioMeta, BoardItem, Cut } from '../types';
import { STATUS_LABEL } from '../types';
import { base64ToBytes } from '../lib/audio';
import { renderThumb } from '../lib/board';
import { filesVersion, getImage, subscribeFiles } from '../lib/files';
import { fmtDate, fmtDur, fmtTick, today } from '../lib/time';
import {
  cutLabel,
  cutsTotal,
  totalDuration,
  useCurrentCutIndex,
  useEditor,
} from '../state/editor';
import { addCutAtEnd, moveBoundary, selectCut } from '../state/actions';
import { pause, seek } from '../state/player';
import { Icon } from './Icon';

const H_RULER = 24;
const H_PLAN = 44;
const H_CUTS = 76;
const H_WAVE = 72;
const GAP = 6;
const ADD_W = 96;
/** 音源がないときに、最低限この秒数ぶんの幅を見せる */
const MIN_SPAN = 8;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

const CutThumb = memo(function CutThumb({ items, ver }: { items: BoardItem[]; ver: number }) {
  // ver は画像が読み込まれたときに描き直すためのきっかけ
  const src = useMemo(() => renderThumb(items, getImage), [items, ver]);
  return <img src={src} alt="" draggable={false} />;
});

function WaveCanvas({
  audio,
  pps,
  scrollLeft,
  vw,
}: {
  audio: AudioMeta;
  pps: number;
  scrollLeft: number;
  vw: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = useMemo(() => base64ToBytes(audio.peaks), [audio.peaks]);

  useEffect(() => {
    const c = ref.current;
    if (!c || vw <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(vw * dpr);
    c.height = Math.round(H_WAVE * dpr);
    c.style.width = `${vw}px`;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, H_WAVE);
    ctx.fillStyle = '#6F7682';
    const step = 3;
    // スクロールしても棒の位置がちらつかないよう、全体の位置を基準に並べる
    for (let gx = Math.floor(scrollLeft / step) * step; gx < scrollLeft + vw; gx += step) {
      const t0 = gx / pps;
      if (t0 >= audio.duration) break;
      const t1 = (gx + step) / pps;
      const i0 = Math.floor(t0 * audio.peaksPerSec);
      const i1 = Math.max(i0 + 1, Math.ceil(t1 * audio.peaksPerSec));
      let m = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const h = Math.max(2, (m / 255) * (H_WAVE - 8));
      ctx.fillRect(gx - scrollLeft, (H_WAVE - h) / 2, 2, h);
    }
  }, [audio, peaks, pps, scrollLeft, vw]);

  return <canvas ref={ref} />;
}

function dueText(cut: Cut, now: string): { text: string; late: boolean } {
  if (!cut.due) return { text: '—', late: false };
  const late = cut.due < now && cut.status !== 'done';
  const suffix = late ? ' 遅れ' : cut.due === now && cut.status !== 'done' ? ' 今日' : '';
  return { text: fmtDate(cut.due) + suffix, late };
}

export function Timeline({ onPickAudio }: { onPickAudio: () => void }) {
  const project = useEditor((s) => s.project)!;
  const zoom = useEditor((s) => s.zoom);
  const curIdx = useCurrentCutIndex();
  const ver = useSyncExternalStore(subscribeFiles, filesVersion);

  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fit = () => setVw(el.clientWidth);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cuts = project.cuts;
  const total = totalDuration(project);
  const cutsEnd = cutsTotal(cuts);
  const audioDur = project.audio?.duration ?? 0;
  const unassigned = audioDur - cutsEnd > 0.2;
  const span = Math.max(total, MIN_SPAN);
  const pps = vw > 0 ? (Math.max(200, vw - ADD_W) / span) * zoom : 50;
  const innerW = Math.max(vw, total * pps + (unassigned ? 0 : ADD_W));
  const now = today();

  const starts = useMemo(() => {
    const out: number[] = [];
    let t = 0;
    for (const c of cuts) {
      out.push(t);
      t += c.duration;
    }
    return out;
  }, [cuts]);

  // 再生位置の線は、毎フレーム画面全体を作り直さないよう直接動かす
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  useEffect(() => {
    const apply = (time: number, playing: boolean) => {
      const head = headRef.current;
      const sc = scrollRef.current;
      if (!head || !sc) return;
      const x = time * ppsRef.current;
      head.style.transform = `translateX(${x}px)`;
      if (playing && (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft)) {
        sc.scrollLeft = Math.max(0, x - 80);
      }
    };
    const s = useEditor.getState();
    apply(s.time, s.playing);
    return useEditor.subscribe((st) => apply(st.time, st.playing));
  }, [pps]);

  const timeAt = (clientX: number): number => {
    const rect = innerRef.current!.getBoundingClientRect();
    return (clientX - rect.left) / pps;
  };

  const scrub = {
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      seek(timeAt(e.clientX));
    },
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(timeAt(e.clientX));
    },
  };

  const ticks = useMemo(() => {
    const step = TICK_STEPS.find((s) => s * pps >= 64) ?? 600;
    const out: number[] = [];
    for (let t = 0; t <= span + 1e-6 && out.length < 2000; t += step) out.push(t);
    return out;
  }, [pps, span]);

  const boundaryTop = H_RULER + GAP + H_PLAN + GAP;
  // 音源がないときは、音の段（音源の落とし先）に線がかからないようにする
  const boundaryH = project.audio ? H_CUTS + GAP + H_WAVE : H_CUTS;

  return (
    <div className="tl-grid">
      <div className="tl-labels">
        <div className="h-ruler" />
        <div className="h-plan">予定</div>
        <div className="h-cuts">カット</div>
        <div className="h-wave">音</div>
        <div className="h-lyric">歌詞</div>
      </div>
      <div
        className="tl-scroll"
        ref={scrollRef}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
      >
        <div className="tl-inner" ref={innerRef} style={{ width: innerW }}>
          <div className="tl-row h-ruler ruler" {...scrub}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: t * pps }}>
                {fmtTick(t)}
              </div>
            ))}
          </div>

          <div className="tl-row h-plan">
            {cuts.map((c, i) => {
              const due = dueText(c, now);
              return (
                <button
                  key={c.id}
                  className={`blk plan-blk${i === curIdx ? ' cur' : ''}${due.late ? ' late' : ''}`}
                  style={{ left: starts[i] * pps, width: Math.max(4, c.duration * pps - 2) }}
                  aria-label={`${cutLabel(i)} の予定：${STATUS_LABEL[c.status]}、締切 ${due.text}`}
                  onClick={() => selectCut(c.id)}
                >
                  <span className={`chip st-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                  <span className={`plan-date${due.late ? ' late' : ''}`}>{due.text}</span>
                </button>
              );
            })}
          </div>

          <div className="tl-row h-cuts">
            {cuts.map((c, i) => (
              <button
                key={c.id}
                className={`blk cut-blk${i === curIdx ? ' cur' : ''}`}
                style={{ left: starts[i] * pps, width: Math.max(4, c.duration * pps - 2) }}
                aria-label={`${cutLabel(i)} を選択`}
                aria-pressed={i === curIdx}
                onClick={() => selectCut(c.id)}
              >
                <CutThumb items={c.items} ver={ver} />
                <span className="tag top">{cutLabel(i)}</span>
                <span className="tag bottom">{fmtDur(c.duration)}</span>
              </button>
            ))}
            {unassigned ? (
              <button
                className="add-blk"
                style={{ left: cutsEnd * pps, width: Math.max(24, (audioDur - cutsEnd) * pps) }}
                aria-label="未割り当ての区間をカットにする"
                title="未割り当ての区間をカットにする"
                onClick={addCutAtEnd}
              >
                <Icon name="plus" size={18} />
                <span>未割り当て</span>
              </button>
            ) : (
              <button
                className="add-blk"
                style={{ left: cutsEnd * pps, width: ADD_W - 8 }}
                aria-label="カットを追加"
                onClick={addCutAtEnd}
              >
                <Icon name="plus" size={18} />
                <span>カットを追加</span>
              </button>
            )}
          </div>

          <div className={`tl-row h-wave${project.audio ? ' wave' : ''}`} {...(project.audio ? scrub : {})}>
            {project.audio ? (
              <WaveCanvas audio={project.audio} pps={pps} scrollLeft={scrollLeft} vw={vw} />
            ) : (
              <div className="dropzone" style={{ width: vw || '100%' }}>
                <Icon name="wave" size={28} />
                <div>
                  <strong>ここに音源を落とす</strong>
                  <small>mp3 ・ wav ・ m4a ／ 読み込み時に圧縮して保存</small>
                </div>
                <button className="btn primary" onClick={onPickAudio}>
                  ファイルを選ぶ
                </button>
              </div>
            )}
          </div>

          <div className="tl-row h-lyric">
            {cuts.map((c, i) => {
              const first = c.lyric.split('\n')[0];
              return (
                <button
                  key={c.id}
                  className={`blk lyric-blk${first ? ' has' : ''}`}
                  style={{ left: starts[i] * pps, width: Math.max(4, c.duration * pps - 2) }}
                  aria-label={`${cutLabel(i)} の歌詞`}
                  onClick={() => selectCut(c.id)}
                >
                  {first || '—'}
                </button>
              );
            })}
          </div>

          {cuts.map((c, i) => (
            <div
              key={c.id}
              className={`boundary${dragId === c.id ? ' drag' : ''}`}
              style={{ left: (starts[i] + c.duration) * pps, top: boundaryTop, height: boundaryH }}
              title="ドラッグして切れ目を動かす"
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                pause();
                setDragId(c.id);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  moveBoundary(i, timeAt(e.clientX));
                }
              }}
              onPointerUp={() => setDragId(null)}
              onPointerCancel={() => setDragId(null)}
            />
          ))}

          <div className="playhead" ref={headRef} />
        </div>
      </div>
    </div>
  );
}
