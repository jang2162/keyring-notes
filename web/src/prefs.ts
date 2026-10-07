import { useEffect, useState } from "react";
import { onVaultSettings, updateVaultSetting } from "./vaultSettings";
import { setLanguage, systemLanguage, urlLanguage } from "./i18n";

/**
 * 화면 설정. 두 가지로 나뉜다(UX.md 27번).
 * - 따라가는 것(SYNCED_KEYS): 공통 설정 파일(keyring-settings.md)의 "ui" 묶음에 두어 앱 동기화로 모든 기기가 같이 쓴다.
 *   설정마다 "이 기기에서만 다르게"를 켜면 이 기기 localStorage의 덮어쓰기(keyring:prefs-local)에 두고 공통 값을 따라가지 않는다.
 *   값을 고르는 순서: 이 기기 덮어쓰기 → 공통 설정 "ui" → 기본값(화면 언어의 기본은 브라우저·OS 언어).
 * - 기기마다(그 밖): 패널 폭·열림, 왼쪽 보기·오른쪽 탭, 지금 워크스페이스 → localStorage의 keyring:prefs.
 * 공통 값은 마지막으로 받은 것을 이 기기에 캐시해(keyring:ui-cache) 시작 때 먼저 쓴다(로그인 화면 포함, 깜빡임 방지).
 * 연달아 바뀌는 값(글자 크기·자동 저장 간격 등)은 멈춘 뒤 한 번만 파일에 쓴다.
 * 덮어쓰기 값은 서버로 보내지 않는다.
 */
export interface Prefs {
  theme: "system" | "light" | "dark";
  /** 화면 언어(""이면 브라우저·OS 언어) */
  language: string;
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
  /** 노드 아이콘 보이기 */
  showIcons: boolean;
  /** 데일리 노트에 제목이 없으면 읽기 좋은 날짜로 보이기 */
  dailyFriendly: boolean;
  /** 트리에서 데일리 폴더는 최신이 위로 */
  dailySortDesc: boolean;
  /** 트리: 노드의 첨부(마크다운이 아닌 파일) 보이기 */
  treeAttachments: "show" | "hide";
  /** 문서 끝에도 백링크 보이기 */
  backlinksInDoc: boolean;
  /** 레일에 아이콘과 이름을 같이(처음 쓰는 사람용) */
  railLabels: boolean;
  /** 단축키 바꾼 것: 명령 id → 키("" = 끔). 데스크톱·웹만 */
  keys: Record<string, string>;
  /** 지금 워크스페이스(기기마다) */
  workspace: string;
  /** 모든 워크스페이스를 같이 보기(트리·빠른 열기·검색·태그·그래프·홈) */
  allWorkspaces: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  language: "",
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
  treeAttachments: "show",
  backlinksInDoc: false,
  railLabels: false,
  keys: {},
  workspace: "",
  allWorkspaces: false,
};

/** 따라가는 설정(공통 설정 파일 "ui" 묶음) */
export const SYNCED_KEYS = [
  "theme",
  "language",
  "editorFont",
  "editorSize",
  "lineNumbers",
  "live",
  "readableWidth",
  "autosave",
  "autosaveDelay",
  "showIcons",
  "treeAttachments",
  "dailyFriendly",
  "dailySortDesc",
  "propsInDoc",
  "backlinksInDoc",
  "railLabels",
  "keys",
] as const satisfies readonly (keyof Prefs)[];

export type SyncedKey = (typeof SYNCED_KEYS)[number];

export function isSynced(k: keyof Prefs): k is SyncedKey {
  return (SYNCED_KEYS as readonly string[]).includes(k);
}

const ENUMS: Partial<Record<keyof Prefs, readonly string[]>> = {
  theme: ["system", "light", "dark"],
  editorFont: ["sans", "serif", "mono"],
  treeAttachments: ["show", "hide"],
  leftView: ["files", "search", "tags"],
  rightTab: ["outline", "links", "props", "history"],
};

/** 저장된 값 검사(파일·다른 기기에서 온 값은 믿지 않는다). 못 쓰면 undefined */
function valid<K extends keyof Prefs>(k: K, v: unknown): Prefs[K] | undefined {
  const d = DEFAULT_PREFS[k];
  if (k === "keys") {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string")) as Prefs[K];
  }
  if (typeof v !== typeof d) return undefined;
  if (ENUMS[k] && !ENUMS[k]!.includes(v as string)) return undefined;
  if (typeof v === "number" && !Number.isFinite(v)) return undefined;
  if (k === "editorSize" && ((v as number) < 10 || (v as number) > 32)) return undefined;
  if (k === "autosaveDelay" && ((v as number) < 300 || (v as number) > 60_000)) return undefined;
  return v as Prefs[K];
}

const DEVICE_KEY = "keyring:prefs";
const OVERRIDE_KEY = "keyring:prefs-local";
const CACHE_KEY = "keyring:ui-cache";

function read(key: string): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

let device = read(DEVICE_KEY);
let overrides = read(OVERRIDE_KEY);
let shared = read(CACHE_KEY);
/** 파일에 쓰기 전(멈추기를 기다리는) 공통 값 */
const pendingShared = new Map<SyncedKey, unknown>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function resolve(): Prefs {
  const out = { ...DEFAULT_PREFS } as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
    if (isSynced(k)) {
      const v = valid(k, overrides[k]) ?? valid(k, pendingShared.has(k) ? pendingShared.get(k) : shared[k]);
      if (v !== undefined) out[k] = v;
    } else {
      const v = valid(k, device[k]);
      if (v !== undefined) out[k] = v;
    }
  }
  return out as unknown as Prefs;
}

let current = resolve();
const listeners = new Set<(p: Prefs) => void>();

function publish() {
  const prev = current;
  current = resolve();
  if (prev.language !== current.language || !applied) applyLanguage(current.language);
  if (prev.theme !== current.theme || !applied) applyTheme(current.theme);
  applied = true;
  for (const l of listeners) l(current);
}
let applied = false;

function applyLanguage(lang: string) {
  setLanguage(urlLanguage ?? (lang || systemLanguage()));
}

export function getPrefs(): Prefs {
  return current;
}

/** 공통 값을 파일에 쓴다(멈춘 뒤 한 번). 실패하면 다음 바뀜 때 다시 */
function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const batch = [...pendingShared.entries()];
    void (async () => {
      for (const [k, v] of batch) {
        try {
          await updateVaultSetting(["ui", k], v);
          if (pendingShared.get(k) === v) pendingShared.delete(k);
        } catch (e) {
          console.warn("could not write the display setting to the shared settings file", k, e);
          pendingShared.delete(k);
          publish();
        }
      }
    })();
  }, 700);
}

/**
 * 설정 바꾸기. 기기마다인 값은 이 기기에, 따라가는 값은 덮어쓴 것이면 이 기기에, 아니면 공통 설정 파일에(멈춘 뒤 한 번).
 */
export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  const p = typeof patch === "function" ? patch(current) : patch;
  let deviceChanged = false;
  let overrideChanged = false;
  for (const [k, v] of Object.entries(p) as [keyof Prefs, unknown][]) {
    if (!isSynced(k)) {
      device = { ...device, [k]: v };
      deviceChanged = true;
    } else if (k in overrides) {
      overrides = { ...overrides, [k]: v };
      overrideChanged = true;
    } else {
      pendingShared.set(k, v);
      shared = { ...shared, [k]: v };
      write(CACHE_KEY, shared);
      scheduleFlush();
    }
  }
  if (deviceChanged) write(DEVICE_KEY, device);
  if (overrideChanged) write(OVERRIDE_KEY, overrides);
  publish();
}

/** 이 기기에서만 다르게 쓰는 중인지 */
export function isLocalOverride(k: SyncedKey): boolean {
  return k in overrides;
}

/** 공통 설정(모든 기기)의 값. 정하지 않았으면 기본값 */
export function sharedPref<K extends SyncedKey>(k: K): Prefs[K] {
  return valid(k, pendingShared.has(k) ? pendingShared.get(k) : shared[k]) ?? DEFAULT_PREFS[k];
}

/**
 * "이 기기에서만 다르게" 켜기·끄기. 켜면 지금 값(또는 value)을 이 기기 덮어쓰기로 남기고, 끄면 공통 값으로 되돌린다
 */
export function setLocalOverride(k: SyncedKey, on: boolean, value?: unknown) {
  if (on) overrides = { ...overrides, [k]: value === undefined ? current[k] : value };
  else {
    const next = { ...overrides };
    delete next[k];
    overrides = next;
  }
  write(OVERRIDE_KEY, overrides);
  publish();
}

/** 처음 값으로: 기기마다인 값과 이 기기 덮어쓰기만(keys를 주면 그것만). 공통 값은 그대로 */
export function resetDevicePrefs() {
  device = {};
  overrides = {};
  write(DEVICE_KEY, device);
  write(OVERRIDE_KEY, overrides);
  publish();
}

/** 공통 설정의 화면 값을 기본값으로(모든 기기에 반영) */
export function resetSharedPrefs(keys: SyncedKey[] = [...SYNCED_KEYS]) {
  for (const k of keys) {
    pendingShared.set(k, null);
    const next = { ...shared };
    delete next[k];
    shared = next;
  }
  write(CACHE_KEY, shared);
  scheduleFlush();
  publish();
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

// 공통 설정 파일이 바뀌면(읽기·동기화·다른 기기) 따라간다. 이 기기 캐시도 바꿔 다음 시작 때 먼저 쓴다
onVaultSettings((s) => {
  const ui = s.ui ?? {};
  if (JSON.stringify(ui) === JSON.stringify(shared)) return;
  shared = { ...ui };
  write(CACHE_KEY, shared);
  publish();
});

// 다른 탭에서 바꾼 값(캐시·덮어쓰기·기기 값)을 새로고침 없이 따라간다
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === CACHE_KEY) shared = read(CACHE_KEY);
    else if (e.key === OVERRIDE_KEY) overrides = read(OVERRIDE_KEY);
    else if (e.key === DEVICE_KEY) device = read(DEVICE_KEY);
    else return;
    publish();
  });
}

// 시작: 캐시한 값으로 먼저 테마·언어를 맞춘다(로그인 화면 포함)
publish();
