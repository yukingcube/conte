import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '../types';
import { type UserInfo, HAS_SUPABASE, getStore, signOut } from '../store';
import { fmtUpdated } from '../lib/time';
import { ARCHIVE_EXT } from '../lib/archive';
import { importProjectFile } from '../state/transfer';
import { Icon } from '../components/Icon';

export function UserBadge({ user }: { user: UserInfo }) {
  return (
    <div className="avatar" title={user.name}>
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        user.name.slice(0, 1)
      )}
    </div>
  );
}

export function Projects({ user }: { user: UserInfo }) {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [importing, setImporting] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setList(await getStore().listProjects());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async () => {
    setCreating(true);
    try {
      const p = await getStore().createProject('無題のコンテ');
      window.location.hash = `#/p/${p.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };

  const importFile = async (file: File) => {
    setError('');
    setImporting('ファイルを確認中');
    try {
      const id = await importProjectFile(file, setImporting);
      window.location.hash = `#/p/${id}`;
    } catch (e) {
      setImporting('');
      // 一覧の取り直しはエラー表示を消すので、先に済ませてから理由を出す
      await reload();
      setError(`読み込めなかった。${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async (id: string) => {
    setConfirmId(null);
    try {
      await getStore().deleteProject(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="list-page">
      <header className="list-head">
        <h1>コンテ</h1>
        <div className="list-user">
          <UserBadge user={user} />
          <span>{user.name}</span>
          {HAS_SUPABASE && (
            <button className="btn small" onClick={() => void signOut()}>
              ログアウト
            </button>
          )}
        </div>
      </header>

      {!HAS_SUPABASE && (
        <div className="banner">
          お試しモード。データはこのブラウザの中だけに保存され、他の人や他の端末とは共有されない。
        </div>
      )}

      <div className="list-tools">
        <h2>コンテ一覧</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            className="btn"
            title="書き出した編集データ（.conte）を読み込み、新しいコンテとして追加する"
            onClick={() => fileRef.current?.click()}
            disabled={importing !== ''}
          >
            <Icon name="upload" size={18} />
            読み込む
          </button>
          <button className="btn primary" onClick={create} disabled={creating || importing !== ''}>
            <Icon name="plus" size={18} />
            新しいコンテ
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={`.${ARCHIVE_EXT},.zip,application/zip`}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {importing && (
        <div className="banner" role="status">
          読み込み中：{importing}
        </div>
      )}

      {error && <div className="error-text">{error}</div>}

      {list === null && !error && <p className="sub">読み込み中</p>}

      {list !== null && list.length === 0 && (
        <div className="empty">まだコンテがない。「新しいコンテ」から作り始める。</div>
      )}

      {list !== null && list.length > 0 && (
        <ul className="proj-list">
          {list.map((p) => (
            <li key={p.id} className="proj-row">
              <a className="proj-link" href={`#/p/${p.id}`}>
                <span className="proj-title">{p.title || '無題のコンテ'}</span>
                <span className="mono sub" style={{ fontSize: 12 }}>
                  {fmtUpdated(p.updatedAt)}
                </span>
              </a>
              {confirmId === p.id ? (
                <>
                  <button className="btn small danger" onClick={() => void remove(p.id)}>
                    削除する
                  </button>
                  <button className="btn small" onClick={() => setConfirmId(null)}>
                    やめる
                  </button>
                </>
              ) : (
                <button
                  className="icon-btn"
                  aria-label={`${p.title} を削除`}
                  onClick={() => setConfirmId(p.id)}
                >
                  <Icon name="trash" size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
