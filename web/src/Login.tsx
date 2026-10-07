import { useState, type FormEvent } from "react";
import { api, passkeyLogin, passkeySupported } from "./api";
import { t } from "./i18n";
import { errorText } from "./toast";

export function Login({ passwordSet, passkey, onDone }: { passwordSet: boolean; passkey?: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordSet && password !== again) return setError(t("login.mismatch"));
    setBusy(true);
    setError(null);
    try {
      if (passwordSet) await api.login(password);
      else await api.setup(code, password);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const withPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      await passkeyLogin();
      onDone();
    } catch (err) {
      // 사람이 창을 닫은 것(NotAllowedError)은 조용히
      if (!(err instanceof Error && err.name === "NotAllowedError")) setError(errorText(err));
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
            placeholder={t("login.password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        ) : (
          <>
            <p className="meta">
              {t("login.firstRun")}
              <br />
              (Docker: <code>docker compose logs keyring</code>)
            </p>
            <input autoFocus placeholder={t("login.code")} value={code} onChange={(e) => setCode(e.target.value)} />
            <input type="password" autoComplete="new-password" placeholder={t("login.newPassword")} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            <input type="password" autoComplete="new-password" placeholder={t("login.again")} minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} />
          </>
        )}
        <button type="submit" disabled={busy || !password || (!passwordSet && !code)}>
          {busy ? t("login.checking") : passwordSet ? t("login.login") : t("login.setAndStart")}
        </button>
        {passwordSet && passkey && passkeySupported() && (
          <button type="button" className="passkey-login" disabled={busy} onClick={() => void withPasskey()}>
            {t("login.passkey")}
          </button>
        )}
        {error && <p className="login-error">{error}</p>}
      </form>
    </div>
  );
}
