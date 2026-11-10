import { describe, expect, it } from "vitest";
import {
  enginesOk,
  lockEntryValue,
  OFFICIAL_REPO_URL,
  parseMarketplace,
  parseVaultSettings,
  planCache,
  resolveInstall,
  setVaultSetting,
  type LockEntry,
  type PackageManifest,
  type RepoIndexResult,
} from "../src/index.js";

const H = (c: string) => c.repeat(64);

const designYaml = `---
keyring: settings
marketplace:
  repos:
    - url: https://market.keyring.example/
    - url: https://me.github.io/my-widgets
  packages:
    "@keyring/pomodoro": { version: 1.2.0, repo: https://market.keyring.example/, sha256: { keyring-package.json: ${H("a")}, frame.js: ${H("b")} } }
---
`;

describe("공통 설정의 marketplace", () => {
  it("설계의 YAML 예", () => {
    const m = parseVaultSettings(designYaml).marketplace;
    expect(m.repos).toEqual(["https://market.keyring.example/", "https://me.github.io/my-widgets/"]);
    expect(m.packages["@keyring/pomodoro"]).toEqual({
      version: "1.2.0",
      repo: "https://market.keyring.example/",
      sha256: { "keyring-package.json": H("a"), "frame.js": H("b") },
    });
    expect(m.problems).toEqual([]);
  });

  it("repos 가 없으면 공식 하나, repos: [] 는 빈 목록", () => {
    expect(parseVaultSettings("---\nkeyring: settings\n---\n").marketplace).toEqual({ repos: [OFFICIAL_REPO_URL], packages: {}, problems: [] });
    expect(parseVaultSettings(null).marketplace.repos).toEqual([OFFICIAL_REPO_URL]);
    expect(parseMarketplace({ repos: [] }).repos).toEqual([]);
    // 잘못된 주소는 빼고, 같은 주소는 한 번만, 글자 꼴도 받는다
    expect(parseMarketplace({ repos: [{ url: "ftp://x/" }, { url: "https://a/" }, "https://a", 3] }).repos).toEqual(["https://a/"]);
  });

  it("잘못된 잠금 항목은 그것만 빼고 problems 에", () => {
    const ok = { version: "1.0.0", repo: "https://a/", sha256: { "keyring-package.json": H("a") } };
    const bad: Record<string, unknown> = {
      "@a/v": { ...ok, version: "../../x" },
      "@a/../b": ok,
      "@a/p": { ...ok, sha256: { "keyring-package.json": H("a"), "../../config/keyring.json": H("b") } },
      "@a/h": { ...ok, sha256: { "keyring-package.json": "a".repeat(63) } },
      "@a/r": { ...ok, repo: "ftp://a/" },
      "@a/m": { ...ok, sha256: { "frame.js": H("a") } },
      "@a/s": "1.0.0",
      "@a/u": { ...ok, version: "1.0.0-Beta" },
    };
    const m = parseMarketplace({ packages: { "@a/ok": ok, ...bad, "@a/http": { ...ok, repo: "http://home.lan/m" } } });
    expect(Object.keys(m.packages)).toEqual(["@a/ok", "@a/http"]);
    expect(m.packages["@a/http"]!.repo).toBe("http://home.lan/m/");
    expect(m.problems).toEqual(Object.keys(bad).map((id) => ({ id, code: "market_lock_invalid" })));
  });

  it("lockEntryValue 로 쓴 글을 다시 읽으면 같은 항목", () => {
    const e: LockEntry = { version: "1.2.0", repo: OFFICIAL_REPO_URL, sha256: { "keyring-package.json": H("a"), "frame.js": H("b") } };
    const v = lockEntryValue(e);
    expect(Object.keys(v)).toEqual(["version", "repo", "sha256"]);
    expect(Object.keys(v.sha256 as object)).toEqual(["frame.js", "keyring-package.json"]);
    const text = setVaultSetting(null, ["marketplace", "packages", "@keyring/pomodoro"], v);
    expect(text).toContain('"@keyring/pomodoro"');
    expect(parseVaultSettings(text).marketplace.packages["@keyring/pomodoro"]).toEqual(e);
  });
});

describe("resolveInstall", () => {
  const PERSONAL = "https://me.github.io/w/";
  const files = (c: string) => [
    { path: "keyring-package.json", sha256: H(c), size: 10 },
    { path: "frame.js", sha256: H(c), size: 20 },
  ];
  const widget = (versions: Record<string, { engines: { keyring: string }; files: ReturnType<typeof files> }>) => ({ type: "widget" as const, versions });
  const official: RepoIndexResult = {
    repo: OFFICIAL_REPO_URL,
    ignored: [],
    index: {
      format: 1,
      name: "공식",
      packages: {
        "@keyring/pomodoro": widget({ "1.2.0": { engines: { keyring: ">=0.1.0" }, files: files("a") } }),
        "@me/clock": widget({
          "1.0.0": { engines: { keyring: ">=0.1.0" }, files: files("b") },
          "2.0.0": { engines: { keyring: ">=9.0.0" }, files: files("c") },
        }),
      },
    },
  };
  const personal: RepoIndexResult = {
    repo: PERSONAL,
    ignored: [],
    index: { format: 1, name: "me", packages: { "@me/clock": widget({ "1.1.0": { engines: { keyring: "*" }, files: files("d") } }) } },
  };
  const broken: RepoIndexResult = { repo: "https://down/", index: null, ignored: [], error: { code: "market_timeout", params: {} } };
  const all = [broken, official, personal];

  it("목록 위의 저장소, 다른 저장소에도 있으면 alsoIn", () => {
    const r = resolveInstall(all, {}, "@me/clock", "0.12.0");
    expect(r).toEqual({
      ok: true,
      entry: { version: "1.0.0", repo: OFFICIAL_REPO_URL, sha256: { "keyring-package.json": H("b"), "frame.js": H("b") } },
      sizes: { "keyring-package.json": 10, "frame.js": 20 },
      type: "widget",
      alsoIn: [PERSONAL],
    });
  });

  it("잠금에 있으면 그 repo 에서만(우선순위·opts.repo 와 상관없이)", () => {
    const lock = { "@me/clock": { version: "1.1.0", repo: PERSONAL, sha256: { "keyring-package.json": H("d") } } };
    const r = resolveInstall(all, lock, "@me/clock", "0.12.0", { repo: OFFICIAL_REPO_URL });
    expect(r.ok && r.entry.repo).toBe(PERSONAL);
    expect(r.ok && r.entry.version).toBe("1.1.0");
  });

  it("opts.repo 로 고른 저장소", () => {
    const r = resolveInstall(all, {}, "@me/clock", "0.12.0", { repo: "https://me.github.io/w" });
    expect(r.ok && r.entry.repo).toBe(PERSONAL);
  });

  it("@keyring 은 공식 저장소에서만", () => {
    expect(resolveInstall(all, {}, "@keyring/pomodoro", "0.12.0", { repo: PERSONAL })).toEqual({
      ok: false,
      code: "market_scope_reserved",
      params: { id: "@keyring/pomodoro" },
    });
    const lock = { "@keyring/pomodoro": { version: "1.2.0", repo: PERSONAL, sha256: { "keyring-package.json": H("a") } } };
    expect(resolveInstall(all, lock, "@keyring/pomodoro", "0.12.0")).toMatchObject({ ok: false, code: "market_scope_reserved" });
    expect(resolveInstall(all, {}, "@keyring/pomodoro", "0.12.0")).toMatchObject({ ok: true });
  });

  it("engines·없는 id·없는 판", () => {
    expect(resolveInstall(all, {}, "@me/clock", "0.12.0", { version: "2.0.0" })).toEqual({
      ok: false,
      code: "market_engines",
      params: { range: ">=9.0.0", version: "0.12.0" },
    });
    expect(resolveInstall(all, {}, "@me/none", "0.12.0")).toMatchObject({ ok: false, code: "market_not_found", params: { id: "@me/none" } });
    expect(resolveInstall(all, {}, "@me/clock", "0.12.0", { version: "9.9.9" })).toMatchObject({ ok: false, code: "market_not_found" });
    expect(resolveInstall(all, {}, "@me/clock", "0.12.0", { version: "1.0.0-BETA" })).toMatchObject({ ok: false, code: "market_not_found" });
    expect(resolveInstall([official], {}, "@me/clock", "0.0.1")).toMatchObject({ ok: false, code: "market_engines" });
  });
});

describe("planCache", () => {
  const e = (version: string, c: string): LockEntry => ({ version, repo: "https://a/", sha256: { "keyring-package.json": H(c) } });
  it("없거나 sha 가 다르면 받고, 잠금에 없는 판은 지운다", () => {
    const lock = { "@a/b": e("1.0.0", "a") };
    expect(
      planCache(lock, [
        { id: "@a/b", version: "0.9.0", sha256: { "keyring-package.json": H("a") } },
        { id: "@c/d", version: "1.0.0", sha256: { "keyring-package.json": H("a") } },
      ]),
    ).toEqual({
      fetch: [{ id: "@a/b", entry: lock["@a/b"] }],
      remove: [
        { id: "@a/b", version: "0.9.0" },
        { id: "@c/d", version: "1.0.0" },
      ],
    });
    expect(planCache(lock, [{ id: "@a/b", version: "1.0.0", sha256: { "keyring-package.json": H("b") } }])).toEqual({
      fetch: [{ id: "@a/b", entry: lock["@a/b"] }],
      remove: [],
    });
    expect(planCache(lock, [{ id: "@a/b", version: "1.0.0", sha256: { "keyring-package.json": H("a") } }])).toEqual({ fetch: [], remove: [] });
    expect(planCache(lock, [{ id: "@a/b", version: "1.0.0", sha256: { "keyring-package.json": H("a"), "frame.js": H("a") } }]).fetch).toHaveLength(1);
  });
});

describe("enginesOk", () => {
  it("매니페스트의 engines.keyring 과 앱 판", () => {
    const m = { engines: { keyring: ">=0.13.0" } } as PackageManifest;
    expect(enginesOk(m, "0.13.0")).toBe(true);
    expect(enginesOk(m, "0.12.0")).toBe(false);
  });
});
