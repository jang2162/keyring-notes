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
