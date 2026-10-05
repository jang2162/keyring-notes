import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashContent, Vault } from "../src/vault.js";

const me = { name: "me", email: "me@test" };
const agent = { name: "openclaw-work", email: "agent@test" };

let dir: string;
let vault: Vault;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "keyring-vault-"));
  vault = new Vault(dir);
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

    const tree = await vault.tree();
    expect(tree.map((n) => n.name)).toEqual(["업무"]); // 숨김 폴더는 트리에서 빠진다
    expect(tree[0].children?.[0].path).toBe("업무/회의.md");
  });

  it("쓰기마다 작성자와 함께 커밋하고, 과거 리비전으로 되돌린다", async () => {
    await vault.init();
    const v1 = await vault.write("노트/a.md", "첫 버전\n", null, me);
    const v2 = await vault.write("노트/a.md", "둘째 버전\n", v1.hash, agent);

    const history = await vault.history("노트/a.md");
    expect(history.map((h) => h.author)).toEqual(["openclaw-work", "me"]);
    expect(history[1].rev).toBe(v1.rev);

    const old = await vault.revision("노트/a.md", v1.rev!);
    expect(old.content).toBe("첫 버전\n");

    const rolled = await vault.rollback("노트/a.md", v1.rev!, v2.hash, me);
    expect(rolled.content).toBe("첫 버전\n");
    expect((await vault.read("노트/a.md")).content).toBe("첫 버전\n");
    expect(await vault.history("노트/a.md")).toHaveLength(3);
  });

  it("baseHash가 현재 버전과 다르면 덮어쓰지 않는다", async () => {
    await vault.init();
    const v1 = await vault.write("a.md", "원본", null, me);
    await vault.write("a.md", "에이전트 수정", v1.hash, agent);

    await expect(vault.write("a.md", "사람 수정", v1.hash, me)).rejects.toMatchObject({
      currentHash: hashContent("에이전트 수정"),
    });
    // 새 문서로 만들려 했는데 이미 있으면 거부
    await expect(vault.write("a.md", "새로", null, me)).rejects.toThrow();
    expect((await vault.read("a.md")).content).toBe("에이전트 수정");
  });

  it("이동과 삭제도 이력에 남는다", async () => {
    await vault.init();
    const v1 = await vault.write("a.md", "내용", null, me);
    const moved = await vault.move("a.md", "폴더/b.md", v1.hash, me);
    expect(moved.path).toBe("폴더/b.md");
    await expect(vault.read("a.md")).rejects.toThrow();
    await vault.delete("폴더/b.md", moved.hash, me);
    await expect(vault.read("폴더/b.md")).rejects.toThrow();
    const log = await vault.git.log();
    expect(log.map((l) => l.message)).toEqual(["삭제: 폴더/b.md", "이동: a.md → 폴더/b.md", "생성: a.md"]);
  });

  it("볼트 밖이나 숨김 경로, 마크다운이 아닌 파일 쓰기는 거부한다", async () => {
    await vault.init();
    for (const bad of ["../x.md", "/etc/passwd", "a/../../x.md", ".history/HEAD", "a/.obsidian/x.md", "a\u0000.md", ""]) {
      await expect(vault.write(bad, "x", null, me), bad).rejects.toThrow();
    }
    await expect(vault.write("script.js", "x", null, me)).rejects.toThrow();
  });

  it("볼트 밖을 가리키는 심볼릭 링크는 따라가지 않는다", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "keyring-outside-"));
    try {
      await writeFile(path.join(outside, "secret.md"), "비밀");
      await mkdir(dir, { recursive: true });
      await symlink(outside, path.join(dir, "link"));
      await vault.init();
      await expect(vault.read("link/secret.md")).rejects.toThrow(/볼트 밖/);
      await expect(vault.write("link/new.md", "x", null, me)).rejects.toThrow(/볼트 밖/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("동시에 들어온 쓰기는 직렬화되어 하나만 성공한다", async () => {
    await vault.init();
    const v1 = await vault.write("a.md", "원본", null, me);
    const results = await Promise.allSettled([
      vault.write("a.md", "A", v1.hash, me),
      vault.write("a.md", "B", v1.hash, agent),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("REST API", () => {
  it("문서 생성·조회·충돌 응답", async () => {
    await vault.init();
    const app = createApp({ vault, author: me });
    const json = { "content-type": "application/json" };

    let res = await app.request("/api/file", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ path: "노트.md", content: "안녕", baseHash: null }),
    });
    expect(res.status).toBe(200);
    const created = await res.json();

    res = await app.request(`/api/file?path=${encodeURIComponent("노트.md")}`);
    expect(await res.json()).toMatchObject({ content: "안녕", hash: created.hash });

    res = await app.request("/api/file", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ path: "노트.md", content: "다시", baseHash: null }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).currentHash).toBe(created.hash);

    res = await app.request("/api/file?path=../x.md");
    expect(res.status).toBe(400);

    // JSON이 아닌 변경 요청은 거부(CSRF 방어)
    res = await app.request("/api/file", { method: "PUT", body: "path=x.md&content=x" });
    expect(res.status).toBe(415);

    res = await app.request(`/api/history?path=${encodeURIComponent("노트.md")}`);
    expect((await res.json()).commits[0].author).toBe("me");
  });
});
