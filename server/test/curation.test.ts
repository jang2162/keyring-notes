import { utimes } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Ingestor } from "../src/ingest.js";
import type { NoteIndex } from "../src/noteindex.js";
import { ScopedVault } from "../src/scoped.js";
import type { Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

let cleanup: () => Promise<void>;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let ingestor: Ingestor;
let owner: ScopedVault;
let raw1 = "";
let raw2 = "";

beforeEach(async () => {
  const t = await tempDir("keyring-curation-");
  cleanup = t.cleanup;
  ({ vault, index, wiki, ingestor } = await openVault(t.dir));
  owner = new ScopedVault(vault, ownerPrincipal, index, wiki);
  await owner.createTopic("경제");
  raw1 = (await ingestor.ingest(owner, { kind: "text", topic: "경제", title: "금리 기사", text: "기준금리 동결" })).path;
  raw2 = (await ingestor.ingest(owner, { kind: "text", topic: "경제", title: "아직 안 읽은 기사", text: "미반영" })).path;
  const r1 = raw1.replace(/\.md$/, "");
  await owner.batch([
    {
      op: "write",
      path: "경제/wiki/기준금리.md",
      content: `---\ntitle: 기준금리\nsummary: 정책 금리\nsources: ["[[${r1}|금리 기사]]", "경제/raw/없는 원본.md", "https://example.com/외부"]\nupdated: 2026-10-01\n---\n# 기준금리\n[[환율]] 참고. [[없는 페이지]]\n`,
      baseHash: null,
    },
    { op: "write", path: "경제/wiki/환율.md", content: "---\ntitle: 환율\n---\n# 환율\n[[기준금리]]와 관련\n", baseHash: null },
    { op: "write", path: "경제/wiki/고아.md", content: `---\ntitle: 고아\nsummary: 아무도 링크 안 함\nsources: ["[[${r1}]]"]\nupdated: 2020-01-01\n---\n# 고아\n`, baseHash: null },
    { op: "write", path: "개인/비밀.md", content: "# 비밀\n", baseHash: null },
    { op: "write", path: "경제/wiki/비밀 링크.md", content: "---\ntitle: 비밀 링크\nsummary: s\nsources: [x]\n---\n[[비밀]] [[기준금리]]\n", baseHash: null },
  ]);
});

afterEach(async () => {
  index.close();
  await cleanup();
});

describe("출처 연결(W6)", () => {
  it("위키 페이지의 출처를 해석하고, 원본 쪽에서는 인용한 페이지를 보여 준다", async () => {
    const s = await owner.sources("경제/wiki/기준금리.md");
    expect(s.sources).toEqual([
      { target: raw1.replace(/\.md$/, ""), path: raw1 },
      { target: "경제/raw/없는 원본.md", path: null },
    ]); // URL은 볼트 문서가 아니라 뺀다
    const r = await owner.sources(raw1);
    expect(r.citedBy.map((x) => x.path).sort()).toEqual(["경제/wiki/고아.md", "경제/wiki/기준금리.md"]);
    expect(r.linkedBy).toEqual([]); // 본문 링크와 출처 인용은 따로 센다
    expect((await owner.sources("경제/wiki/기준금리.md")).linkedBy.map((x) => x.path).sort()).toEqual(["경제/wiki/비밀 링크.md", "경제/wiki/환율.md"]);
  });

  it("볼 수 없는 문서는 출처·인용 목록에서 빠진다", async () => {
    const agent = new ScopedVault(vault, agentPrincipal("a", { "경제/wiki": "read" }), index, wiki);
    const s = await agent.sources("경제/wiki/기준금리.md");
    expect(s.sources[0].path).toBeNull(); // raw를 볼 수 없으면 없는 것과 같다
    await expect(agent.sources(raw1)).rejects.toThrow(/없습니다/);
  });

  it("위키 목차의 '반영된 원본'도 프런트매터 출처로 센다", async () => {
    const idx = (await owner.read("경제/wiki/index.md")).content;
    expect(idx).toContain("미반영 1개");
    expect(idx).toContain("금리 기사]] — 페이지 2개에서 인용");
  });
});

describe("구조적 정리(W7)", () => {
  it("깨진 링크·출처, 고아, 출처 없음, 프런트매터 누락, 오래됨, 미반영 원본", async () => {
    const r = await owner.lint({ folder: "경제" });
    const by = (k: string) => r.issues.filter((i) => i.kind === k).map((i) => i.target ?? i.path);
    expect(by("broken_link")).toEqual(["없는 페이지"]); // [[비밀]]은 소유자에겐 있는 문서
    expect(by("broken_source").sort()).toEqual(["x", "경제/raw/없는 원본.md"]);
    expect(by("orphan").sort()).toEqual(["경제/wiki/고아.md", "경제/wiki/비밀 링크.md"]);
    expect(by("no_sources")).toEqual(["경제/wiki/환율.md"]);
    expect(by("missing_frontmatter")).toEqual(["경제/wiki/환율.md"]);
    expect(by("stale")).toEqual(["경제/wiki/고아.md"]);
    expect(by("unprocessed_raw")).toEqual([raw2]);
    expect(r.counts.orphan).toBe(2);
    // index·log·SCHEMA는 점검 대상이 아니다
    expect(r.issues.some((i) => /\/(index|log)\.md$|SCHEMA/.test(i.path))).toBe(false);
  });

  it("에이전트에게 숨김 문서로 가는 링크는 '없거나 볼 수 없음'으로 같이 보인다", async () => {
    const agent = new ScopedVault(vault, agentPrincipal("a", { 경제: "read" }), index, wiki);
    const r = await agent.lint();
    expect(r.issues.filter((i) => i.kind === "broken_link").map((i) => i.target).sort()).toEqual(["비밀", "없는 페이지"]);
    expect(r.issues.some((i) => i.path.startsWith("개인/"))).toBe(false);
  });

  it("고치면 문제가 사라진다", async () => {
    const h = await owner.read("경제/wiki/환율.md");
    await owner.write("경제/wiki/환율.md", `---\ntitle: 환율\nsummary: 원화 가치\nsources: ["[[${raw2}]]"]\n---\n# 환율\n[[기준금리]]와 관련\n`, h.hash);
    await utimes(path.join(vault.root, "경제/wiki/고아.md"), new Date(), new Date()); // mtime만 바뀌어도 updated가 우선
    const r = await owner.lint({ folder: "경제/wiki" });
    expect(r.issues.filter((i) => i.path === "경제/wiki/환율.md")).toEqual([]);
    expect(r.issues.some((i) => i.kind === "unprocessed_raw")).toBe(false); // 폴더 범위 밖
    expect((await owner.lint({ folder: "경제", staleDays: 100000 })).counts.stale).toBeUndefined();
  });
});
