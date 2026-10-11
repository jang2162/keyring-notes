import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  dailyFormatProblem,
  dailyLinkDate,
  dailyNotePath,
  dailyNotes,
  dailyTagMismatch,
  dailyTags,
  formatDate,
  lintVault,
  parseDailyPath,
  parseFrontmatter,
  parseVaultSettings,
  planDailyMigration,
  resolveLink,
  rewriteLinks,
  runWidget,
  parseWidget,
  setVaultSetting,
  updateDailyTags,
  weekOf,
  withDailyTags,
  analyze,
  singleDaily,
  dailyLookup,
  workspaceSettings,
  type DailyConfig,
  type DocMeta,
} from "../src/index.js";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("주차·날짜 토큰", () => {
  it("ISO 주차: 연말 경계", () => {
    expect(weekOf(day(2026, 12, 31))).toEqual({ year: 2026, week: 53 });
    expect(weekOf(day(2027, 1, 1))).toEqual({ year: 2026, week: 53 });
    expect(weekOf(day(2027, 1, 3))).toEqual({ year: 2026, week: 53 });
    expect(weekOf(day(2027, 1, 4))).toEqual({ year: 2027, week: 1 });
    expect(weekOf(day(2026, 10, 7))).toEqual({ year: 2026, week: 41 });
    // 2024-12-30(월)은 2025-W01
    expect(weekOf(day(2024, 12, 30))).toEqual({ year: 2025, week: 1 });
    expect(weekOf(day(2021, 1, 3))).toEqual({ year: 2020, week: 53 });
  });
  it("일요일 시작 주", () => {
    // 2026-10-04(일)~10-10(토)이 한 주
    expect(weekOf(day(2026, 10, 4), "sunday")).toEqual(weekOf(day(2026, 10, 10), "sunday"));
    expect(weekOf(day(2026, 10, 4), "sunday")).not.toEqual(weekOf(day(2026, 10, 3), "sunday"));
    // 2026-12-27(일)~2027-01-02(토): 새해에 이틀뿐이라 2026년의 마지막 주
    expect(weekOf(day(2027, 1, 2), "sunday").year).toBe(2026);
    expect(weekOf(day(2027, 1, 3), "sunday")).toEqual({ year: 2027, week: 1 });
  });
  it("형식 토큰", () => {
    const d = day(2026, 10, 7);
    expect(formatDate(d, "GGGG/[W]WW/YYYY-MM-DD")).toBe("2026/W41/2026-10-07");
    expect(formatDate(d, "YYYY년 MMMM D일 dddd", { lang: "ko" })).toBe("2026년 10월 7일 수요일");
    // 볼트 언어가 영어면 월·요일 이름도 영어
    expect(formatDate(d, "dddd, MMMM D (ddd)")).toBe("Wednesday, October 7 (Wed)");
    expect(formatDate(day(2027, 1, 1), "GGGG-[W]WW YYYY")).toBe("2026-W53 2027");
    expect(formatDate(day(2027, 1, 4), "W")).toBe("1");
  });
  it("데일리 경로: 주차 묶음 연말 경계", () => {
    const f = "GGGG/[W]WW/YYYY-MM-DD";
    expect(dailyNotePath("일기", f, day(2026, 12, 31))).toBe("일기/2026/W53/2026-12-31.md");
    expect(dailyNotePath("일기", f, day(2027, 1, 1))).toBe("일기/2026/W53/2027-01-01.md");
    expect(dailyNotePath("일기", f, day(2027, 1, 4))).toBe("일기/2027/W01/2027-01-04.md");
  });
  it("형식 검사", () => {
    expect(dailyFormatProblem("일기", "YYYY-MM-DD")).toBeNull();
    expect(dailyFormatProblem("일기", "GGGG/[W]WW/YYYY-MM-DD")).toBeNull();
    expect(dailyFormatProblem("일기", "YYYY-MM")?.code).toBe("noDay");
    expect(dailyFormatProblem("일기", "YYYY//MM-DD")?.code).toBe("emptySegment");
    expect(dailyFormatProblem("일기", "[.]YYYY/MM-DD")?.code).toBe("dotStart");
    expect(dailyFormatProblem("일기", "YYYY-MM-DD[:]")).toEqual({ code: "badChar", segment: "2026-12-31:" });
    expect(dailyFormatProblem("일기", "[..]/YYYY-MM-DD")?.code).toBe("dotSegment");
  });
});

describe("데일리 판정", () => {
  const flat: DailyConfig = { folder: "일기", format: "YYYY-MM-DD" };
  const weekly: DailyConfig = { folder: "일기", format: "GGGG/[W]WW/YYYY-MM-DD" };
  const flatL = singleDaily("일기", flat);
  const weeklyL = singleDaily("일기", weekly);
  it("이름 앞부분이 날짜면 데일리(날짜 뒤 제목)", () => {
    expect(parseDailyPath("일기/2026-10-07.md", flat)).toMatchObject({ ymd: "2026-10-07", title: "", datePart: "2026-10-07" });
    expect(parseDailyPath("일기/2026-10-07 분기 계획 회의.md", flat)).toMatchObject({ ymd: "2026-10-07", title: "분기 계획 회의" });
    expect(parseDailyPath("일기/2026-10-07 - 회고.md", flat)).toMatchObject({ title: "회고", sep: " - " });
    expect(parseDailyPath("일기/2026-10-07_메모.md", flat)?.title).toBe("메모");
    expect(parseDailyPath("일기/2026-10-07·메모.md", flat)?.title).toBe("메모");
  });
  it("숫자가 이어지거나 폴더·날짜가 안 맞으면 아님", () => {
    expect(parseDailyPath("일기/2026-10-071.md", flat)).toBeNull();
    expect(parseDailyPath("일기/2026-10-07회의.md", flat)).toBeNull();
    expect(parseDailyPath("메모/2026-10-07.md", flat)).toBeNull();
    expect(parseDailyPath("일기/하위/2026-10-07.md", flat)).toBeNull();
    expect(parseDailyPath("일기/2026-02-30.md", flat)).toBeNull();
    expect(parseDailyPath("일기/2026/W41/2026-10-07 회의.md", weekly)?.title).toBe("회의");
    expect(parseDailyPath("일기/2026/W41/2026-10-20.md", weekly)).toBeNull();
    expect(parseDailyPath("일기/2027/W53/2027-01-01.md", weekly)).toBeNull();
    expect(parseDailyPath("일기/2026/W53/2027-01-01.md", weekly)?.ymd).toBe("2027-01-01");
  });
  it("링크 해석: [[날짜]] → 그날 노트, 정확한 이름이 먼저", () => {
    const paths = ["일기/2026-10-07 분기 계획 회의.md", "일기/2026-10-08.md", "메모.md"];
    expect(resolveLink("2026-10-07", paths, { daily: flatL })).toBe("일기/2026-10-07 분기 계획 회의.md");
    expect(resolveLink("2026-10-07", paths)).toBeNull();
    expect(resolveLink("2026-10-08", paths, { daily: flatL })).toBe("일기/2026-10-08.md");
    expect(resolveLink("2026-10-09", paths, { daily: flatL })).toBeNull();
    // 같은 이름의 문서가 있으면 그것
    expect(resolveLink("2026-10-07", [...paths, "보관/2026-10-07.md"], { daily: flatL })).toBe("보관/2026-10-07.md");
    // 같은 날 둘이면 날짜만 있는 것 먼저
    expect(resolveLink("2026-10-07", [...paths, "일기/2026-10-07.md"], { daily: flatL })).toBe("일기/2026-10-07.md");
    const wpaths = ["일기/2026/W53/2027-01-01 새해.md"];
    expect(resolveLink("2027-01-01", wpaths, { daily: weeklyL })).toBe("일기/2026/W53/2027-01-01 새해.md");
    expect(dailyLinkDate("2026/W53/2027-01-01", weekly)?.getDate()).toBe(1);
    expect(dailyLinkDate("2026/W41/2027-01-01", weekly)).toBeNull();
  });
  it("월·요일 이름 토큰은 볼트 언어로 읽는다", () => {
    const ko: DailyConfig = { folder: "일기", format: "YYYY/MMMM/YYYY-MM-DD ddd", lang: "ko" };
    expect(parseDailyPath("일기/2026/10월/2026-10-07 수.md", ko)?.ymd).toBe("2026-10-07");
    expect(parseDailyPath("일기/2026/10월/2026-10-07 목.md", ko)).toBeNull();
    const en: DailyConfig = { folder: "Daily", format: "YYYY/MMMM/YYYY-MM-DD ddd", lang: "en" };
    expect(parseDailyPath("Daily/2026/October/2026-10-07 Wed.md", en)?.ymd).toBe("2026-10-07");
    expect(parseDailyPath("Daily/2026/10월/2026-10-07 수.md", en)).toBeNull();
  });
  it("날짜순 목록", () => {
    const list = dailyNotes(["일기/2026-10-08.md", "일기/2026-10-07 b.md", "일기/2026-10-07.md", "x.md"], flat);
    expect(list.map((n) => n.path)).toEqual(["일기/2026-10-07.md", "일기/2026-10-07 b.md", "일기/2026-10-08.md"]);
  });
});

describe("데일리 태그", () => {
  it("자동 태그와 YAML 형태(템플릿 태그·아이콘과 합침)", () => {
    expect(dailyTags(day(2026, 10, 7), "monday", "ko")).toEqual({ day: "데일리/2026/10/07", monthday: "10-07", week: "2026-W41", weekday: "수요일" });
    expect(dailyTags(day(2026, 10, 7))).toEqual({ day: "daily/2026/10/07", monthday: "10-07", week: "2026-W41", weekday: "Wednesday" });
    const out = withDailyTags("---\ntags: [일기]\nicon: \n---\n본문", day(2026, 10, 7), { icon: "📅", lang: "ko" });
    expect(out).toContain("tags: [데일리/2026/10/07, 10-07, 2026-W41, 수요일, 일기]");
    const fm = parseYaml(out.split("---\n")[1]);
    expect(fm).toMatchObject({ tags: ["데일리/2026/10/07", "10-07", "2026-W41", "수요일", "일기"], icon: "📅" });
    // 날짜 속성은 더 넣지 않는다
    expect(Object.keys(fm).sort()).toEqual(["icon", "tags"]);
    expect(out.endsWith("본문")).toBe(true);
    // 템플릿 없이 만들면 한 줄 목록, 템플릿의 icon이 있으면 그대로
    expect(withDailyTags("", day(2026, 10, 7), { lang: "ko" })).toBe("---\ntags: [데일리/2026/10/07, 10-07, 2026-W41, 수요일]\n---\n");
    expect(parseFrontmatter(withDailyTags("---\nicon: 🌙\n---\n", day(2026, 10, 7), { icon: "📅" })).data?.icon).toBe("🌙");
    // 색인에는 소문자 태그로 들어가고 #데일리 로 하위까지 잡힌다
    expect(analyze("일기/2026-10-07.md", withDailyTags("", day(2026, 10, 7))).tags).toEqual(["10-07", "2026-w41", "daily/2026/10/07", "wednesday"]);
  });
  it("이름 날짜를 바꾸면 있는 자동 태그만 고치고, 어긋나면 점검에 나온다", () => {
    const c = withDailyTags("---\ntags: [회의, 10-07]\n---\n", day(2026, 10, 7), { lang: "ko" });
    const next = updateDailyTags(c, day(2027, 1, 1), "monday", "ko")!;
    expect(parseFrontmatter(next).data?.tags).toEqual(["데일리/2027/01/01", "01-01", "2026-W53", "금요일", "회의"]);
    // 사람이 지운 자동 태그는 다시 넣지 않는다
    const partial = updateDailyTags("---\ntags: [데일리/2026/10/07, 메모]\n---\n", day(2026, 10, 8), "monday", "ko")!;
    expect(parseFrontmatter(partial).data?.tags).toEqual(["데일리/2026/10/08", "메모"]);
    expect(updateDailyTags("---\ntitle: x\n---\n", day(2026, 1, 1))).toBeNull();
    expect(updateDailyTags(c, day(2026, 10, 7), "monday", "ko")).toBeNull();
    expect(dailyTagMismatch(parseFrontmatter(c).data, day(2026, 10, 8))).toEqual(["데일리/2026/10/07", "10-07", "수요일"]);
    expect(dailyTagMismatch(parseFrontmatter(c).data, day(2026, 10, 7))).toEqual([]);
    // 볼트 언어를 바꾼 뒤에도 예전 언어의 자동 태그를 알아본다
    const mixed = "---\ntags: [daily/2026/10/07, 수요일]\n---\n";
    expect(dailyTagMismatch(parseFrontmatter(mixed).data, day(2026, 10, 8))).toEqual(["daily/2026/10/07", "수요일"]);
    expect(parseFrontmatter(updateDailyTags(mixed, day(2026, 10, 8), "monday", "ko")!).data?.tags).toEqual(["데일리/2026/10/08", "목요일"]);
    const cfg = singleDaily("개인", { folder: "개인/일기", format: "YYYY-MM-DD", lang: "ko" });
    const meta = (path: string, content: string): DocMeta => {
      const a = analyze(path, content);
      return { path, title: a.title, summary: a.summary, hash: "h", mtime: Date.now(), size: 1, frontmatter: a.frontmatter, tags: a.tags };
    };
    const report = lintVault({
      docs: [meta("개인/일기/2026-10-08.md", c), meta("개인/일기/2026-10-07.md", c)],
      files: ["개인/일기/2026-10-08.md", "개인/일기/2026-10-07.md"],
      links: [],
      canRead: () => true,
      folder: "",
      daily: cfg,
    });
    expect(report.issues.map((i) => [i.kind, i.path, i.params?.date, i.params?.tags])).toEqual([
      ["daily_mismatch", "개인/일기/2026-10-08.md", "2026-10-08", "데일리/2026/10/07, 10-07, 수요일"],
    ]);
  });
  it("위젯: 태그로 해마다 오늘·그달·그주", () => {
    const meta = (path: string, d: Date): DocMeta => {
      const a = analyze(path, withDailyTags("", d, { lang: "ko" }));
      return { path, title: a.title, summary: "", hash: "h", mtime: 0, size: 1, frontmatter: a.frontmatter, tags: a.tags };
    };
    const docs = [meta("일기/2025-10-07.md", day(2025, 10, 7)), meta("일기/2026-10-07.md", day(2026, 10, 7)), meta("일기/2026-10-08.md", day(2026, 10, 8))];
    const paths = (spec: string) => {
      const r = runWidget(parseWidget(spec), docs, []);
      return r.type === "query" ? r.rows.map((x) => x.path) : null;
    };
    expect(paths('type: query\nfrom: "#10-07"')).toEqual(["일기/2025-10-07.md", "일기/2026-10-07.md"]);
    expect(paths('type: query\nfrom: "#데일리/2026/10"')).toEqual(["일기/2026-10-07.md", "일기/2026-10-08.md"]);
    expect(paths('type: query\nfrom: "#데일리"')).toHaveLength(3);
    expect(paths("type: query\nwhere: tags = 2026-W41")).toEqual(["일기/2026-10-07.md", "일기/2026-10-08.md"]);
  });
});

describe("형식 옮기기·링크", () => {
  it("이름에서 날짜를 읽어 새 형식으로(제목 유지)", () => {
    const cfg: DailyConfig = { folder: "일기", format: "GGGG/[W]WW/YYYY-MM-DD" };
    const plan = planDailyMigration(
      ["일기/2026-10-07.md", "일기/2026-12-31 회고.md", "일기/20270101_새해.md", "일기/메모.md", "일기/2026/W41/2026-10-08.md", "다른/2026-10-07.md"],
      cfg,
    );
    expect(plan.moves.map((m) => [m.from, m.to])).toEqual([
      ["일기/2026-10-07.md", "일기/2026/W41/2026-10-07.md"],
      ["일기/2026-12-31 회고.md", "일기/2026/W53/2026-12-31 회고.md"],
      ["일기/20270101_새해.md", "일기/2026/W53/2027-01-01_새해.md"],
    ]);
    expect(plan.skipped).toEqual([{ path: "일기/메모.md", reason: "noDate" }]);
  });
  it("데일리 노트를 데일리 폴더 밖으로 옮기면 [[날짜]] 링크를 고친다", () => {
    const daily = singleDaily("일기", { folder: "일기", format: "YYYY-MM-DD" });
    const before = ["일기/2026-10-07 회의.md", "a.md"];
    const after = ["보관/2026-10-07 회의.md", "a.md"];
    const moves = new Map([["일기/2026-10-07 회의.md", "보관/2026-10-07 회의.md"]]);
    expect(rewriteLinks("[[2026-10-07]] 참고", "a.md", "a.md", { moves, before, after, daily })?.content).toBe("[[2026-10-07 회의]] 참고");
    // 데일리 폴더 안에서 제목만 바꾸면 그대로 둔다
    const after2 = ["일기/2026-10-07 결정.md", "a.md"];
    expect(
      rewriteLinks("[[2026-10-07]]", "a.md", "a.md", {
        moves: new Map([["일기/2026-10-07 회의.md", "일기/2026-10-07 결정.md"]]),
        before,
        after: after2,
        daily,
      }),
    ).toBeNull();
  });
});

describe("공통 설정 파일", () => {
  it("읽기·쓰기·기본값(워크스페이스별, 볼트 언어의 폴더 이름)", () => {
    expect(workspaceSettings(parseVaultSettings(null), "개인").daily.folder).toBe("Daily");
    let c = setVaultSetting(null, ["vault", "language"], "ko", "ko");
    expect(workspaceSettings(parseVaultSettings(c), "개인")).toMatchObject({
      daily: { folder: "데일리 노트", format: "YYYY-MM-DD", template: "템플릿/데일리.md" },
      attachmentFolder: "_첨부",
      templateFolder: "템플릿",
    });
    c = setVaultSetting(c, ["workspaces", "업무", "daily", "format"], "GGGG/[W]WW/YYYY-MM-DD");
    c = setVaultSetting(c, ["workspaces", "업무", "daily", "weekStart"], "sunday");
    c = setVaultSetting(c, ["workspaces", "개인", "daily", "enabled"], false);
    const s = parseVaultSettings(c);
    expect(workspaceSettings(s, "업무").daily).toMatchObject({ format: "GGGG/[W]WW/YYYY-MM-DD", weekStart: "sunday", folder: "데일리 노트" });
    expect(c).toContain("# Keyring Notes 설정");
    const lookup = dailyLookup(s, () => ["개인", "업무"]);
    expect(lookup.of("개인")).toBeNull();
    expect(lookup.of("업무")).toMatchObject({ folder: "업무/데일리 노트", lang: "ko" });
    // 키를 지우면 빈 묶음도 지운다
    c = setVaultSetting(c, ["workspaces", "개인", "daily", "enabled"], null);
    expect(parseVaultSettings(c).workspaces.개인).toBeUndefined();
    // 쓸 수 없는 형식은 기본값으로
    expect(workspaceSettings(parseVaultSettings("---\nworkspaces:\n  a:\n    daily:\n      format: YYYY-MM\n---\n"), "a").daily.format).toBe("YYYY-MM-DD");
  });
});
