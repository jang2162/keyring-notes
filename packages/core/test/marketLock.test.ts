import { describe, expect, it } from "vitest";
import { lockEntryValue, OFFICIAL_REPO_URL, parseMarketplace, parseVaultSettings, setVaultSetting, type LockEntry } from "../src/index.js";

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
