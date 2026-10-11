import { describe, expect, it } from "vitest";
import {
  baseKey,
  checkPack,
  interpolate,
  KeyedError,
  lookup,
  mergePacks,
  OFFICIAL_MESSAGES,
  packTemplate,
  parsePack,
  PathError,
  placeholders,
  translate,
} from "../src/index.js";

const en = OFFICIAL_MESSAGES.en;
const ko = OFFICIAL_MESSAGES.ko;
const bases = (m: Record<string, string>) => new Set(Object.keys(m).map(baseKey));

describe("메시지 묶음", () => {
  it("en·ko가 같은 키를 가진다(복수형 범주는 빼고)", () => {
    const e = bases(en);
    const k = bases(ko);
    expect([...e].filter((x) => !k.has(x))).toEqual([]);
    expect([...k].filter((x) => !e.has(x))).toEqual([]);
  });

  it("en·ko의 끼워 넣기 자리가 같다", () => {
    const bad: string[] = [];
    for (const key of bases(en)) {
      const a = en[key] ?? en[`${key}#other`];
      const b = ko[key] ?? ko[`${key}#other`];
      if (placeholders(a).join() !== placeholders(b).join()) bad.push(key);
      for (const form of Object.keys(en).filter((x) => baseKey(x) === key && x !== key)) {
        if (placeholders(en[form]).some((p) => !placeholders(a).includes(p))) bad.push(form);
      }
    }
    expect(bad).toEqual([]);
  });

  it("HTML을 쓰지 않는다", () => {
    const html = Object.entries({ ...en, ...ko }).filter(([, v]) => /<\/?[a-z][a-z0-9]*(\s[^>]*)?>/i.test(v));
    expect(html.map(([k]) => k)).toEqual([]);
  });
});

describe("번역", () => {
  it("끼워 넣기·복수형·숫자 모양", () => {
    expect(interpolate("{a} and {b}", { a: 1, b: "x" })).toBe("1 and x");
    expect(interpolate("{n}", { n: 12345 }, "en")).toBe("12,345");
    const chain = [{ messages: { "x#one": "{count} file", "x#other": "{count} files" }, locale: "en" }];
    expect(lookup(chain, "x", { count: 1 })).toBe("1 file");
    expect(lookup(chain, "x", { count: 3 })).toBe("3 files");
    expect(lookup(chain, "nope")).toBe("nope");
  });

  it("공식 언어로 바로, 모르는 언어는 영어", () => {
    expect(translate("ko-KR", "common.save")).toBe("저장");
    expect(translate("fr", "common.save")).toBe("Save");
  });

  it("오류는 코드와 값을 가지고 언어마다 다시 만든다", () => {
    const e = new PathError("doc_missing", { path: "a.md" });
    expect(e).toBeInstanceOf(KeyedError);
    expect(e.code).toBe("doc_missing");
    expect(e.text("en")).toBe("No such note: a.md");
    expect(e.text("ko")).toBe("문서가 없습니다: a.md");
  });
});

describe("비공식 언어팩", () => {
  const pack = (messages: Record<string, unknown>, meta: Record<string, unknown> = {}) =>
    JSON.stringify({ meta: { id: "ja", name: "日本語", base: "en", ...meta }, messages });

  it("검사 보고: 모르는 키·빠진 키·자리 불일치·글 아닌 값·HTML", () => {
    const r = parsePack(pack({ "common.save": "保存", "common.nope": "x", "name.badChar": "{oops}", "common.close": 3, "common.open": "<b>開く</b>" }));
    if ("error" in r) throw new Error(r.error);
    expect(r.report.unknown).toEqual(["common.nope"]);
    expect(r.report.placeholderMismatch).toEqual(["name.badChar"]);
    expect(r.report.notString).toEqual(["common.close"]);
    expect(r.report.htmlLike).toEqual(["common.open"]);
    expect(r.pack.messages["common.save"]).toBe("保存");
    expect(r.pack.messages["name.badChar"]).toBeUndefined();
    expect(r.report.missing).toContain("common.cancel");
    expect(r.report.missing).not.toContain("common.save");
  });

  it("모양이 틀리면 거부(JSON 아님·크기·id·이름·공식 언어 id)", () => {
    expect(parsePack("{nope")).toEqual({ error: "not_json" });
    expect(parsePack("[]")).toEqual({ error: "bad_shape" });
    expect(parsePack(pack({}, { id: "x y" }))).toEqual({ error: "bad_id" });
    expect(parsePack(pack({}, { id: "ko" }))).toEqual({ error: "official_id" });
    expect(parsePack(pack({}, { name: " " }))).toEqual({ error: "bad_name" });
    expect(checkPack({}, 2 * 1024 * 1024)).toEqual({ error: "too_large" });
  });

  it("빠진 키만 내려받기와 합치기", () => {
    const t = packTemplate("en", { id: "ja", name: "日本語" }, ["tree.attachments", "common.save"]);
    expect(Object.keys(t.messages).sort()).toEqual(["common.save", "tree.attachments#one", "tree.attachments#other"]);
    const full = packTemplate("ko");
    expect(Object.keys(full.messages).length).toBe(Object.keys(ko).length);
    const merged = mergePacks({ meta: t.meta, messages: { "common.save": "保存" } }, { meta: { ...t.meta, id: "other" }, messages: { "common.open": "開く" } });
    expect(merged.meta.id).toBe("ja");
    expect(merged.messages).toEqual({ "common.save": "保存", "common.open": "開く" });
  });

  it("언어팩 → 기준 언어 → 영어 순서로 찾는다", () => {
    const chain = [
      { messages: { "common.save": "保存" }, locale: "ja" },
      { messages: ko, locale: "ko" },
      { messages: en, locale: "en" },
    ];
    expect(lookup(chain, "common.save")).toBe("保存");
    expect(lookup(chain, "common.open")).toBe("열기");
  });
});
