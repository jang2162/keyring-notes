export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
}

import type { Mention, PropertyStat } from "@keyring-notes/core";
import { isNetworkError, offline } from "./offline";

export interface Doc {
  path: string;
  content: string;
  hash: string;
  /** 서버가 만드는 문서(위키 index·log). 고칠 수 없다. */
  generated?: boolean;
  /** 오프라인에서 저장해 아직 서버로 보내지 못한 내용 */
  pendingOffline?: boolean;
  /** 연결이 없어 이 기기에 남은 사본을 보여 주는 중 */
  cachedOffline?: boolean;
}

export interface Topic {
  name: string;
  wiki: boolean;
  pages: number;
  raw: number;
}

export interface IngestResult {
  path: string;
  title: string;
  asset?: string;
}

export type IngestRequest =
  | { kind: "url"; topic: string; url: string; title?: string }
  | { kind: "html"; topic: string; html: string; url?: string; selectionHtml?: string; title?: string }
  | { kind: "text"; topic: string; text: string; title: string; url?: string };

export interface CommitInfo {
  rev: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly currentHash?: string | null,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event("keyring:unauthorized"));
  }
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? "error", data.message ?? res.statusText, data.currentHash);
  }
  return data as T;
}

const q = (path: string) => encodeURIComponent(path);

export interface SearchHit {
  path: string;
  title: string;
  line: number;
  snippet: string;
}

export interface TaskRow {
  path: string;
  line: number;
  done: boolean;
  text: string;
}

export interface WidgetRow {
  path: string;
  title: string;
  values: Record<string, unknown>;
  /** 문서 해시(위젯에서 프런트매터를 고칠 때 baseHash) */
  hash: string;
  summary?: string;
}

/** 문서 목록 위젯(query·table·cards·kanban) */
export interface ListWidgetResult {
  type: "query" | "table" | "cards" | "kanban";
  title?: string;
  columns: string[];
  rows: WidgetRow[];
  total: number;
  /** 묶을 필드(kanban은 칸) */
  group?: string;
  /** kanban 칸 순서 */
  lanes?: string[];
}

export type WidgetResult =
  | ListWidgetResult
  | { type: "tasks"; title?: string; groups: { path: string; title: string; hash: string; tasks: TaskRow[] }[]; total: number }
  | { type: "chart"; title?: string; chart: "bar" | "line"; x: string; y: string; series: { label: string; value: number }[] }
  | {
      type: "plugin";
      plugin: string;
      options: Record<string, unknown>;
      title?: string;
      columns: string[];
      rows: WidgetRow[];
      total: number;
    };

export interface AuthStatus {
  authenticated: boolean;
  principal: { name: string; kind: "owner" | "agent" } | null;
  passwordSet: boolean;
  /** 이 주소로 등록한 패스키가 있다 */
  passkey?: boolean;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  rpID: string;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** 이 브라우저가 패스키를 쓸 수 있는지(https 또는 localhost) */
export const passkeySupported = () => typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function";

/** 패스키 로그인(서버 모드). 브라우저 쪽 WebAuthn 도우미는 쓸 때만 불러온다 */
export async function passkeyLogin(): Promise<void> {
  const { startAuthentication } = await import("@simplewebauthn/browser");
  const { id, options } = await request<{ id: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("POST", "/api/auth/passkey/options", {});
  const response = await startAuthentication({ optionsJSON: options });
  await request<{ ok: true }>("POST", "/api/auth/passkey/login", { id, response });
}

export type Level = "hidden" | "read" | "append" | "write" | "delete";

export interface AgentInfo {
  name: string;
  createdAt: string;
  rules: Record<string, Level>;
  lastUsed: string | null;
}

export interface DeviceInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsed: string | null;
}

export interface BackupInfo {
  name: string;
  kind: "auto" | "manual" | "pre-restore";
  size: number;
  createdAt: string;
  head: string | null;
  commits: number;
  includesConfig: boolean;
  appVersion: string;
}

export interface BackupSettings {
  enabled: boolean;
  intervalHours: number;
  keep: number;
  includeConfig: boolean;
  /** 백업을 S3에도 올리기 */
  remote: boolean;
  remoteKeep: number;
}

export interface RemoteBackupInfo {
  name: string;
  kind: "auto" | "manual" | "pre-restore";
  size: number;
  uploadedAt: string;
  local: boolean;
}

export interface AdminStatus {
  app: { version: string; node: string; startedAt: string; uptimeSec: number; memoryMb: number };
  vault: { path: string; documents: number; files: number; bytes: number; topics: number; wikiTopics: string[] };
  history: { commits: number; bytes: number; last: { author: string; date: string; message: string } | null };
  index: { documents: number; bytes: number };
  disk: { freeBytes: number; totalBytes: number } | null;
  backups: { dir: string; count: number; last: BackupInfo | null; next: string | null; settings: BackupSettings; lastError: string | null };
  agents: { name: string; lastUsed: string | null }[];
  security: { https: boolean; publicUrl: string | null; allowedHosts: string[] | null };
  storage?: {
    s3: string | null;
    remoteBackups: { enabled: boolean; encrypted?: boolean; lastUpload: string | null; lastError: string | null } | null;
    blobs: { count: number; bytes: number; pending: number; minBytes: number; lastError: string | null } | null;
  };
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  checked: boolean;
  updateAvailable?: boolean;
  url?: string | null;
  notes?: string;
  error?: string;
  instructions: { docker: string; source: string };
}

const enc = encodeURIComponent;

export interface FilePreview {
  path: string;
  before: string | null;
  after: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  binary: boolean;
}

export interface ProposalSummary {
  id: string;
  agent: string;
  message: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
  rev?: string | null;
  stale: boolean;
  files: { path: string; change: "add" | "modify" | "delete"; binary: boolean }[];
}

export interface Proposal extends Omit<ProposalSummary, "stale" | "files"> {
  preview: FilePreview[];
}

export const review = {
  list: (status?: string) => request<{ proposals: ProposalSummary[] }>("GET", `/api/review${status ? `?status=${status}` : ""}`).then((r) => r.proposals),
  get: (id: string) => request<Proposal>("GET", `/api/review/${enc(id)}`),
  approve: (id: string) => request<ProposalSummary>("POST", `/api/review/${enc(id)}/approve`, {}),
  reject: (id: string, reason: string) => request<ProposalSummary>("POST", `/api/review/${enc(id)}/reject`, { reason }),
  settings: () => request<{ reviewPaths: string[] }>("GET", "/api/review/settings"),
  saveSettings: (reviewPaths: string[]) => request<{ reviewPaths: string[] }>("PUT", "/api/review/settings", { reviewPaths }),
};

export type LintKind = "broken_link" | "broken_source" | "orphan" | "no_sources" | "missing_frontmatter" | "stale" | "unprocessed_raw";

export interface LintReport {
  checkedAt: string;
  folder: string | null;
  counts: Partial<Record<LintKind, number>>;
  issues: { kind: LintKind; path: string; detail: string; target?: string }[];
}

export interface GraphData {
  nodes: { id: string; title: string; topic: string; degree: number }[];
  edges: { source: string; target: string; kind: "link" | "source" }[];
}

/** 연결되지 않은 언급: 이 문서의 이름이 링크 없이 나오는 다른 문서(줄·위치는 그 문서 원문 기준) */
export interface MentionsInfo {
  path: string;
  names: string[];
  docs: { path: string; title: string; hash: string; mentions: Mention[] }[];
}

export interface SourcesInfo {
  path: string;
  /** anchor: `#제목`·`#^블록`(원본의 어느 부분을 인용했는지) */
  sources: { target: string; path: string | null; anchor?: string }[];
  citedBy: { path: string; title: string }[];
  linkedBy: { path: string; title: string }[];
}

export interface WebhookInfo {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  topics: string[];
  enabled: boolean;
}

export interface JobInfo {
  id: string;
  name: string;
  cron: string;
  webhook: string;
  topic: string | null;
  lint: boolean;
  instructions: string | null;
  enabled: boolean;
  next?: string | null;
  lastRun?: string | null;
  lastResult?: string | null;
  error?: string;
}

export interface DeliveryInfo {
  id: string;
  webhook: string;
  event: string;
  time: string;
  attempts: number;
  status: "pending" | "ok" | "failed";
  httpStatus?: number;
  error?: string;
}

export const automation = {
  get: () => request<{ events: string[]; webhooks: WebhookInfo[]; jobs: JobInfo[]; deliveries: DeliveryInfo[] }>("GET", "/api/admin/automation"),
  saveWebhooks: (webhooks: Partial<WebhookInfo>[]) =>
    request<{ webhooks: WebhookInfo[]; newSecrets: Record<string, string> }>("PUT", "/api/admin/automation/webhooks", { webhooks }),
  saveJobs: (jobs: Partial<JobInfo>[]) => request<{ jobs: JobInfo[] }>("PUT", "/api/admin/automation/jobs", { jobs }),
  test: (id: string) => request<DeliveryInfo>("POST", `/api/admin/automation/webhooks/${enc(id)}/test`, {}),
  run: (id: string) => request<{ delivery: DeliveryInfo | null; job: JobInfo }>("POST", `/api/admin/automation/jobs/${enc(id)}/run`, {}),
};

export const admin = {
  status: () => request<AdminStatus>("GET", "/api/admin/status"),
  update: (force = false) => request<UpdateInfo>("GET", `/api/admin/update${force ? "?force=1" : ""}`),
  agents: () => request<{ agents: AgentInfo[] }>("GET", "/api/admin/agents").then((r) => r.agents),
  createAgent: (name: string) => request<{ name: string; token: string }>("POST", "/api/admin/agents", { name }),
  rotate: (name: string) => request<{ name: string; token: string }>("POST", `/api/admin/agents/${enc(name)}/rotate`, {}),
  setRules: (name: string, rules: Record<string, Level>) =>
    request<{ rules: Record<string, Level> }>("PUT", `/api/admin/agents/${enc(name)}/rules`, { rules }),
  removeAgent: (name: string) => request<unknown>("DELETE", `/api/admin/agents/${enc(name)}`, {}),
  devices: () => request<{ devices: DeviceInfo[] }>("GET", "/api/admin/devices").then((r) => r.devices),
  removeDevice: (id: string) => request<unknown>("DELETE", `/api/admin/devices/${enc(id)}`, {}),
  password: (current: string, next: string) => request<unknown>("POST", "/api/admin/password", { current, next }),
  passkeys: () => request<{ passkeys: PasskeyInfo[]; here: string | null }>("GET", "/api/admin/passkeys"),
  async registerPasskey(name: string): Promise<PasskeyInfo> {
    const { startRegistration } = await import("@simplewebauthn/browser");
    const { id, options } = await request<{ id: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("POST", "/api/admin/passkeys/options", {});
    const response = await startRegistration({ optionsJSON: options });
    return request<PasskeyInfo>("POST", "/api/admin/passkeys", { id, response, name });
  },
  removePasskey: (id: string) => request<unknown>("DELETE", `/api/admin/passkeys/${enc(id)}`, {}),
  backups: () => request<{ backups: BackupInfo[]; settings: BackupSettings }>("GET", "/api/admin/backups"),
  createBackup: (includeConfig?: boolean) => request<BackupInfo>("POST", "/api/admin/backups", { includeConfig }),
  backupSettings: (s: Partial<BackupSettings>) => request<{ settings: BackupSettings }>("PUT", "/api/admin/backups/settings", s),
  removeBackup: (name: string) => request<unknown>("DELETE", `/api/admin/backups/${enc(name)}`, {}),
  remoteBackups: () =>
    request<{ configured: boolean; location?: string; backups: RemoteBackupInfo[]; lastError?: string | null }>("GET", "/api/admin/backups/remote"),
  fetchRemote: (name: string) => request<BackupInfo>("POST", `/api/admin/backups/remote/${enc(name)}/fetch`, {}),
  pushRemote: (name: string) => request<unknown>("POST", `/api/admin/backups/${enc(name)}/push`, {}),
  restore: (name: string, restoreConfig: boolean) =>
    request<{
      restoredHead: string;
      previousRef: string | null;
      preRestoreBackup: string | null;
      configRestored: boolean;
      attachments?: { downloaded: string[]; removed: string[]; missing: string[] };
    }>(
      "POST",
      `/api/admin/backups/${enc(name)}/restore`,
      { restoreConfig },
    ),
  downloadUrl: (name: string) => `/api/admin/backups/${enc(name)}`,
  async upload(file: File): Promise<BackupInfo> {
    const res = await fetch("/api/admin/backups/upload", {
      method: "POST",
      headers: { "content-type": "application/gzip", "x-keyring-upload": "1" },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? res.statusText);
    return data as BackupInfo;
  },
};

const remoteApi = {
  setup: (code: string, password: string) => request<{ ok: true }>("POST", "/api/auth/setup", { code, password }),
  status: () => request<AuthStatus>("GET", "/api/auth/status"),
  login: (password: string) => request<{ ok: true }>("POST", "/api/auth/login", { password }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  /** 연결이 없으면 마지막으로 받은 트리 */
  async tree(): Promise<TreeNode[]> {
    try {
      const t = (await request<{ tree: TreeNode[] }>("GET", "/api/tree")).tree;
      void offline.saveTree(t).catch(() => undefined);
      return t;
    } catch (e) {
      const cached = isNetworkError(e) ? await offline.getTree().catch(() => undefined) : undefined;
      if (cached) return cached;
      throw e;
    }
  },
  /** 오프라인 저장 대기 내용이 있으면 그것을, 연결이 없으면 이 기기의 사본을 돌려준다. */
  /** fresh: 오프라인 대기분을 건너뛰고 서버 것을 읽는다(병합할 때) */
  async read(path: string, opts: { fresh?: boolean } = {}): Promise<Doc> {
    const pending = opts.fresh ? undefined : await offline.pendingFor(path).catch(() => undefined);
    if (pending) return { path, content: pending.content, hash: pending.baseHash ?? "", pendingOffline: true };
    try {
      const d = await request<Doc>("GET", `/api/file?path=${q(path)}`);
      void offline.saveDoc(d).catch(() => undefined);
      return d;
    } catch (e) {
      const cached = isNetworkError(e) ? await offline.getDoc(path).catch(() => undefined) : undefined;
      if (cached) return { ...cached, cachedOffline: true };
      throw e;
    }
  },
  /** coalesce: 자동 저장. 서버가 같은 문서의 잇단 저장을 한 커밋으로 묶는다 */
  write: (path: string, content: string, baseHash: string | null, opts: { coalesce?: boolean } = {}) =>
    request<Doc>("PUT", "/api/file", { path, content, baseHash, ...(opts.coalesce ? { coalesce: true } : {}) }),
  remove: (path: string, baseHash: string) => request<unknown>("DELETE", "/api/file", { path, baseHash }),
  /** 이동·이름 바꾸기. 기본으로 이 문서를 가리키던 링크도 같이 고친다(linksUpdated: 고친 문서, linkCount: 고친 링크 수) */
  move: (from: string, to: string, baseHash: string, opts: { updateLinks?: boolean } = {}) =>
    request<Doc & { linksUpdated?: string[]; linkCount?: number }>("POST", "/api/move", { from, to, baseHash, updateLinks: opts.updateLinks }),
  history: (path: string) => request<{ commits: CommitInfo[] }>("GET", `/api/history?path=${q(path)}`).then((r) => r.commits),
  revision: (path: string, rev: string) =>
    request<{ content: string | null }>("GET", `/api/revision?path=${q(path)}&rev=${rev}`).then((r) => r.content),
  rollback: (path: string, rev: string, baseHash: string | null) =>
    request<Doc>("POST", "/api/rollback", { path, rev, baseHash }),
  search: (q: string) => request<{ hits: SearchHit[] }>("GET", `/api/search?q=${encodeURIComponent(q)}&limit=50`).then((r) => r.hits),
  backlinks: (path: string) =>
    request<{ backlinks: { path: string; title: string }[] }>("GET", `/api/backlinks?path=${q(path)}`).then((r) => r.backlinks),
  tags: () => request<{ tags: { tag: string; count: number }[] }>("GET", "/api/tags").then((r) => r.tags),
  widget: (source: string) => request<WidgetResult>("POST", "/api/widget", { source }),
  setTask: (path: string, line: number, done: boolean, baseHash: string) =>
    request<Doc>("POST", "/api/task", { path, line, done, baseHash }),
  topics: () => request<{ topics: Topic[] }>("GET", "/api/topics").then((r) => r.topics),
  createTopic: (name: string) => request<{ topic: string; schema: string }>("POST", "/api/topics", { name }),
  ingest: (req: IngestRequest) => request<IngestResult>("POST", "/api/ingest", req),
  /** 첨부 파일 새로 만들기(붙여넣기·끌어놓기). 이미 있으면 409 */
  async uploadAttachment(path: string, file: Blob): Promise<{ path: string; hash: string | null }> {
    const res = await fetch(`/api/attachment?path=${q(path)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-keyring-upload": "1" },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) window.dispatchEvent(new Event("keyring:unauthorized"));
    if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? res.statusText, data.currentHash);
    return data as { path: string; hash: string | null };
  },
  async uploadFile(topic: string, file: File): Promise<IngestResult> {
    const res = await fetch(`/api/ingest/file?topic=${q(topic)}&name=${q(file.name)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-keyring-upload": "1" },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) window.dispatchEvent(new Event("keyring:unauthorized"));
    if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? res.statusText);
    return data as IngestResult;
  },
  lint: (folder?: string) => request<LintReport>("GET", `/api/lint${folder ? `?folder=${q(folder)}` : ""}`),
  sources: (path: string) => request<SourcesInfo>("GET", `/api/sources?path=${q(path)}`),
  properties: () => request<{ properties: PropertyStat[] }>("GET", "/api/properties").then((r) => r.properties),
  mentions: (path: string) => request<MentionsInfo>("GET", `/api/mentions?path=${q(path)}`),
  graph: (folder?: string) => request<GraphData>("GET", `/api/graph${folder ? `?folder=${q(folder)}` : ""}`),
  semanticStatus: () => request<{ enabled: boolean; model?: string; pending?: number; chunks?: number; lastError?: string | null }>("GET", "/api/semantic/status"),
  semantic: (query: string) =>
    request<{ hits: { path: string; title: string; score: number; heading: string; snippet: string }[] }>("GET", `/api/semantic?q=${encodeURIComponent(query)}&limit=20`).then((r) => r.hits),
  rawUrl: (path: string) => `/api/raw?path=${q(path)}`,
  /** 첨부 파일 내용(PDF 보기) */
  readBytes: async (path: string): Promise<Uint8Array> => {
    const res = await fetch(`/api/raw?path=${q(path)}`, { credentials: "same-origin" });
    if (res.status === 401) window.dispatchEvent(new Event("keyring:unauthorized"));
    if (!res.ok) throw new ApiError(res.status, "error", res.status === 404 ? `파일이 없습니다: ${path}` : res.statusText);
    return new Uint8Array(await res.arrayBuffer());
  },
};

/** 화면이 쓰는 볼트 API. 서버(REST)와 기기 로컬 볼트가 같은 모양으로 구현한다. */
export type VaultApi = typeof remoteApi;

export const appMode = {
  /** 기기 로컬 볼트(데스크톱·모바일 앱, 브라우저 ?local)로 도는 중 */
  local: false,
};

let active: VaultApi = remoteApi;

/** 로컬 볼트로 바꾼다(앱 시작 때 한 번). */
export function setLocalBackend(backend: VaultApi) {
  active = backend;
  appMode.local = true;
}

/** 지금 쓰는 백엔드로 넘겨 주는 대리자. 화면 코드는 어느 쪽인지 몰라도 된다. */
export const api: VaultApi = new Proxy({} as VaultApi, {
  get: (_t, key) => active[key as keyof VaultApi],
});
