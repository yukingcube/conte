import { useCallback, useEffect, useState } from 'react';
import type { ProjectSummary } from '../types';
import { type UserInfo, HAS_SUPABASE, getStore, signOut } from '../store';
import { fmtUpdated } from '../lib/time';
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
        <button className="btn primary" onClick={create} disabled={creating}>
          <Icon name="plus" size={18} />
          新しいコンテ
        </button>
      </div>

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
