import { APP_VERSION, lockEntryValue } from "@keyring-notes/core";
import { appMode } from "../api";
import { localContext } from "../local/boot";
import { marketplaceSettings, onVaultSettings, updateVaultSetting } from "../vaultSettings";
import { idbPackageCache, tauriPackageCache } from "./cache";
import { marketMode, pickSource, readDeviceMarketSettings, type PackageSource } from "./source";
import { createMarketState, type MarketState } from "./state";

/** 앱 시작 자리(main.tsx)에서 부른다. 순수한 상태(state.ts)와 나눈 것은 시험이 브라우저 전역(boot.ts·api.ts)을 끌어오지 않게 */
let current: MarketState | null = null;

/** 지금 모드로 받는 쪽·캐시를 골라 하나 만든다(앱 시작 때 한 번). 동기화 연결·해제는 source() 가 매번 다시 본다 */
export function startMarket(): MarketState {
  if (current) return current;
  const ctx = localContext;
  const source = (): PackageSource | null => {
    const sync = ctx?.sync.get().settings ?? null;
    const mode = marketMode({ local: appMode.local, kind: ctx?.kind ?? null, sync: !!sync });
    const server = !appMode.local
      ? { base: "", fetchFn: ((...a: Parameters<typeof fetch>) => fetch(...a)) as typeof fetch }
      : sync && ctx
        ? { base: sync.server.replace(/\/+$/, ""), fetchFn: ctx.fetchFn, token: sync.token }
        : undefined;
    return pickSource(mode, { server, device: readDeviceMarketSettings() });
  };
  current = createMarketState({
    source,
    cache: ctx?.kind === "app" ? tauriPackageCache() : idbPackageCache(),
    settings: marketplaceSettings,
    onSettings: (fn) => onVaultSettings(() => fn()),
    writeLock: (id, entry) => updateVaultSetting(["marketplace", "packages", id], entry ? lockEntryValue(entry) : null),
    appVersion: APP_VERSION,
  });
  // 동기화 연결·해제(서버·토큰이 바뀜)에서 받는 쪽이 바뀐다 — 그때 다시 맞춘다
  let linked = JSON.stringify(ctx?.sync.get().settings ? [ctx.sync.get().settings!.server, ctx.sync.get().settings!.token] : null);
  ctx?.sync.subscribe((s) => {
    const now = JSON.stringify(s.settings ? [s.settings.server, s.settings.token] : null);
    if (now === linked) return;
    linked = now;
    void current?.reconcile();
  });
  // 1단계에는 화면이 없다 — 개발 빌드에서만 브라우저·데스크톱 확인용으로 내보낸다(배포 빌드에는 없다)
  if (import.meta.env.DEV) (globalThis as { keyringMarket?: MarketState }).keyringMarket = current;
  void current.reconcile();
  return current;
}

export function market(): MarketState {
  if (!current) throw new Error("startMarket() first");
  return current;
}
