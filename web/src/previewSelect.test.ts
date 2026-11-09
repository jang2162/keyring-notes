import { describe, expect, it } from "vitest";
import { isMac } from "./shortcuts";
import { takesPreviewSelectAll } from "./previewSelect";

/** 가짜 DOM 노드: contains 는 자기 자신과 kids(그 아래까지) */
interface Fake {
  tagName: string;
  isContentEditable: boolean;
  closest: () => null;
  kids: Fake[];
  contains: (n: unknown) => boolean;
}
const node = (tagName: string, kids: Fake[] = [], editable = false): Fake => {
  const n: Fake = { tagName, isContentEditable: editable, closest: () => null, kids, contains: (x) => x === n || kids.some((k) => k.contains(x)) };
  return n;
};

// body > section.split-pane(포커스를 받는 칸) > [탭 줄 단추, .preview-pane > [본문 글, 위젯 입력칸, contenteditable]]
const text = node("P");
const widgetInput = node("INPUT");
const editable = node("DIV", [], true);
const pane = node("DIV", [text, widgetInput, editable]);
const tabButton = node("BUTTON");
const section = node("SECTION", [tabButton, pane]);
const sideButton = node("BUTTON");
const body = node("BODY", [section, sideButton]);

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
const takes = (target: unknown, mods?: Partial<KeyboardEvent>) => takesPreviewSelectAll(key(target, mods), pane as unknown as Node);

describe("미리보기의 전체 선택", () => {
  it("본문을 눌러 포커스가 칸(section)에 있으면 가져온다 — 사람이 쓰는 길", () => {
    expect(takes(section)).toBe(true);
  });

  it("포커스가 없거나(body) 미리보기 안의 글이면 가져온다", () => {
    expect(takes(body)).toBe(true);
    expect(takes(text)).toBe(true);
  });

  it("미리보기 안이라도 입력칸·편집 영역(위젯 입력 등)이면 그 칸의 전체 선택에 맡긴다", () => {
    expect(takes(widgetInput)).toBe(false);
    expect(takes(editable)).toBe(false);
  });

  it("미리보기 바깥의 다른 요소(사이드바·탭 줄 단추), 다른 조합은 기본 동작에 맡긴다", () => {
    expect(takes(sideButton)).toBe(false);
    expect(takes(tabButton)).toBe(false);
    expect(takes(section, { shiftKey: true })).toBe(false);
    expect(takes(section, { metaKey: false, ctrlKey: false })).toBe(false);
  });
});
