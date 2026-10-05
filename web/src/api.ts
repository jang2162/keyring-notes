export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
}

export interface Doc {
  path: string;
  content: string;
  hash: string;
  /** 서버가 만드는 문서(위키 index·log). 고칠 수 없다. */
  generated?: boolean;
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

export type WidgetResult =
  | {
      type: "query" | "table";
      title?: string;
      columns: string[];
      rows: { path: string; title: string; values: Record<string, unknown> }[];
      total: number;
    }
  | { type: "tasks"; title?: string; groups: { path: string; title: string; hash: string; tasks: TaskRow[] }[]; total: number }
  | { type: "chart"; title?: string; chart: "bar" | "line"; x: string; y: string; series: { label: string; value: number }[] };

export interface AuthStatus {
  authenticated: boolean;
  principal: { name: string; kind: "owner" | "agent" } | null;
  passwordSet: boolean;
}

export type Level = "hidden" | "read" | "append" | "write" | "delete";

export interface AgentInfo {
  name: string;
  createdAt: string;
  rules: Record<string, Level>;
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

export interface SourcesInfo {
  path: string;
  sources: { target: string; path: string | null }[];
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
  password: (current: string, next: string) => request<unknown>("POST", "/api/admin/password", { current, next }),
  backups: () => request<{ backups: BackupInfo[]; settings: BackupSettings }>("GET", "/api/admin/backups"),
  createBackup: (includeConfig?: boolean) => request<BackupInfo>("POST", "/api/admin/backups", { includeConfig }),
  backupSettings: (s: Partial<BackupSettings>) => request<{ settings: BackupSettings }>("PUT", "/api/admin/backups/settings", s),
  removeBackup: (name: string) => request<unknown>("DELETE", `/api/admin/backups/${enc(name)}`, {}),
  restore: (name: string, restoreConfig: boolean) =>
    request<{ restoredHead: string; previousRef: string | null; preRestoreBackup: string | null; configRestored: boolean }>(
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

export const api = {
  setup: (code: string, password: string) => request<{ ok: true }>("POST", "/api/auth/setup", { code, password }),
  status: () => request<AuthStatus>("GET", "/api/auth/status"),
  login: (password: string) => request<{ ok: true }>("POST", "/api/auth/login", { password }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  tree: () => request<{ tree: TreeNode[] }>("GET", "/api/tree").then((r) => r.tree),
  read: (path: string) => request<Doc>("GET", `/api/file?path=${q(path)}`),
  write: (path: string, content: string, baseHash: string | null) =>
    request<Doc>("PUT", "/api/file", { path, content, baseHash }),
  remove: (path: string, baseHash: string) => request<unknown>("DELETE", "/api/file", { path, baseHash }),
  move: (from: string, to: string, baseHash: string) => request<Doc>("POST", "/api/move", { from, to, baseHash }),
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
  rawUrl: (path: string) => `/api/raw?path=${q(path)}`,
};
