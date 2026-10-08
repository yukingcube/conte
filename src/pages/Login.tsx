import { useState } from 'react';
import { signInWithGoogle } from '../store';

export function Login() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      await signInWithGoogle();
      // 成功すると Google の画面へ移動するので、ここには戻らない
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="center-page">
      <div className="login-card">
        <h1>コンテ</h1>
        <p>音楽に合わせて絵コンテと V コンテを作る。</p>
        <button className="btn primary" onClick={start} disabled={busy}>
          Google でログイン
        </button>
        {error && <div className="error-text">{error}</div>}
      </div>
    </div>
  );
}
