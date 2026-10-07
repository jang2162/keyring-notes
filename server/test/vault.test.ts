import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScopedVault } from "../src/scoped.js";
import type { NoteIndex } from "../src/noteindex.js";
import { hashContent, type Vault } from "../src/vault.js";
import { agentPrincipal, openVault, ownerPrincipal } from "./helpers.js";

let dir: string;
let vault: Vault;
let index: NoteIndex;
let me: ScopedVault;
let agent: ScopedVault;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "keyring-vault-"));
  ({ vault, index } = await openVault(dir, { init: false }));
  me = new ScopedVault(vault, ownerPrincipal, index);
  agent = new ScopedVault(vault, agentPrincipal("openclaw-work", { "/": "delete" }), index);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Vault", () => {
  it("서버 밖에서 넣어 둔 파일을 시작할 때 한 커밋으로 흡수한다", async () => {
    await mkdir(path.join(dir, "업무"), { recursive: true });
    await writeFile(path.join(dir, "업무", "회의.md"), "# 회의\n");
    await mkdir(path.join(dir, ".obsidian"));
    await writeFile(path.join(dir, ".obsidian", "app.json"), "{}");
    await vault.init();

    const log = await vault.git.log();
    expect(log).toHaveLength(1);
    expect(log[0].author).toBe("system");

    const tree = await me.tree();
    expect(tree.map((n) => n.name)).toEqual(["업무"]); // 숨김 폴더는 트리에서 빠진다
    expect(tree[0].children?.[0].path).toBe("업무/회의.md");
  });

  it("쓰기마다 작성자와 함께 커밋하고, 과거 리비전으로 되돌린다", async () => {
    await vault.init();
    const v1 = await me.write("노트/a.md", "첫 버전\n", null);
    const v2 = await agent.write("노트/a.md", "둘째 버전\n", v1.hash);

    const history = await me.history("노트/a.md");
    expect(history.map((h) => h.author)).toEqual(["openclaw-work", "me"]);
    expect(history[1].rev).toBe(v1.rev);

    const old = await me.revision("노트/a.md", v1.rev!);
    expect(old.content).toBe("첫 버전\n");

    const rolled = await me.rollback("노트/a.md", v1.rev!, v2.hash);
    expect(rolled.content).toBe("첫 버전\n");
    expect((await me.read("노트/a.md")).content).toBe("첫 버전\n");
    expect(await me.history("노트/a.md")).toHaveLength(3);
  });

  it("baseHash가 현재 버전과 다르면 덮어쓰지 않는다", async () => {
    await vault.init();
    const v1 = await me.write("a.md", "원본", null);
    await agent.write("a.md", "에이전트 수정", v1.hash);

    await expect(me.write("a.md", "사람 수정", v1.hash)).rejects.toMatchObject({
      currentHash: hashContent("에이전트 수정"),
    });
    // 새 문서로 만들려 했는데 이미 있으면 거부
    await expect(me.write("a.md", "새로", null)).rejects.toThrow();
    expect((await me.read("a.md")).content).toBe("에이전트 수정");
  });

  it("이동과 삭제도 이력에 남고, 빈 폴더는 정리된다", async () => {
    await vault.init();
    const v1 = await me.write("a.md", "내용", null);
    const moved = await me.move("a.md", "폴더/b.md", v1.hash);
    expect(moved.path).toBe("폴더/b.md");
    await expect(me.read("a.md")).rejects.toThrow();
    await me.delete("폴더/b.md", moved.hash);
    await expect(me.read("폴더/b.md")).rejects.toThrow();
    const log = await vault.git.log();
    expect(log.map((l) => l.message)).toEqual(["삭제: 폴더/b.md", "이동: a.md → 폴더/b.md", "생성: a.md"]);
    expect(await me.tree()).toEqual([]);
  });

  it("볼트 밖이나 숨김 경로, 마크다운이 아닌 파일 쓰기는 거부한다", async () => {
    await vault.init();
    for (const bad of ["../x.md", "/etc/passwd", "a/../../x.md", ".history/HEAD", "a/.obsidian/x.md", "a\u0000.md", ""]) {
      await expect(me.write(bad, "x", null), bad).rejects.toThrow();
    }
    await expect(me.write("script.js", "x", null)).rejects.toThrow();
  });

  it("볼트 밖을 가리키는 심볼릭 링크는 따라가지 않는다", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "keyring-outside-"));
    try {
      await writeFile(path.join(outside, "secret.md"), "비밀");
      await mkdir(dir, { recursive: true });
      await symlink(outside, path.join(dir, "link"));
      await vault.init();
      await expect(me.read("link/secret.md")).rejects.toThrow(/볼트 밖/);
      await expect(me.write("link/new.md", "x", null)).rejects.toThrow(/볼트 밖/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("동시에 들어온 쓰기는 직렬화되어 하나만 성공한다", async () => {
    await vault.init();
    const v1 = await me.write("a.md", "원본", null);
    const results = await Promise.allSettled([me.write("a.md", "A", v1.hash), agent.write("a.md", "B", v1.hash)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("일괄 쓰기", () => {
  it("여러 문서 변경을 한 커밋으로 묶는다", async () => {
    await vault.init();
    const a = await me.write("wiki/a.md", "A", null);
    const before = (await vault.git.log()).length;
    const res = await agent.batch(
      [
        { op: "write", path: "wiki/a.md", content: "A2", baseHash: a.hash },
        { op: "write", path: "wiki/b.md", content: "B", baseHash: null },
        { op: "append", path: "wiki/log.md", content: "- 수집: 문서 A" },
        { op: "append", path: "wiki/log.md", content: "- 수집: 문서 B" },
      ],
      "위키 갱신",
    );
    expect(res.rev).toBeTruthy();
    const log = await vault.git.log();
    expect(log).toHaveLength(before + 1);
    expect(log[0]).toMatchObject({ author: "openclaw-work", message: "위키 갱신" });
    expect((await me.read("wiki/log.md")).content).toBe("- 수집: 문서 A\n- 수집: 문서 B");
  });

  it("앞 연산 결과 위에서 검사한다(만든 뒤 옮기기)", async () => {
    await vault.init();
    await agent.batch([
      { op: "write", path: "x.md", content: "X", baseHash: null },
      { op: "move", from: "x.md", to: "y/x.md", baseHash: hashContent("X") },
    ]);
    expect((await me.read("y/x.md")).content).toBe("X");
    await expect(me.read("x.md")).rejects.toThrow();
  });

  it("중간 연산이 실패하면 아무것도 바뀌지 않는다", async () => {
    await vault.init();
    const a = await me.write("a.md", "A", null);
    const before = await vault.git.log();
    await expect(
      agent.batch([
        { op: "write", path: "a.md", content: "A2", baseHash: a.hash },
        { op: "write", path: "new.md", content: "N", baseHash: null },
        { op: "delete", path: "a.md", baseHash: a.hash }, // 앞에서 바뀌었으므로 충돌
      ]),
    ).rejects.toThrow(/먼저 수정/);
    expect((await me.read("a.md")).content).toBe("A");
    await expect(me.read("new.md")).rejects.toThrow();
    expect(await vault.git.log()).toEqual(before);
  });

  it("디스크 적용·커밋 단계에서 실패해도 원래 내용으로 복구한다", async () => {
    await vault.init();
    const a = await me.write("a.md", "A", null);
    const spy = vi.spyOn(vault.git, "commit").mockRejectedValueOnce(new Error("디스크 가득"));
    await expect(
      agent.batch([
        { op: "write", path: "a.md", content: "A2", baseHash: a.hash },
        { op: "write", path: "n/new.md", content: "N", baseHash: null },
      ]),
    ).rejects.toThrow("디스크 가득");
    spy.mockRestore();
    expect(await readFile(path.join(dir, "a.md"), "utf8")).toBe("A");
    await expect(me.read("n/new.md")).rejects.toThrow();
    // 스테이징도 비어 있어 다음 커밋에 섞이지 않는다
    const b = await me.write("b.md", "B", null);
    const log = await vault.git.log();
    expect(log[0].rev).toBe(b.rev);
    expect((await vault.git.show(b.rev!, "a.md"))).toBe("A");
  });
});

describe("자동 저장 묶기", () => {
  it("같은 문서를 잇달아 자동 저장하면 직전 커밋에 합친다", async () => {
    await vault.init();
    const a = await me.write("a.md", "A1", null, { coalesce: true });
    const b = await me.write("a.md", "A2", a.hash, { coalesce: true });
    const c = await me.write("a.md", "A3", b.hash, { coalesce: true });
    const log = await vault.git.log("a.md");
    expect(log).toHaveLength(1);
    expect(log[0].message).toBe("생성: a.md");
    expect(c.rev).toBe(log[0].rev);
    expect(await vault.git.show(c.rev!, "a.md")).toBe("A3");
  });

  it("다른 문서·다른 작성자·백업이 끼면 새 커밋으로 남긴다", async () => {
    await vault.init();
    const a = await me.write("a.md", "A1", null, { coalesce: true });
    await me.write("b.md", "B", null, { coalesce: true });
    const a2 = await me.write("a.md", "A2", a.hash, { coalesce: true });
    expect(await vault.git.log("a.md")).toHaveLength(2);

    // 에이전트 쓰기는 묶지 않는다
    const a3 = await agent.write("a.md", "A3", a2.hash, { coalesce: true });
    const a4 = await me.write("a.md", "A4", a3.hash, { coalesce: true });
    expect(await vault.git.log("a.md")).toHaveLength(4);

    // 백업 직전(서버 밖 변경 흡수) 뒤에는 고쳐 쓰지 않는다
    await vault.absorbOutsideChanges();
    await me.write("a.md", "A5", a4.hash, { coalesce: true });
    expect(await vault.git.log("a.md")).toHaveLength(5);
  });

  it("coalesce 없이 저장하면 늘 새 커밋이다", async () => {
    await vault.init();
    const a = await me.write("a.md", "A1", null);
    await me.write("a.md", "A2", a.hash);
    expect(await vault.git.log("a.md")).toHaveLength(2);
  });
});
