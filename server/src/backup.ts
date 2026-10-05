import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import type { ConfigStore } from "./config.js";
import { PathError } from "./paths.js";
import { NotFoundError, type Vault } from "./vault.js";
import { APP_VERSION } from "./version.js";

/**
 * 백업 = 하나의 .tar.gz:
 *   manifest.json   형식·앱 버전·만든 시각·HEAD·커밋 수
 *   vault.bundle    `git bundle --all`: 볼트의 모든 파일(첨부 포함)과 전체 이력
 *   config.json     (선택) 비밀번호 해시·세션 키·에이전트 토큰 해시·권한 표·백업 설정
 *
 * 볼트의 원본은 Git에 모두 커밋되어 있으므로(서버 밖 변경도 백업 직전에 커밋) 번들 하나로 충분하다.
 * 검색 인덱스·위키 index/log는 다시 만들 수 있어 넣지 않는다.
 */
export type BackupKind = "auto" | "manual" | "pre-restore";

export interface BackupInfo {
  name: string;
  kind: BackupKind;
  size: number;
  createdAt: string;
  head: string | null;
  commits: number;
  includesConfig: boolean;
  appVersion: string;
}

interface Manifest {
  format: "keyring-backup";
  version: 1;
  appVersion: string;
  kind: BackupKind;
  createdAt: string;
  head: string;
  commits: number;
  includesConfig: boolean;
}

const NAME_RE = /^keyring-(\d{8}-\d{6})-(auto|manual|pre-restore)(?:-\d+)?\.tar\.gz$/;

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface RestoreResult {
  restoredHead: string;
  previousHead: string | null;
  /** 복원 전 상태를 가리키는 Git ref. 되돌리려면 이 백업(또는 ref)으로 다시 복원한다. */
  previousRef: string | null;
  preRestoreBackup: string | null;
  configRestored: boolean;
}

export class BackupService {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> = Promise.resolve();
  lastError: string | null = null;

  constructor(
    private vault: Vault,
    private config: ConfigStore,
    readonly dir: string,
    /** 복원 뒤 위키·인덱스를 다시 맞추는 콜백(서버 시작 때와 같은 순서). */
    private afterRestore: () => Promise<void>,
  ) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.running.then(fn, fn);
    this.running = next.catch(() => undefined);
    return next;
  }

  private async ensureDir() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  async list(): Promise<BackupInfo[]> {
    await this.ensureDir();
    const out: BackupInfo[] = [];
    for (const name of await readdir(this.dir)) {
      if (!NAME_RE.test(name)) continue;
      try {
        const m = await this.readManifest(path.join(this.dir, name));
        const st = await stat(path.join(this.dir, name));
        out.push({
          name,
          kind: m.kind,
          size: st.size,
          createdAt: m.createdAt,
          head: m.head,
          commits: m.commits,
          includesConfig: m.includesConfig,
          appVersion: m.appVersion,
        });
      } catch {
        // 깨진 파일은 목록에서 뺀다
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** 이름 검증 후 백업 파일의 절대 경로. */
  async file(name: string): Promise<string> {
    if (!NAME_RE.test(name)) throw new PathError("백업 이름이 잘못되었습니다");
    const p = path.join(this.dir, name);
    await stat(p).catch(() => {
      throw new NotFoundError(`백업이 없습니다: ${name}`);
    });
    return p;
  }

  stream(file: string) {
    return createReadStream(file);
  }

  async remove(name: string): Promise<void> {
    await rm(await this.file(name));
  }

  create(kind: BackupKind, opts: { includeConfig?: boolean } = {}): Promise<BackupInfo> {
    return this.serial(() => this.createNow(kind, opts));
  }

  private async createNow(kind: BackupKind, opts: { includeConfig?: boolean }): Promise<BackupInfo> {
    await this.ensureDir();
    await this.vault.absorbOutsideChanges();
    const head = await this.vault.git.head();
    if (!head) throw new PathError("아직 백업할 커밋이 없습니다");
    const includesConfig = opts.includeConfig ?? this.config.get().backup.includeConfig;
    const stage = await mkdtemp(path.join(os.tmpdir(), "keyring-backup-"));
    try {
      await this.vault.git.raw(["bundle", "create", "--quiet", path.join(stage, "vault.bundle"), "--all"]);
      const commits = Number((await this.vault.git.raw(["rev-list", "--count", "HEAD"])).stdout.trim());
      const manifest: Manifest = {
        format: "keyring-backup",
        version: 1,
        appVersion: APP_VERSION,
        kind,
        createdAt: new Date().toISOString(),
        head,
        commits,
        includesConfig,
      };
      await writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));
      const entries = ["manifest.json", "vault.bundle"];
      if (includesConfig) {
        await writeFile(path.join(stage, "config.json"), JSON.stringify(this.config.get(), null, 2), { mode: 0o600 });
        entries.push("config.json");
      }
      let name = `keyring-${stamp()}-${kind}.tar.gz`;
      for (let i = 2; await stat(path.join(this.dir, name)).then(() => true, () => false); i++) {
        name = `keyring-${stamp()}-${kind}-${i}.tar.gz`;
      }
      const target = path.join(this.dir, name);
      await tar.create({ gzip: true, file: target, cwd: stage, portable: true }, entries);
      await chmod(target, 0o600);
      const st = await stat(target);
      return { name, kind, size: st.size, createdAt: manifest.createdAt, head, commits, includesConfig, appVersion: APP_VERSION };
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }

  private async readManifest(file: string): Promise<Manifest> {
    let raw = "";
    await tar.list({
      file,
      filter: (p) => p === "manifest.json",
      onReadEntry: (entry) => {
        entry.on("data", (c: Buffer) => (raw += c.toString("utf8")));
      },
    });
    const m = JSON.parse(raw) as Manifest;
    if (m.format !== "keyring-backup" || m.version !== 1) throw new Error("백업 형식이 아닙니다");
    return m;
  }

  /** 업로드된 파일을 백업 폴더로 옮겨 넣는다(검증 후). */
  async importFile(tmpFile: string): Promise<BackupInfo> {
    let m: Manifest;
    try {
      m = await this.readManifest(tmpFile);
    } catch {
      throw new PathError("Keyring 백업 파일(.tar.gz)이 아닙니다");
    }
    await this.ensureDir();
    const name = `keyring-${stamp(new Date(m.createdAt))}-${m.kind}.tar.gz`;
    const target = path.join(this.dir, (await stat(path.join(this.dir, name)).then(() => true, () => false)) ? name.replace(".tar.gz", `-${Date.now() % 100000}.tar.gz`) : name);
    await copyFile(tmpFile, target);
    await chmod(target, 0o600);
    return (await this.list()).find((b) => b.name === path.basename(target))!;
  }

  /**
   * 백업으로 되돌린다. 먼저 현재 상태를 "pre-restore" 백업으로 남기고, 현재 HEAD를
   * refs/keyring/before-restore-<시각>에 보관한 뒤, 볼트 파일과 이력을 백업 시점으로 바꾼다.
   */
  restore(name: string, opts: { restoreConfig?: boolean } = {}): Promise<RestoreResult> {
    return this.serial(async () => {
      const file = await this.file(name);
      const manifest = await this.readManifest(file);
      const stage = await mkdtemp(path.join(os.tmpdir(), "keyring-restore-"));
      try {
        await tar.extract({ file, cwd: stage, strict: true, filter: (p) => ["manifest.json", "vault.bundle", "config.json"].includes(p) });
        const bundle = path.join(stage, "vault.bundle");
        const hasHead = (await this.vault.git.head()) !== null;
        // 번들 검사: 저장소가 비어 있으면 verify가 실패하므로 list-heads로 대신한다
        const check = await this.vault.git.raw(hasHead ? ["bundle", "verify", "--quiet", bundle] : ["bundle", "list-heads", bundle], true);
        if (check.code !== 0) throw new PathError("백업의 Git 번들이 손상되었습니다");

        const pre = hasHead ? await this.createNow("pre-restore", { includeConfig: true }) : null;
        const result = await this.vault.maintenance(async () => {
          const previousHead = await this.vault.git.head();
          const previousRef = previousHead ? `refs/keyring/before-restore-${stamp()}` : null;
          if (previousRef) await this.vault.git.raw(["update-ref", previousRef, previousHead!]);
          await this.vault.git.raw(["fetch", "--quiet", "--no-tags", bundle, "+refs/heads/*:refs/keyring/restored/*"]);
          await this.vault.git.raw(["update-ref", "refs/keyring/restored-head", manifest.head]);
          // 볼트 파일을 백업 시점과 같게: 추적 파일은 덮어쓰고, 그 뒤에 생긴(추적되던) 파일은 지운다.
          // 무시 목록(.keyring 인덱스, 위키 index·log)은 건드리지 않는다.
          await this.vault.git.raw(["reset", "--quiet", "--hard", manifest.head]);
          await this.vault.git.raw(["clean", "-fdq"]);
          return { previousHead, previousRef };
        });
        let configRestored = false;
        if (opts.restoreConfig && manifest.includesConfig) {
          this.config.replaceAll(JSON.parse(await readFile(path.join(stage, "config.json"), "utf8")));
          configRestored = true;
        }
        await this.afterRestore();
        return {
          restoredHead: manifest.head,
          previousHead: result.previousHead,
          previousRef: result.previousRef,
          preRestoreBackup: pre?.name ?? null,
          configRestored,
        };
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    });
  }

  /** 오래된 자동 백업 정리(수동·복원 전 백업은 남긴다). */
  async prune(): Promise<string[]> {
    const keep = this.config.get().backup.keep;
    const autos = (await this.list()).filter((b) => b.kind === "auto");
    const removed: string[] = [];
    for (const b of autos.slice(keep)) {
      await rm(path.join(this.dir, b.name), { force: true });
      removed.push(b.name);
    }
    return removed;
  }

  /** 자동 백업이 필요하면 만든다: 간격이 지났고, 마지막 자동 백업 뒤 HEAD가 바뀌었을 때. */
  async runScheduled(now = Date.now()): Promise<BackupInfo | null> {
    const settings = this.config.get().backup;
    if (!settings.enabled) return null;
    try {
      const last = (await this.list()).find((b) => b.kind === "auto");
      if (last && now - Date.parse(last.createdAt) < settings.intervalHours * 3600_000) return null;
      await this.vault.absorbOutsideChanges();
      const head = await this.vault.git.head();
      if (!head || (last && last.head === head)) return null;
      const info = await this.create("auto");
      await this.prune();
      this.lastError = null;
      return info;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.error("자동 백업 실패:", this.lastError);
      return null;
    }
  }

  /** 다음 자동 백업 예정 시각(대략). */
  async nextScheduled(): Promise<string | null> {
    const settings = this.config.get().backup;
    if (!settings.enabled) return null;
    const last = (await this.list()).find((b) => b.kind === "auto");
    return new Date(last ? Date.parse(last.createdAt) + settings.intervalHours * 3600_000 : Date.now()).toISOString();
  }

  start(checkEveryMs = 15 * 60_000) {
    this.stop();
    void this.runScheduled();
    this.timer = setInterval(() => void this.runScheduled(), checkEveryMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
