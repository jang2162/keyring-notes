import { useEffect, useState } from "react";
import { DEFAULT_VAULT_SETTINGS, parseVaultSettings, setVaultSetting, VAULT_SETTINGS_PATH, type VaultSettings } from "@keyring-notes/core";
import { api, ApiError } from "./api";

/**
 * 모든 기기 공통 설정(볼트의 keyring-settings.md)을 화면에서 읽고 쓴다.
 * 고칠 때는 그때의 파일을 다시 읽어 그 값 하나만 바꿔 쓴다(baseHash, 409면 다시) — 다른 기기가 고친 다른 값을 덮어쓰지 않는다.
 * 동기화·다른 탭으로 파일이 바뀌면 reloadVaultSettings()로 다시 읽는다.
 */
let current: VaultSettings = { ...DEFAULT_VAULT_SETTINGS, folderIcons: {} };
let loadedHash: string | null = null;
const listeners = new Set<(s: VaultSettings) => void>();
let first: Promise<void> | null = null;

function publish(content: string | null, hash: string | null) {
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

/** 값 하나를 바꿔 파일에 쓴다. 파일이 없으면 만든다 */
export async function updateVaultSetting<K extends keyof VaultSettings>(key: K, value: VaultSettings[K]): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const f = await readFile(true);
    const next = setVaultSetting(f.content, key, value);
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
