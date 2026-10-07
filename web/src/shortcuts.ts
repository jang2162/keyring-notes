import { isTauri } from "@tauri-apps/api/core";

/**
 * 명령 하나에 이름·단축키·실행을 같이 둔다. 명령 팔레트·단축키·메뉴·설정의 단축키 목록이 모두 이 목록을 쓴다.
 * 키 문자열: "Mod+Shift+F"(Mod = macOS Cmd, 그 밖 Ctrl). 글쇠는 배열(e.code) 기준이라 한글 자판·Alt 조합에서도 같다.
 */
export interface Command {
  id: string;
  label: string;
  group: string;
  /** 기본 키(데스크톱 앱) */
  keys?: string;
  /** 브라우저가 가로채는 키(Mod+W·N·T…) 대신 웹에서 쓸 키 */
  webKeys?: string;
  run: () => void;
  /** 입력칸·에디터 안에서도 받을지(기본 true). F2·Delete처럼 글자 입력과 겹치는 키는 false */
  inInputs?: boolean;
  /** 팔레트에서 숨김(탭 N번째처럼 목록에 늘어놓을 필요 없는 것) */
  hidden?: boolean;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const inApp = (() => {
  try {
    return isTauri();
  } catch {
    return false;
  }
})();

const CODE_NAMES: Record<string, string> = {
  Backslash: "\\",
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Minus: "-",
  Equal: "=",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Space: "Space",
};

/** 키 이벤트 → "Mod+Shift+F". 조합 중(IME)이거나 수식키만 눌렀으면 null */
export function eventCombo(e: KeyboardEvent): string | null {
  if (e.isComposing || e.keyCode === 229) return null;
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = e.code.slice(6);
  else if (CODE_NAMES[e.code]) key = CODE_NAMES[e.code];
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const parts: string[] = [];
  if (mod) parts.push("Mod");
  // macOS에서 Ctrl은 Mod와 따로 센다(Ctrl+Tab 등)
  if (isMac && e.ctrlKey) parts.push("Ctrl");
  if (!isMac && e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** 같은 조합을 같은 글로: 수식키 순서를 맞춘다. "Ctrl"은 macOS 밖에서 Mod와 같다 */
export function normalizeCombo(combo: string): string {
  const parts = combo.split("+").filter(Boolean);
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => (!isMac && p === "Ctrl" ? "Mod" : p)));
  return [...["Mod", "Ctrl", "Meta", "Alt", "Shift"].filter((m) => mods.has(m)), key.length === 1 ? key.toUpperCase() : key].join("+");
}

/** 이 명령에 지금 걸린 키(바꾼 것 → 앱/웹 기본) */
export function commandKey(c: Pick<Command, "id" | "keys" | "webKeys">, overrides: Record<string, string>): string | undefined {
  if (c.id in overrides) return overrides[c.id] || undefined;
  return (inApp ? c.keys : (c.webKeys ?? c.keys)) || undefined;
}

const MAC_SYMBOL: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" };
const ARROWS: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };

/** 보여 줄 글: macOS "⌘⇧F", 그 밖 "Ctrl+Shift+F" */
export function formatCombo(combo: string | undefined): string {
  if (!combo) return "";
  const parts = combo.split("+");
  const key = parts.pop()!;
  const k = ARROWS[key] ?? (key === "Delete" ? (isMac ? "⌦" : "Del") : key);
  if (isMac) return parts.map((p) => MAC_SYMBOL[p] ?? p).join("") + k;
  return [...parts.map((p) => (p === "Mod" ? "Ctrl" : p)), k].join("+");
}

/** 입력칸·편집 영역 안인지 */
export function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || !!el.closest?.(".cm-editor");
}

/** 키 이벤트에 맞는 명령을 찾는다 */
export function matchCommand(e: KeyboardEvent, commands: Command[], overrides: Record<string, string>): Command | null {
  const combo = eventCombo(e);
  if (!combo) return null;
  const n = normalizeCombo(combo);
  const editable = inEditable(e.target);
  for (const c of commands) {
    const k = commandKey(c, overrides);
    if (!k || normalizeCombo(k) !== n) continue;
    if (editable && c.inInputs === false) continue;
    return c;
  }
  return null;
}

/** 설정에서 새 키를 받는 동안에는 단축키를 실행하지 않는다 */
export const keyCapture = { active: false };
