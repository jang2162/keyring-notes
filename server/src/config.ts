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

export interface BackupSettings {
  /** 자동 백업 사용 여부 */
  enabled: boolean;
  /** 자동 백업 간격(시간). 마지막 백업 뒤 바뀐 것이 없으면 건너뛴다. */
  intervalHours: number;
  /** 자동 백업을 몇 개까지 남길지(수동·복원 전 백업은 지우지 않는다) */
  keep: number;
  /** 백업에 설정 파일(비밀번호·토큰 해시, 권한 표)을 넣을지 */
  includeConfig: boolean;
}

export const WEBHOOK_EVENTS = ["raw.added", "doc.changed", "proposal.created", "schedule", "ping"] as const;

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  /** 서명(HMAC-SHA256) 키. 받는 쪽에서 X-Keyring-Signature를 검증한다 */
  secret: string;
  events: (typeof WEBHOOK_EVENTS)[number][];
  /** 이 토픽(최상위 폴더) 이벤트만. 비면 전부 */
  topics: string[];
  enabled: boolean;
}

export interface JobConfig {
  id: string;
  name: string;
  /** "분 시 일 월 요일" (서버 TZ) */
  cron: string;
  /** 보낼 웹훅 id */
  webhook: string;
  /** 대상 토픽(정리 점검 범위, 이벤트 data.topic). 없으면 전체 */
  topic: string | null;
  /** 정리 점검 결과를 함께 보낼지 */
  lint: boolean;
  /** 받는 에이전트에게 줄 지시문(예: "SCHEMA의 정리 절차대로 고쳐라") */
  instructions: string | null;
  enabled: boolean;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function validateWebhooks(raw: unknown): WebhookConfig[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  return list.map((w: Partial<WebhookConfig>) => {
    if (typeof w.id !== "string" || !ID_RE.test(w.id)) throw new Error(`설정 오류: 웹훅 id는 영문 소문자·숫자·-·_ 40자 이내: ${String(w.id)}`);
    if (seen.has(w.id)) throw new Error(`설정 오류: 웹훅 id가 겹칩니다: ${w.id}`);
    seen.add(w.id);
    let url: URL;
    try {
      url = new URL(String(w.url));
    } catch {
      throw new Error(`설정 오류: 웹훅 주소가 잘못되었습니다: ${String(w.url)}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("설정 오류: 웹훅은 http·https 주소만");
    const events = Array.isArray(w.events) ? w.events : [];
    for (const e of events) if (!(WEBHOOK_EVENTS as readonly string[]).includes(e)) throw new Error(`설정 오류: 알 수 없는 이벤트: ${e}`);
    if (typeof w.secret !== "string" || w.secret.length < 16) throw new Error("설정 오류: 웹훅 secret은 16자 이상");
    return {
      id: w.id,
      name: typeof w.name === "string" && w.name.trim() ? w.name.trim() : w.id,
      url: url.href,
      secret: w.secret,
      events,
      topics: Array.isArray(w.topics) ? w.topics.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim()) : [],
      enabled: w.enabled !== false,
    };
  });
}

export function validateJobs(raw: unknown, cronCheck: (expr: string) => void = () => undefined): JobConfig[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  return list.map((j: Partial<JobConfig>) => {
    if (typeof j.id !== "string" || !ID_RE.test(j.id)) throw new Error(`설정 오류: 작업 id는 영문 소문자·숫자·-·_ 40자 이내: ${String(j.id)}`);
    if (seen.has(j.id)) throw new Error(`설정 오류: 작업 id가 겹칩니다: ${j.id}`);
    seen.add(j.id);
    if (typeof j.cron !== "string") throw new Error(`설정 오류: ${j.id}의 cron이 없습니다`);
    cronCheck(j.cron);
    if (typeof j.webhook !== "string" || !j.webhook) throw new Error(`설정 오류: ${j.id}의 웹훅이 없습니다`);
    return {
      id: j.id,
      name: typeof j.name === "string" && j.name.trim() ? j.name.trim() : j.id,
      cron: j.cron.trim(),
      webhook: j.webhook,
      topic: typeof j.topic === "string" && j.topic.trim() ? j.topic.trim() : null,
      lint: j.lint === true,
      instructions: typeof j.instructions === "string" && j.instructions.trim() ? j.instructions.trim().slice(0, 4000) : null,
      enabled: j.enabled !== false,
    };
  });
}

export interface KeyringConfig {
  owner: { name: string; passwordHash: string | null };
  /** 로그인 쿠키 서명 키. 비밀번호를 바꾸면 새로 만들어 기존 세션을 모두 끊는다. */
  sessionSecret: string;
  agents: AgentConfig[];
  backup: BackupSettings;
  /** 에이전트 변경을 승인 후 반영할 경로(접두 경로, "/"는 전체). 비어 있으면 모두 즉시 반영 */
  reviewPaths: string[];
  webhooks: WebhookConfig[];
  jobs: JobConfig[];
}

export const DEFAULT_BACKUP: BackupSettings = { enabled: true, intervalHours: 24, keep: 14, includeConfig: true };

export function validateBackupSettings(raw: unknown): BackupSettings {
  const b = (raw ?? {}) as Partial<BackupSettings>;
  const out = { ...DEFAULT_BACKUP, ...b };
  if (typeof out.enabled !== "boolean" || typeof out.includeConfig !== "boolean") throw new Error("설정 오류: backup.enabled·includeConfig는 true/false");
  if (!Number.isFinite(out.intervalHours) || out.intervalHours < 1 || out.intervalHours > 24 * 30) throw new Error("설정 오류: backup.intervalHours는 1~720");
  if (!Number.isInteger(out.keep) || out.keep < 1 || out.keep > 365) throw new Error("설정 오류: backup.keep은 1~365 정수");
  return { enabled: out.enabled, intervalHours: out.intervalHours, keep: out.keep, includeConfig: out.includeConfig };
}

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TOKEN_PREFIX = "kn_";
export const SESSION_COOKIE = "keyring_session";
const SESSION_DAYS = 30;

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function defaultConfig(): KeyringConfig {
  return {
    owner: { name: "me", passwordHash: null },
    sessionSecret: randomBytes(32).toString("hex"),
    agents: [],
    backup: { ...DEFAULT_BACKUP },
    reviewPaths: [],
    webhooks: [],
    jobs: [],
  };
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
    backup: validateBackupSettings(c.backup),
    reviewPaths: (Array.isArray(c.reviewPaths) ? c.reviewPaths : []).map((p) => {
      if (typeof p !== "string") throw new Error("설정 오류: reviewPaths는 문자열 목록");
      return normalizeRulePath(p) || "/";
    }),
    webhooks: validateWebhooks(c.webhooks),
    jobs: validateJobs(c.jobs),
  };
}

/**
 * 비밀번호 해시·세션 키·에이전트 토큰과 권한 표를 담는 설정 파일.
 * 볼트 밖에 두어 Git 이력에 섞이지 않게 한다. 파일이 바뀌면 다음 요청부터 다시 읽는다.
 */
export class ConfigStore {
  private cached: KeyringConfig | null = null;
  private mtime = -1;
  /** 에이전트별 마지막 접속 시각(서버가 켜진 뒤부터, 저장하지 않음) */
  readonly lastUsed = new Map<string, Date>();

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
        this.lastUsed.set(a.name, new Date());
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

  /** 에이전트 권한 표를 통째로 바꾼다(관리 콘솔). */
  setRules(name: string, rules: Record<string, Level>) {
    const normalized: Record<string, Level> = {};
    for (const [k, v] of Object.entries(rules)) {
      if (!isLevel(v)) throw new Error(`권한 값이 잘못되었습니다: ${String(v)}`);
      normalized[normalizeRulePath(k) || "/"] = v;
    }
    this.update((c) => {
      const a = c.agents.find((x) => x.name === name);
      if (!a) throw new Error(`에이전트가 없습니다: ${name}`);
      a.rules = normalized;
    });
  }

  /** 설정 파일 전체를 바꾼다(백업 복원). 형식이 틀리면 바꾸지 않는다. */
  replaceAll(raw: unknown) {
    const valid = validate(raw);
    this.save(valid);
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
