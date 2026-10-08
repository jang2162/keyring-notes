import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setVaultSetting, VAULT_SETTINGS_PATH } from "@keyring-notes/core";
import type { NoteIndex } from "../src/noteindex.js";
import { ScopedVault } from "../src/scoped.js";
import { ForbiddenError, hashContent, type Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

let cleanup: () => Promise<void>;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let owner: ScopedVault;

const git = (...args: string[]) =>
  execFileSync("git", ["--git-dir", path.join(vault.root, ".history"), "--work-tree", vault.root, "-c", "core.quotePath=false", ...args], { encoding: "utf8" }).trim();

beforeEach(async () => {
  const t = await tempDir("keyring-shared-");
  cleanup = t.cleanup;
  ({ vault, index, wiki } = await openVault(path.join(t.dir, "vault")));
  owner = new ScopedVault(vault, ownerPrincipal, index, wiki);
  let settings = setVaultSetting(null, ["vault", "language"], "ko", "ko");
  settings = setVaultSetting(settings, ["workspaces", "개인", "daily", "format"], "GGGG/[W]WW/YYYY-MM-DD");
  await owner.batch([
    { op: "write", path: VAULT_SETTINGS_PATH, content: settings, baseHash: null },
    { op: "write", path: "개인/데일리 노트/2026/W53/2027-01-01 새해 계획.md", content: "---\nicon: 🎍\n---\n새해", baseHash: null },
    { op: "write", path: "개인/데일리 노트/2026/W41/2026-10-07.md", content: "오늘", baseHash: null },
    { op: "write", path: "개인/공개/메모.md", content: "[[2027-01-01]] [[2026-10-07]] 계획", baseHash: null },
  ]);
});

afterEach(async () => {
  index.close();
  await cleanup();
});

describe("모든 기기 공통 설정 파일", () => {
  it("에이전트는 규칙과 상관없이 읽기까지만", async () => {
    const agent = new ScopedVault(vault, agentPrincipal("bot", { "/": "delete" }), index, wiki);
    expect(agent.level(VAULT_SETTINGS_PATH)).toBe("read");
    const cur = await agent.read(VAULT_SETTINGS_PATH);
    await expect(agent.write(VAULT_SETTINGS_PATH, cur.content + "\nx", cur.hash)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(agent.append(VAULT_SETTINGS_PATH, "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(agent.delete(VAULT_SETTINGS_PATH, cur.hash)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(agent.move(VAULT_SETTINGS_PATH, "x.md", cur.hash)).rejects.toBeInstanceOf(ForbiddenError);
    // 숨김 규칙이면 읽기도 안 된다(없는 문서와 같은 응답)
    const hidden = new ScopedVault(vault, agentPrincipal("bot2", { "개인/공개": "write" }), index, wiki);
    await expect(hidden.read(VAULT_SETTINGS_PATH)).rejects.toThrow(/문서가 없습니다/);
    // 소유자는 고칠 수 있다
    await owner.write(VAULT_SETTINGS_PATH, setVaultSetting(cur.content, ["vault", "linkFormat"], "full"), cur.hash);
  });

  it("트리·검색·그래프·위젯·속성에서는 빠진다", async () => {
    const tree = await owner.tree();
    expect(tree.map((n) => n.name)).toContain(VAULT_SETTINGS_PATH); // 파일은 있다(웹이 트리에서 숨긴다)
    expect((await owner.search("workspaces")).map((h) => h.path)).toEqual([]);
    expect((await owner.graph()).nodes.map((n) => n.id)).not.toContain(VAULT_SETTINGS_PATH);
    const w = await owner.widget("type: query");
    expect(w.type === "query" && w.rows.map((r) => r.path)).not.toContain(VAULT_SETTINGS_PATH);
    expect(owner.properties().map((p) => p.key)).not.toContain("workspaces");
  });

  it("[[날짜]] 링크는 같은 워크스페이스의 그날 데일리 노트로, 에이전트에게는 보이는 문서 안에서만", async () => {
    const outline = await owner.outline("개인/공개/메모.md");
    expect(outline.links).toEqual([
      { target: "2027-01-01", path: "개인/데일리 노트/2026/W53/2027-01-01 새해 계획.md" },
      { target: "2026-10-07", path: "개인/데일리 노트/2026/W41/2026-10-07.md" },
    ]);
    expect((await owner.backlinks("개인/데일리 노트/2026/W53/2027-01-01 새해 계획.md")).map((b) => b.path)).toEqual(["개인/공개/메모.md"]);
    expect((await owner.lint()).issues.filter((i) => i.kind === "broken_link")).toEqual([]);
    // 다른 워크스페이스의 같은 날 노트보다 같은 워크스페이스 것이 먼저
    await owner.write("업무/데일리 노트/2026-10-07.md", "업무 일기", null);
    expect((await owner.outline("개인/공개/메모.md")).links[1].path).toBe("개인/데일리 노트/2026/W41/2026-10-07.md");
    await owner.write("업무/메모.md", "[[2026-10-07]]", null);
    expect((await owner.outline("업무/메모.md")).links[0].path).toBe("업무/데일리 노트/2026-10-07.md");
    // 일기가 숨겨진 에이전트: 날짜 링크도 해석되지 않는다(존재가 드러나지 않게)
    const agent = new ScopedVault(vault, agentPrincipal("bot", { "개인/공개": "read" }), index, wiki);
    expect((await agent.outline("개인/공개/메모.md")).links.map((l) => l.path)).toEqual([null, null]);
    // 설정을 바꾸면(형식) 바로 따라간다: 2027-01-01은 이제 데일리 노트가 아니고, 2026-10-07은 이름이 같아서(최단 경로) 찾는다
    const s = await owner.read(VAULT_SETTINGS_PATH);
    await owner.write(VAULT_SETTINGS_PATH, setVaultSetting(s.content, ["workspaces", "개인", "daily", "format"], "YYYY-MM-DD"), s.hash);
    expect((await owner.outline("개인/공개/메모.md")).links.map((l) => l.path)).toEqual([null, "개인/데일리 노트/2026/W41/2026-10-07.md"]);
  });

  it("트리 문서에 아이콘", async () => {
    const tree = await owner.tree("개인/데일리 노트/2026/W53");
    expect(tree).toEqual([{ name: "2027-01-01 새해 계획.md", path: "개인/데일리 노트/2026/W53/2027-01-01 새해 계획.md", type: "file", icon: "🎍" }]);
  });

  it("데일리 노트를 데일리 폴더 밖으로 옮기면 [[날짜]] 링크를 고친다", async () => {
    const d = await owner.read("개인/데일리 노트/2026/W53/2027-01-01 새해 계획.md");
    const r = await owner.move(d.path, "개인/보관/2027-01-01 새해 계획.md", d.hash);
    expect(r.linksUpdated).toContain("개인/공개/메모.md");
    expect((await owner.read("개인/공개/메모.md")).content).toBe("[[2027-01-01 새해 계획]] [[2026-10-07]] 계획");
  });
});

describe("노드 이동·삭제", () => {
  beforeEach(async () => {
    await owner.batch([
      { op: "write", path: "업무/프로젝트.md", content: "# 프로젝트 소개 [[계획]]", baseHash: null },
      { op: "write", path: "업무/프로젝트/계획.md", content: "![[도식.png]] ![](도식.png) [[참고]]", baseHash: null },
      { op: "write", path: "업무/프로젝트/하위/참고.md", content: "[위로](../계획.md)", baseHash: null },
      { op: "put", path: "업무/프로젝트/도식.png", data: new Uint8Array([1, 2, 3]) },
      { op: "write", path: "업무/밖.md", content: "[[프로젝트]] [[프로젝트/계획]] ![[프로젝트/도식.png]] [x](프로젝트/도식.png)", baseHash: null },
    ]);
  });

  it("노드 노트와 하위(문서·첨부)를 한 커밋으로 옮기고 링크(첨부 포함)를 고친다", async () => {
    const before = Number(git("rev-list", "--count", "HEAD"));
    const r = await owner.moveNode("업무/프로젝트", "업무/보관/2026 프로젝트");
    expect(Number(git("rev-list", "--count", "HEAD"))).toBe(before + 1);
    expect(git("log", "-1", "--format=%s")).toBe("노드 이동: 업무/프로젝트 → 업무/보관/2026 프로젝트");
    expect(r.moved.map(([, t]) => t).sort()).toEqual([
      "업무/보관/2026 프로젝트.md",
      "업무/보관/2026 프로젝트/계획.md",
      "업무/보관/2026 프로젝트/도식.png",
      "업무/보관/2026 프로젝트/하위/참고.md",
    ]);
    // 경로를 쓴 링크는 전체 경로로 고친다
    expect((await owner.read("업무/밖.md")).content).toBe("[[2026 프로젝트]] [[업무/보관/2026 프로젝트/계획]] ![[업무/보관/2026 프로젝트/도식.png]] [x](보관/2026%20프로젝트/도식.png)");
    expect((await owner.read("업무/보관/2026 프로젝트/계획.md")).content).toBe("![[도식.png]] ![](도식.png) [[참고]]");
    expect([...(await vault.readRaw("업무/보관/2026 프로젝트/도식.png")).data]).toEqual([1, 2, 3]);
    await expect(vault.readRaw("업무/프로젝트/도식.png")).rejects.toThrow(/파일이 없습니다/);
    expect(git("status", "--porcelain")).toBe("");
    expect((await owner.lint()).issues.filter((i) => i.kind === "broken_link")).toEqual([]);
    await expect(owner.moveNode("업무/보관", "업무/보관/안")).rejects.toThrow(/하위/);
  });

  it("노트 없는 폴더 노드도 옮긴다(.md를 붙여 불러도 같다)", async () => {
    const r = await owner.moveNode("업무/프로젝트/하위.md", "업무/하위");
    expect(r.moved).toEqual([["업무/프로젝트/하위/참고.md", "업무/하위/참고.md"]]);
    expect((await owner.read("업무/하위/참고.md")).content).toBe("[위로](../프로젝트/계획.md)");
  });

  it("중간에 실패하면 아무것도 옮기지 않는다", async () => {
    await owner.write("업무/보관/2026 프로젝트/계획.md", "먼저 있음", null);
    await expect(owner.moveNode("업무/프로젝트", "업무/보관/2026 프로젝트")).rejects.toMatchObject({ code: "file_exists" });
    expect((await owner.read("업무/프로젝트/계획.md")).content).toContain("도식");
    expect([...(await vault.readRaw("업무/프로젝트/도식.png")).data]).toEqual([1, 2, 3]);
  });

  it("첨부 하나 옮기기·지우기(baseHash = 바이트 해시)", async () => {
    const hash = hashContent(Buffer.from([1, 2, 3]));
    const r = await owner.move("업무/프로젝트/도식.png", "업무/_첨부/도식.png", hash);
    expect(r.path).toBe("업무/_첨부/도식.png");
    expect((await owner.read("업무/프로젝트/계획.md")).content).toBe("![[도식.png]] ![](../_첨부/도식.png) [[참고]]");
    await expect(owner.move("업무/_첨부/도식.png", "업무/_첨부/도식.md", hash)).rejects.toThrow(/문서와 첨부/);
    await owner.delete("업무/_첨부/도식.png", hash);
    await expect(vault.readRaw("업무/_첨부/도식.png")).rejects.toThrow(/파일이 없습니다/);
  });

  it("노드 삭제: 하위까지 한 커밋, 그 사이 바뀌었으면 거부", async () => {
    const files = ["업무/프로젝트.md", "업무/프로젝트/계획.md", "업무/프로젝트/도식.png", "업무/프로젝트/하위/참고.md"];
    const expectList = await Promise.all(files.map(async (p) => ({ path: p, baseHash: hashContent((await vault.readRaw(p)).data) })));
    // 하나가 바뀌면 거부(되돌리기에 쓸 내용과 어긋나지 않게)
    const plan = await owner.read("업무/프로젝트/계획.md");
    await owner.write(plan.path, plan.content + "\n더", plan.hash);
    await expect(owner.deleteNode("업무/프로젝트", expectList)).rejects.toMatchObject({ code: "conflict_path" });
    // 하위가 늘어도 거부
    const fresh = await Promise.all(files.map(async (p) => ({ path: p, baseHash: hashContent((await vault.readRaw(p)).data) })));
    await owner.write("업무/프로젝트/새.md", "새", null);
    await expect(owner.deleteNode("업무/프로젝트", fresh)).rejects.toThrow(/하위가 바뀌었/);
    const before = Number(git("rev-list", "--count", "HEAD"));
    const r = await owner.deleteNode("업무/프로젝트");
    expect(r.deleted).toEqual([...files.slice(0, 3), "업무/프로젝트/새.md", files[3]]);
    expect(Number(git("rev-list", "--count", "HEAD"))).toBe(before + 1);
    expect(git("log", "-1", "--format=%s")).toBe("노드 삭제: 업무/프로젝트");
    expect(JSON.stringify(await owner.tree())).not.toContain("프로젝트");
  });

  it("에이전트: 노드를 옮기려면 원래 자리에 삭제 권한", async () => {
    const agent = new ScopedVault(vault, agentPrincipal("bot", { "업무/프로젝트": "write", "업무/보관": "write" }), index, wiki);
    await expect(agent.moveNode("업무/프로젝트", "업무/보관/프로젝트")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
