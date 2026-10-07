import { createHmac, randomBytes } from "node:crypto";
import { WEBHOOK_EVENTS, type ConfigStore, type JobConfig, type WebhookConfig } from "./config.js";
import type { LintReport } from "./scoped.js";
import type { Vault } from "./vault.js";
import type { Wiki } from "./wiki.js";

/**
 * 정기 작업 스케줄러와 이벤트 웹훅(W8).
 *
 * 이벤트
 *   raw.added         위키 토픽 raw/에 새 원본이 들어옴(수집·에이전트 쓰기·제안 승인 모두)
 *   doc.changed       문서 변경. 같은 문서는 마지막 저장 뒤 조용한 시간(기본 90초)이 지나면 한 번만 보낸다
 *                     (자동 저장이 몇 초마다 커밋을 합쳐도 웹훅이 몇 초마다 나가지 않게). 그때까지 쌓인 문서를 한 번에:
 *                     {rev·author·message(마지막 커밋), commits(묶인 커밋 수), files[{status, path}]}
 *   proposal.created  검토 대기열에 새 제안
 *   schedule          정기 작업 실행(선택: 정리 점검 결과 포함)
 *   ping              웹훅 시험
 *
 * 전송: POST JSON {event, id, time, data}, 헤더 X-Keyring-Event, X-Keyring-Delivery,
 * X-Keyring-Signature: sha256=<HMAC-SHA256(secret, body)>. 실패하면 1초·5초·25초 뒤 다시(최대 4번).
 */
export const EVENTS = WEBHOOK_EVENTS;
export type EventName = (typeof WEBHOOK_EVENTS)[number];

export interface Delivery {
  id: string;
  webhook: string;
  event: EventName;
  time: string;
  attempts: number;
  status: "pending" | "ok" | "failed";
  httpStatus?: number;
  error?: string;
}

// ── cron ──

interface CronField {
  values: Set<number>;
  any: boolean;
}

export interface Cron {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
}

function parseField(src: string, min: number, max: number, name: string): CronField {
  const values = new Set<number>();
  const any = src === "*" || src === "?";
  for (const part of src.split(",")) {
    const m = /^(\*|\?|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`cron ${name} 필드를 이해할 수 없습니다: ${part}`);
    let lo = min;
    let hi = max;
    if (m[1] !== "*" && m[1] !== "?") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a;
      hi = b ?? (m[2] ? max : a);
    }
    const step = m[2] ? Number(m[2]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) throw new Error(`cron ${name} 범위는 ${min}~${max}입니다: ${part}`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, any };
}

/** "분 시 일 월 요일" 5필드. *, 숫자, a-b, 목록(,), 간격(/n). 요일 0과 7은 일요일. */
export function parseCron(expr: string): Cron {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error("cron은 '분 시 일 월 요일' 5개 필드입니다(예: 0 9 * * 1)");
  const dow = parseField(f[4], 0, 7, "요일");
  if (dow.values.has(7)) dow.values.add(0);
  return {
    minute: parseField(f[0], 0, 59, "분"),
    hour: parseField(f[1], 0, 23, "시"),
    dom: parseField(f[2], 1, 31, "일"),
    month: parseField(f[3], 1, 12, "월"),
    dow,
  };
}

function cronMatches(c: Cron, d: Date): boolean {
  if (!c.minute.values.has(d.getMinutes()) || !c.hour.values.has(d.getHours()) || !c.month.values.has(d.getMonth() + 1)) return false;
  // 일·요일 둘 다 지정하면 둘 중 하나만 맞아도 된다(전통적인 cron 규칙)
  const domOk = c.dom.values.has(d.getDate());
  const dowOk = c.dow.values.has(d.getDay());
  if (c.dom.any && c.dow.any) return true;
  if (c.dom.any) return dowOk;
  if (c.dow.any) return domOk;
  return domOk || dowOk;
}

/** after 다음(같은 분 제외) 처음 맞는 시각. 1년 안에 없으면 null. 서버의 로컬 시간대(TZ) 기준. */
export function nextRun(c: Cron, after: Date): Date | null {
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatches(c, d)) return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

// ── 서비스 ──

export interface AutomationDeps {
  vault: Vault;
  wiki: Wiki;
  config: ConfigStore;
  /** 정기 작업의 정리 점검(소유자 권한). */
  lint: (folder?: string) => Promise<LintReport>;
  /** 시험용: 실제 fetch 대신 */
  fetchImpl?: typeof fetch;
  /** 시험용: 재시도 간격(ms) */
  retryDelays?: number[];
  /** doc.changed를 보내기 전 조용히 기다리는 시간(ms, 기본 90초). 0이면 커밋마다 바로 */
  docChangedQuietMs?: number;
}

interface PendingDoc {
  status: string;
  rev: string;
  author: string;
  message: string;
  /** 이 문서의 마지막 변경 시각 */
  at: number;
  /** 묶인 커밋 */
  revs: Set<string>;
}

export class Automation {
  readonly deliveries: Delivery[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastRun = new Map<string, string>();
  private lastResult = new Map<string, string>();
  private inflight = new Set<Promise<unknown>>();
  /** 아직 보내지 않은 doc.changed(문서별) */
  private pendingDocs = new Map<string, PendingDoc>();
  private docTimer: NodeJS.Timeout | null = null;

  constructor(private deps: AutomationDeps) {}

  /** doc.changed 조용한 시간(ms) */
  get quietMs() {
    return this.deps.docChangedQuietMs ?? 90_000;
  }
  set quietMs(ms: number) {
    this.deps.docChangedQuietMs = ms;
  }

  /** 진행 중인 전송과 묶어 둔 doc.changed가 모두 나갈 때까지(시험·종료용). */
  async idle(): Promise<void> {
    while (this.inflight.size || this.pendingDocs.size) {
      if (this.inflight.size) await Promise.allSettled([...this.inflight]);
      else await new Promise((r) => setTimeout(r, Math.min(50, this.quietMs + 5)));
    }
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
    return p;
  }

  /** 이벤트를 구독 중인 웹훅들로 보낸다(기다리지 않음). */
  emit(event: EventName, data: Record<string, unknown>, only?: WebhookConfig[]): void {
    const hooks = only ?? this.deps.config.get().webhooks.filter((w) => w.enabled && w.events.includes(event) && this.topicMatches(w, data));
    for (const w of hooks) void this.track(this.deliver(w, event, data));
  }

  private topicMatches(w: WebhookConfig, data: Record<string, unknown>): boolean {
    if (!w.topics || w.topics.length === 0) return true;
    // 토픽(워크스페이스/이름) 또는 워크스페이스·노드 경로: 이벤트의 토픽이 같거나 파일이 그 노드 안이면
    const files = ((data.files as { path: string }[] | undefined) ?? []).map((f) => f.path);
    const topic = typeof data.topic === "string" ? data.topic : null;
    return w.topics.some((t) => topic === t || (topic !== null && topic.startsWith(t + "/")) || files.some((p) => p === `${t}.md` || p.startsWith(t + "/")));
  }

  private async deliver(w: WebhookConfig, event: EventName, data: Record<string, unknown>): Promise<Delivery> {
    const id = randomBytes(8).toString("hex");
    const body = JSON.stringify({ event, id, time: new Date().toISOString(), data });
    const signature = "sha256=" + createHmac("sha256", w.secret).update(body).digest("hex");
    const d: Delivery = { id, webhook: w.id, event, time: new Date().toISOString(), attempts: 0, status: "pending" };
    this.deliveries.unshift(d);
    this.deliveries.splice(100);
    const delays = this.deps.retryDelays ?? [1000, 5000, 25000];
    const doFetch = this.deps.fetchImpl ?? fetch;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      d.attempts = attempt + 1;
      try {
        const res = await doFetch(w.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "keyring-notes-webhook",
            "x-keyring-event": event,
            "x-keyring-delivery": id,
            "x-keyring-signature": signature,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        d.httpStatus = res.status;
        if (res.ok) {
          d.status = "ok";
          delete d.error;
          return d;
        }
        d.error = `HTTP ${res.status}`;
        // 4xx(429 제외)는 다시 보내도 같다
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
      } catch (e) {
        d.error = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
      }
      if (attempt < delays.length) await new Promise((r) => setTimeout(r, delays[attempt]));
    }
    d.status = "failed";
    return d;
  }

  /** Vault.onChange에서 부른다: 방금 커밋의 파일 상태로 doc.changed·raw.added를 만든다. */
  async onCommit(): Promise<void> {
    const hooks = this.deps.config.get().webhooks.filter((w) => w.enabled);
    if (hooks.length === 0) return;
    const head = await this.deps.vault.git.head();
    if (!head) return;
    const out = await this.deps.vault.git.raw(["show", "--no-renames", "--name-status", "--format=%H%x1f%an%x1f%s", "HEAD"]);
    const [meta, ...lines] = out.stdout.trim().split("\n").filter(Boolean);
    const [rev, author, message] = meta.split("\x1f");
    const files = lines.map((l) => {
      const [status, p] = l.split("\t");
      return { status: status[0], path: p };
    });
    if (hooks.some((w) => w.events.includes("doc.changed"))) this.queueDocChanged(rev, author, message, files);
    for (const f of files) {
      if (f.status !== "A" || !f.path.endsWith(".md")) continue;
      const topic = this.deps.wiki.topicOf(f.path);
      if (topic && f.path.startsWith(`${topic}/raw/`) && !f.path.startsWith(`${topic}/raw/assets/`)) {
        this.emit("raw.added", { topic, path: f.path, rev, author, message });
      }
    }
  }

  /** doc.changed 묶기: 문서마다 마지막 변경 시각을 두고, 조용한 시간이 지난 문서들을 한 번에 보낸다 */
  private queueDocChanged(rev: string, author: string, message: string, files: { status: string; path: string }[]) {
    if (this.quietMs <= 0) {
      this.emit("doc.changed", { rev, author, message, commits: 1, files });
      return;
    }
    const now = Date.now();
    for (const f of files) {
      const prev = this.pendingDocs.get(f.path);
      // 상태 합치기: 새로 만든 뒤 고치면 A, 만들고 지우면 보낼 것 없음, 지운 뒤 다시 만들면 M
      let status = f.status;
      if (prev?.status === "A" && f.status === "M") status = "A";
      else if (prev?.status === "D" && f.status === "A") status = "M";
      if (prev?.status === "A" && f.status === "D") {
        this.pendingDocs.delete(f.path);
        continue;
      }
      this.pendingDocs.set(f.path, { status, rev, author, message, at: now, revs: new Set([...(prev?.revs ?? []), rev]) });
    }
    this.scheduleDocs();
  }

  private scheduleDocs() {
    if (this.docTimer) clearTimeout(this.docTimer);
    this.docTimer = null;
    if (this.pendingDocs.size === 0) return;
    const earliest = Math.min(...[...this.pendingDocs.values()].map((p) => p.at));
    this.docTimer = setTimeout(() => this.flushDocs(), Math.max(0, earliest + this.quietMs - Date.now()));
    this.docTimer.unref();
  }

  /** 조용한 시간이 지난 문서(force면 모두)를 doc.changed 하나로 보낸다 */
  flushDocs(force = false): void {
    const now = Date.now();
    const due = [...this.pendingDocs].filter(([, p]) => force || p.at + this.quietMs <= now);
    if (due.length) {
      for (const [path] of due) this.pendingDocs.delete(path);
      const last = due.map(([, p]) => p).sort((a, b) => a.at - b.at).at(-1)!;
      this.emit("doc.changed", {
        rev: last.rev,
        author: last.author,
        message: last.message,
        commits: new Set(due.flatMap(([, p]) => [...p.revs])).size,
        files: due.map(([path, p]) => ({ status: p.status, path })).sort((a, b) => a.path.localeCompare(b.path)),
      });
    }
    this.scheduleDocs();
  }

  // ── 정기 작업 ──

  jobStatus(job: JobConfig) {
    let next: string | null = null;
    let error: string | undefined;
    try {
      next = job.enabled ? (nextRun(parseCron(job.cron), new Date())?.toISOString() ?? null) : null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    return { ...job, next, lastRun: this.lastRun.get(job.id) ?? null, lastResult: this.lastResult.get(job.id) ?? null, error };
  }

  /** at: 실행 시각으로 기록할 때(스케줄러가 판단한 분). 같은 분에 두 번 돌지 않게 한다. */
  async runJob(job: JobConfig, at = new Date()): Promise<Delivery | null> {
    const w = this.deps.config.get().webhooks.find((x) => x.id === job.webhook);
    this.lastRun.set(job.id, at.toISOString());
    if (!w || !w.enabled) {
      this.lastResult.set(job.id, "웹훅이 없거나 꺼져 있음");
      return null;
    }
    const data: Record<string, unknown> = { job: { id: job.id, name: job.name, cron: job.cron }, topic: job.topic ?? null, instructions: job.instructions ?? null };
    if (job.lint) {
      const report = await this.deps.lint(job.topic ?? undefined);
      data.lint = { counts: report.counts, issues: report.issues.slice(0, 200), total: report.issues.length };
    }
    const d = await this.track(this.deliver(w, "schedule", data));
    this.lastResult.set(job.id, d.status === "ok" ? `전송 성공(HTTP ${d.httpStatus})` : `전송 실패: ${d.error}`);
    return d;
  }

  /** 1분마다 지금 시각(분)에 맞는 작업을 실행한다. */
  tick(now = new Date()): JobConfig[] {
    const due: JobConfig[] = [];
    const minuteKey = new Date(now);
    minuteKey.setSeconds(0, 0);
    for (const job of this.deps.config.get().jobs) {
      if (!job.enabled) continue;
      let cron: Cron;
      try {
        cron = parseCron(job.cron);
      } catch {
        continue;
      }
      const last = this.lastRun.get(job.id);
      if (cronMatches(cron, minuteKey) && (!last || Date.parse(last) < minuteKey.getTime())) {
        due.push(job);
        void this.track(this.runJob(job, now).catch((e) => this.lastResult.set(job.id, `실패: ${e instanceof Error ? e.message : e}`)));
      }
    }
    return due;
  }

  start() {
    this.stop();
    const schedule = () => {
      // 다음 분 시작 직후에 맞춘다
      const ms = 60_000 - (Date.now() % 60_000) + 200;
      this.timer = setTimeout(() => {
        this.tick();
        schedule();
      }, ms);
      this.timer.unref();
    };
    schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
