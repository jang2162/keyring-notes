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
import { ConflictError, ForbiddenError, NotFoundError, type Vault } from "../src/vault.js";
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
    // 숨김 규칙은 철자가 달라도 적용된다: 정직한 숨김 경로와 같은 답이다
    await expect(agent.history("secret/x.md")).rejects.toBeInstanceOf(NotFoundError);
    await expect(agent.revision("secret/x.md", git("rev-parse", "HEAD"))).rejects.toBeInstanceOf(NotFoundError);
    // 숨김이 아닌 폴더의 다른 철자는 없는 경로다(이력은 비고, 리비전에는 내용이 없다)
    expect(await agent.history("open/a.md")).toEqual([]);
    expect((await agent.revision("open/a.md", git("rev-parse", "HEAD"))).content).toBeNull();
    // 대소문자를 가리는 볼륨과 같은 답: 소유자에게도, 숨김이 아닌 경로에도 없는 문서다
    await expect(owner.read("secret/x.md")).rejects.toBeInstanceOf(NotFoundError);
    await expect(agent.read("open/a.md")).rejects.toBeInstanceOf(NotFoundError);
    expect((await agent.read("Open/a.md")).content).toContain("열린 본문");
    expect((await owner.read("Secret/x.md")).content).toContain("숨김 본문");
  });

  onCaseInsensitive("있는 폴더를 다른 철자로 찔러도 없는 경로와 답이 같다", async () => {
    const agent = agentOf({ "/": "read", Secret: "hidden" });
    const head = git("rev-parse", "HEAD");
    // 읽을 수 있는 폴더의 다른 철자(open)와 정말 없는 폴더(nothere)를 같은 요청으로 견준다. 경로 글자만 맞춰서 본다.
    // 숨김 폴더의 다른 철자는 숨김 경로의 답을 낸다(아래 「다른 철자로 숨김 경로에 쓸 때의 답은…」)
    const answer = async (dir: string, call: (p: string) => Promise<unknown>, p: string) =>
      JSON.stringify(
        await call(`${dir}/${p}`).then(
          (value) => ({ value }),
          (e: unknown) => ({ error: (e as { code?: string }).code, type: (e as Error).constructor.name }),
        ),
      ).replaceAll(dir, "<dir>");
    const calls: [string, (p: string) => Promise<unknown>, string][] = [
      ["read", (p) => agent.read(p), "a.md"],
      ["read", (p) => agent.read(p), "none.md"],
      ["readRaw", (p) => agent.readRaw(p), "a.md"],
      ["readRaw", (p) => agent.readRaw(p), "pic.bin"],
      ["history", (p) => agent.history(p), "a.md"],
      ["revision", (p) => agent.revision(p, head), "a.md"],
      ["revision(잘못된 리비전)", (p) => agent.revision(p, "zzz"), "a.md"],
      ["rollback", (p) => agent.rollback(p, head, null), "a.md"],
      ["outline", (p) => agent.outline(p), "a.md"],
      ["backlinks", (p) => agent.backlinks(p), "a.md"],
    ];
    for (const [name, call, p] of calls) expect(await answer("open", call, p), `${name} ${p}`).toBe(await answer("nothere", call, p));
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
    // 권한과 무관하게(소유자도, 숨김이 아닌 폴더도) 다른 철자로는 그 폴더 안에 쓰지 못한다
    await expect(owner.write("secret/owner.md", "x\n", null)).rejects.toBeInstanceOf(NotFoundError);
    await expect(agent.write("open/new.md", "x\n", null)).rejects.toBeInstanceOf(NotFoundError);
    expect((await readdir(path.join(vault.root, "Secret"))).sort()).toEqual(before);
    expect(await readdir(path.join(vault.root, "Open"))).toEqual(["a.md"]);
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

describe("제한하는 규칙은 대소문자가 달라도 적용되고, 대소문자만 다른 철자로는 권한이 넓어지지 않는다", () => {
  const top = async () => (await readdir(vault.root)).filter((n) => !n.startsWith("."));

  it("판정: 글자로 견준 단계와 접어서 견준 단계 가운데 엄한 쪽", () => {
    const p = new AccessPolicy({ "/": "write", Secret: "hidden", "Secret/public": "read", "Work/Private": "hidden" });
    // 제한하는 규칙은 철자가 달라도 적용된다(폴더·노드 노트·더 깊은 경로)
    for (const path of ["secret/x.md", "SECRET/x.md", "secret.md", "SECRET.MD", "sEcReT/deep/x.md", "Work/private/x.md", "work/PRIVATE.md", "ſecret/x.md"]) {
      expect(p.level(path), path).toBe("hidden");
    }
    // 둘 다 글자로 맞으면 전과 같다
    expect(p.level("Secret/x.md")).toBe("hidden");
    expect(p.level("Secret/public/x.md")).toBe("read");
    expect(p.level("Work/Private/x.md")).toBe("hidden");
    // 접어서 견줘도 가장 구체적인 규칙이 이긴다
    expect(p.level("secret/PUBLIC/x.md")).toBe("read");
    // 접두가 겹치기만 하는 이름, 규칙과 무관한 이름, 규칙의 조상은 전과 같다
    for (const path of ["Secretary/x.md", "Secretary.md", "secretary/x.md", "Other/x.md", "Work/x.md", "work/x.md", "Work/Privateer/x.md", "Work.md"]) {
      expect(p.level(path), path).toBe("write");
    }
    // 규칙이 "/" 하나뿐이면 어떤 철자든 그 단계다
    const all = new AccessPolicy({ "/": "append" });
    for (const path of ["Secret/x.md", "secret/x.md", "A.md"]) expect(all.level(path)).toBe("append");

    // 접어서 견준 쪽이 더 넓으면 넓어지지 않는다
    const widen = new AccessPolicy({ "/": "read", secret: "write" });
    expect(widen.level("secret/x.md")).toBe("write");
    expect(widen.level("Secret/x.md")).toBe("read");
    // 허용 규칙은 글자로 맞아야 넓어진다
    const team = new AccessPolicy({ Team: "write" });
    expect(team.level("Team/a.md")).toBe("write");
    expect(team.level("team/a.md")).toBe("hidden");
    // 대소문자만 다른 규칙 둘은(대소문자를 가리는 볼륨의 두 폴더) 엄한 쪽이 둘 다에 적용된다
    const both = new AccessPolicy({ "/": "read", Secret: "hidden", secret: "write" });
    expect(both.level("Secret/x.md")).toBe("hidden");
    expect(both.level("secret/x.md")).toBe("hidden");
    // 정규화와 대소문자를 함께 바꿔도 같다
    const umlaut = new AccessPolicy({ "/": "write", [nfc("Ärger")]: "hidden" });
    expect(umlaut.level(nfd("ärger/x.md"))).toBe("hidden");
    // 숨김 폴더 아래를 여는 규칙은 폴더의 철자가 달라도 찾는다
    expect(p.mayContainVisible("secret")).toBe(true);
    expect(new AccessPolicy({ "/": "read", Secret: "hidden" }).mayContainVisible("secret")).toBe(false);
  });

  it("숨김 규칙의 폴더가 아직 없을 때 다른 대소문자로 먼저 만들지 못한다(이름 선점)", async () => {
    const agent = agentOf({ "/": "write", Secret: "hidden" });
    await expect(agent.write("secret/a.md", "선점\n", null)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await top()).toEqual([]);
    await owner.write("Secret/비밀.md", "OWNER-SECRET\n", null);
    expect((await owner.tree()).map((n) => n.name)).toEqual(["Secret"]);
    await expect(agent.read("Secret/비밀.md")).rejects.toBeInstanceOf(NotFoundError);
    await expect(agent.read("secret/비밀.md")).rejects.toBeInstanceOf(NotFoundError);
    expect(JSON.stringify(await agent.tree())).not.toContain("비밀");
  });

  it("다른 에이전트나 소유자가 다른 철자로 먼저 만들어도 숨김 규칙이 그 폴더를 가린다", async () => {
    // 에이전트 A 는 Secret 이 숨김, 에이전트 B 는 규칙이 없다. 볼트에 Secret/ 은 아직 없다
    const a = agentOf({ "/": "write", Secret: "hidden" });
    const b = agentOf({ "/": "write" });
    await owner.write("Open/a.md", "열린 본문 #열린태그\n", null);
    // 1. B 가 다른 철자로 먼저 만든다
    expect((await b.write("secret/b.md", "B 의 글\n", null)).rev).toMatch(/^[0-9a-f]{40}$/);
    // 2~3. 소유자가 그 폴더에 노트를 넣는다(Open 을 링크하고 태그를 단다)
    await owner.write("secret/o.md", "---\ntags: [가린태그]\n---\nOWNER-SECRET [[Open/a]]\n", null);
    // 4. A 는 읽지 못하고, 어느 목록에도 나오지 않는다
    for (const p of ["secret/o.md", "secret/b.md", "Secret/o.md", "SECRET/o.md"]) await expect(a.read(p), p).rejects.toBeInstanceOf(NotFoundError);
    await expect(a.readRaw("secret/o.md")).rejects.toBeInstanceOf(NotFoundError);
    await expect(a.history("secret/o.md")).rejects.toBeInstanceOf(NotFoundError);
    expect((await a.tree()).map((n) => n.name)).toEqual(["Open"]);
    expect((await a.documents()).map((d) => d.path)).toEqual(["Open/a.md"]);
    expect((await a.search("OWNER")).map((h) => h.path)).toEqual([]);
    expect(await a.backlinks("Open/a.md")).toEqual([]);
    expect((await a.tags()).map((t) => t.tag)).toEqual(["열린태그"]);
    expect(JSON.stringify(await a.widget("type: table\nfrom: '#가린태그'"))).not.toContain("secret");
    expect(JSON.stringify(await a.graph())).not.toContain("secret");
    expect(JSON.stringify(await a.children())).not.toContain("secret");
    // 5. A 는 그 폴더에 쓰지도 못한다(새로 만들기·고치기·덧붙이기·지우기 모두)
    const o = await owner.read("secret/o.md");
    await expect(a.write("secret/a.md", "x\n", null)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(a.write("secret/o.md", "고침\n", o.hash)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(a.append("secret/o.md", "덧붙임\n")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(a.delete("secret/o.md", o.hash)).rejects.toBeInstanceOf(ForbiddenError);
    // B 와 소유자에게는 그대로 보인다
    expect((await b.read("secret/o.md")).content).toContain("OWNER-SECRET");
    expect((await b.backlinks("Open/a.md")).map((x) => x.path)).toEqual(["secret/o.md"]);
    expect((await owner.read("secret/o.md")).hash).toBe(o.hash);
    expect((await owner.tree()).map((n) => n.name).sort()).toEqual(["Open", "secret"]);
  });

  it("다른 철자로 숨김 경로에 쓸 때의 답은 폴더가 있든 없든 같다", async () => {
    await owner.write("Secret/x.md", "숨김 본문\n", null);
    await owner.batch([{ op: "put", path: "Secret/p.bin", data: new Uint8Array([1]) }]);
    await owner.write("Open/a.md", "열린 본문\n", null);
    // Secret/ 은 디스크에 있고 Vault2/ 는 없다. 둘 다 숨김 규칙이다
    const agent = agentOf({ "/": "delete", Secret: "hidden", Vault2: "hidden" });
    const open = await agent.read("Open/a.md");
    const h = "0".repeat(64);
    const answer = async (dir: string, call: (d: string) => Promise<unknown>) =>
      JSON.stringify(
        await call(dir).then(
          (value) => ({ value }),
          (e: unknown) => ({ type: (e as Error).constructor.name, code: (e as { code?: string }).code, params: (e as { params?: unknown }).params }),
        ),
      ).replaceAll(dir, "<dir>");
    const calls: [string, (d: string) => Promise<unknown>][] = [
      ["write 새 문서", (d) => agent.write(`${d}/new.md`, "x\n", null)],
      ["write 있는 이름", (d) => agent.write(`${d}/x.md`, "x\n", h)],
      ["append", (d) => agent.append(`${d}/x.md`, "x\n")],
      ["delete", (d) => agent.delete(`${d}/x.md`, h)],
      ["putAttachment", (d) => agent.putAttachment(`${d}/p.bin`, new Uint8Array([2]))],
      ["move 목적지", (d) => agent.move("Open/a.md", `${d}/a.md`, open.hash)],
      ["move 출발지", (d) => agent.move(`${d}/x.md`, "Open/moved.md", h)],
      ["moveNode 목적지", (d) => agent.moveNode("Open/a", `${d}/a`)],
      ["deleteNode", (d) => agent.deleteNode(`${d}/x`)],
      ["read", (d) => agent.read(`${d}/x.md`)],
      ["readRaw", (d) => agent.readRaw(`${d}/p.bin`)],
      ["history", (d) => agent.history(`${d}/x.md`)],
      ["outline", (d) => agent.outline(`${d}/x.md`)],
    ];
    for (const [name, call] of calls) {
      const honest = await answer("Vault2", call);
      // 폴더가 있는 쪽의 다른 철자, 폴더가 없는 쪽의 다른 철자, 폴더가 있는 쪽의 정직한 철자가 전부 같은 답이다
      expect(await answer("secret", call), `${name} secret`).toBe(honest);
      expect(await answer("vault2", call), `${name} vault2`).toBe(honest);
      expect(await answer("Secret", call), `${name} Secret`).toBe(honest);
    }
    expect((await readdir(path.join(vault.root, "Secret"))).sort()).toEqual(["p.bin", "x.md"]);
    expect((await owner.read("Open/a.md")).hash).toBe(open.hash);
  });

  it("규칙의 조상을 다른 철자로 만들어도 그 아래의 숨김 규칙은 적용된다", async () => {
    const agent = agentOf({ "/": "write", "Work/Private": "hidden" });
    // 조상 폴더(work/)를 만드는 것은 막지 않는다 — 그 아래에 무엇이 들어가도 규칙이 철자와 상관없이 적용된다
    expect((await agent.write("work/x.md", "x\n", null)).rev).toMatch(/^[0-9a-f]{40}$/);
    await expect(agent.write("work/private/a.md", "x\n", null)).rejects.toBeInstanceOf(ForbiddenError);
    await owner.write("work/Private/s.md", "OWNER-SECRET\n", null);
    await expect(agent.read("work/Private/s.md")).rejects.toBeInstanceOf(NotFoundError);
    expect((await agent.documents()).map((d) => d.path)).toEqual(["work/x.md"]);
  });

  it("규칙과 글자까지 같은 철자, 규칙과 무관한 이름, 접두가 겹치기만 하는 이름은 그대로 만든다", async () => {
    const agent = agentOf({ "/": "write", Secret: "hidden", "Secret/public": "read", "Work/Private": "hidden", Open: "write" });
    for (const p of ["Open/b.md", "Other/x.md", "Secretary/x.md", "Secretary.md", "Work/x.md", "Work/Privateer/x.md", "Work/Privateer.md", "Work.md"]) {
      const r = await agent.write(p, "본문\n", null);
      expect(r.rev, p).toMatch(/^[0-9a-f]{40}$/);
    }
    // 숨김 폴더 아래를 여는 규칙은 글자로 맞을 때 그대로 열린다
    await owner.write("Secret/public/x.md", "공개 본문\n", null);
    await owner.write("Secret/hidden.md", "숨김 본문\n", null);
    expect((await agent.read("Secret/public/x.md")).content).toContain("공개 본문");
    await expect(agent.read("Secret/hidden.md")).rejects.toBeInstanceOf(NotFoundError);
    expect(JSON.stringify(await agent.tree())).toContain("Secret/public/x.md");
    expect(JSON.stringify(await agent.tree())).not.toContain("hidden.md");
    // 허용 규칙은 글자로 맞아야 넓어진다
    const team = agentOf({ Team: "write" });
    expect((await team.write("Team/a.md", "본문\n", null)).rev).toMatch(/^[0-9a-f]{40}$/);
    await expect(team.write("team/b.md", "본문\n", null)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("소유자는 어떤 철자로도 막히지 않는다", async () => {
    // 에이전트 규칙이 있어도 소유자의 읽기·쓰기는 그대로다
    const agent = agentOf({ "/": "read", Secret: "hidden" });
    const made = await owner.write("secret/o.md", "소유자\n", null);
    expect((await owner.read("secret/o.md")).content).toContain("소유자");
    expect((await owner.write("secret/o.md", "고침\n", made.hash)).rev).toMatch(/^[0-9a-f]{40}$/);
    expect((await owner.documents()).map((d) => d.path)).toEqual(["secret/o.md"]);
    expect((await owner.search("고침")).map((h) => h.path)).toEqual(["secret/o.md"]);
    expect((await agent.documents()).map((d) => d.path)).toEqual([]);
  });

  it("위키 목차에도 다른 철자의 숨김 문서가 나오지 않는다", async () => {
    await owner.createTopic("W/Topic");
    await owner.write("W/Topic/wiki/Open.md", "# 열린 쪽\n", null);
    await owner.write("W/Topic/wiki/Private.md", "# 가린 쪽\n", null);
    // 규칙은 private.md, 디스크는 Private.md
    const agent = agentOf({ W: "read", "W/Topic/wiki/private.md": "hidden" });
    const index = (await agent.read("W/Topic/wiki/index.md")).content;
    expect(index).toContain("열린 쪽");
    expect(index).not.toContain("가린 쪽");
    expect(index).not.toContain("Private");
  });

  it("검토 대상도 대소문자를 접어 견준다", async () => {
    const config = new ConfigStore(path.join(root, "config.json"));
    config.update((c) => {
      c.reviewPaths = ["Work/Wiki"];
    });
    const review = new ReviewQueue(vault, config);
    await owner.write("Else/seed.md", "씨앗\n", null);
    const before = git("rev-parse", "HEAD");
    const agent = agentOf({ "/": "write" }, review);
    for (const p of ["Work/wiki/p.md", "Work/WIKI.md", "work/Wiki/p.md", "WORK/WIKI/deep/p.md"]) {
      const r = await agent.write(p, "검토 없이?\n", null);
      expect(r.pending?.proposal, p).toMatch(/^[0-9a-f]{16}$/);
      expect(r.rev, p).toBeNull();
    }
    expect(git("rev-parse", "HEAD")).toBe(before);
    expect(await top()).toEqual(["Else"]);
    // 소유자는 검토 대상 폴더를 그 철자로 만들 수 있다
    await owner.write("Work/Wiki/q.md", "소유자\n", null);
    // 검토 대상과 무관한 이름은 바로 커밋된다
    for (const p of ["Work/Wikipedia.md", "Work/Other/x.md", "Else/x.md"]) expect((await agent.write(p, "바로\n", null)).rev, p).toMatch(/^[0-9a-f]{40}$/);
    expect(underReview("Work/wiki/p.md", ["Work/Wiki"])).toBe(true);
    expect(underReview("work/WIKI.md", ["Work/Wiki/"])).toBe(true);
    expect(underReview(nfd("업무/경제/wiki/금리.md"), [nfc("업무/경제/WIKI")])).toBe(true);
    expect(underReview("Work/other.md", ["Work/Wiki"])).toBe(false);
    expect(underReview("work/other.md", ["Work/Wiki"])).toBe(false);
    expect(underReview("Work/Wikipedia.md", ["Work/Wiki"])).toBe(false);
  });

  it("이미 있는 다른 철자의 검토 대상 폴더 안을 고쳐도 제안으로 쌓인다", async () => {
    const config = new ConfigStore(path.join(root, "config.json"));
    config.update((c) => {
      c.reviewPaths = ["Work/Wiki"];
    });
    const review = new ReviewQueue(vault, config);
    const made = await owner.write("Work/wiki/old.md", "옛 글\n", null);
    const agent = agentOf({ "/": "write" }, review);
    const r = await agent.write("Work/wiki/old.md", "고친 글\n", made.hash);
    expect(r.pending?.proposal).toMatch(/^[0-9a-f]{16}$/);
    expect((await owner.read("Work/wiki/old.md")).hash).toBe(made.hash);
  });

  it("제안 뒤에 숨김 규칙이 생기면, 승인으로 만들어진 다른 철자의 문서도 그 에이전트에게 보이지 않는다", async () => {
    const config = new ConfigStore(path.join(root, "config.json"));
    config.issueToken("probe");
    config.setRules("probe", { "/": "write" });
    config.update((c) => {
      c.reviewPaths = ["/"];
    });
    const review = new ReviewQueue(vault, config);
    const alias = await agentOf({ "/": "write" }, review).write("secret/a.md", "제안\n", null);
    config.setRules("probe", { "/": "write", Secret: "hidden" });
    // 승인은 사람이 본 제안을 그대로 적용한다(권한은 제안할 때 검사했다)
    expect((await review.approve(alias.pending!.proposal, "me")).rev).toMatch(/^[0-9a-f]{40}$/);
    const now = agentOf({ "/": "write", Secret: "hidden" }, review);
    await expect(now.read("secret/a.md")).rejects.toBeInstanceOf(NotFoundError);
    expect(await now.documents()).toEqual([]);
  });
});

describe("한 번의 일괄 쓰기는 대소문자만 다른 두 철자를 함께 남기지 않는다", () => {
  const tracked = () => git("ls-files").split("\n").filter(Boolean);

  it("새 폴더와 그 다른 대소문자 철자를 함께 쓰면 거부하고 아무것도 남기지 않는다", async () => {
    const write = (p: string) => ({ op: "write" as const, path: p, content: "본문\n", baseHash: null });
    for (const pair of [
      ["New/x.md", "new/y.md"],
      ["A/Note.md", "A/note.md"],
      ["Deep/One/x.md", "Deep/one/y.md"],
    ]) {
      await expect(owner.batch(pair.map(write)), pair.join(" + ")).rejects.toBeInstanceOf(ConflictError);
    }
    expect((await readdir(vault.root)).filter((n) => !n.startsWith("."))).toEqual([]);
    expect(tracked()).toEqual([]);
    // 같은 철자끼리는 그대로 된다
    await owner.batch([write("New/x.md"), write("New/y.md"), write("New/Sub/z.md")]);
    expect(tracked().sort()).toEqual(["New/Sub/z.md", "New/x.md", "New/y.md"]);
  });

  it("동시에 다른 철자로 만들어도, 성공한 쓰기는 그 경로로 읽히고 이력에 남는다", async () => {
    const agent = agentOf({ "/": "write" });
    const writes: [ScopedVault, string][] = [
      [owner, "Race/s.md"],
      [agent, "race/new.md"],
    ];
    const settled = await Promise.allSettled(writes.map(([who, p]) => who.write(p, "본문\n", null)));
    const done = writes.filter((_, i) => settled[i].status === "fulfilled").map(([, p]) => p);
    expect(done.length).toBeGreaterThan(0);
    for (const p of done) {
      expect((await owner.read(p)).content, p).toContain("본문");
      expect(tracked(), p).toContain(p);
    }
    // 실패한 쓰기는 디스크에 아무것도 남기지 않는다(다른 철자의 폴더 안에 써지지 않는다)
    expect((await vault.markdownPaths()).sort()).toEqual([...done].sort());
  });
});

describe("위키 생성 문서 판정은 정규화를 맞춘다", () => {
  it("정규화가 다른 철자로 생성 문서를 쓰면 생성 문서 오류로 거부한다", async () => {
    await owner.createTopic(nfc("업무/경제"));
    const agent = agentOf({ "/": "delete" });
    const index = await owner.read(nfc("업무/경제/wiki/index.md"));
    for (const who of [owner, agent]) {
      for (const p of [nfc("업무/경제/wiki/index.md"), nfd("업무/경제/wiki/index.md"), nfd("업무/경제/wiki/log.md")]) {
        await expect(who.write(p, "거짓 목차\n", index.hash), p).rejects.toMatchObject({ code: "generated_readonly" });
      }
    }
    expect((await owner.read(nfc("업무/경제/wiki/index.md"))).content).toBe(index.content);
    expect(wiki.isGenerated(nfd("업무/경제/wiki/index.md"))).toBe(true);
    expect(wiki.isGenerated(nfd("업무/경제/wiki/page.md"))).toBe(false);
    expect(wiki.isGenerated(nfd("업무/다른/wiki/index.md"))).toBe(false);
  });
});
