import { utf8 } from "@keyring-notes/core";
import type { WidgetDefinition } from "../types";
import { EMPTY_SCENE } from "./scene";

/** 내장 위젯 Excalidraw 의 정의(앱 묶음에 늘 실린다). 그리는 코드는 iframe 묶음(frame.tsx)이다 — 크기·전역 이벤트·키·자체 실행 취소·캔버스 다섯 다 인라인 기준을 넘는다 */
export const excalidrawDef: WidgetDefinition = {
  id: "keyring/excalidraw",
  version: 1,
  isolation: "frame",
  display: "block",
  dataFile: { ext: ".excalidraw.json", initial: () => utf8(EMPTY_SCENE), name: { en: "sketch", ko: "스케치" } },
  defaultState: () => ({}),
  title: { en: "Excalidraw sketch", ko: "Excalidraw 스케치" },
};
