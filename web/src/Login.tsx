import { useState, type FormEvent } from "react";
import { api } from "./api";

export function Login({ passwordSet, onDone }: { passwordSet: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordSet && password !== again) return setError("비밀번호가 서로 다릅니다");
    setBusy(true);
    setError(null);
    try {
      if (passwordSet) await api.login(password);
      else await api.setup(code, password);
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
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        ) : (
          <>
            <p className="meta">
              처음 설치입니다. 서버 로그에 나온 <strong>설정 코드</strong>를 넣고 비밀번호를 정하세요.
              <br />
              (도커: <code>docker compose logs keyring</code>)
            </p>
            <input autoFocus placeholder="설정 코드 (예: 1A2B-3C4D-5E6F)" value={code} onChange={(e) => setCode(e.target.value)} />
            <input type="password" autoComplete="new-password" placeholder="새 비밀번호(8자 이상)" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            <input type="password" autoComplete="new-password" placeholder="비밀번호 확인" minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} />
          </>
        )}
        <button type="submit" disabled={busy || !password || (!passwordSet && !code)}>
          {busy ? "확인 중…" : passwordSet ? "로그인" : "비밀번호 정하고 시작"}
        </button>
        {error && <p className="login-error">{error}</p>}
      </form>
    </div>
  );
}
