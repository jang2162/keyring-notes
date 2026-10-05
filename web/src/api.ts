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
}

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
  rawUrl: (path: string) => `/api/raw?path=${q(path)}`,
};
