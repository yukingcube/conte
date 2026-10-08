import { useEffect, useState } from 'react';
import { type UserInfo, currentUser, onAuthChange } from './store';
import { Login } from './pages/Login';
import { Projects } from './pages/Projects';
import { Editor } from './pages/Editor';

// 画面の切り替えは URL の # 以降で行う（#/ が一覧、#/p/◯◯ が編集画面）。
// サーバー側の設定なしで、GitHub Pages のような置き場所でもそのまま動く。

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  // undefined は「確認中」、null は「ログインしていない」
  const [user, setUser] = useState<UserInfo | null | undefined>(undefined);
  const hash = useHash();

  useEffect(() => {
    let alive = true;
    void currentUser().then((u) => {
      if (alive) setUser(u);
    });
    const off = onAuthChange((u) => setUser(u));
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (user === undefined) {
    return (
      <div className="center-page">
        <p className="sub">読み込み中</p>
      </div>
    );
  }
  if (user === null) return <Login />;

  const m = /^#\/p\/([0-9a-zA-Z-]+)/.exec(hash);
  if (m) return <Editor key={m[1]} projectId={m[1]} user={user} />;
  return <Projects user={user} />;
}
