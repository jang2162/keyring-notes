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
  let settings = setVaultSetting(null, "dailyFolder", "일기");
  settings = setVaultSetting(settings, "dailyFormat", "GGGG/[W]WW/YYYY-MM-DD");
  await owner.batch([
    { op: "write", path: VAULT_SETTINGS_PATH, content: settings, baseHash: null },
    { op: "write", path: "일기/2026/W53/2027-01-01 새해 계획.md", content: "---\nicon: 🎍\n---\n새해", baseHash: null },
    { op: "write", path: "일기/2026/W41/2026-10-07.md", content: "오늘", baseHash: null },
    { op: "write", path: "공개/메모.md", content: "[[2027-01-01]] [[2026-10-07]] 계획", baseHash: null },
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
    const hidden = new ScopedVault(vault, agentPrincipal("bot2", { 공개: "write" }), index, wiki);
    await expect(hidden.read(VAULT_SETTINGS_PATH)).rejects.toThrow(/문서가 없습니다/);
    // 소유자는 고칠 수 있다
    await owner.write(VAULT_SETTINGS_PATH, cur.content.replace("dailyFolder: 일기", "dailyFolder: 일기"), cur.hash);
  });

  it("트리·검색·그래프·위젯·속성에서는 빠진다", async () => {
    const tree = await owner.tree();
    expect(tree.map((n) => n.name)).toContain(VAULT_SETTINGS_PATH); // 파일은 있다(웹이 트리에서 숨긴다)
    expect((await owner.search("dailyFormat")).map((h) => h.path)).toEqual([]);
    expect((await owner.graph()).nodes.map((n) => n.id)).not.toContain(VAULT_SETTINGS_PATH);
    const w = await owner.widget("type: query");
    expect(w.type === "query" && w.rows.map((r) => r.path)).not.toContain(VAULT_SETTINGS_PATH);
    expect(owner.properties().map((p) => p.key)).not.toContain("dailyFormat");
  });

  it("[[날짜]] 링크는 그날 데일리 노트로, 에이전트에게는 보이는 문서 안에서만", async () => {
    const outline = await owner.outline("공개/메모.md");
    expect(outline.links).toEqual([
      { target: "2027-01-01", path: "일기/2026/W53/2027-01-01 새해 계획.md" },
      { target: "2026-10-07", path: "일기/2026/W41/2026-10-07.md" },
    ]);
    expect((await owner.backlinks("일기/2026/W53/2027-01-01 새해 계획.md")).map((b) => b.path)).toEqual(["공개/메모.md"]);
    expect((await owner.lint()).issues.filter((i) => i.kind === "broken_link")).toEqual([]);
    // 일기가 숨겨진 에이전트: 날짜 링크도 해석되지 않는다(존재가 드러나지 않게)
    const agent = new ScopedVault(vault, agentPrincipal("bot", { 공개: "read" }), index, wiki);
    expect((await agent.outline("공개/메모.md")).links.map((l) => l.path)).toEqual([null, null]);
    // 설정을 바꾸면(형식) 바로 따라간다: 2027-01-01은 이제 데일리 노트가 아니고, 2026-10-07은 이름이 같아서(최단 경로) 찾는다
    const s = await owner.read(VAULT_SETTINGS_PATH);
    await owner.write(VAULT_SETTINGS_PATH, setVaultSetting(s.content, "dailyFormat", "YYYY-MM-DD"), s.hash);
    expect((await owner.outline("공개/메모.md")).links.map((l) => l.path)).toEqual([null, "일기/2026/W41/2026-10-07.md"]);
  });

  it("트리 문서에 아이콘", async () => {
    const tree = await owner.tree("일기/2026/W53");
    expect(tree).toEqual([{ name: "2027-01-01 새해 계획.md", path: "일기/2026/W53/2027-01-01 새해 계획.md", type: "file", icon: "🎍" }]);
  });

  it("데일리 노트를 데일리 폴더 밖으로 옮기면 [[날짜]] 링크를 고친다", async () => {
    const d = await owner.read("일기/2026/W53/2027-01-01 새해 계획.md");
    const r = await owner.move(d.path, "보관/2027-01-01 새해 계획.md", d.hash);
    expect(r.linksUpdated).toContain("공개/메모.md");
    expect((await owner.read("공개/메모.md")).content).toBe("[[2027-01-01 새해 계획]] [[2026-10-07]] 계획");
  });
});

describe("폴더 이동", () => {
  beforeEach(async () => {
    await owner.batch([
      { op: "write", path: "프로젝트/계획.md", content: "![[도식.png]] ![](attachments/도식.png) [[참고]]", baseHash: null },
      { op: "write", path: "프로젝트/하위/참고.md", content: "[위로](../계획.md)", baseHash: null },
      { op: "put", path: "프로젝트/attachments/도식.png", data: new Uint8Array([1, 2, 3]) },
      { op: "write", path: "밖.md", content: "[[프로젝트/계획]] ![[프로젝트/attachments/도식.png]] [x](프로젝트/attachments/도식.png)", baseHash: null },
    ]);
  });

  it("문서와 첨부를 한 커밋으로 옮기고 링크(첨부 포함)를 고친다", async () => {
    const before = Number(git("rev-list", "--count", "HEAD"));
    const r = await owner.moveFolder("프로젝트", "보관/2026 프로젝트");
    expect(Number(git("rev-list", "--count", "HEAD"))).toBe(before + 1);
    expect(git("log", "-1", "--format=%s")).toBe("폴더 이동: 프로젝트 → 보관/2026 프로젝트");
    expect(r.moved.map(([, t]) => t).sort()).toEqual(["보관/2026 프로젝트/attachments/도식.png", "보관/2026 프로젝트/계획.md", "보관/2026 프로젝트/하위/참고.md"]);
    expect((await owner.read("밖.md")).content).toBe("[[보관/2026 프로젝트/계획]] ![[보관/2026 프로젝트/attachments/도식.png]] [x](보관/2026%20프로젝트/attachments/도식.png)");
    expect((await owner.read("보관/2026 프로젝트/계획.md")).content).toBe("![[도식.png]] ![](attachments/도식.png) [[참고]]");
    expect([...(await vault.readRaw("보관/2026 프로젝트/attachments/도식.png")).data]).toEqual([1, 2, 3]);
    await expect(vault.readRaw("프로젝트/attachments/도식.png")).rejects.toThrow(/파일이 없습니다/);
    expect(git("status", "--porcelain")).toBe("");
    expect((await owner.lint()).issues.filter((i) => i.kind === "broken_link")).toEqual([]);
  });

  it("중간에 실패하면 아무것도 옮기지 않는다", async () => {
    await owner.write("보관/2026 프로젝트/계획.md", "먼저 있음", null);
    await expect(owner.moveFolder("프로젝트", "보관/2026 프로젝트")).rejects.toThrow(/이미 같은 이름/);
    expect((await owner.read("프로젝트/계획.md")).content).toContain("도식");
    expect([...(await vault.readRaw("프로젝트/attachments/도식.png")).data]).toEqual([1, 2, 3]);
  });

  it("첨부 하나 옮기기·지우기(baseHash = 바이트 해시)", async () => {
    const hash = hashContent(Buffer.from([1, 2, 3]));
    const r = await owner.move("프로젝트/attachments/도식.png", "그림/도식.png", hash);
    expect(r.path).toBe("그림/도식.png");
    expect((await owner.read("프로젝트/계획.md")).content).toBe("![[도식.png]] ![](../그림/도식.png) [[참고]]");
    await expect(owner.move("그림/도식.png", "그림/도식.md", hash)).rejects.toThrow(/문서와 첨부/);
    await owner.delete("그림/도식.png", hash);
    await expect(vault.readRaw("그림/도식.png")).rejects.toThrow(/파일이 없습니다/);
  });

  it("에이전트: 폴더를 옮기려면 원래 자리에 삭제 권한", async () => {
    const agent = new ScopedVault(vault, agentPrincipal("bot", { 프로젝트: "write", 보관: "write" }), index, wiki);
    await expect(agent.moveFolder("프로젝트", "보관/프로젝트")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
