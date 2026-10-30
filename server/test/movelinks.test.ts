import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withoutEdited } from "@keyring-notes/core";
import { ConfigStore } from "../src/config.js";
import type { NoteIndex } from "../src/noteindex.js";
import { ReviewQueue } from "../src/review.js";
import { ScopedVault } from "../src/scoped.js";
import type { Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

let cleanup: () => Promise<void>;
let root: string;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let owner: ScopedVault;

const git = (...args: string[]) =>
  execFileSync("git", ["--git-dir", path.join(vault.root, ".history"), "--work-tree", vault.root, "-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
  }).trim();

beforeEach(async () => {
  const t = await tempDir("keyring-movelinks-");
  root = t.dir;
  cleanup = t.cleanup;
  ({ vault, index, wiki } = await openVault(path.join(root, "vault")));
  owner = new ScopedVault(vault, ownerPrincipal, index, wiki);
  await owner.batch([
    { op: "write", path: "업무/계획.md", content: "# 계획\n[회의](회의록.md)\n", baseHash: null },
    { op: "write", path: "업무/회의록.md", content: "# 회의록\n[[계획]] 참고\n", baseHash: null },
    { op: "write", path: "일기/오늘.md", content: "---\nsources: ['[[계획]]']\n---\n[[업무/계획#일정|일정]] [본문](../업무/계획.md)\n", baseHash: null },
    { op: "write", path: "비밀/숨은.md", content: "[[계획]]\n", baseHash: null },
    { op: "write", path: "공개/읽기만.md", content: "[[계획]]\n", baseHash: null },
  ]);
});

afterEach(async () => {
  index.close();
  await cleanup();
});

describe("이동 때 링크 자동 갱신(서버)", () => {
  it("이동과 링크 갱신이 한 커밋에 들어간다", async () => {
    const plan = await owner.read("업무/계획.md");
    const r = await owner.move("업무/계획.md", "보관/2026 계획.md", plan.hash);
    expect(withoutEdited(r.content)).toBe("# 계획\n[회의](../업무/회의록.md)\n");
    expect(r.linksUpdated.sort()).toEqual(["공개/읽기만.md", "보관/2026 계획.md", "비밀/숨은.md", "업무/회의록.md", "일기/오늘.md"]);
    expect(r.linkCount).toBe(7);
    expect(withoutEdited((await owner.read("업무/회의록.md")).content)).toBe("# 회의록\n[[2026 계획]] 참고\n");
    expect(withoutEdited((await owner.read("일기/오늘.md")).content)).toBe(
      "---\nsources: ['[[2026 계획]]']\n---\n[[보관/2026 계획#일정|일정]] [본문](../보관/2026%20계획.md)\n",
    );
    // 커밋 하나, 제목은 이동, 본문에 링크 갱신
    expect(git("log", "-1", "--format=%s")).toBe("이동: 업무/계획.md → 보관/2026 계획.md");
    expect(git("log", "-1", "--format=%b")).toContain("링크 갱신: 일기/오늘.md");
    // 이름 바꾸기 판정 없이 본다 — 수정 시각이 적혀 내용 비율이 달라지면 git 이 옛 경로를 이름 바꾸기로 접는다
    expect(git("show", "--name-only", "--no-renames", "--format=", "HEAD").split("\n").sort()).toEqual(
      ["공개/읽기만.md", "보관/2026 계획.md", "비밀/숨은.md", "업무/계획.md", "업무/회의록.md", "일기/오늘.md"].sort(),
    );
    // 인덱스 백링크가 새 위치로
    expect((await owner.backlinks("보관/2026 계획.md")).map((b) => b.path)).toContain("업무/회의록.md");
    expect((await owner.lint()).issues.filter((i) => i.kind === "broken_link" || i.kind === "broken_source")).toEqual([]);
  });

  it("옵션을 끄면 고치지 않는다", async () => {
    const plan = await owner.read("업무/계획.md");
    const meeting = (await owner.read("업무/회의록.md")).content;
    const r = await owner.move("업무/계획.md", "보관/계획2.md", plan.hash, { updateLinks: false });
    expect(r.linksUpdated).toEqual([]);
    // 손대지 않았다(수정 시각 줄까지 글자 그대로)
    expect((await owner.read("업무/회의록.md")).content).toBe(meeting);
    const b = await owner.batch([{ op: "move", from: "보관/계획2.md", to: "보관/계획3.md", baseHash: r.hash }], undefined, { updateLinks: false });
    expect(b.linksUpdated).toEqual([]);
  });

  it("같은 일괄 쓰기의 연쇄 이동을 합치고, 바뀐 문서만 files에 넣는다", async () => {
    const plan = await owner.read("업무/계획.md");
    const moved = await owner.batch([
      { op: "move", from: "업무/계획.md", to: "임시/계획.md", baseHash: plan.hash },
      { op: "move", from: "임시/계획.md", to: "최종/새계획.md", baseHash: plan.hash },
    ]);
    expect(withoutEdited((await owner.read("업무/회의록.md")).content)).toBe("# 회의록\n[[새계획]] 참고\n");
    expect(moved.files.map((f) => f.path)).not.toContain("임시/계획.md");
    expect(moved.files.map((f) => f.path)).toContain("업무/회의록.md");
  });

  it("에이전트: 볼 수 없거나 쓸 수 없는 문서는 그대로 두고 응답에도 나오지 않으며, 고친 링크는 전체 경로", async () => {
    const agent = new ScopedVault(vault, agentPrincipal("bot", { 업무: "delete", 보관: "delete", 일기: "write", 공개: "read" }), index, wiki);
    const plan = await agent.read("업무/계획.md");
    const hidden = (await owner.read("비밀/숨은.md")).content;
    const readOnly = (await owner.read("공개/읽기만.md")).content;
    const r = await agent.move("업무/계획.md", "보관/새계획.md", plan.hash);
    expect(r.linksUpdated.sort()).toEqual(["보관/새계획.md", "업무/회의록.md", "일기/오늘.md"]);
    expect(withoutEdited((await owner.read("업무/회의록.md")).content)).toBe("# 회의록\n[[보관/새계획]] 참고\n");
    // 숨김·읽기 전용 노트는 손대지 않았다(수정 시각 줄까지 글자 그대로)
    expect((await owner.read("비밀/숨은.md")).content).toBe(hidden);
    expect((await owner.read("공개/읽기만.md")).content).toBe(readOnly);
    // batch 응답에도 숨김·읽기 전용 경로가 없다
    const again = await agent.read("보관/새계획.md");
    const b = await agent.batch([{ op: "move", from: "보관/새계획.md", to: "보관/새계획2.md", baseHash: again.hash }]);
    const paths = b.files.map((f) => f.path);
    expect(paths.some((p) => p.startsWith("비밀/") || p.startsWith("공개/"))).toBe(false);
    expect(JSON.stringify(b)).not.toContain("비밀");
  });

  it("검토 대상 경로면 제안 미리보기에 링크 갱신이 들어가고, 승인하면 같이 반영된다", async () => {
    const config = new ConfigStore(path.join(root, "config.json"));
    const rules = { 업무: "delete", 보관: "delete", 일기: "write" } as const;
    config.issueToken("bot");
    config.setRules("bot", { ...rules });
    config.update((c) => {
      c.reviewPaths = ["일기"];
    });
    const review = new ReviewQueue(vault, config);
    const agent = new ScopedVault(vault, agentPrincipal("bot", { ...rules }), index, wiki, review);
    const plan = await agent.read("업무/계획.md");
    const diary = (await owner.read("일기/오늘.md")).content;
    const meeting = (await owner.read("업무/회의록.md")).content;
    const hidden = (await owner.read("비밀/숨은.md")).content;
    // 이동 자체는 검토 대상이 아니지만, 링크 갱신이 검토 대상(일기)에 닿으므로 제안이 된다
    const r = await agent.move("업무/계획.md", "보관/새계획.md", plan.hash);
    expect(r.pending).toBeDefined();
    const proposal = await review.get(r.pending!.proposal);
    expect(proposal.preview.map((p) => p.path).sort()).toEqual(["보관/새계획.md", "업무/계획.md", "업무/회의록.md", "일기/오늘.md"]);
    expect(proposal.preview.find((p) => p.path === "일기/오늘.md")!.after).toContain("[[보관/새계획]]");
    // 아직 그대로(수정 시각 줄까지 글자 그대로)
    expect((await owner.read("일기/오늘.md")).content).toBe(diary);
    expect((await owner.read("업무/회의록.md")).content).toBe(meeting);
    // 승인 전 사람이 숨김 문서에 같은 이름 링크를 하나 더 만들어도 승인 때 끼어들지 않는다
    const fresh = (await owner.write("비밀/새로.md", "[[계획]]\n", null)).content;
    await review.approve(proposal.id, "me");
    expect((await owner.read("일기/오늘.md")).content).toContain("[[보관/새계획]]");
    expect(withoutEdited((await owner.read("업무/회의록.md")).content)).toBe("# 회의록\n[[보관/새계획]] 참고\n");
    expect((await owner.read("비밀/새로.md")).content).toBe(fresh);
    expect((await owner.read("비밀/숨은.md")).content).toBe(hidden);
  });
});

describe("블록 단위 출처(서버)", () => {
  it("sources에 문단 위치가 나오고, 없는 블록은 정리 점검에 잡힌다. 개요 섹션은 ^id로 읽는다", async () => {
    await owner.write("원본.md", "# 원본\n\n중요한 문단. ^key\n\n다른 문단.\n", null);
    await owner.write("정리.md", "---\nsources: ['[[원본#^key]]', '[[원본#^gone]]']\n---\n# 정리\n", null);
    const s = await owner.sources("정리.md");
    expect(s.sources).toEqual([
      { target: "원본", path: "원본.md", anchor: "^key" },
      { target: "원본", path: "원본.md", anchor: "^gone" },
    ]);
    const lint = await owner.lint();
    expect(lint.issues.filter((i) => i.kind === "broken_source").map((i) => i.target)).toEqual(["원본#^gone"]);
    expect((await owner.section("원본.md", { heading: "^key" })).content).toBe("중요한 문단. ^key");
  });
});
