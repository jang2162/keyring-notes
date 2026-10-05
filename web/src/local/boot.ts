import { isTauri } from "@tauri-apps/api/core";
import { LocalVault, type FileStore } from "@keyring-notes/core";
import { setLocalBackend } from "../api";
import { IdbStore } from "./idbStore";
import { createLocalApi } from "./localApi";
import { defaultDeviceName, SyncController } from "./syncController";

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

/** 앱(Tauri)이면 늘 로컬. 브라우저는 `?local`로 켜고 `?local=0`으로 끈다(이 브라우저에 기억). */
export function wantsLocal(): boolean {
  if (isTauri()) return true;
  const q = new URLSearchParams(location.search);
  if (q.has("local")) {
    const on = q.get("local") !== "0";
    if (on) storage()?.setItem(MODE_KEY, "local");
    else storage()?.removeItem(MODE_KEY);
    return on;
  }
  return storage()?.getItem(MODE_KEY) === "local";
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
        const dir = await open({ directory: true, title: "볼트 폴더 고르기(마크다운 파일이 있는 폴더)" });
        if (typeof dir === "string" && dir) {
          storage()?.setItem(DIR_KEY, dir);
          location.reload();
        }
      };
    }
  } else {
    store = new IdbStore();
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
  const sync = new SyncController(vault, fetchFn);
  // 다른 편집기에서 고친 파일은 창으로 돌아올 때 다시 읽는다
  window.addEventListener("focus", () => void vault.rescan().catch(() => undefined));
  sync.startAuto();
  if (sync.get().settings?.auto) void sync.run();
  localContext = { vault, sync, kind: app ? "app" : "browser", vaultDir, chooseFolder };
  return localContext;
}
