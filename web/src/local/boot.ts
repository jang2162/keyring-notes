import { isTauri } from "@tauri-apps/api/core";
import { LocalVault, type FileStore } from "@keyring-notes/core";
import { setLocalBackend } from "../api";
import { IdbStore } from "./idbStore";
import { createLocalApi } from "./localApi";
import { defaultDeviceName, SyncController } from "./syncController";
import { SOLO } from "../soloWindow";
import { t } from "../i18n";
import { offline } from "../offline";
import { requestPersist } from "../persist";
import { queryChoice, startsLocal, storedChoice, type ModeInput } from "./mode";

export interface LocalContext {
  vault: LocalVault;
  sync: SyncController;
  /** app: 데스크톱·모바일 앱(실제 폴더), browser: 브라우저 IndexedDB */
  kind: "app" | "browser";
  /** 앱 볼트 폴더 경로 */
  vaultDir: string | null;
  /** 데스크톱에서 다른 볼트 폴더 고르기 */
  chooseFolder?: () => Promise<void>;
}

/** 로컬 모드일 때만 채워진다. */
export let localContext: LocalContext | null = null;

const MODE_KEY = "keyring:mode";
const DIR_KEY = "keyring:vaultDir";

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function installed(): boolean {
  try {
    return matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

/**
 * 로컬 모드로 시작할지(판정은 mode.ts startsLocal). 브라우저는 `?local` 로 켜고 `?local=0` 으로 끄며 그 선택을 이 브라우저에 기억한다.
 * `?local=0` 을 지우지 않고 "server" 로 남기는 것은 설치한 웹 앱의 자동 로컬 시작이 그 선택을 덮지 않게 하려는 것이다.
 */
export async function wantsLocal(): Promise<boolean> {
  if (isTauri()) return true;
  const query = queryChoice(location.search);
  if (query) storage()?.setItem(MODE_KEY, query);
  const input: ModeInput = { tauri: false, installed: installed(), query, stored: storedChoice(storage()?.getItem(MODE_KEY) ?? null), pendingOutbox: false };
  // 대기열은 판정을 가를 때만 연다. 못 읽으면 남은 것으로 본다(서버 모드가 대기분을 보낼 기회를 잃지 않게)
  if (input.installed && !query && !input.stored)
    input.pendingOutbox = await offline.pending().then(
      (l) => l.length > 0,
      () => true,
    );
  return startsLocal(input);
}

const isMobile = () => /Android|iPhone|iPad/.test(navigator.userAgent);

async function defaultVaultDir(): Promise<string> {
  const p = await import("@tauri-apps/api/path");
  // iOS의 문서 폴더는 "파일" 앱에 보인다. Android는 앱 전용 폴더.
  if (/Android/.test(navigator.userAgent)) return `${await p.appDataDir()}${p.sep()}vault`;
  // 문서 폴더가 정해지지 않은 Linux(XDG 사용자 폴더 없음)에서는 홈 아래에 둔다
  const base = await p.documentDir().catch(() => p.homeDir());
  return `${base}${p.sep()}Keyring Notes`;
}

export async function startLocal(): Promise<LocalContext> {
  let store: FileStore;
  let fetchFn: typeof fetch = (...a) => fetch(...a);
  let vaultDir: string | null = null;
  let chooseFolder: LocalContext["chooseFolder"];
  const app = isTauri();
  if (app) {
    const { TauriStore } = await import("./tauriStore");
    vaultDir = storage()?.getItem(DIR_KEY) || (await defaultVaultDir());
    store = new TauriStore(vaultDir);
    // 앱의 요청은 Rust 쪽 HTTP로 보내 CORS·혼합 콘텐츠·모바일 평문 HTTP 제한을 피한다
    const http = await import("@tauri-apps/plugin-http");
    fetchFn = http.fetch as typeof fetch;
    if (!isMobile()) {
      chooseFolder = async () => {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const dir = await open({ directory: true, title: t("app.pickVault") });
        if (typeof dir === "string" && dir) {
          storage()?.setItem(DIR_KEY, dir);
          location.reload();
        }
      };
    }
  } else {
    store = new IdbStore();
    void requestPersist();
  }
  let device = defaultDeviceName();
  try {
    device = (JSON.parse(storage()?.getItem("keyring:sync") ?? "{}") as { device?: string }).device ?? device;
  } catch {
    /* 연결 정보가 깨졌으면 기본 이름 */
  }
  const vault = new LocalVault(store, { author: device });
  await vault.open();
  setLocalBackend(createLocalApi(vault));
  // 노트 하나만 띄운 새 창은 동기화를 돌리지 않는다(SyncController 의 passive)
  const sync = new SyncController(vault, fetchFn, { passive: SOLO });
  // 다른 편집기에서 고친 파일은 창으로 돌아올 때 다시 읽는다
  window.addEventListener("focus", () => void vault.rescan().catch(() => undefined));
  sync.startAuto();
  if (sync.get().settings?.auto) void sync.run();
  localContext = { vault, sync, kind: app ? "app" : "browser", vaultDir, chooseFolder };
  return localContext;
}
