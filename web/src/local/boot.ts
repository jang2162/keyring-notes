import { isTauri } from "@tauri-apps/api/core";
import { LocalVault, type FileStore } from "@keyring-notes/core";
import { setLocalBackend } from "../api";
import { openBrowserStore } from "./browserStore";
import { createLocalApi } from "./localApi";
import { defaultDeviceName, SyncController } from "./syncController";
import { SOLO } from "../soloWindow";
import { t } from "../i18n";
import { offline } from "../offline";
import { readMode } from "./mode";

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

/** 로컬 모드로 시작할지(판정은 mode.ts readMode). 주소로 고른 것은 이 브라우저에 기억한다 */
export async function wantsLocal(): Promise<boolean> {
  const { local, remember } = await readMode({
    tauri: isTauri(),
    search: location.search,
    stored: storage()?.getItem(MODE_KEY) ?? null,
    installed: installed(),
    pending: () => offline.pending().then((l) => l.length > 0),
  });
  if (remember) storage()?.setItem(MODE_KEY, remember);
  return local;
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
    store = openBrowserStore();
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
