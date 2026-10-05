import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AccessPolicy, isLevel, normalizeRulePath, type Level, type Principal } from "./access.js";

export interface AgentConfig {
  name: string;
  /** 토큰 원문은 저장하지 않는다. sha256 해시만 둔다. */
  tokenHash: string;
  rules: Record<string, Level>;
  createdAt: string;
}

export interface KeyringConfig {
  owner: { name: string; passwordHash: string | null };
  /** 로그인 쿠키 서명 키. 비밀번호를 바꾸면 새로 만들어 기존 세션을 모두 끊는다. */
  sessionSecret: string;
  agents: AgentConfig[];
}

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TOKEN_PREFIX = "kn_";
export const SESSION_COOKIE = "keyring_session";
const SESSION_DAYS = 30;

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function defaultConfig(): KeyringConfig {
  return { owner: { name: "me", passwordHash: null }, sessionSecret: randomBytes(32).toString("hex"), agents: [] };
}

function validate(raw: unknown): KeyringConfig {
  const c = raw as Partial<KeyringConfig>;
  const base = defaultConfig();
  const agents = Array.isArray(c.agents) ? c.agents : [];
  for (const a of agents) {
    if (!AGENT_NAME_RE.test(a.name)) throw new Error(`설정 오류: 에이전트 이름이 잘못되었습니다: ${a.name}`);
    for (const [k, v] of Object.entries(a.rules ?? {})) {
      normalizeRulePath(k);
      if (!isLevel(v)) throw new Error(`설정 오류: ${a.name}의 ${k} 권한 값이 잘못되었습니다: ${v}`);
    }
  }
  return {
    owner: { name: c.owner?.name ?? base.owner.name, passwordHash: c.owner?.passwordHash ?? null },
    sessionSecret: typeof c.sessionSecret === "string" && c.sessionSecret.length >= 32 ? c.sessionSecret : base.sessionSecret,
    agents: agents.map((a) => ({ name: a.name, tokenHash: a.tokenHash, rules: a.rules ?? {}, createdAt: a.createdAt ?? "" })),
  };
}

/**
 * 비밀번호 해시·세션 키·에이전트 토큰과 권한 표를 담는 설정 파일.
 * 볼트 밖에 두어 Git 이력에 섞이지 않게 한다. 파일이 바뀌면 다음 요청부터 다시 읽는다.
 */
export class ConfigStore {
  private cached: KeyringConfig | null = null;
  private mtime = -1;

  constructor(readonly file: string) {}

  get(): KeyringConfig {
    let mtime = -2;
    try {
      mtime = statSync(this.file).mtimeMs;
    } catch {
      // 파일이 없으면 처음 쓸 때 만든다.
    }
    if (this.cached && mtime === this.mtime) return this.cached;
    if (mtime === -2) {
      this.cached = defaultConfig();
      this.save(this.cached);
      return this.cached;
    }
    this.cached = validate(JSON.parse(readFileSync(this.file, "utf8")));
    this.mtime = mtime;
    return this.cached;
  }

  update(fn: (c: KeyringConfig) => void): KeyringConfig {
    const c = structuredClone(this.get());
    fn(c);
    const valid = validate(c);
    this.save(valid);
    return valid;
  }

  private save(c: KeyringConfig) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.file);
    this.cached = c;
    this.mtime = statSync(this.file).mtimeMs;
  }

  // ── 사람(소유자) 로그인 ──

  setPassword(password: string) {
    if (password.length < 8) throw new Error("비밀번호는 8자 이상이어야 합니다");
    this.update((c) => {
      c.owner.passwordHash = hashPassword(password);
      c.sessionSecret = randomBytes(32).toString("hex");
    });
  }

  checkPassword(password: string): boolean {
    const h = this.get().owner.passwordHash;
    return h !== null && verifyPassword(password, h);
  }

  issueSession(now = Date.now()): { value: string; maxAge: number } {
    const expires = now + SESSION_DAYS * 86400_000;
    const payload = `owner.${expires}`;
    const sig = createHmac("sha256", this.get().sessionSecret).update(payload).digest("base64url");
    return { value: `${payload}.${sig}`, maxAge: SESSION_DAYS * 86400 };
  }

  verifySession(value: string | undefined, now = Date.now()): boolean {
    if (!value) return false;
    const m = /^owner\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(value);
    if (!m || Number(m[1]) < now) return false;
    const expected = createHmac("sha256", this.get().sessionSecret).update(`owner.${m[1]}`).digest();
    const got = Buffer.from(m[2], "base64url");
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  ownerPrincipal(): Principal {
    const name = this.get().owner.name;
    return { kind: "owner", name, email: `${name}@keyring-notes.local` };
  }

  // ── 에이전트 토큰 ──

  agentByToken(token: string | undefined): Principal | null {
    if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
    const h = Buffer.from(sha256(token), "hex");
    for (const a of this.get().agents) {
      const stored = Buffer.from(a.tokenHash, "hex");
      if (stored.length === h.length && timingSafeEqual(stored, h)) {
        return { kind: "agent", name: a.name, email: `${a.name}@agent.keyring-notes.local`, policy: new AccessPolicy(a.rules) };
      }
    }
    return null;
  }

  /** 에이전트를 만들거나 토큰을 새로 발급한다. 토큰 원문은 이때 한 번만 돌려준다. */
  issueToken(name: string): string {
    if (!AGENT_NAME_RE.test(name)) throw new Error("에이전트 이름은 영문 소문자·숫자·-·_ 로 64자 이내여야 합니다");
    const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
    this.update((c) => {
      const existing = c.agents.find((a) => a.name === name);
      if (existing) existing.tokenHash = sha256(token);
      else c.agents.push({ name, tokenHash: sha256(token), rules: {}, createdAt: new Date().toISOString() });
    });
    return token;
  }

  removeAgent(name: string) {
    this.update((c) => {
      const before = c.agents.length;
      c.agents = c.agents.filter((a) => a.name !== name);
      if (c.agents.length === before) throw new Error(`에이전트가 없습니다: ${name}`);
    });
  }

  setRule(name: string, rulePath: string, level: Level | null) {
    const key = normalizeRulePath(rulePath) || "/";
    this.update((c) => {
      const a = c.agents.find((x) => x.name === name);
      if (!a) throw new Error(`에이전트가 없습니다: ${name}`);
      for (const k of Object.keys(a.rules)) if ((normalizeRulePath(k) || "/") === key) delete a.rules[k];
      if (level !== null) a.rules[key] = level;
    });
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64url");
  const got = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(got, expected);
}
