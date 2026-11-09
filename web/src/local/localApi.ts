import { ConflictError, ForbiddenError, KeyedError, NotFoundError, type LocalVault } from "@keyring-notes/core";
import { ApiError, type VaultApi } from "../api";
import { t } from "../i18n";
import { bumpRawVersion, swapImageSrc, versioned } from "../rawVersion";

/** 로컬 볼트 오류를 서버 응답과 같은 모양(ApiError)으로 바꿔 화면 코드가 그대로 처리하게 한다. */
function toApiError(e: unknown): unknown {
  const k = e instanceof KeyedError ? ([e.code, e.params as Record<string, string | number>] as const) : null;
  if (e instanceof ConflictError) return new ApiError(409, "conflict", e.message, e.currentHash, k?.[0], k?.[1]);
  if (e instanceof NotFoundError) return new ApiError(404, "not_found", e.message, undefined, k?.[0], k?.[1]);
  if (e instanceof ForbiddenError) return new ApiError(403, "forbidden", e.message, undefined, k?.[0], k?.[1]);
  if (e instanceof KeyedError) return new ApiError(400, "bad_request", e.message, undefined, k?.[0], k?.[1]);
  return e;
}

async function wrap<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toApiError(e);
  }
}

/** 서버에서만 되는 기능(what은 메시지 키) */
const serverOnly = (what: string) => async (): Promise<never> => {
  throw new ApiError(501, "server_only", t("error.server_only", { what: t(what) }), undefined, "server_only", { what: t(what) });
};

/**
 * 기기 로컬 볼트로 도는 VaultApi. 원본 수집(웹페이지 변환·PDF)·의미 검색·관리 콘솔·검토처럼
 * 서버가 있어야 하는 기능은 쓰지 않는다(화면에서 숨긴다).
 */
export function createLocalApi(vault: LocalVault): VaultApi {
  const blobUrls = new Map<string, string>();
  const loading = new Set<string>();
  /** 내용이 바뀐 첨부의 옛 blob URL: 새 것을 읽으면 이미 그려진 그림을 바꿔 끼운다 */
  const stale = new Map<string, string>();
  vault.onChange((paths) => {
    const files = paths.filter((p) => !/\.md$/i.test(p));
    for (const p of files) {
      const u = blobUrls.get(p);
      if (u) {
        URL.revokeObjectURL(u);
        stale.set(p, u);
      }
      blobUrls.delete(p);
    }
    // 같은 경로의 첨부가 바뀌었다(교체·동기화·앱 밖 편집): 판을 올려 다시 그리게 한다
    bumpRawVersion(files, (p) => (vault.fileUrl(p) ? rawUrl(p) : (stale.get(p) ?? "")));
  });

  /** 첨부 표시 URL: 앱은 파일 URL(asset 프로토콜), 브라우저는 읽어서 blob URL을 만든 뒤 다시 그리게 알린다. */
  const rawUrl = (path: string): string => {
    const direct = vault.fileUrl(path);
    if (direct) return versioned(direct, path);
    const cached = blobUrls.get(path);
    if (cached) return cached;
    if (!loading.has(path)) {
      loading.add(path);
      void vault
        .readBytes(path)
        .then((data) => {
          const type = /\.svg$/i.test(path) ? "image/svg+xml" : /\.pdf$/i.test(path) ? "application/pdf" : "";
          const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], type ? { type } : {}));
          blobUrls.set(path, url);
          const old = stale.get(path);
          if (old) swapImageSrc(old, url);
          stale.delete(path);
          window.dispatchEvent(new Event("keyring:asset-loaded"));
        })
        .catch(() => undefined)
        .finally(() => loading.delete(path));
    }
    return "data:,";
  };

  const local: VaultApi = {
    setup: serverOnly("feature.setup"),
    status: async () => ({ authenticated: true, principal: { name: vault.author, kind: "owner" as const }, passwordSet: true }),
    login: async () => ({ ok: true as const }),
    logout: async () => ({ ok: true as const }),
    tree: () => wrap(() => vault.tree()),
    read: (path) => wrap(() => vault.read(path)),
    write: (path, content, baseHash) => wrap(() => vault.write(path, content, baseHash)),
    remove: (path, baseHash) => wrap(() => vault.remove(path, baseHash)),
    move: (from, to, baseHash, opts) => wrap(() => vault.move(from, to, baseHash, opts)),
    moveNode: (from, to) => wrap(() => vault.moveNode(from, to)),
    // 미리 읽은 파일·해시와 디스크가 다르면 서버처럼 409(다른 창·동기화가 그 사이 바꾼 것을 모르고 지우지 않게)
    deleteNode: (path, files) =>
      wrap(async () => ({
        deleted: (
          await vault.deleteNode(
            path,
            files.map((f) => ({ path: f.path, baseHash: f.hash })),
          )
        ).deleted.map((d) => d.path),
      })),
    restoreFiles: (files) => wrap(() => vault.restoreFiles(files)),
    moveFiles: (pairs, message) => wrap(() => vault.moveFiles(pairs, message)),
    writeMany: (files, message) => wrap(() => vault.writeMany(files, message)),
    trash: (folder, cursor) => wrap(() => vault.trash({ folder, cursor })),
    trashPreview: (id, path) => wrap(() => vault.trashPreview(id, path)),
    restoreTrash: (id, paths) => wrap(() => vault.restoreTrash(id, paths)),
    history: (path) => wrap(() => vault.history(path)),
    revision: (path, rev) => wrap(() => vault.revision(path, rev)),
    rollback: (path, rev, baseHash) => wrap(() => vault.rollback(path, rev, baseHash)),
    search: (q, opts = {}) => wrap(() => vault.search(q, { ...opts, limit: 50 })),
    backlinks: (path) => wrap(() => vault.backlinks(path)),
    tags: (folder) => wrap(() => vault.tags(folder)),
    widget: (source) => wrap(() => vault.widget(source)),
    setTask: (path, line, done, baseHash) => wrap(() => vault.setTask(path, line, done, baseHash)),
    topics: () => wrap(() => vault.topics()),
    createTopic: (name) => wrap(() => vault.createTopic(name)),
    ingest: serverOnly("tool.ingest"),
    uploadFile: serverOnly("feature.upload"),
    uploadAttachment: async (path, file) => wrap(async () => vault.putFile(path, new Uint8Array(await file.arrayBuffer()))),
    replaceAttachment: async (path, file, baseHash) => wrap(async () => vault.replaceFile(path, new Uint8Array(await file.arrayBuffer()), baseHash)),
    lint: (folder) => wrap(() => vault.lint({ folder })),
    sources: (path) => wrap(() => vault.sources(path)),
    properties: () => wrap(async () => vault.properties()),
    mentions: (path) => wrap(() => vault.mentions(path)),
    graph: (folder) => wrap(() => vault.graph(folder)),
    semanticStatus: async () => ({ enabled: false }),
    semantic: serverOnly("feature.semantic"),
    rawUrl,
    // 기기 볼트의 휴지통은 첨부를 담지 않는다
    trashRawUrl: () => null,
    readBytes: (path) => wrap(() => vault.readBytes(path)),
  };
  return local;
}
