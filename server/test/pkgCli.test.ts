import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRepoIndex, PathError } from "@keyring-notes/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRepoIndex, checkPackageDir } from "../src/pkgCli.js";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let repo: string;

const base = { name: { en: "Clock" }, description: { en: "A clock" }, author: "me", license: "MIT", engines: { keyring: ">=0.1.0" } };

async function put(dir: string, files: Record<string, string | object>) {
  for (const [p, v] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), typeof v === "string" ? v : JSON.stringify(v, null, 2));
  }
}

const widgetDir = (v: string) => path.join(repo, "packages", "me", "clock", v);

beforeEach(async () => {
  repo = await mkdtemp(path.join(os.tmpdir(), "keyring-pkg-"));
  for (const v of ["1.0.0", "1.1.0"])
    await put(widgetDir(v), {
      "keyring-package.json": { ...base, id: "@me/clock", version: v, type: "widget", widget: { stateVersion: 1, display: "block", defaultState: {} } },
      "frame.js": `keyringWidgetRegister(() => () => {}); // ${v}`,
      "messages/ko.json": { title: "시계" },
    });
  await put(path.join(repo, "packages", "me", "sea", "0.1.0"), {
    "keyring-package.json": { ...base, id: "@me/sea", version: "0.1.0", type: "theme", colors: { light: { "--bg": "#e0f0ff" } } },
  });
  await put(path.join(repo, "packages", "me", "ja", "1.0.0"), {
    "keyring-package.json": { ...base, id: "@me/ja", version: "1.0.0", type: "language" },
    "messages.json": { meta: { id: "ja", name: "日本語", base: "en" }, messages: {} },
  });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof PathError ? `${e.code}:${String(e.params.reason)}` : String(e instanceof Error ? e.message : e);
  }
  return "no error";
}

describe("checkPackageDir", () => {
  it("올바른 위젯 폴더", async () => {
    const r = await checkPackageDir(widgetDir("1.0.0"));
    expect(r.manifest.id).toBe("@me/clock");
    expect(r.warnings).toEqual([]);
  });
  it("frame.js 가 없으면 market_manifest_invalid", async () => {
    await rm(path.join(widgetDir("1.0.0"), "frame.js"));
    expect(await reason(checkPackageDir(widgetDir("1.0.0")))).toMatch(/^market_manifest_invalid:/);
  });
  it("숨김 파일도 허용 꼴이 아니면 오류(이유에 이름)", async () => {
    await writeFile(path.join(widgetDir("1.0.0"), ".DS_Store"), "x");
    expect(await reason(checkPackageDir(widgetDir("1.0.0")))).toContain(".DS_Store");
  });
});

describe("심볼릭 링크·종류·판 이름", () => {
  it("판 폴더 안의 링크 파일은 오류(이유에 이름)", async () => {
    const outside = path.join(repo, "outside.js");
    await writeFile(outside, "x");
    await rm(path.join(widgetDir("1.0.0"), "frame.js"));
    await symlink(outside, path.join(widgetDir("1.0.0"), "frame.js"));
    expect(await reason(checkPackageDir(widgetDir("1.0.0")))).toContain("frame.js");
    expect(await reason(buildRepoIndex(repo))).toContain("frame.js");
  });

  it("링크된 판·이름·범위 폴더는 건너뛰지 않고 오류", async () => {
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), "keyring-pkg-link-"));
    try {
      await put(path.join(elsewhere, "2.0.0"), {
        "keyring-package.json": { ...base, id: "@me/clock", version: "2.0.0", type: "widget", widget: { stateVersion: 1, display: "block", defaultState: {} } },
        "frame.js": "x",
      });
      await symlink(path.join(elsewhere, "2.0.0"), path.join(repo, "packages", "me", "clock", "2.0.0"));
      expect(await reason(buildRepoIndex(repo))).toContain(path.join("packages", "me", "clock", "2.0.0"));
      await rm(path.join(repo, "packages", "me", "clock", "2.0.0"));
      await symlink(path.join(repo, "packages", "me"), path.join(repo, "packages", "them"));
      expect(await reason(buildRepoIndex(repo))).toContain(path.join("packages", "them"));
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("한 패키지의 판끼리 종류가 다르면 그 폴더를 밝혀 오류", async () => {
    await put(path.join(repo, "packages", "me", "clock", "2.0.0"), {
      "keyring-package.json": { ...base, id: "@me/clock", version: "2.0.0", type: "theme", colors: { light: { "--bg": "#fff" } } },
    });
    expect(await reason(buildRepoIndex(repo))).toContain(path.join("packages", "me", "clock", "2.0.0"));
  });

  it("대소문자 프리릴리스 판 폴더는 오류", async () => {
    await put(path.join(repo, "packages", "me", "clock", "2.0.0-Beta"), {
      "keyring-package.json": {
        ...base,
        id: "@me/clock",
        version: "2.0.0-Beta",
        type: "widget",
        widget: { stateVersion: 1, display: "block", defaultState: {} },
      },
      "frame.js": "x",
    });
    expect(await reason(buildRepoIndex(repo))).toContain(path.join("packages", "me", "clock", "2.0.0-Beta"));
  });
});

describe("buildRepoIndex", () => {
  it("sha256·size 는 실제 파일, type·engines 는 매니페스트, 결과는 parseRepoIndex 가 그대로 읽는다", async () => {
    const { index, written } = await buildRepoIndex(repo, { name: "내 저장소" });
    expect(written).toBe(true);
    expect(Object.keys(index.packages).sort()).toEqual(["@me/clock", "@me/ja", "@me/sea"]);
    expect(Object.keys(index.packages["@me/clock"]!.versions)).toEqual(["1.0.0", "1.1.0"]);
    expect(index.packages["@me/sea"]!.type).toBe("theme");
    expect(index.packages["@me/clock"]!.versions["1.0.0"]!.engines).toEqual({ keyring: ">=0.1.0" });
    for (const f of index.packages["@me/clock"]!.versions["1.1.0"]!.files) {
      const bytes = await readFile(path.join(widgetDir("1.1.0"), f.path));
      expect(f.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(f.size).toBe(bytes.byteLength);
    }
    const onDisk = JSON.parse(await readFile(path.join(repo, "index.json"), "utf8"));
    expect(onDisk).toEqual(index);
    expect(onDisk.name).toBe("내 저장소");
    expect(parseRepoIndex(onDisk, { official: true }).ignored).toEqual([]);
  });

  it("두 번 돌리면 written: false 이고 바이트가 같다(멱등), 이름은 기존 index.json 을 지킨다", async () => {
    await buildRepoIndex(repo, { name: "처음" });
    const first = await readFile(path.join(repo, "index.json"));
    const t1 = (await stat(path.join(repo, "index.json"))).mtimeMs;
    const again = await buildRepoIndex(repo, { name: "다른 이름" });
    expect(again.written).toBe(false);
    expect(again.index.name).toBe("처음");
    const second = await readFile(path.join(repo, "index.json"));
    expect(second.equals(first)).toBe(true);
    expect((await stat(path.join(repo, "index.json"))).mtimeMs).toBe(t1);
    expect(first.toString("utf8").endsWith("}\n")).toBe(true);
    expect(first.toString("utf8")).toContain('\n  "format": 1,');
  });

  it("이름이 없으면 폴더 이름", async () => {
    const { index } = await buildRepoIndex(repo);
    expect(index.name).toBe(path.basename(repo));
  });

  it("폴더 경로와 매니페스트의 id·판이 다르면 그 폴더를 밝혀 오류", async () => {
    await put(path.join(repo, "packages", "me", "clock", "2.0.0"), {
      "keyring-package.json": { ...base, id: "@me/clock", version: "2.0.1", type: "widget", widget: { stateVersion: 1, display: "block", defaultState: {} } },
      "frame.js": "x",
    });
    expect(await reason(buildRepoIndex(repo))).toContain(path.join("packages", "me", "clock", "2.0.0"));
    await rm(path.join(repo, "packages", "me", "clock", "2.0.0"), { recursive: true });
    await put(path.join(repo, "packages", "me", "other", "1.0.0"), {
      "keyring-package.json": { ...base, id: "@me/clock", version: "1.0.0", type: "theme", colors: { light: { "--bg": "#fff" } } },
    });
    expect(await reason(buildRepoIndex(repo))).toContain(path.join("packages", "me", "other", "1.0.0"));
  });
});

function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      path.join(serverDir, "node_modules", ".bin", "tsx"),
      ["--conditions=keyring-source", "src/cli.ts", ...args],
      { cwd: serverDir, env: { ...process.env, KEYRING_LANG: "en", LANG: "en", INIT_CWD: "" } },
      (err, stdout, stderr) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
  });
}

describe("cli pkg", () => {
  it("pkg check: 통과하면 0 과 경고 줄, 잘못된 폴더는 1", async () => {
    const ok = await cli(["pkg", "check", path.join(repo, "packages", "me", "ja", "1.0.0")]);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("@me/ja@1.0.0");
    expect(ok.stdout).toMatch(/warning: missing/i);
    await rm(path.join(widgetDir("1.0.0"), "frame.js"));
    const bad = await cli(["pkg", "check", widgetDir("1.0.0")]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("no_frame_js");
  }, 30000);

  it("pkg index: --name 과 결과 줄, 상대 경로는 INIT_CWD 기준", async () => {
    const r = await cli(["pkg", "index", repo, "--name", "CLI 저장소"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(await readFile(path.join(repo, "index.json"), "utf8")).name).toBe("CLI 저장소");
    const again = await new Promise<{ code: number; stdout: string }>((resolve) =>
      execFile(
        path.join(serverDir, "node_modules", ".bin", "tsx"),
        ["--conditions=keyring-source", path.join(serverDir, "src", "cli.ts"), "pkg", "index", "."],
        { cwd: serverDir, env: { ...process.env, KEYRING_LANG: "en", LANG: "en", INIT_CWD: repo } },
        (err, stdout) => resolve({ code: err ? 1 : 0, stdout }),
      ),
    );
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/unchanged/);
  }, 30000);
});
