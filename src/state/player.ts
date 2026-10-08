import { snap } from '../lib/time';
import { totalDuration, useEditor } from './editor';

// 再生の仕組み。音源があるときは音源の再生位置を正とし、
// 音源がない区間（音源なし、または音源が終わった後）は時計で進める。

let audio: HTMLAudioElement | null = null;
let raf = 0;
let clockStart = 0;
let timeStart = 0;

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
  }
  return audio;
}

export function setAudioSrc(url: string | null): void {
  const a = el();
  a.pause();
  if (url) {
    a.src = url;
  } else {
    a.removeAttribute('src');
  }
  a.load();
}

/** 保存したファイルの頭の遅れ（秒）。圧縮していない音源では 0 */
function offset(): number {
  return useEditor.getState().project?.audio?.offset ?? 0;
}

function audioUsable(t: number): boolean {
  const s = useEditor.getState();
  return Boolean(s.project?.audio && s.audioUrl && t < s.project.audio.duration - 0.05);
}

function startAudioAt(t: number): void {
  const a = el();
  if (audioUsable(t)) {
    a.currentTime = t + offset();
    void a.play().catch(() => {
      /* 再生を始められなくても、時計で進める */
    });
  } else {
    a.pause();
  }
}

function tick(): void {
  const s = useEditor.getState();
  const p = s.project;
  if (!p || !s.playing) return;
  const total = totalDuration(p);
  const a = el();
  let t: number;
  if (!a.paused && !a.ended && a.readyState >= 2) {
    t = Math.max(0, a.currentTime - offset());
    timeStart = t;
    clockStart = performance.now();
  } else {
    t = timeStart + (performance.now() - clockStart) / 1000;
  }
  if (t >= total) {
    a.pause();
    useEditor.setState({ time: total, playing: false });
    return;
  }
  useEditor.setState({ time: t });
  raf = requestAnimationFrame(tick);
}

export function play(): void {
  const s = useEditor.getState();
  const p = s.project;
  if (!p || s.playing) return;
  const total = totalDuration(p);
  if (total <= 0) return;
  const t = s.time >= total - 0.01 ? 0 : s.time;
  useEditor.setState({ playing: true, time: t, selectedItemId: null });
  timeStart = t;
  clockStart = performance.now();
  startAudioAt(t);
  raf = requestAnimationFrame(tick);
}

export function pause(): void {
  cancelAnimationFrame(raf);
  audio?.pause();
  const s = useEditor.getState();
  if (!s.playing) return;
  const fps = s.project?.fps ?? 30;
  useEditor.setState({ playing: false, time: snap(s.time, fps) });
}

export function togglePlay(): void {
  if (useEditor.getState().playing) pause();
  else play();
}

export function seek(t: number): void {
  const s = useEditor.getState();
  const p = s.project;
  if (!p) return;
  const total = totalDuration(p);
  const clamped = Math.max(0, Math.min(total, t));
  useEditor.setState({ time: clamped, selectedItemId: null });
  if (s.playing) {
    timeStart = clamped;
    clockStart = performance.now();
    startAudioAt(clamped);
  }
}
