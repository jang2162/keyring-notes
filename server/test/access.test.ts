import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessPolicy } from "../src/access.js";
import { ScopedVault } from "../src/scoped.js";
import type { NoteIndex } from "../src/noteindex.js";
import type { Vault } from "../src/vault.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

// 계획서의 "폴더별 에이전트 권한 (예시)" 표
const WIKI_WORK = {
  "업무/경제/raw": "append",
  "업무/경제/wiki": "delete",
  "업무/경제/SCHEMA.md": "read",
} as const;
const OPENCLAW_WORK = {
  "업무": "read",
  "에이전트 작업함": "delete",
} as const;
const OPENCLAW_PERSONAL = {
  "에이전트 작업함": "delete",
} as const;

let cleanup: () => Promise<void>;
let vault: Vault;
let owner: ScopedVault;
let wiki: ScopedVault;
let work: ScopedVault;
let personal: ScopedVault;
const h: Record<string, string> = {};

beforeEach(async () => {
  const t = await tempDir("keyring-acl-");
  cleanup = t.cleanup;
  let index: NoteIndex;
  ({ vault, index } = await openVault(t.dir));
  owner = new ScopedVault(vault, ownerPrincipal, index);
  wiki = new ScopedVault(vault, agentPrincipal("wiki-work", { ...WIKI_WORK }), index);
  work = new ScopedVault(vault, agentPrincipal("openclaw-work", { ...OPENCLAW_WORK }), index);
  personal = new ScopedVault(vault, agentPrincipal("openclaw-personal", { ...OPENCLAW_PERSONAL }), index);
  const seed: Record<string, string> = {
    "업무/경제/raw/기사.md": "# 기사\n원문 내용 금리\n",
    "업무/경제/wiki/금리.md": "# 금리\n[[가계부]] 와 [[기사]] 참고\n",
    "업무/경제/SCHEMA.md": "# 스키마\n",
    "에이전트 작업함/메모.md": "# 메모\n",
    "개인·재무/가계부.md": "---\ntags: [재무]\n---\n# 가계부\n금리 비밀 메모\n",
  };
  for (const [p, c] of Object.entries(seed)) h[p] = (await owner.write(p, c, null)).hash;
});

afterEach(() => cleanup());

describe("AccessPolicy", () => {
  it("가장 구체적인 경로 규칙이 이기고, 규칙이 없으면 숨김", () => {
    const p = new AccessPolicy({ "/": "read", "업무": "write", "업무/비밀": "hidden", "업무/비밀/공개.md": "read" });
    expect(p.level("아무거나.md")).toBe("read");
    expect(p.level("업무/a.md")).toBe("write");
    expect(p.level("업무/비밀/a.md")).toBe("hidden");
    expect(p.level("업무/비밀/공개.md")).toBe("read");
    expect(p.level("업무비슷/a.md")).toBe("read"); // 접두어가 아니라 폴더 경계로 비교
    expect(new AccessPolicy({}).level("a.md")).toBe("hidden");
  });
});

describe("숨김", () => {
  it("목록·트리·검색에서 빠진다", async () => {
    for (const s of [wiki, work, personal]) {
      const docs = (await s.documents()).map((d) => d.path);
      expect(docs.some((p) => p.startsWith("개인·재무"))).toBe(false);
      expect(JSON.stringify(await s.tree())).not.toContain("개인·재무");
      const hits = await s.search("금리");
      expect(hits.map((x) => x.path).some((p) => p.startsWith("개인·재무"))).toBe(false);
    }
    expect((await personal.documents()).map((d) => d.path)).toEqual(["에이전트 작업함/메모.md"]);
    // 업무에 SCHEMA.md가 있어 위키 토픽이 되므로 서버가 만든 wiki/index.md·log.md도 보인다
    expect((await wiki.documents()).map((d) => d.path).sort()).toEqual([
      "업무/경제/SCHEMA.md",
      "업무/경제/raw/기사.md",
      "업무/경제/wiki/index.md",
      "업무/경제/wiki/log.md",
      "업무/경제/wiki/금리.md",
    ]);
  });

  it("읽기·이력·첨부는 '없는 문서'와 같은 오류를 낸다", async () => {
    const hidden = await wiki.read("개인·재무/가계부.md").catch((e) => e);
    const missing = await wiki.read("개인·재무/없는문서.md").catch((e) => e);
    expect(hidden.constructor.name).toBe("NotFoundError");
    expect(missing.constructor.name).toBe("NotFoundError");
    await expect(wiki.history("개인·재무/가계부.md")).rejects.toThrow(/문서가 없습니다/);
    await expect(wiki.outline("개인·재무/가계부.md")).rejects.toThrow(/문서가 없습니다/);
    await expect(wiki.readRaw("개인·재무/가계부.md")).rejects.toThrow(/문서가 없습니다/);
  });

  it("쓰기는 존재 여부와 상관없이 같은 권한 오류를 낸다(충돌 응답으로 존재가 드러나지 않음)", async () => {
    const existing = await work.write("개인·재무/가계부.md", "x", null).catch((e) => e);
    const absent = await work.write("개인·재무/새.md", "x", null).catch((e) => e);
    expect(existing.constructor.name).toBe("ForbiddenError");
    expect(absent.constructor.name).toBe("ForbiddenError");
    await expect(work.delete("개인·재무/가계부.md", h["개인·재무/가계부.md"])).rejects.toThrow(/권한/);
    await expect(work.move("에이전트 작업함/메모.md", "개인·재무/메모.md", h["에이전트 작업함/메모.md"])).rejects.toThrow(/권한/);
  });

  it("숨김 문서를 가리키는 링크는 해석하지 않는다", async () => {
    const outline = await wiki.outline("업무/경제/wiki/금리.md");
    expect(outline.links).toEqual([
      { target: "가계부", path: null },
      { target: "기사", path: "업무/경제/raw/기사.md" },
    ]);
    // 소유자는 해석된다
    expect((await owner.outline("업무/경제/wiki/금리.md")).links[0].path).toBe("개인·재무/가계부.md");
  });

  it("frontmatter 목록에도 숨김 문서가 없다", async () => {
    const list = await work.frontmatterList();
    expect(list.map((d) => d.path)).not.toContain("개인·재무/가계부.md");
  });

  it("이력의 이동 메시지에 숨김 경로가 드러나지 않는다", async () => {
    const moved = await owner.move("개인·재무/가계부.md", "업무/경제/wiki/공개가계부.md", h["개인·재무/가계부.md"]);
    const msgs = (await wiki.history(moved.path)).map((c) => c.message);
    expect(msgs.join("\n")).not.toContain("개인·재무");
    expect((await owner.history(moved.path))[0].message).toContain("개인·재무");
  });
});

describe("읽기 전용", () => {
  it("openclaw-work는 업무를 읽지만 쓰지 못한다", async () => {
    expect((await work.read("업무/경제/wiki/금리.md")).content).toContain("금리");
    await expect(work.write("업무/경제/wiki/금리.md", "바꿈", h["업무/경제/wiki/금리.md"])).rejects.toThrow(/권한/);
    await expect(work.append("업무/경제/wiki/금리.md", "덧붙임")).rejects.toThrow(/권한/);
    await expect(work.write("업무/경제/wiki/새.md", "x", null)).rejects.toThrow(/권한/);
    await expect(wiki.write("업무/경제/SCHEMA.md", "규칙 변경", h["업무/경제/SCHEMA.md"])).rejects.toThrow(/권한/);
  });

  it("자기 작업함에서는 쓰기·삭제가 된다", async () => {
    const d = await work.write("에이전트 작업함/새.md", "x", null);
    await work.delete("에이전트 작업함/새.md", d.hash);
  });
});

describe("추가 전용", () => {
  const raw = "업무/경제/raw/기사.md";

  it("새 원본 문서를 만들고 끝에 덧붙일 수 있다", async () => {
    await wiki.write("업무/경제/raw/새 기사.md", "# 새 기사\n", null);
    const d = await wiki.append(raw, "추가 메모\n");
    expect(d.content).toBe("# 기사\n원문 내용 금리\n추가 메모\n");
    // 전체 쓰기라도 기존 내용 뒤에 붙이기만 하면 허용
    await wiki.write(raw, d.content + "또 추가\n", d.hash);
  });

  it("기존 내용을 바꾸거나 지우거나 옮길 수 없다", async () => {
    await expect(wiki.write(raw, "# 기사\n왜곡된 요약\n", h[raw])).rejects.toThrow(/추가 전용/);
    await expect(wiki.write(raw, "", h[raw])).rejects.toThrow(/권한/);
    await expect(wiki.delete(raw, h[raw])).rejects.toThrow(/권한/);
    await expect(wiki.move(raw, "업무/경제/wiki/기사.md", h[raw])).rejects.toThrow(/권한/);
    // 위키 쪽에서 원본 폴더로 옮겨와 덮어쓰기도 불가(이미 있는 이름이면 충돌)
    const w = await wiki.write("업무/경제/wiki/임시.md", "x", null);
    await expect(wiki.move("업무/경제/wiki/임시.md", raw, w.hash)).rejects.toThrow();
    expect((await owner.read(raw)).content).toBe("# 기사\n원문 내용 금리\n");
  });

  it("일괄 쓰기 안에서도 같은 규칙이 적용되고, 위반 시 전체가 취소된다", async () => {
    const before = await vault.git.log();
    await expect(
      wiki.batch([
        { op: "write", path: "업무/경제/wiki/요약.md", content: "요약", baseHash: null },
        { op: "write", path: raw, content: "덮어쓰기", baseHash: h[raw] },
      ]),
    ).rejects.toThrow(/추가 전용/);
    await expect(owner.read("업무/경제/wiki/요약.md")).rejects.toThrow();
    expect(await vault.git.log()).toEqual(before);
  });
});

describe("소유자", () => {
  it("모든 경로에 접근한다", async () => {
    expect((await owner.documents()).length).toBe(7); // 시드 5 + 위키 index·log
    await owner.write("개인·재무/가계부.md", "바꿈", h["개인·재무/가계부.md"]);
  });
});
