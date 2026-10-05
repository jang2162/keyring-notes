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

export const api = {
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
  rawUrl: (path: string) => `/api/raw?path=${q(path)}`,
};
