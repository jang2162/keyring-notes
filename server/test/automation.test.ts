import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Automation, nextRun, parseCron } from "../src/automation.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import type { Ingestor } from "../src/ingest.js";
import type { NoteIndex } from "../src/noteindex.js";
import { ReviewQueue } from "../src/review.js";
import { ScopedVault } from "../src/scoped.js";
import type { Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

interface Received {
  event: string;
  data: Record<string, any>;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let server: Server;
let base = "";
let received: Received[] = [];
/** 다음 요청들에 돌려줄 상태 코드(비면 200) */
let replies: number[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      received.push({ event: parsed.event, data: parsed.data, headers: req.headers, body });
      res.writeHead(replies.shift() ?? 200);
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let root: string;
let cleanup: () => Promise<void>;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let ingestor: Ingestor;
let config: ConfigStore;
let review: ReviewQueue;
let automation: Automation;
let owner: ScopedVault;
const SECRET = "s3cret-s3cret-s3cret";

beforeEach(async () => {
  received = [];
  replies = [];
  const t = await tempDir("keyring-auto-");
  root = t.dir;
  cleanup = t.cleanup;
  ({ vault, index, wiki, ingestor } = await openVault(path.join(root, "vault")));
  config = new ConfigStore(path.join(root, "config.json"));
  review = new ReviewQueue(vault, config);
  owner = new ScopedVault(vault, ownerPrincipal, index, wiki, review);
  automation = new Automation({ vault, wiki, config, lint: (folder) => owner.lint({ folder }), retryDelays: [10, 10, 10], docChangedQuietMs: 60 });
  vault.onChange(() => automation.onCommit());
  review.onCreate((p) => automation.emit("proposal.created", { id: p.id, agent: p.agent, topic: p.preview[0]?.path.split("/")[0], files: p.preview.map((f) => ({ path: f.path })) }));
  await owner.createTopic("경제");
  await owner.createTopic("업무");
  config.update((c) => {
    c.webhooks = [
      { id: "agent", name: "위키 에이전트", url: `${base}/hook`, secret: SECRET, events: ["raw.added", "proposal.created", "schedule"], topics: ["경제"], enabled: true },
      { id: "all", name: "전체 기록", url: `${base}/all`, secret: SECRET, events: ["doc.changed"], topics: [], enabled: true },
    ];
  });
});

afterEach(async () => {
  await automation.idle();
  index.close();
  await cleanup();
});

describe("cron", () => {
  it("5필드를 해석하고 다음 실행 시각을 구한다", () => {
    const at = (s: string) => new Date(s);
    expect(nextRun(parseCron("0 9 * * 1"), at("2026-10-05T09:00:00"))?.toString()).toBe(at("2026-10-12T09:00:00").toString()); // 월요일 9시
    expect(nextRun(parseCron("*/15 * * * *"), at("2026-10-05T10:07:30"))?.getMinutes()).toBe(15);
    expect(nextRun(parseCron("30 2 1 * *"), at("2026-10-05T00:00:00"))?.toString()).toBe(at("2026-11-01T02:30:00").toString());
    expect(nextRun(parseCron("0 0 * * 7"), at("2026-10-05T00:00:00"))?.getDay()).toBe(0); // 7도 일요일
    expect(nextRun(parseCron("0 8-18/5 * * 1-5"), at("2026-10-05T09:00:00"))?.getHours()).toBe(13);
    for (const bad of ["* * * *", "60 * * * *", "* 24 * * *", "a b c d e", "5-1 * * * *"]) expect(() => parseCron(bad), bad).toThrow();
  });
});

describe("이벤트 웹훅", () => {
  it("새 원본 수집 → raw.added(구독 토픽만), 모든 커밋 → doc.changed, 서명 확인", async () => {
    const r = await ingestor.ingest(owner, { kind: "text", topic: "경제", title: "기사", text: "본문" });
    await ingestor.ingest(owner, { kind: "text", topic: "업무", title: "다른 토픽", text: "본문" });
    await automation.idle();
    const raw = received.filter((x) => x.event === "raw.added");
    expect(raw).toHaveLength(1); // 업무 토픽은 구독 안 함
    expect(raw[0].data).toMatchObject({ topic: "경제", path: r.path, author: "me" });
    const changed = received.filter((x) => x.event === "doc.changed");
    expect(changed.flatMap((x) => x.data.files.map((f: { path: string }) => f.path))).toContain(r.path);
    for (const x of received) {
      expect(x.headers["x-keyring-signature"]).toBe("sha256=" + createHmac("sha256", SECRET).update(x.body).digest("hex"));
      expect(x.headers["x-keyring-event"]).toBe(x.event);
    }
  });

  it("doc.changed: 같은 문서의 잇단 저장은 조용해진 뒤 한 번만, raw.added는 바로", async () => {
    await automation.idle();
    received = [];
    automation.quietMs = 1500;
    let d = await owner.write("업무/메모.md", "1", null);
    for (let i = 2; i <= 5; i++) d = await owner.write("업무/메모.md", String(i), d.hash, { coalesce: true });
    // 아직 조용한 시간 전: 보낸 doc.changed 없음
    await new Promise((r) => setTimeout(r, 20));
    expect(received.filter((x) => x.event === "doc.changed")).toHaveLength(0);
    const raw = await ingestor.ingest(owner, { kind: "text", topic: "경제", title: "바로", text: "본문" });
    await new Promise((r) => setTimeout(r, 20));
    expect(received.filter((x) => x.event === "raw.added").map((x) => x.data.path)).toEqual([raw.path]);
    await automation.idle();
    const changed = received.filter((x) => x.event === "doc.changed");
    const memo = changed.filter((x) => x.data.files.some((f: { path: string }) => f.path === "업무/메모.md"));
    expect(memo).toHaveLength(1);
    expect(memo[0].data.files.find((f: { path: string }) => f.path === "업무/메모.md").status).toBe("A");
    // 조용해진 뒤 다시 고치면 새로 한 번
    received = [];
    await owner.write("업무/메모.md", "6", d.hash);
    await automation.idle();
    const again = received.filter((x) => x.event === "doc.changed");
    expect(again).toHaveLength(1);
    expect(again[0].data.files).toEqual([{ status: "M", path: "업무/메모.md" }]);
    expect(again[0].data.commits).toBe(1);
  });

  it("검토 대기열에 제안이 쌓이면 proposal.created", async () => {
    config.update((c) => {
      c.reviewPaths = ["경제/wiki"];
    });
    const agent = new ScopedVault(vault, agentPrincipal("wiki-work", { "경제/wiki": "delete" }), index, wiki, review);
    const res = await agent.write("경제/wiki/a.md", "# A\n", null);
    await automation.idle();
    const p = received.find((x) => x.event === "proposal.created");
    expect(p?.data).toMatchObject({ id: res.pending!.proposal, agent: "wiki-work", topic: "경제" });
  });

  it("5xx·연결 실패는 다시 보내고, 4xx는 바로 실패로 남긴다", async () => {
    replies = [500, 503, 200];
    automation.emit("ping", { n: 1 }, [config.get().webhooks[0]]);
    await automation.idle();
    expect(automation.deliveries[0]).toMatchObject({ status: "ok", attempts: 3, httpStatus: 200 });
    replies = [404];
    automation.emit("ping", { n: 2 }, [config.get().webhooks[0]]);
    await automation.idle();
    expect(automation.deliveries[0]).toMatchObject({ status: "failed", attempts: 1, error: "HTTP 404" });
    automation.emit("ping", {}, [{ ...config.get().webhooks[0], url: "http://127.0.0.1:1/x" }]);
    await automation.idle();
    expect(automation.deliveries[0]).toMatchObject({ status: "failed", attempts: 4 });
  });
});

describe("정기 작업", () => {
  it("cron 시각에 한 번만 돌고, 정리 점검 결과와 지시문을 함께 보낸다", async () => {
    await owner.batch([{ op: "write", path: "경제/wiki/고아.md", content: "# 고아\n", baseHash: null }]);
    await automation.idle();
    received = [];
    config.update((c) => {
      c.jobs = [
        { id: "weekly-lint", name: "주간 정리", cron: "0 9 * * 1", webhook: "agent", topic: "경제", lint: true, instructions: "SCHEMA의 정리 절차대로", enabled: true },
        { id: "off", name: "꺼짐", cron: "* * * * *", webhook: "agent", topic: null, lint: false, instructions: null, enabled: false },
      ];
    });
    const monday9 = new Date("2026-10-12T09:00:20");
    expect(automation.tick(new Date("2026-10-12T08:59:00")).map((j) => j.id)).toEqual([]);
    expect(automation.tick(monday9).map((j) => j.id)).toEqual(["weekly-lint"]);
    expect(automation.tick(new Date("2026-10-12T09:00:50"))).toEqual([]); // 같은 분에 두 번은 안 돈다
    await automation.idle();
    const s = received.filter((x) => x.event === "schedule");
    expect(s).toHaveLength(1);
    expect(s[0].data).toMatchObject({ job: { id: "weekly-lint" }, topic: "경제", instructions: "SCHEMA의 정리 절차대로" });
    expect(s[0].data.lint.counts.orphan).toBe(1);
    expect(automation.jobStatus(config.get().jobs[0]).lastResult).toMatch(/성공/);
  });

  it("관리 API: 웹훅 저장(secret 자동 생성·가림), 잘못된 cron 거부, 시험 전송, 지금 실행", async () => {
    config.setPassword("correct horse");
    const app = createApp({
      vault,
      index,
      config,
      wiki,
      ingestor,
      review,
      admin: { backups: new BackupService(vault, config, path.join(root, "backups"), () => wiki.resync()), automation },
    });
    const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const h = { "content-type": "application/json", cookie };
    let res = await app.request("/api/admin/automation/webhooks", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ webhooks: [...config.get().webhooks.map((w) => ({ ...w, secret: "" })), { id: "n8n", url: `${base}/n8n`, events: ["raw.added"] }] }),
    });
    const saved = await res.json();
    expect(saved.newSecrets.n8n).toHaveLength(32);
    expect(saved.webhooks.find((w: { id: string }) => w.id === "agent").secret).toBe("s3cr…");
    expect(config.get().webhooks.find((w) => w.id === "agent")!.secret).toBe(SECRET); // 비워 보내면 기존 값 유지
    res = await app.request("/api/admin/automation/webhooks", { method: "PUT", headers: h, body: JSON.stringify({ webhooks: [{ id: "x", url: "ftp://x", events: [] }] }) });
    expect(res.status).toBe(400);
    res = await app.request("/api/admin/automation/jobs", { method: "PUT", headers: h, body: JSON.stringify({ jobs: [{ id: "j", cron: "61 * * * *", webhook: "agent" }] }) });
    expect(res.status).toBe(400);
    res = await app.request("/api/admin/automation/jobs", { method: "PUT", headers: h, body: JSON.stringify({ jobs: [{ id: "j", cron: "0 3 * * *", webhook: "nope" }] }) });
    expect(res.status).toBe(400);
    res = await app.request("/api/admin/automation/jobs", { method: "PUT", headers: h, body: JSON.stringify({ jobs: [{ id: "daily", name: "매일", cron: "0 3 * * *", webhook: "agent", topic: "경제", lint: true }] }) });
    expect((await res.json()).jobs[0].next).toMatch(/T/);
    const ping = await (await app.request("/api/admin/automation/webhooks/n8n/test", { method: "POST", headers: h, body: "{}" })).json();
    expect(ping).toMatchObject({ event: "ping", status: "ok" });
    const run = await (await app.request("/api/admin/automation/jobs/daily/run", { method: "POST", headers: h, body: "{}" })).json();
    expect(run.delivery.status).toBe("ok");
    const all = await (await app.request("/api/admin/automation", { headers: { cookie } })).json();
    expect(all.deliveries.length).toBeGreaterThan(0);
    expect(all.events).toContain("raw.added");
  });
});
