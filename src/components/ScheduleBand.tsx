import { useEffect, useRef, useState } from 'react';
import type { Cut, CutStatus, Phase } from '../types';
import { STATUS_LABEL } from '../types';
import { newId } from '../lib/id';
import { dayDiff, fmtDate, today } from '../lib/time';
import { useEditor } from '../state/editor';
import { setPhases } from '../state/actions';
import { Icon } from './Icon';

const KEY = 'conte.bandCollapsed';
// 毎回新しい配列を返すと画面の作り直しが止まらなくなるので、空の配列は使い回す
const NO_CUTS: Cut[] = [];
const NO_PHASES: Phase[] = [];

function readCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved !== null) return saved === '1';
  } catch {
    /* 読めなければ下の既定値を使う */
  }
  // 一度も切り替えていないときは、縦が狭い画面ではたたんだ状態から始める
  return window.innerHeight < 960;
}

type PhaseState = 'done' | 'now' | 'later' | 'unset';

function phaseState(p: Phase, now: string): PhaseState {
  const end = p.end ?? p.start;
  const start = p.start ?? p.end;
  if (!end || !start) return 'unset';
  if (end < now) return 'done';
  if (start <= now) return 'now';
  return 'later';
}

function phaseDates(p: Phase): string {
  if (p.start && p.end && p.start !== p.end) return `${fmtDate(p.start)} 〜 ${fmtDate(p.end)}`;
  const one = p.end ?? p.start;
  return one ? fmtDate(one) : '日付なし';
}

function PhaseCard({
  phase,
  now,
  onChange,
  onRemove,
}: {
  phase: Phase;
  now: string;
  onChange: (p: Phase) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const state = phaseState(phase, now);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className={`phase${state === 'now' ? ' now' : ''}`} ref={ref}>
      <button className="card" aria-expanded={open} onClick={() => setOpen(!open)}>
        <div className="row-between">
          <span className="phase-name">{phase.name || '名前なし'}</span>
          {state === 'now' && <span className="chip accent">進行中</span>}
          {state === 'done' && <span className="chip outline">済</span>}
        </div>
        <span className="phase-date">{phaseDates(phase)}</span>
      </button>
      {open && (
        <div className="popover">
          <div className="field">
            <label htmlFor={`pn-${phase.id}`}>工程の名前</label>
            <input
              id={`pn-${phase.id}`}
              className="input"
              value={phase.name}
              onChange={(e) => onChange({ ...phase, name: e.target.value })}
            />
          </div>
          <div className="two-col">
            <div className="field">
              <label htmlFor={`ps-${phase.id}`}>開始</label>
              <input
                id={`ps-${phase.id}`}
                type="date"
                className="input"
                value={phase.start ?? ''}
                onChange={(e) => onChange({ ...phase, start: e.target.value || null })}
              />
            </div>
            <div className="field">
              <label htmlFor={`pe-${phase.id}`}>終了</label>
              <input
                id={`pe-${phase.id}`}
                type="date"
                className="input"
                value={phase.end ?? ''}
                onChange={(e) => onChange({ ...phase, end: e.target.value || null })}
              />
            </div>
          </div>
          <div className="row-between">
            <button className="btn small" onClick={onRemove}>
              <Icon name="trash" size={16} />
              この工程を消す
            </button>
            <button className="btn small primary" onClick={() => setOpen(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ScheduleBand() {
  const cuts = useEditor((s) => s.project?.cuts ?? NO_CUTS);
  const phases = useEditor((s) => s.project?.phases ?? NO_PHASES);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const now = today();

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  };

  const count: Record<CutStatus, number> = { todo: 0, doing: 0, review: 0, done: 0 };
  let late = 0;
  for (const c of cuts) {
    count[c.status]++;
    if (c.due && c.due < now && c.status !== 'done') late++;
  }
  const totalCuts = cuts.length;

  // 一番最後の日付を「納期」として残り日数を出す
  let last: Phase | null = null;
  let lastDate = '';
  for (const p of phases) {
    const d = p.end ?? p.start;
    if (d && d > lastDate) {
      lastDate = d;
      last = p;
    }
  }
  const left = last ? dayDiff(now, lastDate) : null;
  const leftText =
    left === null ? '未設定' : left > 0 ? `あと${left}日` : left === 0 ? '今日' : `${-left}日超過`;
  const leftLabel = last ? `${last.name || '最後の工程'}まで` : '日程';

  const current = phases.find((p) => phaseState(p, now) === 'now') ?? null;

  const bar = (
    <div className="pbar" aria-hidden="true">
      {(['done', 'review', 'doing', 'todo'] as CutStatus[]).map((st) =>
        count[st] > 0 ? <div key={st} className={st} style={{ flex: `${count[st]} 1 0` }} /> : null,
      )}
      {totalCuts === 0 && <div className="todo" style={{ flex: '1 1 0' }} />}
    </div>
  );

  if (collapsed) {
    return (
      <div className="band-line">
        <span className="sub" style={{ fontSize: 12 }}>
          スケジュール
        </span>
        <div style={{ width: 120 }}>{bar}</div>
        <span className="mono">
          {count.done} / {totalCuts} カット完了
        </span>
        {current && (
          <>
            <span className="vsep" />
            <strong>{current.name}</strong>
            <span className="mono sub" style={{ fontSize: 11 }}>
              {phaseDates(current)}
            </span>
            <span className="chip accent">進行中</span>
          </>
        )}
        <span className="vsep" />
        <span className="mono">
          {leftLabel} {leftText}
        </span>
        {late > 0 && (
          <>
            <span className="vsep" />
            <span className="late">遅れ {late}件</span>
          </>
        )}
        <span className="spacer" />
        <button className="icon-btn" aria-label="スケジュールを開く" onClick={toggle}>
          <Icon name="down" />
        </button>
      </div>
    );
  }

  const change = (i: number, p: Phase) => setPhases(phases.map((x, j) => (j === i ? p : x)));

  return (
    <div className="band">
      <div className="card progress">
        <div className="row-between">
          <span className="label">全体の進捗</span>
          <span className="mono">
            {count.done} / {totalCuts} カット完了
          </span>
        </div>
        {bar}
        <div className="legend">
          {(['done', 'review', 'doing', 'todo'] as CutStatus[]).map((st) => (
            <span key={st}>
              <i
                style={
                  st === 'todo'
                    ? { border: '1px solid var(--line2)' }
                    : { background: `var(--st-${st})` }
                }
              />
              {STATUS_LABEL[st]} {count[st]}
            </span>
          ))}
          {late > 0 && <span className="late">遅れ {late}</span>}
        </div>
      </div>

      <div className="phases">
        {phases.map((p, i) => (
          <PhaseCard
            key={p.id}
            phase={p}
            now={now}
            onChange={(np) => change(i, np)}
            onRemove={() => setPhases(phases.filter((_, j) => j !== i))}
          />
        ))}
        <button
          className="icon-btn outline"
          style={{ height: 'auto', minHeight: 'var(--ctl)' }}
          aria-label="工程を追加"
          title="工程を追加"
          onClick={() =>
            setPhases([...phases, { id: newId(), name: '新しい工程', start: null, end: null }])
          }
        >
          <Icon name="plus" size={18} />
        </button>
      </div>

      <div className="card">
        <span className="label" style={{ fontSize: 11 }}>
          {leftLabel}
        </span>
        <span className="mono" style={{ fontSize: 16, fontWeight: 500 }}>
          {leftText}
        </span>
      </div>

      <button
        className="icon-btn outline"
        style={{ height: 'auto', minHeight: 'var(--ctl)' }}
        aria-label="スケジュールをたたむ"
        title="スケジュールをたたむ"
        onClick={toggle}
      >
        <Icon name="up" />
      </button>
    </div>
  );
}
