import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PathError } from "@keyring-notes/core";
import { AccessPolicy, isLevel, normalizeRulePath, type Level, type Principal } from "./access.js";
import { serverText } from "./lang.js";

export interface AgentConfig {
  name: string;
  /** 토큰 원문은 저장하지 않는다. sha256 해시만 둔다. */
  tokenHash: string;
  rules: Record<string, Level>;
  createdAt: string;
}

/** 데스크톱·모바일 앱(기기) 하나. 앱은 이 토큰으로 동기화한다. */
export interface DeviceConfig {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
}

/** 소유자 패스키(WebAuthn). 공개 키만 저장한다(비밀이 아니다). */
export interface PasskeyConfig {
  /** 자격 증명 ID(base64url) */
  id: string;
  /** COSE 공개 키(base64url) */
  publicKey: string;
  /** 서명 횟수(복제된 인증기 감지용, 0이면 세지 않는 인증기) */
  counter: number;
  transports: string[];
  name: string;
  /** 등록한 주소의 호스트 이름(rpID). 다른 주소로 접속하면 이 패스키는 쓸 수 없다 */
  rpID: string;
  createdAt: string;
  lastUsedAt: string | null;
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
  /** 백업을 만들 때마다 S3에도 올릴지(KEYRING_S3_BUCKET을 설정했을 때) */
  remote: boolean;
  /** S3에 남길 자동 백업 수 */
  remoteKeep: number;
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
    if (typeof w.id !== "string" || !ID_RE.test(w.id)) throw new PathError("config.webhook_id", { id: String(w.id) });
    if (seen.has(w.id)) throw new PathError("config.webhook_id_dup", { id: w.id });
    seen.add(w.id);
    let url: URL;
    try {
      url = new URL(String(w.url));
    } catch {
      throw new PathError("config.webhook_url", { url: String(w.url) });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new PathError("config.webhook_protocol");
    const events = Array.isArray(w.events) ? w.events : [];
    for (const e of events) if (!(WEBHOOK_EVENTS as readonly string[]).includes(e)) throw new PathError("config.webhook_event", { event: String(e) });
    if (typeof w.secret !== "string" || w.secret.length < 16) throw new PathError("config.webhook_secret");
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
    if (typeof j.id !== "string" || !ID_RE.test(j.id)) throw new PathError("config.job_id", { id: String(j.id) });
    if (seen.has(j.id)) throw new PathError("config.job_id_dup", { id: j.id });
    seen.add(j.id);
    if (typeof j.cron !== "string") throw new PathError("config.job_cron", { id: j.id });
    cronCheck(j.cron);
    if (typeof j.webhook !== "string" || !j.webhook) throw new PathError("config.job_webhook", { id: j.id });
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
  devices: DeviceConfig[];
  backup: BackupSettings;
  /** 에이전트 변경을 승인 후 반영할 경로(접두 경로, "/"는 전체). 비어 있으면 모두 즉시 반영 */
  reviewPaths: string[];
  webhooks: WebhookConfig[];
  jobs: JobConfig[];
  passkeys: PasskeyConfig[];
  /** 패스키에 넣는 사용자 ID(무작위, base64url). 인증기가 같은 사용자의 패스키를 하나로 묶는다 */
  passkeyUserId: string;
  /**
   * 서버 언어(CLI 출력, 볼트 언어를 아직 정하지 않았을 때의 볼트 글). null이면 LANG을 따른다
   */
  language: "en" | "ko" | null;
  /** 에이전트에게 가는 글(MCP 안내·도구 설명·오류·정리 점검 설명)의 언어. 기본 영어 */
  agentLanguage: "en" | "ko";
}

export const DEFAULT_BACKUP: BackupSettings = { enabled: true, intervalHours: 24, keep: 14, includeConfig: true, remote: true, remoteKeep: 30 };

export function validateBackupSettings(raw: unknown): BackupSettings {
  const b = (raw ?? {}) as Partial<BackupSettings>;
  const out = { ...DEFAULT_BACKUP, ...b };
  if (typeof out.enabled !== "boolean" || typeof out.includeConfig !== "boolean") throw new PathError("config.backup_flags");
  if (!Number.isFinite(out.intervalHours) || out.intervalHours < 1 || out.intervalHours > 24 * 30) throw new PathError("config.backup_interval");
  if (!Number.isInteger(out.keep) || out.keep < 1 || out.keep > 365) throw new PathError("config.backup_keep");
  if (typeof out.remote !== "boolean") throw new PathError("config.backup_remote");
  if (!Number.isInteger(out.remoteKeep) || out.remoteKeep < 1 || out.remoteKeep > 3650) throw new PathError("config.backup_remote_keep");
  return { enabled: out.enabled, intervalHours: out.intervalHours, keep: out.keep, includeConfig: out.includeConfig, remote: out.remote, remoteKeep: out.remoteKeep };
}

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TOKEN_PREFIX = "kn_";
const DEVICE_TOKEN_PREFIX = "kd_";
export const SESSION_COOKIE = "keyring_session";
const SESSION_DAYS = 30;

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

/** 기기 이름: 1~40자, 제어 문자 없음(커밋 작성자에 들어간다). */
export function validDeviceName(name: unknown): string {
  const n = typeof name === "string" ? name.trim() : "";
  // eslint-disable-next-line no-control-regex
  if (!n || [...n].length > 40 || /[\u0000-\u001f\u007f<>]/.test(n)) throw new PathError("device_name");
  return n;
}

function defaultConfig(): KeyringConfig {
  return {
    owner: { name: "me", passwordHash: null },
    sessionSecret: randomBytes(32).toString("hex"),
    agents: [],
    devices: [],
    backup: { ...DEFAULT_BACKUP },
    reviewPaths: [],
    webhooks: [],
    jobs: [],
    passkeys: [],
    passkeyUserId: randomBytes(16).toString("base64url"),
    language: null,
    agentLanguage: "en",
  };
}

const B64URL = /^[A-Za-z0-9_-]+$/;

function validatePasskeys(raw: unknown): PasskeyConfig[] {
  return (Array.isArray(raw) ? raw : []).map((k: Partial<PasskeyConfig>) => {
    if (typeof k?.id !== "string" || !B64URL.test(k.id) || typeof k.publicKey !== "string" || !B64URL.test(k.publicKey) || typeof k.rpID !== "string" || !k.rpID) {
      throw new PathError("config.passkeys");
    }
    return {
      id: k.id,
      publicKey: k.publicKey,
      counter: Number.isInteger(k.counter) && k.counter! >= 0 ? k.counter! : 0,
      transports: Array.isArray(k.transports) ? k.transports.filter((t): t is string => typeof t === "string") : [],
      name: typeof k.name === "string" && k.name.trim() ? k.name.trim().slice(0, 40) : serverText("server.passkey_name"),
      rpID: k.rpID,
      createdAt: k.createdAt ?? "",
      lastUsedAt: k.lastUsedAt ?? null,
    };
  });
}

function validate(raw: unknown): KeyringConfig {
  const c = raw as Partial<KeyringConfig>;
  const base = defaultConfig();
  const agents = Array.isArray(c.agents) ? c.agents : [];
  for (const a of agents) {
    if (!AGENT_NAME_RE.test(a.name)) throw new PathError("config.agent_name", { name: String(a.name) });
    for (const [k, v] of Object.entries(a.rules ?? {})) {
      normalizeRulePath(k);
      if (!isLevel(v)) throw new PathError("config.agent_level", { name: a.name, path: k, level: String(v) });
    }
  }
  return {
    owner: { name: c.owner?.name ?? base.owner.name, passwordHash: c.owner?.passwordHash ?? null },
    sessionSecret: typeof c.sessionSecret === "string" && c.sessionSecret.length >= 32 ? c.sessionSecret : base.sessionSecret,
    agents: agents.map((a) => ({ name: a.name, tokenHash: a.tokenHash, rules: a.rules ?? {}, createdAt: a.createdAt ?? "" })),
    devices: (Array.isArray(c.devices) ? c.devices : []).map((d) => {
      if (typeof d?.id !== "string" || typeof d.tokenHash !== "string" || !/^[0-9a-f]{64}$/.test(d.tokenHash)) throw new PathError("config.devices");
      return { id: d.id, name: validDeviceName(d.name), tokenHash: d.tokenHash, createdAt: d.createdAt ?? "" };
    }),
    backup: validateBackupSettings(c.backup),
    reviewPaths: (Array.isArray(c.reviewPaths) ? c.reviewPaths : []).map((p) => {
      if (typeof p !== "string") throw new PathError("config.review_paths");
      return normalizeRulePath(p) || "/";
    }),
    webhooks: validateWebhooks(c.webhooks),
    jobs: validateJobs(c.jobs),
    passkeys: validatePasskeys(c.passkeys),
    passkeyUserId: typeof c.passkeyUserId === "string" && B64URL.test(c.passkeyUserId) ? c.passkeyUserId : base.passkeyUserId,
    language: c.language === "en" || c.language === "ko" ? c.language : null,
    agentLanguage: c.agentLanguage === "ko" ? "ko" : "en",
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
    if (password.length < 8) throw new PathError("password_short");
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

  // ── 기기(앱) 토큰 ──

  /** 앱 기기를 등록하고 토큰을 발급한다. 토큰 원문은 이때 한 번만 돌려준다. */
  issueDeviceToken(name: string): { id: string; name: string; token: string } {
    const n = validDeviceName(name);
    const token = DEVICE_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const id = randomBytes(6).toString("hex");
    this.update((c) => {
      c.devices.push({ id, name: n, tokenHash: sha256(token), createdAt: new Date().toISOString() });
    });
    return { id, name: n, token };
  }

  deviceByToken(token: string | undefined): Principal | null {
    if (!token || !token.startsWith(DEVICE_TOKEN_PREFIX)) return null;
    const h = Buffer.from(sha256(token), "hex");
    for (const d of this.get().devices) {
      const stored = Buffer.from(d.tokenHash, "hex");
      if (stored.length === h.length && timingSafeEqual(stored, h)) {
        this.lastUsed.set(`device:${d.id}`, new Date());
        const owner = this.get().owner.name;
        return { kind: "owner", name: `${owner} (${d.name})`, email: `${owner}@keyring-notes.local`, device: d.id };
      }
    }
    return null;
  }

  removeDevice(id: string) {
    this.update((c) => {
      const before = c.devices.length;
      c.devices = c.devices.filter((d) => d.id !== id);
      if (c.devices.length === before) throw new PathError("device_missing", { id });
    });
    this.lastUsed.delete(`device:${id}`);
  }

  // ── 패스키 ──

  addPasskey(k: Omit<PasskeyConfig, "createdAt" | "lastUsedAt">): PasskeyConfig {
    const entry: PasskeyConfig = { ...k, name: validDeviceName(k.name), createdAt: new Date().toISOString(), lastUsedAt: null };
    this.update((c) => {
      if (c.passkeys.some((p) => p.id === k.id)) throw new PathError("passkey_exists");
      c.passkeys.push(entry);
    });
    return entry;
  }

  /** 로그인에 썼을 때: 서명 횟수와 마지막 사용 시각 */
  touchPasskey(id: string, counter: number) {
    this.update((c) => {
      const k = c.passkeys.find((p) => p.id === id);
      if (k) {
        k.counter = counter;
        k.lastUsedAt = new Date().toISOString();
      }
    });
  }

  removePasskey(id: string) {
    this.update((c) => {
      const before = c.passkeys.length;
      c.passkeys = c.passkeys.filter((p) => p.id !== id);
      if (c.passkeys.length === before) throw new PathError("passkey_missing", { id });
    });
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
    if (!AGENT_NAME_RE.test(name)) throw new PathError("agent_name");
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
      if (c.agents.length === before) throw new PathError("agent_missing", { name });
    });
  }

  /** 에이전트 권한 표를 통째로 바꾼다(관리 콘솔). */
  setRules(name: string, rules: Record<string, Level>) {
    const normalized: Record<string, Level> = {};
    for (const [k, v] of Object.entries(rules)) {
      if (!isLevel(v)) throw new PathError("level_invalid", { level: String(v) });
      normalized[normalizeRulePath(k) || "/"] = v;
    }
    this.update((c) => {
      const a = c.agents.find((x) => x.name === name);
      if (!a) throw new PathError("agent_missing", { name });
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
      if (!a) throw new PathError("agent_missing", { name });
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
