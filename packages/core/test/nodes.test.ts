import { describe, expect, it } from "vitest";
import {
  buildNodeTree,
  countNode,
  dailyLookup,
  findNode,
  inNode,
  mergeSettingsObjects,
  moveNodePath,
  nodeFiles,
  parseVaultSettings,
  resolveLink,
  rewriteLinks,
  workspaceOf,
  workspacesOf,
  type TreeNode,
} from "../src/index.js";

/** 경로 목록 → 파일 트리(폴더·파일) */
function tree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirs = new Map<string, TreeNode[]>([["", root]]);
  const dir = (p: string): TreeNode[] => {
    if (dirs.has(p)) return dirs.get(p)!;
    const i = p.lastIndexOf("/");
    const node: TreeNode = { name: p.slice(i + 1), path: p, type: "dir", children: [] };
    dir(i < 0 ? "" : p.slice(0, i)).push(node);
    dirs.set(p, node.children!);
    return node.children!;
  };
  for (const p of paths) {
    const i = p.lastIndexOf("/");
    dir(i < 0 ? "" : p.slice(0, i)).push({ name: p.slice(i + 1), path: p, type: "file" });
  }
  return root;
}

describe("노드 짝짓기", () => {
  const files = ["업무.md", "업무/프로젝트A.md", "업무/프로젝트A/회의록.md", "업무/프로젝트A/도식.png", "업무/주간보고.md", "업무/빈폴더/x.png", "개인/일기/2026-10-07.md", "Upper/a.md", "upper.md", "keyring-settings.md", "루트그림.png"];
  const nodes = buildNodeTree(tree(files));
  it("형제 A.md ↔ A/ 를 한 노드로, 노트 없는 폴더는 빈 노드", () => {
    // 대소문자가 다르면 다른 노드. 이름순(한국어 정렬)
    expect(nodes.map((n) => [n.path, n.note, n.dir])).toEqual([
      ["개인", null, true],
      ["업무", "업무.md", true],
      ["keyring-settings", "keyring-settings.md", false],
      ["upper", "upper.md", false],
      ["Upper", null, true],
    ]);
    const a = findNode(nodes, "업무/프로젝트A")!;
    expect(a).toMatchObject({ note: "업무/프로젝트A.md", dir: true, attachments: ["업무/프로젝트A/도식.png"] });
    expect(a.children.map((c) => c.path)).toEqual(["업무/프로젝트A/회의록"]);
    // 첨부만 든 폴더는 첨부를 가진 빈 노드
    expect(findNode(nodes, "업무/빈폴더")).toMatchObject({ note: null, attachments: ["업무/빈폴더/x.png"] });
    expect(countNode(findNode(nodes, "업무")!)).toEqual({ nodes: 4, attachments: 2 });
  });
  it("숨길 경로는 트리에서 뺀다(공통 설정 파일·워크스페이스 첨부 폴더)", () => {
    const n = buildNodeTree(tree([...files, "개인/_첨부/사진.png"]), { hidden: (p) => p === "keyring-settings.md" || p === "개인/_첨부" });
    expect(n.map((x) => x.path)).toEqual(["개인", "업무", "upper", "Upper"]);
    expect(findNode(n, "개인")!.children.map((c) => c.path)).toEqual(["개인/일기"]);
  });
  it("노드에 드는 파일과 옮긴 경로", () => {
    expect(nodeFiles("업무/프로젝트A", files)).toEqual(["업무/프로젝트A.md", "업무/프로젝트A/도식.png", "업무/프로젝트A/회의록.md"]);
    expect(inNode("업무/프로젝트A2.md", "업무/프로젝트A")).toBe(false);
    expect(moveNodePath("업무/프로젝트A/회의록.md", "업무/프로젝트A", "보관/A")).toBe("보관/A/회의록.md");
    expect(moveNodePath("업무/프로젝트A.md", "업무/프로젝트A", "보관/A")).toBe("보관/A.md");
  });
  it("워크스페이스 = 볼트 루트 노드(공통 설정 파일 제외)", () => {
    expect(workspacesOf(tree(files))).toEqual(["개인", "업무", "upper", "Upper"]);
    expect(workspaceOf("업무/프로젝트A/회의록.md")).toBe("업무");
    expect(workspaceOf("업무.md")).toBe("업무");
    expect(workspaceOf("keyring-settings.md")).toBeNull();
    expect(workspaceOf("루트그림.png")).toBeNull();
  });
});

describe("링크 해석: 같은 워크스페이스 먼저", () => {
  const paths = ["개인/회의.md", "업무/팀/회의.md", "업무/계획.md", "개인/깊은/곳/계획.md", "개인/데일리 노트/2026-10-07.md", "업무/데일리 노트/2026-10-07 회의.md"];
  it("이름이 같으면 링크를 쓴 문서의 워크스페이스 것, 없으면 볼트 전체에서 가장 얕은 것", () => {
    expect(resolveLink("회의", paths, { from: "업무/메모.md" })).toBe("업무/팀/회의.md");
    expect(resolveLink("회의", paths, { from: "개인/메모.md" })).toBe("개인/회의.md");
    expect(resolveLink("회의", paths)).toBe("개인/회의.md");
    expect(resolveLink("계획", paths, { from: "개인/x.md" })).toBe("개인/깊은/곳/계획.md");
    expect(resolveLink("계획", paths, { from: "다른/x.md" })).toBe("업무/계획.md");
    // 경로를 쓰면 그 경로
    expect(resolveLink("업무/팀/회의", paths, { from: "개인/x.md" })).toBe("업무/팀/회의.md");
  });
  it("[[날짜]]는 같은 워크스페이스의 그날 노트가 먼저(정확한 이름이 같은 워크스페이스에 있으면 그것)", () => {
    const s = parseVaultSettings("---\nvault:\n  language: ko\n---\n");
    const daily = dailyLookup(s, () => ["개인", "업무"]);
    expect(resolveLink("2026-10-07", paths, { from: "업무/x.md", daily })).toBe("업무/데일리 노트/2026-10-07 회의.md");
    expect(resolveLink("2026-10-07", paths, { from: "개인/x.md", daily })).toBe("개인/데일리 노트/2026-10-07.md");
    // 데일리가 꺼진 워크스페이스에서는 다른 워크스페이스의 정확한 이름
    const off = dailyLookup(parseVaultSettings("---\nvault:\n  language: ko\nworkspaces:\n  업무:\n    daily:\n      enabled: false\n---\n"), () => ["개인", "업무"]);
    expect(resolveLink("2026-10-07", paths, { from: "업무/x.md", daily: off })).toBe("개인/데일리 노트/2026-10-07.md");
  });
  it("링크 자동 갱신은 이동 전후 같은 워크스페이스 기준으로 비교한다", () => {
    const before = ["개인/회의.md", "업무/팀/회의.md", "업무/메모.md"];
    // 업무/메모.md의 [[회의]]는 업무/팀/회의.md. 그 문서를 개인으로 옮기면 개인/회의.md와 겹치므로 경로를 붙인다
    const moves = new Map([["업무/팀/회의.md", "개인/보관/회의.md"]]);
    const after = ["개인/회의.md", "개인/보관/회의.md", "업무/메모.md"];
    expect(rewriteLinks("[[회의]]", "업무/메모.md", "업무/메모.md", { moves, before, after })?.content).toBe("[[보관/회의]]");
    // 문서 자신이 다른 워크스페이스로 옮겨 가면 그 워크스페이스 기준으로 다시 맞춘다
    const moves2 = new Map([["업무/메모.md", "개인/메모.md"]]);
    expect(rewriteLinks("[[회의]]", "업무/메모.md", "개인/메모.md", { moves: moves2, before, after: ["개인/회의.md", "업무/팀/회의.md", "개인/메모.md"] })?.content).toBe("[[팀/회의]]");
  });
});

describe("설정 파일 키 단위 합치기", () => {
  it("한쪽만 바꾼 키는 그쪽, 양쪽이 다르게 바꾼 키는 서버 값(기기 값은 알림), 지운 키도 전한다", () => {
    const base = { vault: { language: "ko" }, ui: { theme: "light", live: true, keys: { save: "Mod+S" } } };
    const local = { vault: { language: "ko" }, ui: { theme: "dark", keys: { save: "Mod+S", new: "Alt+N" } } };
    const server = { vault: { language: "ko", linkFormat: "full" }, ui: { theme: "system", live: true, keys: { save: "Mod+S" } } };
    const m = mergeSettingsObjects(base, local, server);
    expect(m.merged).toEqual({ vault: { language: "ko", linkFormat: "full" }, ui: { theme: "system", keys: { save: "Mod+S", new: "Alt+N" } } });
    expect(m.conflicts).toEqual([{ key: ["ui", "theme"], local: "dark", server: "system" }]);
  });
  it("기준점이 없으면 한쪽에만 있는 키는 그쪽, 다른 값은 서버", () => {
    const m = mergeSettingsObjects(null, { ui: { theme: "dark", size: 18 } }, { ui: { theme: "light" }, vault: { language: "en" } });
    expect(m.merged).toEqual({ ui: { theme: "light", size: 18 }, vault: { language: "en" } });
    expect(m.conflicts).toEqual([{ key: ["ui", "theme"], local: "dark", server: "light" }]);
  });
});
