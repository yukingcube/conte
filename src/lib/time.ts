/** 0:07.20 の形にする */
export function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const cs = Math.round(t * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** 目盛り用。0:07 の形にする */
export function fmtTick(t: number): string {
  const total = Math.round(t * 10) / 10;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const whole = Math.abs(s - Math.round(s)) < 0.01;
  return whole
    ? `${m}:${String(Math.round(s)).padStart(2, '0')}`
    : `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export const fmtDur = (t: number): string => t.toFixed(2);

/** フレーム単位に丸める */
export const snap = (t: number, fps: number): number => Math.round(t * fps) / fps;

export const toFrames = (t: number, fps: number): number => Math.round(t * fps);

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 今日の日付を YYYY-MM-DD で返す（利用者の現地時間） */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parse(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

/** 10/8 の形にする */
export function fmtDate(d: string): string {
  const dt = parse(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 10/8（木）の形にする */
export function fmtDateW(d: string): string {
  const dt = parse(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}（${WEEK[dt.getDay()]}）`;
}

/** b が a の何日後か */
export function dayDiff(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}

export function fmtUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
