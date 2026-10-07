import { ConflictError, KeyedError, NotFoundError, UnauthorizedError } from "./errors.js";

/** 서버 오류 응답(code·params가 있으면 그것으로 번역한다) */
interface RemoteErrorBody {
  message?: string;
  code?: string;
  params?: Record<string, string | number>;
  currentHash?: string | null;
}

function remoteError(status: number, data: RemoteErrorBody): { code: string; params: Record<string, string | number> } {
  if (data.code) return { code: data.code, params: data.params ?? {} };
  if (data.message) return { code: "server_message", params: { message: data.message } };
  return { code: "server_status", params: { status } };
}
import { sha256Hex, utf8 } from "./hash.js";
import type { LocalVault } from "./local.js";
import { merge3 } from "./merge.js";
import { isMarkdown } from "./paths.js";
import { isVaultSettingsPath, replaceSettingsObject, settingsObject, vaultLanguage, parseVaultSettings } from "./settings.js";
import { mergeSettingsObjects, type SettingsKeyConflict } from "./settingsMerge.js";

export interface RemoteFile {
  path: string;
  hash: string;
  size: number;
}

/** 동기화 상대(보통 자체 호스팅 서버). 쓰기는 baseHash가 맞을 때만 되고, 아니면 ConflictError. */
export interface RemoteVault {
  /** 기준점을 서버별로 따로 두기 위한 이름(서버 주소) */
  readonly id: string;
  manifest(): Promise<RemoteFile[]>;
  read(path: string): Promise<{ content: string; hash: string }>;
  readRaw(path: string): Promise<Uint8Array>;
  write(path: string, content: string, baseHash: string | null): Promise<{ hash: string }>;
  remove(path: string, baseHash: string): Promise<void>;
  /** 새 첨부 올리기(이미 있으면 ConflictError). 없으면 기기에서 만든 첨부는 올리지 않는다 */
  putRaw?(path: string, data: Uint8Array): Promise<{ hash: string }>;
  /** 첨부 지우기(baseHash가 맞을 때만). 없으면 기기에서 지운 첨부는 서버에 남는다 */
  removeRaw?(path: string, baseHash: string): Promise<void>;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  /** 서버에서 받아 이 기기에 쓴 문서·첨부 */
  pulled: string[];
  /** 이 기기에서 서버로 보낸 문서 */
  pushed: string[];
  deletedLocal: string[];
  deletedRemote: string[];
  /** 양쪽에서 바뀌었지만 서로 다른 곳이라 자동으로 합친 문서(양쪽 모두 합친 내용이 됨) */
  merged: string[];
  /** 양쪽에서 같은 곳을 다르게 바뀜: path는 서버 버전, copy에 이 기기의 내용 */
  conflicts: { path: string; copy: string }[];
  /**
   * 공통 설정 파일에서 양쪽이 다르게 바꾼 키(서버 값을 따랐다). 충돌 사본은 만들지 않는다.
   * 화면이 기기 값(local)을 "이 기기에서만 다르게"로 남길지 묻는다.
   */
  settingsConflicts: SettingsKeyConflict[];
  /**
   * 이번에 건너뛴 것(다음 동기화에서 다시 본다). reason: attachment-taken(같은 이름의 첨부가 서버에 생김),
   * attachment-changed(지우는 사이 서버에서 바뀜), attachment-local(기기에서 바꾼 첨부는 보내지 않음),
   * local-changed(받는 사이 기기에서 바뀜), settings-changed(설정 파일을 합치는 사이 서버에서 또 바뀜)
   */
  skipped: { path: string; reason: "attachment-taken" | "attachment-changed" | "attachment-local" | "local-changed" | "settings-changed" }[];
  errors: { path: string; message: string }[];
}

export interface SyncState {
  server: string;
  /** 경로 → 마지막으로 양쪽이 같았던 때의 해시(기준점) */
  base: Record<string, string>;
  lastSync: string | null;
}

const STATE = "sync.json";

export function conflictCopyPath(path: string, label: string, exists: (p: string) => boolean, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  for (let i = 1; ; i++) {
    const p = path.replace(/\.md$/i, ` (${label} ${stamp}${i > 1 ? ` ${i}` : ""}).md`);
    if (!exists(p)) return p;
  }
}

/** 연결 자체가 안 됨(오프라인·서버 꺼짐). 이때는 동기화를 멈추고 다음에 다시 한다. */
function isNetworkFailure(e: unknown): boolean {
  return e instanceof TypeError || e instanceof UnauthorizedError;
}

/**
 * 로컬 볼트 ↔ 서버 동기화. 문서마다 기준점 B(마지막으로 같았던 해시)와 로컬 L·서버 S를 비교한다.
 *
 *   L = S            → 같음. 기준점만 맞춘다.
 *   서버만 바뀜       → 받는다(서버에서 지웠으면 이 기기에서도 지운다).
 *   기기만 바뀜       → 보낸다(baseHash=B라 그 사이 서버가 바뀌었으면 409 → 아래 "둘 다 바뀜").
 *   둘 다 바뀜        → 기준점 내용으로 3방향 병합해 서로 다른 곳이면 합친 내용을 양쪽에 둔다.
 *                       같은 곳을 다르게 고쳤으면 원래 경로는 서버 버전, 이 기기 내용은 충돌 사본으로 새로 만들어 양쪽에 둔다.
 *                       한쪽이 지우고 다른 쪽이 고쳤으면 고친 쪽을 살린다.
 *
 * 공통 설정 파일(keyring-settings.md)만은 줄 대신 키 단위로 합친다(settingsMerge.ts): 충돌 사본을 만들지 않고,
 * 양쪽이 다르게 바꾼 키는 서버 값을 따른 뒤 settingsConflicts로 알린다. 처음 연결해 기준점이 없을 때도 같다.
 *
 * 마크다운은 양방향, 첨부는 서버 → 기기에 더해 기기에서 새로 만든 첨부(붙여넣은 이미지 등)는 올리고,
 * 기기에서 지운 첨부(폴더 이동으로 옮긴 원래 자리 포함)는 서버가 기준점 그대로일 때만 서버에서도 지운다.
 * 이미 있는 첨부를 기기에서 바꾼 것은 보내지 않는다. 어떤 경우에도 상대의 변경을 덮어쓰지 않는다.
 */
export class SyncEngine {
  private running: Promise<SyncReport> | null = null;

  constructor(
    private vault: LocalVault,
    private remote: RemoteVault,
  ) {}

  async state(): Promise<SyncState> {
    const raw = await this.vault.store.readMeta(STATE);
    if (raw) {
      try {
        const s = JSON.parse(raw) as SyncState;
        if (s.server === this.remote.id && s.base && typeof s.base === "object") return s;
      } catch {
        /* 새로 시작 */
      }
    }
    return { server: this.remote.id, base: {}, lastSync: null };
  }

  private async save(s: SyncState) {
    await this.vault.store.writeMeta(STATE, JSON.stringify(s));
  }

  /** 이미 도는 중이면 그 결과를 같이 기다린다. */
  run(): Promise<SyncReport> {
    this.running ??= this.runOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runOnce(): Promise<SyncReport> {
    const report: SyncReport = {
      startedAt: new Date().toISOString(),
      finishedAt: "",
      pulled: [],
      pushed: [],
      deletedLocal: [],
      deletedRemote: [],
      merged: [],
      conflicts: [],
      settingsConflicts: [],
      skipped: [],
      errors: [],
    };
    const state = await this.state();
    const base = state.base;
    const manifest = await this.remote.manifest();
    const local = await this.vault.snapshot();
    const server = new Map(manifest.map((f) => [f.path, f]));
    const paths = [...new Set([...local.keys(), ...server.keys(), ...Object.keys(base)])].sort();
    const taken = (p: string) => local.has(p) || server.has(p);

    /** 이 기기에 쓸 것(마지막에 한 번에, 그 사이 기기에서 바뀐 것은 건너뛴다) */
    const pulls: { path: string; data: Uint8Array | null; expect: string | null; base: string | null; merged?: true }[] = [];
    /** 양쪽이 이미 같아 기준점이 된 문서: 나중 병합의 기준 내용으로 남긴다 */
    const agreed: string[] = [];

    /** 공통 설정 파일: 키 단위로 합쳐 양쪽에 둔다. 한쪽 YAML이 깨져 있으면 다른 쪽을 따른다 */
    const mergeSettingsFile = async (path: string, L: string, B: string | null, mine: { content: string }, theirs: { content: string; hash: string }) => {
      const baseText = B ? await this.vault.contentByHash(B) : null;
      const l = settingsObject(mine.content);
      const s = settingsObject(theirs.content);
      let text: string;
      if (!s && !l) text = theirs.content;
      else if (!s) text = mine.content;
      else if (!l) text = theirs.content;
      else {
        const m = mergeSettingsObjects(baseText !== null ? settingsObject(baseText) : null, l, s);
        report.settingsConflicts.push(...m.conflicts);
        text = replaceSettingsObject(theirs.content, m.merged, vaultLanguage(parseVaultSettings(theirs.content)));
      }
      const res = text === theirs.content ? { hash: theirs.hash } : await this.remote.write(path, text, theirs.hash);
      pulls.push({ path, data: utf8(text), expect: L, base: res.hash, merged: true });
      report.merged.push(path);
    };

    const conflict = async (path: string, L: string, B: string | null) => {
      const mine = await this.vault.read(path);
      const theirs = await this.remote.read(path);
      if (isVaultSettingsPath(path)) {
        // 합치는 사이 서버가 또 바뀌면(409) 이번에는 건너뛰고 다음 동기화에서 다시 합친다(충돌 사본은 만들지 않는다)
        try {
          return await mergeSettingsFile(path, L, B, mine, theirs);
        } catch (e) {
          if (!(e instanceof ConflictError)) throw e;
          report.skipped.push({ path, reason: "settings-changed" });
          return;
        }
      }
      // 기준점 내용이 있으면 3방향 병합을 먼저 해 본다
      const baseText = B ? await this.vault.contentByHash(B) : null;
      if (baseText !== null) {
        const m = merge3(baseText, mine.content, theirs.content);
        if (m.ok) {
          try {
            const res = m.text === theirs.content ? { hash: theirs.hash } : await this.remote.write(path, m.text, theirs.hash);
            pulls.push({ path, data: utf8(m.text), expect: L, base: res.hash, merged: true });
            report.merged.push(path);
            return;
          } catch (e) {
            // 합치는 사이 서버가 또 바뀌었다 → 아래 충돌 사본으로
            if (!(e instanceof ConflictError)) throw e;
          }
        }
      }
      const copy = conflictCopyPath(path, this.vault.text().syncConflictCopy, taken);
      // 사본의 기준점은 이 기기에 실제로 만들어졌을 때만 남긴다(아니면 다음 동기화가 서버 사본을 받아 온다)
      const pushedCopy = await this.remote.write(copy, mine.content, null);
      pulls.push({ path: copy, data: utf8(mine.content), expect: null, base: pushedCopy.hash });
      pulls.push({ path, data: utf8(theirs.content), expect: L, base: theirs.hash });
      report.conflicts.push({ path, copy });
    };

    try {
      for (const path of paths) {
        const L = local.get(path)?.hash ?? null;
        const S = server.get(path)?.hash ?? null;
        const B = base[path] ?? null;
        try {
          if (L === S) {
            if (S === null) delete base[path];
            else {
              if (base[path] !== S && isMarkdown(path)) agreed.push(path);
              base[path] = S;
            }
            continue;
          }
          const localChanged = L !== B;
          const serverChanged = S !== B;

          if (!isMarkdown(path)) {
            // 첨부: 서버가 기준. 기기에서 새로 만든 첨부(서버에도 기준점에도 없음)만 올린다.
            if (L !== null && S === null && B === null && this.remote.putRaw) {
              const data = await this.vault.readBytes(path);
              try {
                base[path] = (await this.remote.putRaw(path, data)).hash;
                report.pushed.push(path);
              } catch (e) {
                if (!(e instanceof ConflictError)) throw e;
                report.skipped.push({ path, reason: "attachment-taken" });
              }
              continue;
            }
            // 이 기기에서 지운 첨부: 서버가 기준점 그대로면 서버에서도 지운다(옮긴 첨부의 원래 자리가 되살아나지 않게)
            if (L === null && S !== null && S === B && this.remote.removeRaw) {
              try {
                await this.remote.removeRaw(path, S);
                delete base[path];
                report.deletedRemote.push(path);
              } catch (e) {
                if (!(e instanceof ConflictError)) throw e;
                report.skipped.push({ path, reason: "attachment-changed" });
              }
              continue;
            }
            // 이 기기에서 바뀐 첨부는 보내지 않고 알린다.
            if (localChanged && L !== null) {
              report.skipped.push({ path, reason: "attachment-local" });
              continue;
            }
            pulls.push({ path, data: S === null ? null : await this.remote.readRaw(path), expect: L, base: S });
            continue;
          }

          if (!localChanged && serverChanged) {
            pulls.push({ path, data: S === null ? null : utf8((await this.remote.read(path)).content), expect: L, base: S });
            continue;
          }

          if (localChanged && !serverChanged) {
            try {
              if (L === null) {
                await this.remote.remove(path, B!);
                delete base[path];
                report.deletedRemote.push(path);
              } else {
                const doc = await this.vault.read(path);
                const res = await this.remote.write(path, doc.content, B);
                base[path] = res.hash;
                report.pushed.push(path);
              }
            } catch (e) {
              if (!(e instanceof ConflictError)) throw e;
              // 보내는 사이 서버가 바뀌었다
              const now = e.currentHash;
              if (now === null) {
                if (L !== null) {
                  const doc = await this.vault.read(path);
                  base[path] = (await this.remote.write(path, doc.content, null)).hash;
                  report.pushed.push(path);
                } else delete base[path];
              } else if (L === null) {
                pulls.push({ path, data: utf8((await this.remote.read(path)).content), expect: null, base: now });
              } else {
                await conflict(path, L, B);
              }
            }
            continue;
          }

          // 둘 다 바뀜
          if (L === null) {
            // 이 기기에서 지웠지만 서버에서 고쳤다 → 서버 것을 살린다
            pulls.push({ path, data: utf8((await this.remote.read(path)).content), expect: null, base: S });
          } else if (S === null) {
            // 서버에서 지웠지만 이 기기에서 고쳤다 → 이 기기 것을 다시 올린다
            const doc = await this.vault.read(path);
            base[path] = (await this.remote.write(path, doc.content, null)).hash;
            report.pushed.push(path);
          } else {
            await conflict(path, L, B);
          }
        } catch (e) {
          if (isNetworkFailure(e)) throw e;
          report.errors.push({ path, message: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      // 받은 것을 반영하고 기준점을 저장한다(중간에 끊겨도 한 것까지는 남긴다)
      if (agreed.length) await this.vault.preserve(agreed);
      if (pulls.length) {
        const apply = (list: typeof pulls, message: string) =>
          list.length ? this.vault.applySync(list.map(({ path, data, expect }) => ({ path, data, expect })), message) : Promise.resolve([]);
        const applied = new Set([
          ...(await apply(pulls.filter((p) => !p.merged), this.vault.text().commit.syncPulled)),
          ...(await apply(pulls.filter((p) => p.merged), this.vault.text().commit.syncMerged)),
        ]);
        for (const p of pulls) {
          if (!applied.has(p.path)) {
            report.skipped.push({ path: p.path, reason: "local-changed" });
            continue;
          }
          if (p.base === null) delete base[p.path];
          else base[p.path] = p.base;
          if (p.data === null) report.deletedLocal.push(p.path);
          else if (!p.merged && !report.conflicts.some((c) => c.copy === p.path)) report.pulled.push(p.path);
        }
      }
      state.lastSync = new Date().toISOString();
      await this.save(state);
    }
    report.finishedAt = new Date().toISOString();
    return report;
  }
}

/** 기기 토큰으로 서버 REST API를 쓰는 동기화 상대. */
export class HttpRemote implements RemoteVault {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private token: string,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {
    this.baseUrl = normalizeServerUrl(baseUrl);
  }

  get id(): string {
    return this.baseUrl;
  }

  private async req(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await this.fetchFn(this.baseUrl + path, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return res;
    const data = (await res.json().catch(() => ({}))) as RemoteErrorBody;
    const { code, params } = remoteError(res.status, data);
    if (res.status === 409) throw new ConflictError(data.currentHash ?? null, data.code ?? undefined, data.params);
    if (res.status === 401) throw new UnauthorizedError(data.code ?? undefined, data.params);
    if (res.status === 404) throw new NotFoundError(code, params);
    throw new KeyedError(code, params);
  }

  async manifest(): Promise<RemoteFile[]> {
    return ((await (await this.req("GET", "/api/sync/manifest")).json()) as { files: RemoteFile[] }).files;
  }

  async read(path: string) {
    return (await (await this.req("GET", `/api/file?path=${encodeURIComponent(path)}`)).json()) as { content: string; hash: string };
  }

  async readRaw(path: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.req("GET", `/api/raw?path=${encodeURIComponent(path)}`)).arrayBuffer());
  }

  async write(path: string, content: string, baseHash: string | null) {
    const res = (await (await this.req("PUT", "/api/file", { path, content, baseHash })).json()) as { hash?: string };
    // 검토 대기열 등으로 바로 반영되지 않는 응답에는 hash가 없을 수 있다
    return { hash: res.hash ?? (await sha256Hex(content)) };
  }

  async remove(path: string, baseHash: string): Promise<void> {
    await this.req("DELETE", "/api/file", { path, baseHash });
  }

  async removeRaw(path: string, baseHash: string): Promise<void> {
    await this.req("DELETE", "/api/file", { path, baseHash });
  }

  async putRaw(path: string, data: Uint8Array): Promise<{ hash: string }> {
    const res = await this.fetchFn(`${this.baseUrl}/api/attachment?path=${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/octet-stream", "x-keyring-upload": "1" },
      body: data as Uint8Array<ArrayBuffer>,
    });
    const body = (await res.json().catch(() => ({}))) as RemoteErrorBody & { hash?: string };
    if (res.status === 409) throw new ConflictError(body.currentHash ?? null, body.code ?? undefined, body.params);
    if (res.status === 401) throw new UnauthorizedError(body.code ?? undefined, body.params);
    if (!res.ok) {
      const { code, params } = remoteError(res.status, body);
      throw new KeyedError(code, params);
    }
    return { hash: body.hash ?? (await sha256Hex(data)) };
  }
}

export function normalizeServerUrl(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, "");
}

/** 비밀번호로 이 기기용 토큰을 받는다(토큰은 이때 한 번만 나온다). */
export async function pairDevice(
  serverUrl: string,
  password: string,
  device: string,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<{ token: string; device: string; server: string }> {
  const server = normalizeServerUrl(serverUrl);
  const res = await fetchFn(`${server}/api/auth/device`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password, name: device }),
  });
  const data = (await res.json().catch(() => ({}))) as RemoteErrorBody & { token?: string; name?: string };
  if (!res.ok || !data.token) {
    const { code, params } = remoteError(res.status, data);
    throw res.status === 401 ? new UnauthorizedError(code, params) : new KeyedError(code, params);
  }
  return { token: data.token, device: data.name ?? device, server };
}

