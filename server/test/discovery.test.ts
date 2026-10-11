import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chunkDocument, SemanticIndex } from "../src/embeddings.js";
import type { NoteIndex } from "../src/noteindex.js";
import { ScopedVault } from "../src/scoped.js";
import type { Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

// ── 가짜 임베딩 서버: 동의어 묶음을 같은 차원으로(뜻이 같으면 단어가 달라도 가깝게) ──
const CONCEPTS = [
  ["금리", "이자율", "기준금리", "금통위"],
  ["환율", "달러", "원화", "외환"],
  ["물가", "인플레이션", "소비자물가"],
  ["고양이", "강아지", "반려동물"],
];
const DIM = 32;
function fakeEmbed(text: string): number[] {
  const v = Array.from({ length: DIM }, () => 0);
  CONCEPTS.forEach((words, i) => {
    for (const w of words) v[i] += (text.match(new RegExp(w, "g")) ?? []).length;
  });
  for (const ch of text.replace(/\s/g, "")) v[8 + (ch.charCodeAt(0) % (DIM - 8))] += 0.01; // 약한 잡음
  return v;
}

let server: Server;
let url = "";
let calls = 0;
let fail = false;
beforeAll(async () => {
  server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      calls++;
      if (fail) {
        res.writeHead(500);
        res.end("boom");
        return;
      }
      const { input, model } = JSON.parse(b);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model, data: input.map((t: string, index: number) => ({ index, embedding: fakeEmbed(t) })) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/embeddings`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let cleanup: () => Promise<void>;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let owner: ScopedVault;
let sem: SemanticIndex;

beforeEach(async () => {
  calls = 0;
  fail = false;
  const t = await tempDir("keyring-disc-");
  cleanup = t.cleanup;
  ({ vault, index, wiki } = await openVault(path.join(t.dir, "vault")));
  sem = new SemanticIndex(index, vault, { url, model: "fake-1", batchSize: 4 });
  owner = new ScopedVault(vault, ownerPrincipal, index, wiki, undefined, sem);
  await owner.createTopic("업무/경제");
  await owner.batch([
    {
      op: "write",
      path: "업무/경제/wiki/기준금리.md",
      content: "---\ntitle: 기준금리\nsummary: 정책 금리\n---\n# 기준금리\n금통위가 기준금리를 동결했다.\n\n## 영향\n[[환율]]에도 영향.\n",
      baseHash: null,
    },
    { op: "write", path: "업무/경제/wiki/환율.md", content: "# 환율\n원화와 달러의 교환 비율. [[기준금리]] 참고\n", baseHash: null },
    {
      op: "write",
      path: "업무/경제/wiki/물가.md",
      content: '---\ntitle: 물가\nsources: ["[[업무/경제/wiki/기준금리]]"]\n---\n# 물가\n소비자물가가 2% 올랐다.\n',
      baseHash: null,
    },
    { op: "write", path: "개인/고양이.md", content: "# 고양이\n반려동물 이야기. [[기준금리]] 몰래 링크\n", baseHash: null },
  ]);
  await sem.sync();
});

afterEach(async () => {
  index.close();
  await cleanup();
});

describe("그래프 뷰", () => {
  it("문서와 본문 링크·출처 링크를 돌려주고, 자동 생성 문서는 뺀다", async () => {
    const g = await owner.graph();
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      "개인/고양이.md",
      "업무/경제/SCHEMA.md",
      "업무/경제/wiki/기준금리.md",
      "업무/경제/wiki/물가.md",
      "업무/경제/wiki/환율.md",
    ]);
    const e = g.edges.map((x) => `${x.source.split("/").pop()}→${x.target.split("/").pop()}:${x.kind}`).sort();
    expect(e).toEqual(["고양이.md→기준금리.md:link", "기준금리.md→환율.md:link", "물가.md→기준금리.md:source", "환율.md→기준금리.md:link"]);
    expect(g.nodes.find((n) => n.id === "업무/경제/wiki/기준금리.md")).toMatchObject({ topic: "업무/경제", degree: 4 });
  });

  it("숨김 문서는 노드도, 그 문서에서 나온 링크도 없다", async () => {
    const agent = new ScopedVault(vault, agentPrincipal("a", { "업무/경제": "read" }), index, wiki);
    const g = await agent.graph();
    expect(g.nodes.some((n) => n.id.startsWith("개인/"))).toBe(false);
    expect(g.edges.some((x) => x.source.startsWith("개인/"))).toBe(false);
    expect(g.nodes.find((n) => n.id === "업무/경제/wiki/기준금리.md")?.degree).toBe(3);
    expect((await owner.graph("업무/경제/wiki")).nodes).toHaveLength(3);
  });
});

describe("의미 검색", () => {
  it("문서를 절 단위로 나누고 제목·절 이름을 붙인다", () => {
    const c = chunkDocument("기준금리", "---\nsummary: 정책 금리\n---\n# 기준금리\n본문\n\n## 영향\n환율\n");
    expect(c.map((x) => x.heading)).toEqual(["기준금리", "영향"]);
    expect(c[1].text).toBe("기준금리 › 영향\n정책 금리\n\n환율"); // 절 제목은 앞머리에만
    const long = chunkDocument("긴 글", "가".repeat(3000));
    expect(long.length).toBe(3);
  });

  it("단어가 달라도 뜻이 가까운 문서를 찾는다", async () => {
    const hits = await owner.semantic("이자율 인상 소식");
    expect(hits[0].path).toBe("업무/경제/wiki/기준금리.md");
    expect((await owner.semantic("외환 시장"))[0].path).toBe("업무/경제/wiki/환율.md");
    expect((await owner.semantic("인플레이션"))[0]).toMatchObject({ path: "업무/경제/wiki/물가.md", title: "물가" });
    expect(sem.status()).toMatchObject({ enabled: true, model: "fake-1", pending: 0 });
  });

  it("권한 밖 문서와 폴더 밖 문서는 나오지 않는다", async () => {
    expect((await owner.semantic("강아지"))[0].path).toBe("개인/고양이.md");
    const agent = new ScopedVault(vault, agentPrincipal("a", { "업무/경제": "read" }), index, wiki, undefined, sem);
    expect((await agent.semantic("강아지")).map((h) => h.path)).not.toContain("개인/고양이.md");
    expect((await owner.semantic("강아지", { folder: "업무/경제" })).every((h) => h.path.startsWith("업무/경제/"))).toBe(true);
  });

  it("바뀐 문서만 다시 임베딩하고, 지운 문서는 빠진다", async () => {
    calls = 0;
    await sem.sync();
    expect(calls).toBe(0); // 바뀐 게 없으면 요청 없음
    const d = await owner.read("업무/경제/wiki/환율.md");
    await owner.write("업무/경제/wiki/환율.md", "# 환율\n반려동물 사료 수입 가격과 원화\n", d.hash);
    expect(sem.status().pending).toBe(1);
    await sem.sync();
    expect(calls).toBe(1); // 문서 하나(조각 4개 이하 = 요청 1번)
    const m = await owner.read("업무/경제/wiki/물가.md");
    await owner.delete("업무/경제/wiki/물가.md", m.hash);
    await sem.sync();
    expect((await owner.semantic("인플레이션")).map((h) => h.path)).not.toContain("업무/경제/wiki/물가.md");
  });

  it("임베딩 서버 오류는 상태에 남고, 꺼져 있으면 알려 준다", async () => {
    const d = await owner.read("업무/경제/wiki/환율.md");
    await owner.write("업무/경제/wiki/환율.md", "# 환율\n바뀜\n", d.hash);
    fail = true;
    await sem.sync();
    expect(sem.status().lastError).toMatch(/HTTP 500/);
    expect(sem.status().pending).toBe(1);
    const off = new ScopedVault(vault, ownerPrincipal, index, wiki);
    await expect(off.semantic("금리")).rejects.toThrow(/의미 검색이 꺼져/);
  });
});
