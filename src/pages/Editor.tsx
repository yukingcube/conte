import { type DragEvent as RDragEvent, useEffect, useRef, useState } from 'react';
import type { UserInfo } from '../store';
import { fmtTime } from '../lib/time';
import { cutsTotal, useEditor } from '../state/editor';
import {
  addImage,
  closeProject,
  deleteSelectedItem,
  importAudio,
  openProject,
  redo,
  setTitle,
  stepCut,
  tapCut,
  undo,
} from '../state/actions';
import { isUnsaved } from '../state/saver';
import { togglePlay } from '../state/player';
import { Icon } from '../components/Icon';
import { Monitor } from '../components/Monitor';
import { Inspector } from '../components/Inspector';
import { ScheduleBand } from '../components/ScheduleBand';
import { Timeline } from '../components/Timeline';
import { UserBadge } from './Projects';

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|aif|aiff)$/i;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return type !== 'range' && type !== 'checkbox' && type !== 'button' && type !== 'file';
  }
  return false;
}

const SAVE_TEXT = {
  saved: '保存済み',
  dirty: '未保存の変更あり',
  saving: '保存中',
  error: '保存に失敗（再試行する）',
} as const;

function Header({ user }: { user: UserInfo }) {
  const title = useEditor((s) => s.project?.title ?? '');
  const saveState = useEditor((s) => s.saveState);
  const stats = useEditor((s) => {
    const p = s.project;
    if (!p) return '';
    const parts = [`${p.cuts.length}カット`, fmtTime(cutsTotal(p.cuts))];
    if (p.audio) parts.push(`音源 ${fmtTime(p.audio.duration)}`);
    return parts.join(' ・ ');
  });

  return (
    <header className="ed-head">
      <div className="ed-head-main">
        <a className="icon-btn outline" href="#/" aria-label="コンテ一覧へ戻る" title="コンテ一覧へ戻る">
          <Icon name="back" />
        </a>
        <div style={{ minWidth: 0, flex: 1 }}>
          <input
            className="title-input"
            aria-label="コンテの名前"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="ed-stats">{stats}</div>
        </div>
      </div>
      <div className="ed-head-side">
        <div className={`save-pill ${saveState}`} role="status">
          <span className="save-dot" />
          <span>{SAVE_TEXT[saveState]}</span>
        </div>
        <UserBadge user={user} />
      </div>
    </header>
  );
}

function TimelineSection() {
  const audio = useEditor((s) => s.project?.audio ?? null);
  const zoom = useEditor((s) => s.zoom);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dropOn, setDropOn] = useState(false);

  const pick = () => fileRef.current?.click();

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
    if (f && (f.type.startsWith('audio/') || AUDIO_EXT.test(f.name))) void importAudio(f);
  };

  return (
    <section
      className={`tl${dropOn ? ' drop-on' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDropOn(false)}
      onDrop={onDrop}
    >
      <ScheduleBand />
      <div className="tl-head">
        <span className={`audio-name${audio ? '' : ' sub'}`}>
          <Icon name="wave" size={18} />
          {audio ? `${audio.name} ・ ${fmtTime(audio.duration)}` : '音源なし'}
        </span>
        {audio && (
          <button className="btn small" onClick={pick}>
            音源を差し替え
          </button>
        )}
        <span className="sub">黄色の線をドラッグして切れ目を微調整</span>
        <span className="spacer" />
        <label htmlFor="tl-zoom" className="sub">
          拡大
        </label>
        <input
          id="tl-zoom"
          type="range"
          min={1}
          max={12}
          step={0.1}
          value={zoom}
          onChange={(e) => useEditor.setState({ zoom: Number(e.target.value) })}
        />
      </div>
      <Timeline onPickAudio={pick} />
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importAudio(f);
          e.target.value = '';
        }}
      />
    </section>
  );
}

export function Editor({ projectId, user }: { projectId: string; user: UserInfo }) {
  const loadState = useEditor((s) => s.loadState);
  const loadError = useEditor((s) => s.loadError);
  const busy = useEditor((s) => s.busy);
  const notice = useEditor((s) => s.notice);

  useEffect(() => {
    void openProject(projectId);
    return () => {
      void closeProject();
    };
  }, [projectId]);

  // キー操作
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = useEditor.getState();
      if (!s.project || s.busy) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (k === 'c') {
        tapCut();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepCut(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepCut(1);
      } else if (k === 'v') {
        useEditor.setState({ tool: 'select' });
      } else if (k === 'b') {
        useEditor.setState({ tool: 'pen', selectedItemId: null });
      } else if (k === 'e') {
        useEditor.setState({ tool: 'eraser', selectedItemId: null });
      } else if (k === 't') {
        useEditor.setState({ tool: 'text', selectedItemId: null });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedItemId) {
          e.preventDefault();
          deleteSelectedItem();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // コピーした画像を Ctrl+V で貼る
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            void addImage(f);
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // 保存が終わる前に閉じようとしたら確認を出す
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (isUnsaved()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <div className="center-page">
        <p className="sub">読み込み中</p>
      </div>
    );
  }

  if (loadState === 'missing' || loadState === 'error') {
    return (
      <div className="center-page">
        <div className="login-card">
          <p>
            {loadState === 'missing'
              ? 'このコンテは見つからない。削除されたか、見る権限がない可能性がある。'
              : `読み込めなかった。${loadError}`}
          </p>
          <a className="btn" href="#/">
            コンテ一覧へ戻る
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="editor">
      <Header user={user} />
      <div className="ed-body">
        <Monitor />
        <Inspector />
      </div>
      <TimelineSection />
      {busy && (
        <div className="overlay">
          <div className="busy-card" role="status">
            <div>{busy.label}</div>
            <div className="meter">
              <div style={{ width: `${Math.round(busy.ratio * 100)}%` }} />
            </div>
          </div>
        </div>
      )}
      {notice && (
        <div className="toast" role="alert">
          {notice}
        </div>
      )}
    </div>
  );
}
