import { useEffect, useState } from "react";

/**
 * 이 기기에만 두는 화면 설정(테마·패널 폭·편집기 모양·자동 저장·단축키). 다른 기기와 나누지 않는다.
 * 모든 기기가 같아야 하는 값(데일리·템플릿·첨부 폴더·링크 형식·폴더 아이콘)은 볼트의 공통 설정 파일(vaultSettings.ts).
 */
export interface Prefs {
  theme: "system" | "light" | "dark";
  leftWidth: number;
  rightWidth: number;
  leftOpen: boolean;
  rightOpen: boolean;
  /** 왼쪽 패널 내용(레일에서 고른 것) */
  leftView: "files" | "search" | "tags";
  rightTab: "outline" | "links" | "props" | "history";
  autosave: boolean;
  /** 입력이 멈춘 뒤 저장까지(ms) */
  autosaveDelay: number;
  /** 본문을 읽기 폭으로 가운데 정렬(끄면 넓게) */
  readableWidth: boolean;
  editorFont: "sans" | "serif" | "mono";
  editorSize: number;
  lineNumbers: boolean;
  live: boolean;
  /** 미리보기에서 속성(프런트매터)을 본문 위에도 보이기(기본은 오른쪽 패널 "속성" 탭만) */
  propsInDoc: boolean;
  /** 문서·폴더 아이콘 보이기 */
  showIcons: boolean;
  /** 데일리 노트에 제목이 없으면 "10월 7일 (수)"처럼 읽기 좋은 날짜로 보이기 */
  dailyFriendly: boolean;
  /** 트리에서 데일리 폴더는 최신이 위로 */
  dailySortDesc: boolean;
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
  propsInDoc: false,
  showIcons: true,
  dailyFriendly: true,
  dailySortDesc: true,
  treeAttachments: "bottom",
  treeHideAttachmentFolders: false,
  backlinksInDoc: false,
  keys: {},
};

const KEY = "keyring:prefs";

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Prefs> | null;
    return saved ? { ...DEFAULT_PREFS, ...saved, keys: { ...(saved.keys ?? {}) } } : DEFAULT_PREFS;
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
