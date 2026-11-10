import { describe, expect, it } from "vitest";
import { checkPackageFiles, checkThemeColors, isThemeColor, parseManifest, PathError, utf8 } from "../src/index.js";

function reason(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    if (e instanceof PathError && e.code === "market_manifest_invalid") return String(e.params.reason);
    return `other: ${e instanceof PathError ? e.code : String(e)}`;
  }
  return undefined;
}

const base = {
  id: "@me/clock",
  version: "1.0.0",
  name: { en: "Clock", ko: "시계" },
  description: { en: "A clock" },
  author: "me",
  license: "MIT",
  engines: { keyring: ">=0.12.0" },
};
const widgetManifest = { ...base, type: "widget", widget: { stateVersion: 1, display: "block", defaultState: {} } };

function files(entries: Record<string, string | Uint8Array | object>): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(entries)) m.set(k, v instanceof Uint8Array ? v : utf8(typeof v === "string" ? v : JSON.stringify(v)));
  return m;
}

describe("isThemeColor", () => {
  it("엄격한 색 꼴만", () => {
    for (const v of [
      "#abc",
      "#a1b2c3",
      "#a1b2c3d4",
      "rgb(1 2 3)",
      "rgb(1, 2, 3)",
      "rgb(1 2 3 / 50%)",
      "hsl(120 50% 40%)",
      "hsl(120deg 50% 40%)",
      "oklch(0.7 0.1 200)",
      "oklch(70% 0.1 200 / 0.5)",
      "oklab(0.5 -0.1 0.1)",
    ])
      expect(isThemeColor(v), v).toBe(true);
    for (const v of [
      "red",
      "#abcd5",
      "url(x)",
      "var(--x)",
      "rgb(1 2 3);x",
      "#fff}",
      "rgb(calc(1) 2 3)",
      "expression(1)",
      "rgb(1 2 3) !important",
      "rgb()",
      "rgb(1 2 3))",
      "",
      "#fff\\",
      "rgb(1 2 3)\n",
      "rgb(red 1 2)",
      "rgb(1;2 3)",
      'rgb(1 2 3 / "x")',
      "hsl(1 2 3 <b>)",
    ])
      expect(isThemeColor(v), JSON.stringify(v)).toBe(false);
  });
});

describe("checkThemeColors", () => {
  it("토큰 이름 꼴·크기 꼴·값", () => {
    const r = checkThemeColors({ light: { "--bg": "#fff", "--fs-body": "#000", bg: "#fff", "--fg": "url(a)" } });
    expect(r.errors).toHaveLength(3);
    expect(r.unknownTokens).toEqual([]);
    for (const t of ["--font-ui", "--radius-sm", "--bar-h", "--side-w"]) expect(checkThemeColors({ dark: { [t]: "#000" } }).errors, t).toHaveLength(1);
  });
  it("알려진 목록을 주면 모르는 토큰을 센다", () => {
    expect(checkThemeColors({ dark: { "--bg": "#000", "--zz": "#111" } }, ["--bg"])).toEqual({ errors: [], unknownTokens: ["--zz"] });
  });
});

describe("parseManifest", () => {
  it("위젯 매니페스트", () => {
    const m = parseManifest(widgetManifest);
    expect(m).toMatchObject({ id: "@me/clock", type: "widget", widget: { stateVersion: 1, display: "block", defaultState: {} } });
    const df = parseManifest({ ...widgetManifest, widget: { ...widgetManifest.widget, dataFile: { ext: "json", initial: "{}", name: { en: "data" } } } });
    expect(df.widget?.dataFile).toEqual({ ext: "json", initial: "{}", name: { en: "data" } });
  });
  it("공통 필드가 틀리면 market_manifest_invalid", () => {
    expect(reason(() => parseManifest([]))).toBeDefined();
    for (const bad of [
      { ...widgetManifest, id: "me/clock" },
      { ...widgetManifest, version: "1.0" },
      { ...widgetManifest, type: "font" },
      { ...widgetManifest, name: {} },
      { ...widgetManifest, name: "Clock" },
      { ...widgetManifest, description: undefined },
      { ...widgetManifest, author: 1 },
      { ...widgetManifest, license: undefined },
      { ...widgetManifest, engines: { keyring: ">= banana" } },
    ])
      expect(
        reason(() => parseManifest(bad)),
        JSON.stringify(bad).slice(0, 80),
      ).not.toMatch(/^other/);
  });
});

describe("checkPackageFiles", () => {
  const frame = "keyringWidgetRegister({});";

  it("위젯: 매니페스트 + frame.js 통과", () => {
    const r = checkPackageFiles(files({ "keyring-package.json": widgetManifest, "frame.js": frame, "messages/ko.json": { a: "가" } }), {
      id: "@me/clock",
      version: "1.0.0",
      type: "widget",
    });
    expect(r.manifest.id).toBe("@me/clock");
    expect(r.warnings).toEqual([]);
  });

  it("위젯: 틀린 묶음은 market_manifest_invalid", () => {
    const w = widgetManifest.widget;
    const cases: [string, Map<string, Uint8Array>, { id: string; version: string; type: "widget" }?][] = [
      ["frame.js 없음", files({ "keyring-package.json": widgetManifest })],
      ["img.png", files({ "keyring-package.json": widgetManifest, "frame.js": frame, "img.png": "x" })],
      ["대소문자", files({ "keyring-package.json": widgetManifest, "frame.js": frame, "messages/ko.json": {}, "messages/KO.json": {} })],
      ["합 16 MiB 초과", files({ "keyring-package.json": widgetManifest, "frame.js": new Uint8Array(8388608), "frame.css": new Uint8Array(8388608) })],
      ["id 다름", files({ "keyring-package.json": widgetManifest, "frame.js": frame }), { id: "@me/other", version: "1.0.0", type: "widget" }],
      ["stateVersion 0", files({ "keyring-package.json": { ...widgetManifest, widget: { ...w, stateVersion: 0 } }, "frame.js": frame })],
      ["display x", files({ "keyring-package.json": { ...widgetManifest, widget: { ...w, display: "x" } }, "frame.js": frame })],
      [
        "dataFile.initial 빔",
        files({ "keyring-package.json": { ...widgetManifest, widget: { ...w, dataFile: { ext: "json", initial: "" } } }, "frame.js": frame }),
      ],
      ["isolation inline", files({ "keyring-package.json": { ...widgetManifest, widget: { ...w, isolation: "inline" } }, "frame.js": frame })],
      ["widget 없음", files({ "keyring-package.json": { ...widgetManifest, widget: undefined }, "frame.js": frame })],
      ["매니페스트 JSON 아님", files({ "keyring-package.json": "{", "frame.js": frame })],
      ["매니페스트 없음", files({ "frame.js": frame })],
      ["messages JSON 아님", files({ "keyring-package.json": widgetManifest, "frame.js": frame, "messages/ko.json": "{" })],
    ];
    for (const [label, f, expect_] of cases)
      expect(
        reason(() => checkPackageFiles(f, expect_)),
        label,
      ).toBeDefined();
    for (const [label, f, expect_] of cases)
      expect(
        reason(() => checkPackageFiles(f, expect_)),
        label,
      ).not.toMatch(/^other/);
  });

  it("언어: checkPack 오류는 오류, 빠진 키는 경고", () => {
    const lang = { ...base, id: "@me/ja", type: "language" };
    const ok = checkPackageFiles(files({ "keyring-package.json": lang, "messages.json": { meta: { id: "ja", name: "日本語", base: "en" }, messages: {} } }));
    expect(ok.warnings.some((w) => w.startsWith("missing"))).toBe(true);
    expect(reason(() => checkPackageFiles(files({ "keyring-package.json": lang, "messages.json": { meta: { id: "x", name: "x" }, messages: {} } })))).toMatch(
      /bad_id/,
    );
    expect(reason(() => checkPackageFiles(files({ "keyring-package.json": lang })))).toBeDefined();
  });

  it("테마: colors 없음은 오류, light 만 있으면 통과", () => {
    const theme = { ...base, id: "@me/sea", type: "theme" };
    expect(reason(() => checkPackageFiles(files({ "keyring-package.json": theme })))).toBeDefined();
    expect(checkPackageFiles(files({ "keyring-package.json": { ...theme, colors: { light: { "--bg": "#fff" } } } })).manifest.colors).toEqual({
      light: { "--bg": "#fff" },
    });
    expect(reason(() => checkPackageFiles(files({ "keyring-package.json": { ...theme, colors: { light: { "--bg": "url(x)" } } } })))).toBeDefined();
    expect(reason(() => checkPackageFiles(files({ "keyring-package.json": { ...theme, colors: {} } })))).toBeDefined();
  });
});
