import { useEffect, useState } from "react";
import {
  DEFAULT_VAULT_SETTINGS,
  officialLangOf,
  parseVaultSettings,
  setVaultSetting,
  vaultLanguage,
  VAULT_SETTINGS_PATH,
  type SettingPath,
  type VaultLang,
  type VaultSettings,
} from "@keyring-notes/core";
import { api, ApiError } from "./api";
import { language } from "./i18n";

/**
 * 모든 기기 공통 설정(볼트의 keyring-settings.md)을 화면에서 읽고 쓴다.
 * 고칠 때는 그때의 파일을 다시 읽어 그 값 하나만 바꿔 쓴다(baseHash, 409면 다시) — 다른 기기가 고친 다른 값을 덮어쓰지 않는다.
 * 동기화·다른 탭으로 파일이 바뀌면 reloadVaultSettings()로 다시 읽는다.
 * 파일이 없으면 처음 고칠 때(또는 ensureVaultSettings) 만들고, 그때 볼트 언어를 지금 화면 언어로 정한다.
 */
let current: VaultSettings = { ...DEFAULT_VAULT_SETTINGS, workspaces: {}, ui: {}, workspaceOrder: [] };
let loadedHash: string | null = null;
/** 파일이 있는지(마지막으로 읽은 결과). 모르면 null */
let exists: boolean | null = null;
const listeners = new Set<(s: VaultSettings) => void>();
let first: Promise<void> | null = null;

function publish(content: string | null, hash: string | null) {
  exists = content !== null;
  if (hash !== null && hash === loadedHash) return;
  loadedHash = hash;
  current = parseVaultSettings(content);
  for (const l of listeners) l(current);
}

async function readFile(fresh: boolean): Promise<{ content: string | null; hash: string | null }> {
  try {
    const d = await api.read(VAULT_SETTINGS_PATH, { fresh });
    return { content: d.content, hash: d.hash || null };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { content: null, hash: null };
    throw e;
  }
}

/** 파일을 다시 읽는다(바뀌었으면 알린다). 읽지 못하면 지금 값을 둔다 */
export async function reloadVaultSettings(): Promise<VaultSettings> {
  try {
    const f = await readFile(false);
    publish(f.content, f.hash ?? "none");
  } catch {
    /* 연결이 없으면 마지막 값 */
  }
  return current;
}

/** 처음 한 번 읽을 때까지 기다린다(데일리 노트 만들기 등 설정이 꼭 필요할 때) */
export function vaultSettingsReady(): Promise<void> {
  first ??= reloadVaultSettings().then(() => undefined);
  return first;
}

export function getVaultSettings(): VaultSettings {
  return current;
}

/** 볼트 언어(볼트에 남는 글: 제목 없음·충돌 사본·기본 폴더·템플릿). 정하지 않았으면 화면 언어 */
export function vaultLang(): VaultLang {
  return vaultLanguage(current, officialLangOf(language()));
}

export function onVaultSettings(fn: (s: VaultSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useVaultSettings(): VaultSettings {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    setS(current);
    void vaultSettingsReady();
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

/**
 * 값 하나를 바꿔 파일에 쓴다(null이면 지운다). 파일이 없으면 만들고, 그때 볼트 언어도 지금 화면 언어로 정한다
 */
export async function updateVaultSetting(path: SettingPath, value: unknown): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const f = await readFile(true);
    let next = setVaultSetting(f.content, path, value, vaultLang());
    if (f.content === null && !(path[0] === "vault" && path[1] === "language")) next = setVaultSetting(next, ["vault", "language"], vaultLang());
    if (next === f.content) return publish(next, f.hash);
    try {
      const d = await api.write(VAULT_SETTINGS_PATH, next, f.hash);
      publish(next, d.hash);
      return;
    } catch (e) {
      // 그 사이 다른 기기·탭이 고쳤다: 다시 읽어 이 값만 다시 바꾼다
      if (e instanceof ApiError && e.status === 409 && attempt < 3) continue;
      throw e;
    }
  }
}

/** 공통 설정 파일이 없으면 만든다(볼트 언어 = 지금 화면 언어). 소유자 화면이 처음 열릴 때 */
export async function ensureVaultSettings(): Promise<void> {
  await vaultSettingsReady();
  if (exists !== false) return;
  try {
    await updateVaultSetting(["vault", "language"], officialLangOf(language()));
  } catch {
    /* 오프라인 등: 다음에 고칠 때 만든다 */
  }
}
