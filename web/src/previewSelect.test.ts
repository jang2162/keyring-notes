import { describe, expect, it } from "vitest";
import { isMac } from "./shortcuts";
import { takesPreviewSelectAll } from "./previewSelect";

const el = (tag = "DIV", editable = false) => ({ tagName: tag, isContentEditable: editable, closest: () => null });
const body = el("BODY");
const key = (target: unknown, mods: Partial<KeyboardEvent> = {}) =>
  ({
    key: "a",
    code: "KeyA",
    keyCode: 65,
    isComposing: false,
    metaKey: isMac,
    ctrlKey: !isMac,
    altKey: false,
    shiftKey: false,
    target,
    ...mods,
  }) as unknown as KeyboardEvent;

describe("미리보기의 전체 선택", () => {
  const inside = el();
  const pane = { contains: (n: unknown) => n === inside };

  it("포커스가 없거나(body) 미리보기 안이면 가져온다", () => {
    expect(takesPreviewSelectAll(key(body), pane, body)).toBe(true);
    expect(takesPreviewSelectAll(key(inside), pane, body)).toBe(true);
  });

  it("입력칸(속성 편집 칸)·사이드바 등 다른 자리, 다른 조합은 기본 동작에 맡긴다", () => {
    expect(takesPreviewSelectAll(key(el("INPUT")), pane, body)).toBe(false);
    expect(takesPreviewSelectAll(key(el("DIV", true)), pane, body)).toBe(false);
    expect(takesPreviewSelectAll(key(el("BUTTON")), pane, body)).toBe(false);
    expect(takesPreviewSelectAll(key(body, { shiftKey: true }), pane, body)).toBe(false);
    expect(takesPreviewSelectAll(key(body, { metaKey: false, ctrlKey: false }), pane, body)).toBe(false);
  });
});
