import { describe, expect, it } from "vitest";
import {
  compareSemver,
  isOfficialRepo,
  latestVersion,
  normalizeRepoUrl,
  OFFICIAL_REPO_URL,
  packageCacheDir,
  packageFileAllowed,
  packageFileUrl,
  parsePackageId,
  parseRepoIndex,
  parseSemver,
  PathError,
  satisfies,
  validRange,
} from "../src/index.js";

function code(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    return e instanceof PathError ? e.code : `not PathError: ${String(e)}`;
  }
  return undefined;
}

describe("semver", () => {
  it("parseSemver 는 MAJOR.MINOR.PATCH(-pre) 만 받는다", () => {
    expect(parseSemver("1.2.0")).toEqual({ major: 1, minor: 2, patch: 0, pre: [] });
    expect(parseSemver("1.2.0-alpha.10")).toEqual({ major: 1, minor: 2, patch: 0, pre: ["alpha", 10] });
    for (const v of ["01.2.0", "1.2", "1.2.0+b", "1.2.0-", "v1.2.0", "../1.0.0", "1.2.0-01", "1.2.0-a..b", ""]) expect(parseSemver(v), v).toBeNull();
  });

  it("compareSemver 는 semver 순서", () => {
    expect(compareSemver("1.2.0-alpha", "1.2.0")).toBeLessThan(0);
    expect(compareSemver("1.2.0-alpha.2", "1.2.0-alpha.10")).toBeLessThan(0);
    expect(compareSemver("1.2.0-alpha", "1.2.0-alpha.1")).toBeLessThan(0);
    expect(compareSemver("1.2.0-1", "1.2.0-alpha")).toBeLessThan(0);
    expect(compareSemver("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("bad", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("bad", "worse")).toBe(0);
  });

  it("satisfies·validRange", () => {
    const yes: [string, string][] = [
      ["0.13.0", ">=0.13.0"],
      ["1.4.2", "^1.2.0"],
      ["0.2.5", "^0.2.0"],
      ["1.2.9", "~1.2.0"],
      ["1.0.0", ">=0.9.0 <1.0.0 || 1.0.0"],
      ["5.0.0", "*"],
      ["1.0.0", "=1.0.0"],
      ["0.0.3", "^0.0.3"],
    ];
    const no: [string, string][] = [
      ["0.12.9", ">=0.13.0"],
      ["2.0.0", "^1.2.0"],
      ["0.3.0", "^0.2.0"],
      ["1.3.0", "~1.2.0"],
      ["0.0.4", "^0.0.3"],
      ["1.0.0", ">= banana"],
      ["bad", "*"],
    ];
    for (const [v, r] of yes) expect(satisfies(v, r), `${v} ${r}`).toBe(true);
    for (const [v, r] of no) expect(satisfies(v, r), `${v} ${r}`).toBe(false);
    expect(validRange(">= banana")).toBe(false);
    expect(validRange("")).toBe(false);
    expect(validRange("||")).toBe(false);
    expect(validRange(">=0.13.0 <1.0.0 || ^2.0.0")).toBe(true);
  });
});

describe("패키지 id", () => {
  it("@scope/name 만", () => {
    expect(parsePackageId("@keyring/pomodoro")).toEqual({ scope: "keyring", name: "pomodoro" });
    for (const id of ["keyring/pomodoro", "@Keyring/x", "@a/b/c", "@a/..", "@-a/b", "@a/", "@a/b ", ""]) expect(parsePackageId(id), id).toBeNull();
  });
});

describe("저장소 주소", () => {
  it("정규형은 끝 / 하나", () => {
    expect(normalizeRepoUrl("https://me.github.io/w")).toBe("https://me.github.io/w/");
    expect(normalizeRepoUrl("https://me.github.io/w//")).toBe("https://me.github.io/w/");
    expect(normalizeRepoUrl("HTTPS://Me.GitHub.io/w/")).toBe("https://me.github.io/w/");
  });
  it("http 는 허용할 때만, 사용자·비밀번호·?·# 는 거부", () => {
    expect(code(() => normalizeRepoUrl("http://x/"))).toBe("market_url_protocol");
    expect(normalizeRepoUrl("http://x/", { allowHttp: true })).toBe("http://x/");
    expect(code(() => normalizeRepoUrl("https://u:p@x/"))).toBe("market_url_credentials");
    expect(code(() => normalizeRepoUrl("https://u@x/"))).toBe("market_url_credentials");
    expect(code(() => normalizeRepoUrl("https://x/?a=1"))).toBe("market_url_invalid");
    expect(code(() => normalizeRepoUrl("https://x/?"))).toBe("market_url_invalid");
    expect(code(() => normalizeRepoUrl("https://x/#a"))).toBe("market_url_invalid");
    expect(code(() => normalizeRepoUrl("ftp://x/"))).toBe("market_url_protocol");
    expect(code(() => normalizeRepoUrl("not a url"))).toBe("market_url_invalid");
  });
  it("공식 저장소", () => {
    expect(OFFICIAL_REPO_URL).toBe("https://keyring-notes-marketplace.develma.com/");
    expect(isOfficialRepo("https://keyring-notes-marketplace.develma.com")).toBe(true);
    expect(isOfficialRepo("https://me.github.io/w/")).toBe(false);
    expect(isOfficialRepo("not a url")).toBe(false);
  });
});

describe("패키지 파일", () => {
  it("종류별 허용 꼴", () => {
    for (const p of ["frame.js", "frame.css", "messages/ko.json", "messages/pt-BR.json", "keyring-package.json"])
      expect(packageFileAllowed("widget", p), p).toBe(true);
    for (const p of ["../frame.js", "messages/../x.json", "img.png", "Frame.js", "messages.json", "messages/ko/x.json", "/frame.js", "messages\\ko.json"])
      expect(packageFileAllowed("widget", p), p).toBe(false);
    expect(packageFileAllowed("language", "messages.json")).toBe(true);
    expect(packageFileAllowed("language", "frame.js")).toBe(false);
    expect(packageFileAllowed("theme", "frame.js")).toBe(false);
    expect(packageFileAllowed("theme", "keyring-package.json")).toBe(true);
  });
  it("저장소 주소와 캐시 경로", () => {
    expect(packageFileUrl("https://r.example/m/", "@a/b", "1.0.0", "frame.js")).toBe("https://r.example/m/packages/a/b/1.0.0/frame.js");
    expect(packageCacheDir("@a/b", "1.0.0")).toEqual(["@a", "b", "1.0.0"]);
    expect(code(() => packageCacheDir("@a/b", "../1"))).toBe("market_lock_invalid");
    expect(code(() => packageCacheDir("@a/..", "1.0.0"))).toBe("market_lock_invalid");
    expect(code(() => packageFileUrl("https://r.example/m/", "@a/b", "1.0.0", "../x"))).toBe("market_lock_invalid");
  });
});

const H = (c: string) => c.repeat(64);

function sampleIndex() {
  return {
    format: 1,
    name: "Keyring 공식",
    packages: {
      "@keyring/pomodoro": {
        type: "widget",
        versions: {
          "1.2.0": {
            engines: { keyring: ">=0.13.0" },
            files: [
              { path: "keyring-package.json", sha256: H("a"), size: 812 },
              { path: "frame.js", sha256: H("b"), size: 20480 },
            ],
          },
        },
      },
      "@me/clock": {
        type: "widget",
        versions: {
          "1.0.0": {
            engines: { keyring: "*" },
            files: [
              { path: "keyring-package.json", sha256: H("c"), size: 10 },
              { path: "frame.js", sha256: H("d"), size: 10 },
            ],
          },
        },
      },
    },
  };
}

describe("parseRepoIndex", () => {
  it("설계의 예를 그대로 읽는다", () => {
    const raw = sampleIndex();
    const { index, ignored } = parseRepoIndex(raw, { official: true });
    expect(ignored).toEqual([]);
    expect(index).toEqual(raw);
  });

  it("공식이 아니면 @keyring/… 를 뺀다", () => {
    const { index, ignored } = parseRepoIndex(sampleIndex(), { official: false });
    expect(Object.keys(index.packages)).toEqual(["@me/clock"]);
    expect(ignored).toHaveLength(1);
    expect(ignored[0]).toMatch(/^@keyring\/pomodoro: /);
  });

  it("잘못된 판은 그 판만 뺀다", () => {
    const good = sampleIndex().packages["@me/clock"].versions["1.0.0"];
    const bad: Record<string, unknown> = {
      "1.2": good,
      "1.0.1": { ...good, engines: { keyring: ">= banana" } },
      "1.0.2": { ...good, files: [good.files[0], { path: "frame.js", sha256: "A".repeat(64), size: 1 }] },
      "1.0.3": { ...good, files: [good.files[0], { path: "frame.js", sha256: H("d"), size: -1 }] },
      "1.0.4": { ...good, files: [...good.files, { path: "../x", sha256: H("d"), size: 1 }] },
      "1.0.5": { ...good, files: [...good.files, { path: "frame.js", sha256: H("d"), size: 1 }] },
      "1.0.6": {
        ...good,
        files: [...good.files, { path: "messages/ko.json", sha256: H("d"), size: 1 }, { path: "messages/KO.json", sha256: H("d"), size: 1 }],
      },
      "1.0.7": { ...good, files: [good.files[1]] },
      "1.0.8": { ...good, files: [good.files[0], { path: "frame.js", sha256: H("d"), size: 8388608 }, { path: "frame.css", sha256: H("d"), size: 8388608 }] },
      "1.0.9": { ...good, files: [good.files[0], { path: "frame.js", sha256: H("d"), size: 8388609 }] },
      "1.1.0": good,
    };
    const raw = { format: 1, name: "me", packages: { "@me/clock": { type: "widget", versions: bad } } };
    const { index, ignored } = parseRepoIndex(raw, { official: false });
    expect(Object.keys(index.packages["@me/clock"]!.versions)).toEqual(["1.1.0"]);
    expect(ignored).toHaveLength(Object.keys(bad).length - 1);
    for (const v of Object.keys(bad).filter((v) => v !== "1.1.0"))
      expect(
        ignored.some((x) => x.startsWith(`@me/clock@${v}: `)),
        v,
      ).toBe(true);
  });

  it("잘못된 패키지는 빼고, 맨 모양이 틀리면 market_index_invalid", () => {
    const raw = { format: 1, name: "me", packages: { "@me/x": { type: "font", versions: {} }, "bad id": { type: "widget", versions: {} } } };
    const { index, ignored } = parseRepoIndex(raw, { official: false });
    expect(index.packages).toEqual({});
    expect(ignored).toHaveLength(2);
    expect(code(() => parseRepoIndex({ format: 2, name: "x", packages: {} }, { official: true }))).toBe("market_index_invalid");
    expect(code(() => parseRepoIndex([], { official: true }))).toBe("market_index_invalid");
    expect(code(() => parseRepoIndex({ format: 1, name: "x" }, { official: true }))).toBe("market_index_invalid");
  });
});

describe("latestVersion", () => {
  it("engines 가 맞는 가장 높은 정식 판", () => {
    const f = sampleIndex().packages["@me/clock"].versions["1.0.0"].files;
    const index = parseRepoIndex(
      {
        format: 1,
        name: "x",
        packages: {
          "@me/clock": {
            type: "widget",
            versions: {
              "1.0.0": { engines: { keyring: ">=0.1.0" }, files: f },
              "1.3.0": { engines: { keyring: ">=0.13.0" }, files: f },
              "2.0.0-beta": { engines: { keyring: ">=0.1.0" }, files: f },
            },
          },
        },
      },
      { official: false },
    ).index;
    expect(latestVersion(index, "@me/clock", "0.12.0")).toBe("1.0.0");
    expect(latestVersion(index, "@me/clock", "0.13.0")).toBe("1.3.0");
    expect(latestVersion(index, "@me/clock", "0.0.1")).toBeNull();
    expect(latestVersion(index, "@me/none", "0.13.0")).toBeNull();
  });
});
