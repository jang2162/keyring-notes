/**
 * Excalidraw 위젯의 순수 부분(앱 묶음·iframe 묶음 둘 다 쓴다 — Excalidraw 패키지를 import 하지 않는다).
 */

/** 새 그림 파일의 처음 내용. 서버가 빈 첨부를 거절하므로 비어 있지 않은 장면을 쓴다 */
export const EMPTY_SCENE = '{"type":"excalidraw","version":2,"source":"keyring-notes","elements":[],"appState":{},"files":{}}';

export interface ParsedScene {
  elements: unknown[];
  appState: object;
  files: object;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** 깨졌거나 Excalidraw 장면이 아니면 null — 위젯은 그 파일을 쓰지 않는다 */
export function parseScene(bytes: Uint8Array): ParsedScene | null {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.type !== "excalidraw") return null;
  const elements = raw.elements ?? [];
  const appState = raw.appState ?? {};
  const files = raw.files ?? {};
  if (!Array.isArray(elements) || !isObj(appState) || !isObj(files)) return null;
  return { elements, appState, files };
}

/**
 * serializeAsJSON(…, "local") 이 파일에 싣는 appState 키(@excalidraw/excalidraw 0.18.1 의 APP_STATE_STORAGE_CONF 에서 export: true 인 것).
 * 다시 재기: dist/prod/*.js 에서 `export:!0` 인 항목을 찾는다. 판을 올리면 다시 잰다
 */
export const EXPORTED_APP_STATE_KEYS = ["gridModeEnabled", "gridSize", "gridStep", "viewBackgroundColor"] as const;

/** onChange 마다 직렬화하지 않으려고 먼저 보는 값싼 열쇠 — 장면 판 + 파일 id + 내보내는 appState(배경색·격자만 바꿔도 저장되게) */
export function sceneKey(sceneVersion: number, fileIds: string[], appState: Record<string, unknown>): string {
  const exported: Record<string, unknown> = {};
  for (const k of [...EXPORTED_APP_STATE_KEYS].sort()) if (k in appState) exported[k] = appState[k];
  return `${sceneVersion}:${[...fileIds].sort().join(",")}:${JSON.stringify(exported)}`;
}

/**
 * 열기만 해서는 쓰지 않게: 불러온 장면의 직렬화를 기준선으로 두고, 열쇠가 바뀐 때만 직렬화해 글이 기준과 다를 때만 쓴다.
 * Excalidraw 는 처음 그릴 때도 onChange 를 부르고 선택·확대만 바뀌어도 부른다
 */
export class SceneGate {
  constructor(
    private key: string,
    private text: string,
  ) {}

  next(key: string, serialize: () => string): string | null {
    if (key === this.key) return null;
    this.key = key;
    const text = serialize();
    if (text === this.text) return null;
    this.text = text;
    return text;
  }
}
