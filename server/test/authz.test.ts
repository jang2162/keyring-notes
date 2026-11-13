import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessPolicy, type Level } from "../src/access.js";
import { ConfigStore } from "../src/config.js";
import type { NoteIndex } from "../src/noteindex.js";
import { ReviewQueue, underReview } from "../src/review.js";
import { ScopedVault } from "../src/scoped.js";
import { ForbiddenError, NotFoundError, type Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

const nfc = (s: string) => s.normalize("NFC");
const nfd = (s: string) => s.normalize("NFD");
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/**
 * 시험 볼트가 놓이는 볼륨(os.tmpdir())의 성질. 대소문자·정규화를 가리지 않는 볼륨에서만 성립하는 시험은 이 값으로 건너뛴다 —
 * 가리는 볼륨(Linux ext4 등)에서는 다른 철자의 파일이 처음부터 없어 볼 것이 없다
 */
const fsTraits = await (async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "keyring-fsprobe-"));
  try {
    await writeFile(path.join(dir, "a"), "");
    await writeFile(path.join(dir, nfc("가")), "");
    return { caseInsensitive: await exists(path.join(dir, "A")), normInsensitive: await exists(path.join(dir, nfd("가"))) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
})();
if (!fsTraits.caseInsensitive) console.warn("[authz.test] 이 볼륨은 대소문자를 가린다 — 대소문자 시험을 건너뛴다");
if (!fsTraits.normInsensitive) console.warn("[authz.test] 이 볼륨은 유니코드 정규화를 가린다 — 정규화가 다른 철자로 여는 시험을 건너뛴다");
const onCaseInsensitive = it.skipIf(!fsTraits.caseInsensitive);
const onNormInsensitive = it.skipIf(!fsTraits.normInsensitive);

let root: string;
let cleanup: () => Promise<void>;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let owner: ScopedVault;

const agentOf = (rules: Record<string, Level>, review?: ReviewQueue) => new ScopedVault(vault, agentPrincipal("probe", rules), index, wiki, review);

const git = (...args: string[]) =>
  execFileSync("git", ["--git-dir", path.join(vault.root, ".history"), "--work-tree", vault.root, "-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
  }).trim();
const headFiles = () => git("show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);

beforeEach(async () => {
  const t = await tempDir("keyring-authz-");
  root = t.dir;
  cleanup = t.cleanup;
  ({ vault, index, wiki } = await openVault(path.join(root, "vault")));
  owner = new ScopedVault(vault, ownerPrincipal, index, wiki);
});

afterEach(async () => {
  index.close();
  await cleanup();
});

describe("권한 판정은 유니코드 정규화를 맞춘 뒤 견준다", () => {
  it("규칙과 요청의 정규화 형태가 달라도 같은 경로로 본다", () => {
    const composed = new AccessPolicy({ "/": "read", [nfc("W/비밀")]: "hidden" });
    expect(composed.level(nfd("W/비밀/x.md"))).toBe("hidden");
    expect(composed.level(nfd("W/비밀.md"))).toBe("hidden");
    expect(composed.mayContainVisible(nfd("W/비밀"))).toBe(false);
    const decomposed = new AccessPolicy({ "/": "read", [nfd("W/비밀")]: "hidden" });
    expect(decomposed.level(nfc("W/비밀/x.md"))).toBe("hidden");
    expect(new AccessPolicy({ [nfc("W/열린")]: "read" }).level(nfd("W/열린/a.md"))).toBe("read");
  });

  it("디스크의 이름이 NFD 여도 NFC 로 쓴 숨김 규칙이 목록과 읽기를 가린다", async () => {
    await owner.write(nfd("W/비밀/x.md"), "숨김 본문\n", null);
    await owner.write("W/Open.md", "열린 본문\n", null);
    expect(await readdir(path.join(vault.root, "W"))).toContain(nfd("비밀"));
    const agent = agentOf({ "/": "read", [nfc("W/비밀")]: "hidden" });
    await expect(agent.read(nfd("W/비밀/x.md"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(agent.read(nfc("W/비밀/x.md"))).rejects.toBeInstanceOf(NotFoundError);
    expect(nfc(JSON.stringify(await agent.tree()))).not.toContain(nfc("비밀"));
    expect((await agent.documents()).map((d) => d.path)).toEqual(["W/Open.md"]);
    expect((await agent.search("본문")).map((h) => h.path)).toEqual(["W/Open.md"]);
    await expect(agent.write(nfd("W/비밀/new.md"), "x\n", null)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("디스크의 이름이 NFC 일 때 NFD 로 온 요청도 숨김 규칙에 걸린다", async () => {
    await owner.write(nfc("W/금고/y.md"), "숨김 본문\n", null);
    const agent = agentOf({ "/": "read", [nfc("W/금고")]: "hidden" });
    await expect(agent.read(nfd("W/금고/y.md"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(agent.readRaw(nfd("W/금고/y.md"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(agent.history(nfd("W/금고/y.md"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("읽기 규칙은 디스크와 같은 형태로 온 요청에 그대로 적용된다(NFD 디스크·NFD 요청, 규칙은 NFC)", async () => {
    await owner.write(nfd("W/열린/a.md"), "열린 본문\n", null);
    const agent = agentOf({ [nfc("W/열린")]: "read" });
    expect((await agent.read(nfd("W/열린/a.md"))).content).toContain("열린 본문");
  });

  it("정규화가 다른 철자로 위키 생성 문서를 받아도 볼 수 있는 문서만 나온다", async () => {
    await owner.createTopic(nfc("업무/경제"));
    await owner.write(nfc("업무/경제/wiki/공개.md"), "# 열린 쪽\n", null);
    await owner.write(nfc("업무/경제/wiki/비공개.md"), "# 가린 쪽\n", null);
    const agent = agentOf({ "/": "read", [nfc("업무/경제/wiki/비공개.md")]: "hidden" });
    const honest = await agent.read(nfc("업무/경제/wiki/index.md"));
    expect(honest.content).toContain("공개");
    expect(honest.content).not.toContain("비공개");
    // 정규화를 가리는 볼륨에서는 이 철자의 파일이 없다(없는 문서)
    const other = await agent.read(nfd("업무/경제/wiki/index.md")).catch(() => null);
    expect(other?.content ?? "").not.toContain("비공개");
    const raw = await agent.readRaw(nfd("업무/경제/wiki/index.md")).catch(() => null);
    expect(raw?.data.toString("utf8") ?? "").not.toContain("비공개");
  });

  onNormInsensitive("정규화만 다른 정직한 요청은 그 파일을 연다(NFC 요청 ↔ NFD 디스크, NFD 요청 ↔ NFC 디스크)", async () => {
    await owner.write(nfd("W/열린/a.md"), "가 본문\n", null);
    await owner.write(nfc("W/공개/b.md"), "나 본문\n", null);
    const agent = agentOf({ W: "write" });
    for (const s of [owner, agent]) {
      expect((await s.read(nfc("W/열린/a.md"))).content).toContain("가 본문");
      expect((await s.read(nfd("W/공개/b.md"))).content).toContain("나 본문");
    }
    // 새 문서도 이미 있는 폴더 안에 생긴다(정규화만 다른 폴더가 따로 생기지 않는다)
    await agent.write(nfc("W/열린/new.md"), "새 문서\n", null);
    expect((await readdir(path.join(vault.root, "W"))).filter((n) => nfc(n) === nfc("열린"))).toHaveLength(1);
    expect((await owner.read(nfd("W/열린/new.md"))).content).toContain("새 문서");
  });
});

describe("디스크의 실제 철자와 다른 경로는 없는 경로다", () => {
  beforeEach(async () => {
    await owner.write("Secret/x.md", "숨김 본문\n", null);
    await owner.write("Open/a.md", "열린 본문\n", null);
    await owner.batch([{ op: "put", path: "Secret/pic.bin", data: new Uint8Array([1, 2, 3]) }]);
  });

  onCaseInsensitive("대소문자만 다른 경로로는 숨김 문서를 읽지 못한다", async () => {
    const agent = agentOf({ "/": "read", Secret: "hidden" });
    for (const p of ["secret/x.md", "SECRET/X.MD", "Secret/X.md"]) {
      await expect(agent.read(p), p).rejects.toBeInstanceOf(NotFoundError);
      await expect(agent.outline(p), p).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(agent.readRaw("secret/pic.bin")).rejects.toBeInstanceOf(NotFoundError);
    await expect(agent.readRaw("SECRET/x.md")).rejects.toBeInstanceOf(NotFoundError);
    expect(await agent.history("secret/x.md")).toEqual([]);
    expect((await agent.revision("secret/x.md", git("rev-parse", "HEAD"))).content).toBeNull();
    // 대소문자를 가리는 볼륨과 같은 답: 소유자에게도, 숨김이 아닌 경로에도 없는 문서다
    await expect(owner.read("secret/x.md")).rejects.toBeInstanceOf(NotFoundError);
    await expect(agent.read("open/a.md")).rejects.toBeInstanceOf(NotFoundError);
    expect((await agent.read("Open/a.md")).content).toContain("열린 본문");
    expect((await owner.read("Secret/x.md")).content).toContain("숨김 본문");
  });

  onCaseInsensitive("다른 철자로 숨김 폴더를 찔러도 없는 경로와 답이 같다", async () => {
    const agent = agentOf({ "/": "read", Secret: "hidden" });
    const head = git("rev-parse", "HEAD");
    // 숨김 폴더의 다른 철자(secret)와 정말 없는 폴더(nothere)를 같은 요청으로 견준다. 경로 글자만 맞춰서 본다
    const answer = async (dir: string, call: (p: string) => Promise<unknown>, p: string) =>
      JSON.stringify(
        await call(`${dir}/${p}`).then(
          (value) => ({ value }),
          (e: unknown) => ({ error: (e as { code?: string }).code, type: (e as Error).constructor.name }),
        ),
      ).replaceAll(dir, "<dir>");
    const calls: [string, (p: string) => Promise<unknown>, string][] = [
      ["read", (p) => agent.read(p), "x.md"],
      ["read", (p) => agent.read(p), "none.md"],
      ["readRaw", (p) => agent.readRaw(p), "x.md"],
      ["readRaw", (p) => agent.readRaw(p), "pic.bin"],
      ["history", (p) => agent.history(p), "x.md"],
      ["revision", (p) => agent.revision(p, head), "x.md"],
      ["revision(잘못된 리비전)", (p) => agent.revision(p, "zzz"), "x.md"],
      ["rollback", (p) => agent.rollback(p, head, null), "x.md"],
      ["outline", (p) => agent.outline(p), "x.md"],
      ["backlinks", (p) => agent.backlinks(p), "x.md"],
    ];
    for (const [name, call, p] of calls) expect(await answer("secret", call, p), `${name} ${p}`).toBe(await answer("nothere", call, p));
  });

  onCaseInsensitive("대소문자만 다른 경로로 쓰면 숨김 폴더 안에 파일이 생기지 않는다", async () => {
    const agent = agentOf({ "/": "delete", Secret: "hidden" });
    const before = (await readdir(path.join(vault.root, "Secret"))).sort();
    const open = await agent.read("Open/a.md");
    await expect(agent.write("secret/new.md", "x\n", null)).rejects.toThrow();
    await expect(agent.write("SECRET/sub/deep/new.md", "x\n", null)).rejects.toThrow();
    await expect(agent.append("secret/x.md", "덧붙임\n")).rejects.toThrow();
    await expect(agent.putAttachment("secret/new.bin", new Uint8Array([9]))).rejects.toThrow();
    await expect(agent.move("Open/a.md", "secret/moved.md", open.hash)).rejects.toThrow();
    expect((await readdir(path.join(vault.root, "Secret"))).sort()).toEqual(before);
    expect((await owner.read("Secret/x.md")).content).not.toContain("덧붙임");
    expect((await owner.read("Open/a.md")).content).toContain("열린 본문");
    // 정직한 경로의 쓰기는 그대로 된다
    await agent.write("Open/b.md", "새 문서\n", null);
    expect(await readdir(path.join(vault.root, "Open"))).toContain("b.md");
  });
});

describe("사람 전용 파일은 다른 철자로도 에이전트가 만들거나 고치지 못한다", () => {
  it("공통 설정 파일이 아직 없을 때 다른 철자로 만들지 못한다", async () => {
    const agent = agentOf({ "/": "delete" });
    for (const p of ["Keyring-Settings.md", "KEYRING-SETTINGS.MD", "keyring-ſettings.md", nfd("keyring-settings.md")]) {
      await expect(agent.write(p, "---\nvault:\n  language: en\n---\n", null), p).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await readdir(vault.root)).not.toContain("Keyring-Settings.md");
    expect(vault.sharedSettings().language).toBeNull();
  });

  it("공통 설정 파일이 있을 때 다른 철자로 고치거나 옮겨 오지 못한다", async () => {
    const made = await owner.write("keyring-settings.md", "---\nvault:\n  language: ko\n---\n", null);
    await owner.write("W/a.md", "본문\n", null);
    const agent = agentOf({ "/": "delete" });
    await expect(agent.write("Keyring-Settings.md", "---\nvault:\n  language: en\n---\n", made.hash)).rejects.toThrow();
    const a = await agent.read("W/a.md");
    await expect(agent.move("W/a.md", "KEYRING-SETTINGS.md", a.hash)).rejects.toThrow();
    expect((await owner.read("keyring-settings.md")).hash).toBe(made.hash);
  });

  it("토픽의 SCHEMA.md 를 다른 철자로 만들지 못한다", async () => {
    await owner.write("W/Topic/note.md", "본문\n", null);
    const agent = agentOf({ W: "delete" });
    for (const p of ["W/Topic/schema.md", "W/Topic/Schema.MD"]) {
      await expect(agent.write(p, "# 규칙\n", null), p).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await readdir(path.join(vault.root, "W", "Topic"))).map((n) => n.toLowerCase())).not.toContain("schema.md");
  });
});

describe("git 은 경로를 글자 그대로 받는다", () => {
  beforeEach(async () => {
    await owner.write("Work/Open.md", "열린 본문\n", null);
    await owner.write("Work/Private/alpha.md", "숨김 본문\n", null);
  });

  it("글롭·매직 pathspec 으로 숨김 파일의 이력을 캐내지 못한다", async () => {
    const agent = agentOf({ "/": "read", "Work/Private": "hidden" });
    for (const p of ["Work/Privat[e]/a*", "Work/Privat[e]/z*", ":(glob)Work/**/alpha.md", ":(icase)work/private/alpha.md", ":(exclude)nothing", "Work/Pr*"]) {
      expect(await agent.history(p), p).toEqual([]);
    }
    expect(await agent.history("Work/Open.md")).toHaveLength(1);
    await expect(agent.history("Work/Private/alpha.md")).rejects.toBeInstanceOf(NotFoundError);
    // 소유자도 같다: 글롭은 그 이름의 파일일 뿐이다
    expect(await owner.history("Work/Privat[e]/a*")).toEqual([]);
    expect(await owner.history("Work/Private/alpha.md")).toHaveLength(1);
  });

  it("이름이 글롭인 파일을 써도 다른 파일이 그 커밋에 섞이지 않는다", async () => {
    // 서버 밖에서 생긴 변경(아직 커밋 전)
    await writeFile(path.join(vault.root, "Work", "outside.md"), "밖에서 쓴 글\n");
    await writeFile(path.join(vault.root, "Work", "Open.md"), "밖에서 고친 글\n");
    await owner.write("Work/*.md", "별표 문서\n", null);
    expect(headFiles()).toEqual(["Work/*.md"]);
    expect(await owner.history("Work/*.md")).toHaveLength(1);
    expect(await owner.history("Work/Open.md")).toHaveLength(1);
  });

  it("이름이 매직 pathspec 인 파일을 써도 그 파일만 커밋된다", async () => {
    await writeFile(path.join(vault.root, "Work", "outside.md"), "밖에서 쓴 글\n");
    await owner.write(":(exclude)W/x.md", "매직 이름\n", null);
    expect(headFiles()).toEqual([":(exclude)W/x.md"]);
    await owner.write(":(top)y.md", "매직 이름\n", null);
    expect(headFiles()).toEqual([":(top)y.md"]);
  });

  it("스테이징 되돌리기도 그 경로만 되돌린다", async () => {
    await mkdir(path.join(vault.root, "Work"), { recursive: true });
    await writeFile(path.join(vault.root, "Work", "*.md"), "별표\n");
    await writeFile(path.join(vault.root, "Work", "other.md"), "다른 글\n");
    git("add", "--all");
    await vault.git.unstage(["Work/*.md"]);
    expect(git("diff", "--cached", "--name-only")).toBe("Work/other.md");
  });
});

describe("과거 리비전은 지금 이력에 있는 커밋의 파일만 내준다", () => {
  let first: string;
  beforeEach(async () => {
    await owner.write("Work/Open.md", "첫 내용\n", null);
    first = git("rev-parse", "HEAD");
    await owner.write("Work/Private/alpha.md", "숨김 본문\n", null);
    await owner.write("Work/Wiki/page.md", "위키\n", null);
    await owner.write("Work/Open.md", "둘째 내용\n", (await owner.read("Work/Open.md")).hash);
  });

  it("디렉터리 경로로 숨김 자식의 이름을 받지 못한다", async () => {
    const agent = agentOf({ Work: "read", "Work/Private": "hidden" });
    const head = (await agent.history("Work/Open.md"))[0].rev;
    for (const p of ["Work", "Work/Wiki"]) {
      const r = await agent.revision(p, head);
      expect(r.content, p).toBeNull();
      expect(JSON.stringify(r)).not.toContain("Private");
    }
    expect((await owner.revision("Work", head)).content).toBeNull();
  });

  it("파일의 과거 내용은 그대로 받는다(소유자·에이전트)", async () => {
    const agent = agentOf({ Work: "read", "Work/Private": "hidden" });
    const revs = (await owner.history("Work/Open.md")).map((c) => c.rev);
    expect(revs).toHaveLength(2);
    for (const s of [owner, agent]) {
      expect((await s.revision("Work/Open.md", revs[1])).content).toContain("첫 내용");
      expect((await s.revision("Work/Open.md", revs[0])).content).toContain("둘째 내용");
      // 줄인 해시도 된다
      expect((await s.revision("Work/Open.md", first.slice(0, 10))).content).toContain("첫 내용");
    }
    // 그 리비전에 없던 문서는 내용이 없다
    expect((await owner.revision("Work/Wiki/page.md", first)).content).toBeNull();
    await expect(agent.revision("Work/Private/alpha.md", revs[0])).rejects.toBeInstanceOf(NotFoundError);
  });

  it("커밋이 아니거나 지금 이력에 없는 리비전은 받지 않는다", async () => {
    const tree = git("rev-parse", "HEAD^{tree}");
    const dangling = git("-c", "user.name=x", "-c", "user.email=x@test", "commit-tree", tree, "-m", "이력 밖 커밋");
    expect((await owner.revision("Work/Open.md", tree)).content).toBeNull();
    expect((await owner.revision("Work/Open.md", dangling)).content).toBeNull();
    const cur = await owner.read("Work/Open.md");
    await expect(owner.rollback("Work/Open.md", dangling, cur.hash)).rejects.toBeInstanceOf(NotFoundError);
    // 지금 이력의 커밋으로는 되돌릴 수 있다
    expect((await owner.rollback("Work/Open.md", first, cur.hash)).content).toContain("첫 내용");
  });
});

describe("검토 대상 경로는 노드 노트와 정규화가 다른 철자를 덮는다", () => {
  it("판정: 노드 노트(X.md)와 정규화만 다른 경로도 검토 대상이다", () => {
    expect(underReview("Work/Wiki.md", ["Work/Wiki"])).toBe(true);
    expect(underReview("Work/Wiki/page.md", ["Work/Wiki/"])).toBe(true);
    expect(underReview("Work/Wiki.md", ["Work/Wiki/"])).toBe(true);
    expect(underReview("Work/Wikipedia.md", ["Work/Wiki"])).toBe(false);
    expect(underReview("Work/Wiki.mdx", ["Work/Wiki"])).toBe(false);
    expect(underReview(nfd("업무/경제/wiki/금리.md"), [nfc("업무/경제/wiki")])).toBe(true);
    expect(underReview(nfc("업무/경제.md"), [nfd("업무/경제")])).toBe(true);
    expect(underReview("아무거나.md", ["/"])).toBe(true);
  });

  it("검토 대상 노드의 노트를 에이전트가 쓰면 제안으로 쌓인다", async () => {
    const config = new ConfigStore(path.join(root, "config.json"));
    config.update((c) => {
      c.reviewPaths = ["Work/Wiki"];
    });
    const review = new ReviewQueue(vault, config);
    await owner.write("Work/Wiki/page.md", "위키\n", null);
    const agent = agentOf({ Work: "write" }, review);
    const before = git("rev-parse", "HEAD");
    const note = await agent.write("Work/Wiki.md", "노드 노트\n", null);
    expect(note.pending?.proposal).toMatch(/^[0-9a-f]{16}$/);
    expect(git("rev-parse", "HEAD")).toBe(before);
    expect(await exists(path.join(vault.root, "Work", "Wiki.md"))).toBe(false);
    // 검토 대상이 아닌 이웃은 바로 커밋된다
    const other = await agent.write("Work/Wikipedia.md", "이웃\n", null);
    expect(other.pending).toBeUndefined();
    expect(other.rev).toMatch(/^[0-9a-f]{40}$/);
  });
});
