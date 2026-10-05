import { useState, type FormEvent } from "react";
import { api } from "./api";

export function Login({ passwordSet, onDone }: { passwordSet: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>Keyring Notes</h1>
        {passwordSet ? (
          <>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit" disabled={busy || !password}>
              {busy ? "확인 중…" : "로그인"}
            </button>
            {error && <p className="login-error">{error}</p>}
          </>
        ) : (
          <p>
            아직 비밀번호가 없습니다. 서버에서 <code>npm run keyring -- passwd</code> 로 설정한 뒤 새로고침하세요.
          </p>
        )}
      </form>
    </div>
  );
}
