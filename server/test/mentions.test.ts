import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteIndex } from "../src/noteindex.js";
import { ScopedVault } from "../src/scoped.js";
import type { Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

let cleanup: () => Promise<void>;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let owner: ScopedVault;

beforeEach(async () => {
  const t = await tempDir("keyring-mentions-");
  cleanup = t.cleanup;
  ({ vault, index, wiki } = await openVault(path.join(t.dir, "vault")));
  owner = new ScopedVault(vault, ownerPrincipal, index, wiki);
  await owner.batch([
    { op: "write", path: "업무/경제/기준금리.md", content: "---\naliases: [policy rate]\n---\n# 기준금리\n", baseHash: null },
    { op: "write", path: "일기/오늘.md", content: "오늘 기준금리 동결. Policy rate 얘기.\n[[기준금리]]는 이미 링크\n", baseHash: null },
    { op: "write", path: "비밀/메모.md", content: "기준금리 비밀 메모\n", baseHash: null },
    { op: "write", path: "일기/무관.md", content: "날씨 맑음\n", baseHash: null },
  ]);
});

afterEach(async () => {
  index.close();
  await cleanup();
});

describe("연결되지 않은 언급(서버)", () => {
  it("이름·별칭이 링크 없이 나온 자리를 돌려준다", async () => {
    const r = await owner.mentions("업무/경제/기준금리.md");
    expect(r.names).toEqual(["policy rate", "기준금리"]);
    expect(r.docs.map((d) => d.path)).toEqual(["비밀/메모.md", "일기/오늘.md"]);
    const today = r.docs.find((d) => d.path === "일기/오늘.md")!;
    // 저장할 때 적힌 수정 시각(프런트매터 세 줄)만큼 아래 줄이다
    expect(today.mentions.map((m) => [m.line, m.text])).toEqual([
      [4, "기준금리"],
      [4, "Policy rate"],
    ]);
    expect(today.hash).toBe((await owner.read("일기/오늘.md")).hash);
  });

  it("에이전트에게는 볼 수 있는 문서만", async () => {
    const agent = new ScopedVault(vault, agentPrincipal("bot", { "업무/경제": "read", 일기: "read" }), index, wiki);
    const r = await agent.mentions("업무/경제/기준금리.md");
    expect(r.docs.map((d) => d.path)).toEqual(["일기/오늘.md"]);
    await expect(agent.mentions("비밀/메모.md")).rejects.toThrow();
  });
});
