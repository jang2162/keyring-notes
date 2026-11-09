import { conflictCopyPath, sha256Hex } from "@keyring-notes/core";

/**
 * keyring-widget 데이터 파일(state.file) 쓰기 — 설계 「데이터 파일(큰 상태)」, 계획 Task 4 의 규칙.
 *
 * 경로마다 writer 하나가 모아 쓰고 비운다. 위젯(핸들)은 writer 의 판(rev — 받아들인 쓰기마다 오른다)이 자기가 마지막으로
 * 읽었거나 받아들여진 판과 같을 때만 쓸 수 있다. 다른 판에서 시작한 쓰기는 원본 경로에 쓰지 않고 충돌 사본으로만 남긴다 —
 * 같은 그림을 두 칸·두 노트에서 열어도 한쪽이 다른 쪽 획을 조용히 덮어쓰지 않게(덮어쓰지 않음이 이 파일의 계약).
 * 주인 핸들은 두지 않는다: 사라진 위젯이 남긴 바이트는 그 뒤 read 한 위젯이 이어 쓴다(미리보기 다시 그리기·화면 밖 스크롤).
 */

export type DataFileErrorCode = "missing" | "conflict" | "exists" | "failed";

export class DataFileError extends Error {
  constructor(readonly code: DataFileErrorCode) {
    super(code);
    this.name = "DataFileError";
  }
}

export interface DataFileIO {
  /** 없으면 DataFileError("missing") */
  read(path: string): Promise<Uint8Array>;
  /** 409 → "conflict", 404 → "missing", 그 밖 → "failed" */
  replace(path: string, bytes: Uint8Array, baseHash: string): Promise<{ hash: string | null }>;
  /** 만든 경로. 이미 있으면 "exists" */
  create(path: string, bytes: Uint8Array): Promise<string>;
}

export interface DataFileStatus {
  saving: boolean;
  unsaved: boolean;
  stale: boolean;
  conflictCopy: string | null;
  error: "missing" | "failed" | null;
}

export interface DataFileHandle {
  read(): Promise<{ bytes: Uint8Array; hash: string }>;
  write(bytes: Uint8Array, baseHash: string): Promise<{ hash: string }>;
  onStatus(cb: (s: DataFileStatus) => void): () => void;
  onStale(cb: () => void): () => void;
  onSettled(cb: () => void): () => void;
  drain(): void;
  release(): void;
  /** 이 그림의 쓰지 않은 바이트·사본 대기를 지금 쓴다(위젯 포커스 아웃 — 자동 저장 켬일 때 호스트가 부른다). 남은 것이 없으면 true */
  flush(): Promise<boolean>;
}

export interface DataFileOptions {
  autosave(): boolean;
  delay(): number;
  conflictLabel(): string;
  /** 닫기 묻는 중(closeHold) — 타이머는 쓰지 않고 delay() 뒤로 다시 미룬다(Workspace 의 savesHeld 와 같은 규칙) */
  held(): boolean;
  now?(): Date;
  timers?: { set(fn: () => void, ms: number): unknown; clear(t: unknown): void };
}

/** 사라지는 iframe 이 이미 보낸 fileWrite 를 받는 창(mountFrame 이 쓴다) */
export const FRAME_DRAIN_MS = 1000;
/** read 가 drain 중인 핸들의 release 를 기다리는 상한. drain 창보다 조금 길게 — release 타이머가 늦어도 늦은 바이트가 먼저 받아들여지게 */
export const READ_DRAIN_WAIT_MS = FRAME_DRAIN_MS + 250;

const realTimers = { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>) };

interface Waiter {
  resolve(v: { hash: string }): void;
  reject(e: unknown): void;
}

interface Pending {
  bytes: Uint8Array;
  waiters: Waiter[];
  /** 이 바이트까지 쓴 핸들 — 내려앉은 해시를 issued 에 넣는다 */
  writers: Set<Handle>;
}

class Writer {
  head: string | null = null;
  rev = 0;
  latest: Pending | null = null;
  inflight: (Pending & { done: Promise<void> }) | null = null;
  copies: Uint8Array[] = [];
  /** 쓰지 않은 바이트·사본 대기를 만든 핸들의 노트 */
  contributors = new Set<string>();
  handles = new Set<Handle>();
  timer: unknown = null;
  /** head·rev 가 바뀔 때마다 오른다 — 늦게 끝난 read 가 그 사이 내려앉은 쓰기를 옛 바이트로 되돌리지 못하게 */
  gen = 0;
  error: "missing" | "failed" | null = null;
  conflictCopy: string | null = null;
  private drainWaiters = new Set<() => void>();
  private copying: Promise<void> | null = null;

  constructor(
    readonly path: string,
    readonly ext: string,
    public io: DataFileIO,
    public opts: DataFileOptions,
  ) {}

  get timers() {
    return this.opts.timers ?? realTimers;
  }

  hasUnsaved(): boolean {
    return this.latest !== null || this.inflight !== null || this.copies.length > 0;
  }

  relatesTo(owner: string): boolean {
    return this.contributors.has(owner) || [...this.handles].some((h) => h.owner === owner);
  }

  changed(): void {
    for (const h of this.handles) h.emitStatus();
    notifyChange();
    this.collect();
  }

  /** 핸들이 없고 남은 것이 없으면 표에서 지운다 */
  collect(): void {
    if (this.handles.size === 0 && !this.hasUnsaved() && writers.get(this.path) === this) {
      if (this.timer !== null) this.timers.clear(this.timer);
      writers.delete(this.path);
    }
  }

  settledIfIdle(): void {
    if (this.latest !== null || this.inflight !== null) return;
    for (const h of Array.from(this.handles)) h.fireSettled();
  }

  markOthersStale(except: Handle | null): void {
    for (const h of this.handles) if (h !== except) h.markStale();
  }

  schedule(): void {
    if (!this.opts.autosave()) return;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      if (this.opts.held()) return this.schedule();
      void this.pump();
    }, this.opts.delay());
  }

  cancelTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  /** latest 를 하나 쓴다. 쓰는 중이면 그 쓰기가 끝나기를 기다린다 */
  pump(): Promise<void> {
    if (this.inflight) return this.inflight.done;
    const job = this.latest;
    if (!job || this.head === null) return Promise.resolve();
    this.latest = null;
    const base = this.head;
    const done = this.io.replace(this.path, job.bytes, base).then(
      async (r) => {
        const hash = r.hash ?? (await sha256Hex(job.bytes));
        this.head = hash;
        this.gen++;
        this.inflight = null;
        this.error = null;
        for (const h of job.writers) h.issued.add(hash);
        for (const w of job.waiters) w.resolve({ hash });
        if (this.latest === null && this.copies.length === 0) this.contributors.clear();
        // 쓰는 중에 받은 것: 타이머가 이미 지났으면 바로 이어 쓴다
        if (this.latest && this.timer === null && this.opts.autosave()) void this.pump();
        this.settledIfIdle();
        this.changed();
      },
      async (e: unknown) => {
        const code = e instanceof DataFileError ? e.code : "failed";
        this.inflight = null;
        if (code === "conflict" || code === "missing") {
          // 덮어쓰지 않는다: 가장 새 바이트(쓰는 중에 이어 받은 것이 있으면 그것 — 같은 계보라 그 위에 그린 것)를 사본으로
          const newest = this.latest ?? job;
          this.latest = null;
          for (const w of [...job.waiters, ...(newest === job ? [] : newest.waiters)]) w.reject(new DataFileError(code));
          this.copies.push(newest.bytes);
          this.error = code === "missing" ? "missing" : null;
          this.rev++;
          this.gen++;
          this.markOthersStale(null);
          this.settledIfIdle();
          this.changed();
          await this.makeCopies();
        } else {
          // 네트워크·오프라인·5xx: 바이트를 지우지 않는다. 혼자 되풀이하지 않고 다음 쓰기·비우기 때 다시 쓴다
          if (this.latest) {
            this.latest.writers = new Set([...job.writers, ...this.latest.writers]);
          } else this.latest = { bytes: job.bytes, waiters: [], writers: job.writers };
          for (const w of job.waiters) w.reject(new DataFileError("failed"));
          this.error = "failed";
          this.changed();
        }
      },
    );
    this.inflight = { ...job, done };
    this.changed();
    return done;
  }

  /** 사본 대기를 만든다. exists 면 다음 이름, 그 밖의 실패는 남겨 다음 비우기 때 다시 */
  makeCopies(): Promise<void> {
    if (this.copying) return this.copying;
    this.copying = (async () => {
      while (this.copies.length > 0) {
        const bytes = this.copies[0]!;
        const tried = new Set<string>();
        let made: string | null = null;
        for (let i = 0; i < 50; i++) {
          const name = conflictCopyPath(this.path, this.opts.conflictLabel(), (p) => tried.has(p), this.opts.now?.() ?? new Date(), this.ext);
          try {
            made = await this.io.create(name, bytes);
            break;
          } catch (e) {
            if (e instanceof DataFileError && e.code === "exists") {
              tried.add(name);
              continue;
            }
            break;
          }
        }
        if (made === null) {
          // 남겨 다음 비우기 때 다시 — 원본 경로로는 보내지 않는다
          this.changed();
          break;
        }
        this.copies.shift();
        this.conflictCopy = made;
        if (!this.hasUnsaved()) this.contributors.clear();
        this.changed();
      }
    })().finally(() => (this.copying = null));
    return this.copying;
  }

  /** 지금 쓰지 않은 것과 사본 대기를 쓴다. 남은 것이 없으면 true */
  async flush(): Promise<boolean> {
    this.cancelTimer();
    let failedOnce = false;
    while (!failedOnce && (this.inflight || this.latest)) {
      const wasInflight = this.inflight !== null;
      await this.pump();
      if (!wasInflight && this.error === "failed" && this.latest) failedOnce = true;
    }
    await this.makeCopies();
    return !this.hasUnsaved();
  }

  waitForDrains(self: Handle): Promise<void> {
    const draining = () => [...this.handles].some((h) => h !== self && h.draining);
    if (!draining()) return Promise.resolve();
    return new Promise((resolve) => {
      let t: unknown = null;
      const finish = () => {
        this.drainWaiters.delete(check);
        if (t !== null) this.timers.clear(t);
        resolve();
      };
      const check = () => {
        if (!draining()) finish();
      };
      this.drainWaiters.add(check);
      t = this.timers.set(finish, READ_DRAIN_WAIT_MS);
    });
  }

  released(): void {
    for (const cb of Array.from(this.drainWaiters)) cb();
  }

  discard(owner: string): void {
    if (!this.contributors.has(owner) || !this.hasUnsaved()) return;
    // 계획 R4: 그 바이트를 만든 다른 노트가 있을 때만 남긴다. 열어만 둔 노트는 치지 않는다 — 그 칸은 stale(보기 전용)이라
    // 버린 획을 본 적이 없고, 남기면 사람이 버린 획이 그 노트의 비우기로 저장된다
    if ([...this.contributors].some((o) => o !== owner)) {
      this.contributors.delete(owner);
      return;
    }
    this.cancelTimer();
    if (this.latest) for (const w of this.latest.waiters) w.reject(new DataFileError("failed"));
    this.latest = null;
    this.copies = [];
    this.contributors.clear();
    this.error = null;
    // 버린 바이트 위에서 이어 쓰지 않게 모두 다시 읽힌다
    this.rev++;
    this.gen++;
    this.markOthersStale(null);
    this.settledIfIdle();
    this.changed();
  }
}

class Handle implements DataFileHandle {
  rev = -1;
  issued = new Set<string>();
  stale = false;
  draining = false;
  isReleased = false;
  private statusCbs = new Set<(s: DataFileStatus) => void>();
  private staleCbs = new Set<() => void>();
  private settledCbs = new Set<() => void>();

  constructor(
    private w: Writer,
    public owner: string,
  ) {}

  status(): DataFileStatus {
    const w = this.w;
    return {
      saving: w.inflight !== null,
      unsaved: w.latest !== null || w.copies.length > 0,
      stale: this.stale,
      conflictCopy: w.conflictCopy,
      error: w.error,
    };
  }

  emitStatus(): void {
    const s = this.status();
    for (const cb of this.statusCbs) cb(s);
  }

  markStale(): void {
    if (this.stale) return;
    this.stale = true;
    for (const cb of Array.from(this.staleCbs)) cb();
  }

  fireSettled(): void {
    for (const cb of Array.from(this.settledCbs)) cb();
  }

  async read(): Promise<{ bytes: Uint8Array; hash: string }> {
    const w = this.w;
    await w.waitForDrains(this);
    let bytes!: Uint8Array;
    let hash!: string;
    // 읽는 사이 받아들이거나 내려앉은 쓰기가 생기면(gen) 읽은 것을 버리고 writer 상태로 다시 정한다
    for (let attempt = 0; ; attempt++) {
      const pending = w.latest ?? w.inflight;
      if (pending && w.head !== null) {
        bytes = pending.bytes;
        hash = w.head;
        break;
      }
      const gen = w.gen;
      try {
        bytes = await w.io.read(w.path);
      } catch (e) {
        w.error = e instanceof DataFileError && e.code === "missing" ? "missing" : "failed";
        w.changed();
        throw e instanceof DataFileError ? e : new DataFileError("failed");
      }
      hash = await sha256Hex(bytes);
      const now = w.latest ?? w.inflight;
      if (now && w.head !== null) {
        bytes = now.bytes;
        hash = w.head;
        break;
      }
      if (w.gen === gen || attempt >= 4) {
        w.head = hash;
        w.gen++;
        break;
      }
    }
    if (w.error === "missing") w.error = null;
    this.rev = w.rev;
    this.issued = new Set([hash]);
    this.stale = false;
    this.emitStatus();
    return { bytes, hash };
  }

  write(bytes: Uint8Array, baseHash: string): Promise<{ hash: string }> {
    const w = this.w;
    if (this.isReleased || this.rev !== w.rev || !this.issued.has(baseHash)) {
      // 다른 판에서 시작한 쓰기 — 원본 경로에는 쓰지 않고 사본으로만(조용히 버리지 않는다).
      // 놓아 버린 뒤 writer 가 표에서 수거됐으면 표에 있는 writer(없으면 이 writer 를 다시 올려)에 맡겨야
      // 사본이 실패해도 unsavedDataFiles 에 보이고 다음 비우기 때 다시 시도된다
      const target = listedWriter(w);
      target.copies.push(bytes);
      target.contributors.add(this.owner);
      target.changed();
      return target.makeCopies().then(() => Promise.reject(new DataFileError("conflict")));
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      if (w.latest) {
        w.latest.bytes = bytes;
        w.latest.waiters.push(waiter);
        w.latest.writers.add(this);
      } else w.latest = { bytes, waiters: [waiter], writers: new Set([this]) };
      w.contributors.add(this.owner);
      w.rev++;
      this.rev = w.rev;
      w.markOthersStale(this);
      w.schedule();
      w.changed();
    });
  }

  onStatus(cb: (s: DataFileStatus) => void): () => void {
    this.statusCbs.add(cb);
    cb(this.status());
    return () => this.statusCbs.delete(cb);
  }

  onStale(cb: () => void): () => void {
    this.staleCbs.add(cb);
    return () => this.staleCbs.delete(cb);
  }

  onSettled(cb: () => void): () => void {
    this.settledCbs.add(cb);
    return () => this.settledCbs.delete(cb);
  }

  drain(): void {
    if (!this.isReleased) this.draining = true;
  }

  flush(): Promise<boolean> {
    return this.w.flush();
  }

  release(): void {
    if (this.isReleased) return;
    const w = this.w;
    this.isReleased = true;
    this.draining = false;
    w.handles.delete(this);
    this.statusCbs.clear();
    this.staleCbs.clear();
    this.settledCbs.clear();
    w.released();
    // 자동 저장 켬이면 바로 비운다. 끔이면 바이트를 남겨 다시 붙는 위젯이 읽게 한다
    if (w.opts.autosave() && w.latest) {
      w.cancelTimer();
      void w.pump();
    }
    w.collect();
  }
}

const writers = new Map<string, Writer>();
const changeListeners = new Set<() => void>();
let globalOptions: DataFileOptions | null = null;

function listedWriter(w: Writer): Writer {
  const cur = writers.get(w.path);
  if (cur) return cur;
  writers.set(w.path, w);
  return w;
}

function notifyChange(): void {
  // 부르는 중 구독을 끊어도 이번 차례는 그대로 돈다
  for (const cb of Array.from(changeListeners)) cb();
}

/** owner: 이 위젯이 든 노트 경로 — 탭 닫기·노트 바꾸기에서 그 노트의 그림만 비우려고 */
export function openDataFile(path: string, ext: string, owner: string, io: DataFileIO, opts: DataFileOptions): DataFileHandle {
  let w = writers.get(path);
  if (!w) {
    w = new Writer(path, ext, io, opts);
    writers.set(path, w);
  } else {
    w.io = io;
    w.opts = opts;
  }
  const h = new Handle(w, owner);
  w.handles.add(h);
  return h;
}

/** 쓰지 않은 것과 사본 대기를 지금(자동 저장 설정 무관). owner 를 주면 그 노트가 연 것만. 남은 것이 없으면 true */
export async function flushDataFiles(owner?: string): Promise<boolean> {
  const targets = [...writers.values()].filter((w) => owner === undefined || w.relatesTo(owner));
  const results = await Promise.all(targets.map((w) => w.flush()));
  return results.every(Boolean);
}

/** 그 노트의 쓰지 않은 바이트·사본 대기를 버린다. 같은 그림을 다른 노트도 열고 있으면 이 노트만 빼고 바이트는 남긴다 */
export function discardDataFiles(owner: string): void {
  // discard 가 표에서 writer 를 지울 수 있어 먼저 떠 둔다
  for (const w of Array.from(writers.values())) w.discard(owner);
}

/** 노트 이동·이름 바꾸기(폴더 이동이면 from 이 앞머리인 owner 모두) */
export function renameDataFileOwner(from: string, to: string): void {
  const map = (o: string) => (o === from ? to : o.startsWith(`${from}/`) ? to + o.slice(from.length) : o);
  for (const w of writers.values()) {
    w.contributors = new Set([...w.contributors].map(map));
    for (const h of w.handles) h.owner = map(h.owner);
  }
}

/** 쓰지 않은 바이트(쓰는 중 포함)나 사본 대기가 남은 경로 */
export function unsavedDataFiles(): string[] {
  return [...writers.values()].filter((w) => w.hasUnsaved()).map((w) => w.path);
}

/** unsavedDataFiles() 가 바뀔 수 있을 때마다 — useSyncExternalStore 용 */
export function onDataFilesChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

function randomHex4(): string {
  const b = crypto.getRandomValues(new Uint8Array(2));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** `<dir>/<stem>-<무작위 16진 4자리><ext>`. 같은 이름이 있으면 무작위를 바꿔 50번까지 */
export async function createDataFile(
  io: DataFileIO,
  dir: string,
  stem: string,
  ext: string,
  initial: Uint8Array,
  rand: () => string = randomHex4,
): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const path = `${dir ? `${dir}/` : ""}${stem}-${rand()}${ext}`;
    try {
      return await io.create(path, initial);
    } catch (e) {
      if (e instanceof DataFileError && e.code === "exists") continue;
      throw e;
    }
  }
  throw new DataFileError("exists");
}

/** 첨부 이름과 같은 글자 거르기(Workspace 의 uploadFiles) */
export function dataFileStem(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, " ").trim();
}

export function setDataFileOptions(o: DataFileOptions): void {
  globalOptions = o;
}

export function dataFileOptions(): DataFileOptions {
  return globalOptions ?? { autosave: () => true, delay: () => 1500, conflictLabel: () => "conflict copy", held: () => false };
}

export function resetDataFilesForTest(): void {
  for (const w of writers.values()) w.cancelTimer();
  writers.clear();
  changeListeners.clear();
  globalOptions = null;
}
