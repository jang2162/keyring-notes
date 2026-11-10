import { parseWidgetBlock, utf8, widgetDataPath } from "@keyring-notes/core";
import { describe, expect, it, vi } from "vitest";
import { widgetInsertText } from "../registry";
import { excalidrawDef } from "./def";
import { EMPTY_SCENE, parseScene, SceneGate, sceneKey } from "./scene";

describe("Excalidraw 장면", () => {
  it("parseScene: 빈 장면, 깨진 JSON·다른 type 은 null", () => {
    expect(parseScene(utf8(EMPTY_SCENE))).toEqual({ elements: [], appState: {}, files: {} });
    expect(parseScene(utf8("{"))).toBeNull();
    expect(parseScene(utf8('{"type":"x"}'))).toBeNull();
    expect(parseScene(utf8('{"type":"excalidraw","elements":{}}'))).toBeNull();
    expect(parseScene(utf8('{"type":"excalidraw"}'))).toEqual({ elements: [], appState: {}, files: {} });
  });

  it("SceneGate: 열고 아무것도 안 하면 직렬화도 쓰기도 없다", () => {
    const g = new SceneGate("1:", "T");
    const f = vi.fn(() => "X");
    expect(g.next("1:", f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(g.next("2:", () => "T")).toBeNull();
    expect(g.next("3:", () => "U")).toBe("U");
    expect(g.next("3:", f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
    // 기준이 U 로 옮겨졌다
    expect(g.next("4:", () => "U")).toBeNull();
  });

  it("sceneKey: 파일 id 정렬, 내보내는 appState 가 다르면 다른 열쇠", () => {
    expect(sceneKey(5, ["b", "a"], { viewBackgroundColor: "#fff" })).toBe('5:a,b:{"viewBackgroundColor":"#fff"}');
    expect(sceneKey(5, [], { viewBackgroundColor: "#fff" })).not.toBe(sceneKey(5, [], { viewBackgroundColor: "#000" }));
    // 키 순서가 달라도 같은 값이면 같은 열쇠
    expect(sceneKey(1, [], { gridSize: 20, viewBackgroundColor: "#fff" })).toBe(sceneKey(1, [], { viewBackgroundColor: "#fff", gridSize: 20 }));
    // 내보내지 않는 값(선택·확대)은 열쇠에 들지 않는다
    expect(sceneKey(1, [], { viewBackgroundColor: "#fff", zoom: { value: 2 }, selectedElementIds: { a: true } })).toBe(
      sceneKey(1, [], { viewBackgroundColor: "#fff" }),
    );
  });

  it("정의와 넣기 글", () => {
    expect(excalidrawDef.id).toBe("keyring/excalidraw");
    expect(excalidrawDef.version).toBe(1);
    expect(excalidrawDef.isolation).toBe("frame");
    expect(excalidrawDef.display).toBe("block");
    expect(excalidrawDef.dataFile?.ext).toBe(".excalidraw.json");
    expect(new TextDecoder().decode(excalidrawDef.dataFile!.initial())).toBe(EMPTY_SCENE);
    expect(excalidrawDef.dataFile?.name).toEqual({ en: "sketch", ko: "스케치" });
    expect(excalidrawDef.title).toEqual({ en: "Excalidraw sketch", ko: "Excalidraw 스케치" });
    expect(excalidrawDef.defaultState()).toEqual({});
    const text = widgetInsertText(excalidrawDef, { file: "a/스케치-3f9a.excalidraw.json" });
    const r = parseWidgetBlock(text.split("\n").slice(1, -1).join("\n"));
    expect(r.ok).toBe(true);
    expect(r.ok && widgetDataPath(r.block.state, ".excalidraw.json")).toBe("a/스케치-3f9a.excalidraw.json");
  });
});

import { escapeAction } from "./scene";

describe("escapeAction — Excalidraw 0.18.1 은 Esc 로 선택을 풀지 않으므로 위젯이 풀고, 할 일이 없을 때만 전체 화면을 닫는다", () => {
  const idle = {
    selectedElementIds: {},
    selectedGroupIds: {},
    editingTextElement: null,
    activeTool: { type: "selection" },
    openMenu: null,
    openPopup: null,
    openDialog: null,
    contextMenu: null,
    newElement: null,
    multiElement: null,
  };
  it("아무것도 고르지 않고 선택 도구면 close", () => {
    expect(escapeAction(idle)).toBe("close");
    expect(escapeAction({ ...idle, selectedElementIds: { a: false } })).toBe("close");
  });
  it("고른 것(요소·묶음)만 있으면 clearSelection — 다음 Esc 가 close", () => {
    expect(escapeAction({ ...idle, selectedElementIds: { a: true } })).toBe("clearSelection");
    expect(escapeAction({ ...idle, selectedGroupIds: { g: true } })).toBe("clearSelection");
  });
  it("글 편집·다른 도구·열린 메뉴·그리는 중이면 Excalidraw 에 맡긴다(고른 것이 있어도)", () => {
    for (const sel of [{}, { a: true }]) {
      const s = { ...idle, selectedElementIds: sel };
      expect(escapeAction({ ...s, editingTextElement: { id: "t" } })).toBe("excalidraw");
      expect(escapeAction({ ...s, activeTool: { type: "rectangle" } })).toBe("excalidraw");
      expect(escapeAction({ ...s, openMenu: "canvas" })).toBe("excalidraw");
      expect(escapeAction({ ...s, openPopup: "fontFamily" })).toBe("excalidraw");
      expect(escapeAction({ ...s, openDialog: { name: "help" } })).toBe("excalidraw");
      expect(escapeAction({ ...s, contextMenu: { items: [] } })).toBe("excalidraw");
      expect(escapeAction({ ...s, newElement: { id: "n" } })).toBe("excalidraw");
      expect(escapeAction({ ...s, multiElement: { id: "m" } })).toBe("excalidraw");
    }
  });
});

import { keepsWriting } from "./scene";

describe("keepsWriting — 쓰기가 거절된 뒤 그리기를 계속 저장할지", () => {
  it("네트워크·오프라인(failed)이면 계속 쓴다 — 바이트는 남아 있고 다음 쓰기 때 다시 시도한다", () => {
    expect(keepsWriting({ code: "failed" })).toBe(true);
  });
  it("충돌·파일 없음·거부면 멈추고 호스트가 다시 그리기를 기다린다", () => {
    for (const code of ["conflict", "missing", "denied"]) expect(keepsWriting({ code })).toBe(false);
    expect(keepsWriting(new Error("x"))).toBe(false);
    expect(keepsWriting(undefined)).toBe(false);
  });
});
