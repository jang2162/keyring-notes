import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import type { Ingestor } from "../src/ingest.js";
import type { NoteIndex } from "../src/noteindex.js";
import { ReviewQueue } from "../src/review.js";
import { ScopedVault } from "../src/scoped.js";
import type { Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let ingestor: Ingestor;
let config: ConfigStore;
let review: ReviewQueue;
let owner: ScopedVault;
let agent: ScopedVault;
const RULES = { "업무/경제/raw": "append", "업무/경제/wiki": "delete", 메모: "write" } as const;

beforeEach(async () => {
  const t = await tempDir("keyring-review-");
  root = t.dir;
  cleanup = t.cleanup;
  ({ vault, index, wiki, ingestor } = await openVault(path.join(root, "vault")));
  config = new ConfigStore(path.join(root, "config.json"));
  config.update((c) => {
    c.reviewPaths = ["업무/경제/wiki", "업무/경제/raw/"];
  });
  review = new ReviewQueue(vault, config);
  owner = new ScopedVault(vault, ownerPrincipal, index, wiki, review);
  agent = new ScopedVault(vault, agentPrincipal("wiki-work", { ...RULES }), index, wiki, review);
  await owner.createTopic("업무/경제");
  await owner.batch([{ op: "write", path: "업무/경제/wiki/금리.md", content: "# 금리\n원래 설명\n", baseHash: null }]);
});

afterEach(async () => {
  index.close();
  await cleanup();
});

const git = (...args: string[]) =>
  execFileSync("git", ["--git-dir", path.join(vault.root, ".history"), "--work-tree", vault.root, "-c", "core.quotePath=false", ...args], { encoding: "utf8" }).trim();

describe("변경 검토 대기열", () => {
  it("검토 대상 경로에 에이전트가 쓰면 바로 반영하지 않고 제안으로 쌓는다", async () => {
    const before = git("rev-parse", "HEAD");
    const cur = await owner.read("업무/경제/wiki/금리.md");
    const r = await agent.write("업무/경제/wiki/금리.md", "# 금리\n에이전트가 고친 설명\n", cur.hash);
    expect(r.pending?.proposal).toMatch(/^[0-9a-f]{16}$/);
    expect(r.rev).toBeNull();
    expect(r.content).toContain("에이전트가 고친"); // 승인 뒤 모습
    expect((await owner.read("업무/경제/wiki/금리.md")).content).toBe("# 금리\n원래 설명\n");
    expect(git("rev-parse", "HEAD")).toBe(before);

    const list = await review.list({ status: "pending" });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ agent: "wiki-work", stale: false, files: [{ path: "업무/경제/wiki/금리.md", change: "modify", binary: false }] });
    const full = await review.get(list[0].id);
    expect(full.preview[0]).toMatchObject({ before: "# 금리\n원래 설명\n", after: "# 금리\n에이전트가 고친 설명\n" });
  });

  it("승인하면 에이전트 이름으로 커밋하고 승인자를 남긴다", async () => {
    const cur = await owner.read("업무/경제/wiki/금리.md");
    const res = await agent.batch(
      [
        { op: "write", path: "업무/경제/wiki/금리.md", content: "# 금리\n고침\n", baseHash: cur.hash },
        { op: "write", path: "업무/경제/wiki/환율.md", content: "# 환율\n", baseHash: null },
      ],
      "수집: 기사",
    );
    const p = await review.approve(res.pending!.proposal, "me");
    expect(p.status).toBe("approved");
    expect(git("log", "-1", "--format=%an|%s")).toBe("wiki-work|수집: 기사");
    expect(git("log", "-1", "--format=%b")).toContain(`승인: me (제안 ${p.id})`);
    expect((await owner.read("업무/경제/wiki/환율.md")).content).toBe("# 환율\n");
    expect((await owner.search("고침")).map((h) => h.path)).toContain("업무/경제/wiki/금리.md"); // 인덱스도 갱신
    expect((await agent.myProposals()).map((x) => x.status)).toEqual(["approved"]);
    await expect(review.approve(p.id, "me")).rejects.toThrow(/이미 처리/);
  });

  it("그 사이 문서가 바뀌면 stale로 표시되고, 승인은 충돌로 거부된다", async () => {
    const cur = await owner.read("업무/경제/wiki/금리.md");
    const res = await agent.write("업무/경제/wiki/금리.md", "# 금리\n에이전트\n", cur.hash);
    await owner.write("업무/경제/wiki/금리.md", "# 금리\n사람이 먼저 고침\n", cur.hash);
    expect((await review.list())[0].stale).toBe(true);
    await expect(review.approve(res.pending!.proposal, "me")).rejects.toThrow(/먼저 수정/);
    expect((await review.get(res.pending!.proposal)).status).toBe("pending");
    const rejected = await review.reject(res.pending!.proposal, "me", "사람 수정과 충돌");
    expect(rejected).toMatchObject({ status: "rejected", reason: "사람 수정과 충돌" });
    expect((await owner.read("업무/경제/wiki/금리.md")).content).toBe("# 금리\n사람이 먼저 고침\n");
  });

  it("권한·충돌은 제안을 만들 때 이미 검사한다", async () => {
    const cur = await owner.read("업무/경제/wiki/금리.md");
    await expect(agent.write("업무/경제/wiki/금리.md", "x", "0".repeat(64))).rejects.toThrow(/먼저 수정/);
    await expect(agent.write("업무/경제/SCHEMA.md", "x", (await owner.read("업무/경제/SCHEMA.md")).hash)).rejects.toThrow(/권한/);
    const raw = await ingestor.ingest(owner, { kind: "text", topic: "업무/경제", title: "원본", text: "본문" });
    const rawDoc = await owner.read(raw.path);
    await expect(agent.write(raw.path, "왜곡", rawDoc.hash)).rejects.toThrow(/추가 전용/);
    expect(await review.list()).toEqual([]);
    expect(cur.hash).toBeTruthy();
  });

  it("검토 대상이 아닌 경로·소유자 쓰기는 바로 반영된다", async () => {
    const r = await agent.write("메모/a.md", "바로", null);
    expect(r.pending).toBeUndefined();
    expect(r.rev).toBeTruthy();
    const cur = await owner.read("업무/경제/wiki/금리.md");
    expect((await owner.write("업무/경제/wiki/금리.md", "# 사람\n", cur.hash)).pending).toBeUndefined();
  });

  it("첨부 파일이 든 수집도 제안으로 쌓였다가 승인 때 파일까지 쓴다", async () => {
    const r = await ingestor.ingest(agent, { kind: "file", topic: "업무/경제", filename: "그림.png", data: new Uint8Array([9, 8, 7]) });
    expect(r.rev).toBeNull();
    const [p] = await review.list({ status: "pending" });
    expect(p.files.map((f) => f.change).sort()).toEqual(["add", "add"]);
    await expect(readFile(path.join(vault.root, r.asset!))).rejects.toThrow();
    await review.approve(p.id, "me");
    expect(await readFile(path.join(vault.root, r.asset!))).toEqual(Buffer.from([9, 8, 7]));
  });

  it("REST: 소유자만 목록·승인·거절·설정, 에이전트는 403", async () => {
    config.setPassword("correct horse");
    const token = config.issueToken("wiki-work");
    config.setRules("wiki-work", { ...RULES });
    const app = createApp({
      vault,
      index,
      config,
      wiki,
      ingestor,
      review,
      admin: { backups: new BackupService(vault, config, path.join(root, "backups"), () => wiki.resync()) },
    });
    const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const json = { "content-type": "application/json" };
    const cur = await owner.read("업무/경제/wiki/금리.md");
    const put = await app.request("/api/file", {
      method: "PUT",
      headers: { ...json, authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: "업무/경제/wiki/금리.md", content: "# 금리\nREST\n", baseHash: cur.hash }),
    });
    const body = await put.json();
    expect(body.pending.proposal).toBeTruthy();
    expect((await app.request("/api/review", { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
    const list = await (await app.request("/api/review?status=pending", { headers: { cookie } })).json();
    expect(list.proposals).toHaveLength(1);
    const detail = await (await app.request(`/api/review/${body.pending.proposal}`, { headers: { cookie } })).json();
    expect(detail.preview[0].after).toBe("# 금리\nREST\n");
    const ok = await app.request(`/api/review/${body.pending.proposal}/approve`, { method: "POST", headers: { ...json, cookie }, body: "{}" });
    expect((await ok.json()).status).toBe("approved");
    const s = await app.request("/api/review/settings", { method: "PUT", headers: { ...json, cookie }, body: JSON.stringify({ reviewPaths: ["/"] }) });
    expect((await s.json()).reviewPaths).toEqual(["/"]);
    const bad = await app.request("/api/review/settings", { method: "PUT", headers: { ...json, cookie }, body: JSON.stringify({ reviewPaths: ["../x"] }) });
    expect(bad.status).toBe(400);
  });
});
