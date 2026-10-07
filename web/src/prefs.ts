import { useEffect, useState } from "react";

/**
 * 이 기기에만 두는 화면 설정(테마·패널 폭·편집기 모양·자동 저장·단축키). 다른 기기와 나누지 않는다.
 * 데일리 노트·템플릿은 noteSettings.ts.
 */
export interface Prefs {
  theme: "system" | "light" | "dark";
  leftWidth: number;
  rightWidth: number;
  leftOpen: boolean;
  rightOpen: boolean;
  /** 왼쪽 패널 내용(레일에서 고른 것) */
  leftView: "files" | "search" | "tags";
  rightTab: "outline" | "links" | "history";
  autosave: boolean;
  /** 입력이 멈춘 뒤 저장까지(ms) */
  autosaveDelay: number;
  /** 본문을 읽기 폭으로 가운데 정렬(끄면 넓게) */
  readableWidth: boolean;
  editorFont: "sans" | "serif" | "mono";
  editorSize: number;
  lineNumbers: boolean;
  live: boolean;
  props: boolean;
  /** 트리: 첨부(마크다운이 아닌 파일) 보이기 */
  treeAttachments: "show" | "bottom" | "hide";
  /** 트리: attachments 폴더 숨기기 */
  treeHideAttachmentFolders: boolean;
  /** 문서 끝에도 백링크 보이기 */
  backlinksInDoc: boolean;
  /** 단축키 바꾼 것: 명령 id → 키("" = 끔) */
  keys: Record<string, string>;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  leftWidth: 260,
  rightWidth: 280,
  leftOpen: true,
  rightOpen: false,
  leftView: "files",
  rightTab: "links",
  autosave: true,
  autosaveDelay: 1500,
  readableWidth: true,
  editorFont: "sans",
  editorSize: 16,
  lineNumbers: false,
  live: true,
  props: true,
  treeAttachments: "bottom",
  treeHideAttachmentFolders: false,
  backlinksInDoc: false,
  keys: {},
};

const KEY = "keyring:prefs";

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Prefs> | null;
    if (saved) return { ...DEFAULT_PREFS, ...saved, keys: { ...(saved.keys ?? {}) } };
    // 예전 낱개 저장값(편집 중 렌더링·속성 화면)을 이어받는다
    const old: Partial<Prefs> = {};
    const live = localStorage.getItem("keyring:live");
    if (live !== null) old.live = live === "1";
    const props = localStorage.getItem("keyring:props");
    if (props !== null) old.props = props !== "0";
    return { ...DEFAULT_PREFS, ...old };
  } catch {
    return DEFAULT_PREFS;
  }
}

let current = load();
const listeners = new Set<(p: Prefs) => void>();

export function getPrefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  for (const l of listeners) l(next);
}

export function resetPrefs(keys?: (keyof Prefs)[]) {
  setPrefs(keys ? Object.fromEntries(keys.map((k) => [k, DEFAULT_PREFS[k]])) : DEFAULT_PREFS);
}

export function usePrefs(): Prefs {
  const [p, setP] = useState(current);
  useEffect(() => {
    listeners.add(setP);
    setP(current);
    return () => {
      listeners.delete(setP);
    };
  }, []);
  return p;
}

/** 테마: html[data-theme]에 둔다(system이면 지운다 → prefers-color-scheme) */
export function applyTheme(theme: Prefs["theme"]) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
