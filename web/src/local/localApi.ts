import { ConflictError, ForbiddenError, NotFoundError, PathError, type LocalVault } from "@keyring-notes/core";
import { ApiError, type VaultApi } from "../api";

/** 로컬 볼트 오류를 서버 응답과 같은 모양(ApiError)으로 바꿔 화면 코드가 그대로 처리하게 한다. */
function toApiError(e: unknown): unknown {
  if (e instanceof ConflictError) return new ApiError(409, "conflict", e.message, e.currentHash);
  if (e instanceof NotFoundError) return new ApiError(404, "not_found", e.message);
  if (e instanceof ForbiddenError) return new ApiError(403, "forbidden", e.message);
  if (e instanceof PathError) return new ApiError(400, "bad_request", e.message);
  return e;
}

async function wrap<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toApiError(e);
  }
}

const serverOnly = (what: string) => async (): Promise<never> => {
  throw new ApiError(501, "server_only", `${what}은(는) 서버에 연결된 웹 화면에서 쓸 수 있습니다.`);
};

/**
 * 기기 로컬 볼트로 도는 VaultApi. 원본 수집(웹페이지 변환·PDF)·의미 검색·관리 콘솔·검토처럼
 * 서버가 있어야 하는 기능은 쓰지 않는다(화면에서 숨긴다).
 */
export function createLocalApi(vault: LocalVault): VaultApi {
  const blobUrls = new Map<string, string>();
  const loading = new Set<string>();
  vault.onChange((paths) => {
    for (const p of paths) {
      const u = blobUrls.get(p);
      if (u) URL.revokeObjectURL(u);
      blobUrls.delete(p);
    }
  });

  /** 첨부 표시 URL: 앱은 파일 URL(asset 프로토콜), 브라우저는 읽어서 blob URL을 만든 뒤 다시 그리게 알린다. */
  const rawUrl = (path: string): string => {
    const direct = vault.fileUrl(path);
    if (direct) return direct;
    const cached = blobUrls.get(path);
    if (cached) return cached;
    if (!loading.has(path)) {
      loading.add(path);
      void vault
        .readBytes(path)
        .then((data) => {
          const type = /\.svg$/i.test(path) ? "image/svg+xml" : /\.pdf$/i.test(path) ? "application/pdf" : "";
          blobUrls.set(path, URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], type ? { type } : {})));
          window.dispatchEvent(new Event("keyring:asset-loaded"));
        })
        .catch(() => undefined)
        .finally(() => loading.delete(path));
    }
    return "data:,";
  };

  const local: VaultApi = {
    setup: serverOnly("처음 설정"),
    status: async () => ({ authenticated: true, principal: { name: vault.author, kind: "owner" as const }, passwordSet: true }),
    login: async () => ({ ok: true as const }),
    logout: async () => ({ ok: true as const }),
    tree: () => wrap(() => vault.tree()),
    read: (path) => wrap(() => vault.read(path)),
    write: (path, content, baseHash) => wrap(() => vault.write(path, content, baseHash)),
    remove: (path, baseHash) => wrap(() => vault.remove(path, baseHash)),
    move: (from, to, baseHash, opts) => wrap(() => vault.move(from, to, baseHash, opts)),
    moveFolder: (from, to) => wrap(() => vault.moveFolder(from, to)),
    moveFiles: (pairs, message) => wrap(() => vault.moveFiles(pairs, message)),
    history: (path) => wrap(() => vault.history(path)),
    revision: (path, rev) => wrap(() => vault.revision(path, rev)),
    rollback: (path, rev, baseHash) => wrap(() => vault.rollback(path, rev, baseHash)),
    search: (q) => wrap(() => vault.search(q, { limit: 50 })),
    backlinks: (path) => wrap(() => vault.backlinks(path)),
    tags: () => wrap(() => vault.tags()),
    widget: (source) => wrap(() => vault.widget(source)),
    setTask: (path, line, done, baseHash) => wrap(() => vault.setTask(path, line, done, baseHash)),
    topics: () => wrap(() => vault.topics()),
    createTopic: (name) => wrap(() => vault.createTopic(name)),
    ingest: serverOnly("원본 수집"),
    uploadFile: serverOnly("파일 업로드"),
    uploadAttachment: async (path, file) => wrap(async () => vault.putFile(path, new Uint8Array(await file.arrayBuffer()))),
    lint: (folder) => wrap(() => vault.lint({ folder })),
    sources: (path) => wrap(() => vault.sources(path)),
    properties: () => wrap(async () => vault.properties()),
    mentions: (path) => wrap(() => vault.mentions(path)),
    graph: (folder) => wrap(() => vault.graph(folder)),
    semanticStatus: async () => ({ enabled: false }),
    semantic: serverOnly("의미 검색"),
    rawUrl,
    readBytes: (path) => wrap(() => vault.readBytes(path)),
  };
  return local;
}
