import { OFFICIAL_REPO_URL, type IndexVersion, type LockEntry, type PackageType, type RepoIndexResult } from "@keyring-notes/core";
import { describe, expect, it } from "vitest";
import { browseRows, MARKET_KINDS, repoAdd, repoMove, repoRemove } from "./view";

const A = "https://a.example/";
const B = "https://b.example/";
const files = [{ path: "keyring-package.json", sha256: "a".repeat(64), size: 1 }];
const ver = (extra: Partial<IndexVersion> = {}, keyring = "*"): IndexVersion => ({ engines: { keyring }, files, ...extra });

function repo(url: string, name: string, packages: Record<string, { type: PackageType; versions: Record<string, IndexVersion> }>): RepoIndexResult {
  return { repo: url, index: { format: 1, name, packages }, ignored: [] };
}
const lock = (version: string, r: string): LockEntry => ({ version, repo: r, sha256: { "keyring-package.json": "a".repeat(64) } });

describe("browseRows", () => {
  const sea = {
    type: "theme" as const,
    versions: { "0.1.0": ver({ name: { en: "Sea", ko: "바다" }, description: { en: "Blue" }, author: "me", license: "MIT" }) },
  };
  const indexes = [
    repo(A, "A repo", { "@me/sea": sea, "@me/clock": { type: "widget", versions: { "1.0.0": ver() } } }),
    repo(B, "B repo", {
      "@me/sea": { type: "theme", versions: { "0.1.0": ver(), "0.2.0": ver() } },
      "@me/ja": { type: "language", versions: { "1.0.0": ver({}, ">=99.0.0") } },
    }),
  ];

  it("같은 id 는 행 하나, 위 저장소, alsoIn 에 아래 것", () => {
    const rows = browseRows(indexes, {}, "0.12.0", "ko");
    const s = rows.find((r) => r.id === "@me/sea")!;
    expect(s).toMatchObject({ repo: A, repoName: "A repo", version: "0.1.0", alsoIn: [B], installed: null, update: null, incompatible: null });
    expect(s.info).toEqual({ name: "바다", description: "Blue", author: "me", license: "MIT" });
    expect(rows.filter((r) => r.id === "@me/sea")).toHaveLength(1);
  });

  it("설치된 것은 잠금의 저장소 행, 더 높은 맞는 판이면 update", () => {
    const s = browseRows(indexes, { "@me/sea": lock("0.1.0", B) }, "0.12.0", "en").find((r) => r.id === "@me/sea")!;
    expect(s).toMatchObject({ repo: B, alsoIn: [A], version: "0.2.0", update: "0.2.0" });
    expect(s.info.name).toBeNull();
    expect(browseRows(indexes, { "@me/sea": lock("0.1.0", A) }, "0.12.0", "en").find((r) => r.id === "@me/sea")!.update).toBeNull();
  });

  it("프리릴리스는 update 로 고르지 않는다", () => {
    const idx = [repo(A, "A", { "@me/sea": { type: "theme", versions: { "1.0.0": ver(), "1.2.0-beta": ver() } } })];
    expect(browseRows(idx, { "@me/sea": lock("1.0.0", A) }, "0.12.0", "en")[0]!.update).toBeNull();
  });

  it("맞는 판이 없으면 version null·incompatible.range", () => {
    const j = browseRows(indexes, {}, "0.12.0", "en").find((r) => r.id === "@me/ja")!;
    expect(j).toMatchObject({ version: null, incompatible: { range: ">=99.0.0" } });
  });

  it("오류 난 저장소는 행을 만들지 않고, 위젯 행도 나오며 설치는 꺼진 종류", () => {
    const rows = browseRows([{ repo: A, index: null, ignored: [], error: { code: "market_timeout", params: {} } }, indexes[1]!], {}, "0.12.0", "en");
    expect(rows.map((r) => r.repo)).toEqual([B, B]);
    const all = browseRows(indexes, {}, "0.12.0", "en");
    expect(all.find((r) => r.id === "@me/clock")!.type).toBe("widget");
    expect(MARKET_KINDS.widget.installable).toBe(false);
    expect(MARKET_KINDS.theme.installable).toBe(true);
    expect(MARKET_KINDS.language.installable).toBe(true);
  });

  it("정렬: 종류(테마·언어·위젯) → 이름(없으면 id)", () => {
    expect(browseRows(indexes, {}, "0.12.0", "en").map((r) => r.id)).toEqual(["@me/sea", "@me/ja", "@me/clock"]);
    const two = [
      repo(A, "A", {
        "@me/zz": { type: "theme", versions: { "1.0.0": ver({ name: { en: "Alpha" } }) } },
        "@me/aa": { type: "theme", versions: { "1.0.0": ver() } },
      }),
    ];
    expect(browseRows(two, {}, "0.12.0", "en").map((r) => r.id)).toEqual(["@me/aa", "@me/zz"]);
  });

  it("표시 필드가 없는 index 는 info 가 모두 null", () => {
    const r = browseRows([repo(A, "", { "@me/x": { type: "theme", versions: { "1.0.0": ver() } } })], {}, "0.12.0", "en")[0]!;
    expect(r.info).toEqual({ name: null, description: null, author: null, license: null });
    expect(r.repoName).toBe(A);
  });
});

describe("저장소 목록 고치기", () => {
  it("repoAdd: 정규형·중복·꼴 오류·http 는 기록으로 받음", () => {
    expect(repoAdd([A], "https://a.example")).toEqual({ error: "market_repo_duplicate" });
    expect(repoAdd([A], "ftp://x")).toEqual({ error: "market_url_protocol" });
    expect(repoAdd([A], "https://u:p@x/")).toEqual({ error: "market_url_credentials" });
    expect(repoAdd([A], "not a url")).toEqual({ error: "market_url_invalid" });
    expect(repoAdd([A], "http://10.0.0.2/r")).toEqual({ repos: [A, "http://10.0.0.2/r/"] });
    expect(repoAdd([], ` ${B} `)).toEqual({ repos: [B] });
  });

  it("repoMove: 끝에서는 그대로, repoRemove: 공식도 뺄 수 있다", () => {
    const l = [OFFICIAL_REPO_URL, A, B];
    expect(repoMove(l, 0, -1)).toEqual(l);
    expect(repoMove(l, 2, 1)).toEqual(l);
    expect(repoMove(l, 1, -1)).toEqual([A, OFFICIAL_REPO_URL, B]);
    expect(repoMove(l, 1, 1)).toEqual([OFFICIAL_REPO_URL, B, A]);
    expect(repoRemove(l, 0)).toEqual([A, B]);
    expect(l).toEqual([OFFICIAL_REPO_URL, A, B]);
  });
});
