import { HttpRemote, pairDevice, SyncEngine, UnauthorizedError, type LocalVault, type SyncReport } from "@keyring-notes/core";

/** 이 기기의 서버 연결 정보. 볼트 폴더가 아니라 앱 설정(localStorage)에 둔다. */
export interface SyncSettings {
  server: string;
  token: string;
  device: string;
  /** 자동 동기화(열 때·저장 뒤·5분마다) */
  auto: boolean;
}

export interface SyncStatus {
  settings: SyncSettings | null;
  running: boolean;
  lastReport: SyncReport | null;
  lastError: string | null;
  lastSync: string | null;
}

const KEY = "keyring:sync";
const AUTO_INTERVAL = 5 * 60_000;
const AFTER_SAVE_DELAY = 10_000;

function load(): SyncSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SyncSettings) : null;
  } catch {
    return null;
  }
}

function save(s: SyncSettings | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

export function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux PC";
  return "내 기기";
}

/**
 * 선택 동기화. 연결하지 않아도 앱은 그대로 쓸 수 있고, 연결을 끊어도 기기의 문서는 남는다.
 * 자동 동기화는 앱을 열 때, 저장하고 잠시 뒤, 창에 돌아올 때, 5분마다 돈다(모바일은 앱이 열려 있을 때만).
 */
export class SyncController {
  private status: SyncStatus;
  private listeners = new Set<(s: SyncStatus) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private vault: LocalVault,
    private fetchFn: typeof fetch,
  ) {
    this.status = { settings: load(), running: false, lastReport: null, lastError: null, lastSync: null };
    vault.onChange((_paths, source) => {
      if (source !== "local" || !this.status.settings?.auto) return;
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => void this.run(), AFTER_SAVE_DELAY);
    });
    void this.engine()
      ?.state()
      .then((s) => this.set({ lastSync: s.lastSync }));
  }

  get(): SyncStatus {
    return this.status;
  }

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  private engine(): SyncEngine | null {
    const s = this.status.settings;
    return s ? new SyncEngine(this.vault, new HttpRemote(s.server, s.token, this.fetchFn)) : null;
  }

  async connect(server: string, password: string, device: string): Promise<SyncReport | null> {
    const paired = await pairDevice(server, password, device, this.fetchFn);
    const settings: SyncSettings = { server: paired.server, token: paired.token, device: paired.device, auto: true };
    save(settings);
    this.set({ settings, lastError: null, lastReport: null });
    this.startAuto();
    return this.run();
  }

  /** 서버 연결만 잊는다. 기기의 문서·이력은 그대로. */
  disconnect() {
    save(null);
    this.stopAuto();
    this.set({ settings: null, lastReport: null, lastError: null });
  }

  setAuto(auto: boolean) {
    if (!this.status.settings) return;
    const settings = { ...this.status.settings, auto };
    save(settings);
    this.set({ settings });
    if (auto) this.startAuto();
    else this.stopAuto();
  }

  async run(): Promise<SyncReport | null> {
    const engine = this.engine();
    if (!engine) return null;
    this.set({ running: true });
    try {
      const report = await engine.run();
      this.set({ running: false, lastReport: report, lastError: null, lastSync: report.finishedAt });
      return report;
    } catch (e) {
      const offline = e instanceof TypeError;
      const message =
        e instanceof UnauthorizedError
          ? "서버가 이 기기 연결을 받지 않습니다(관리 콘솔에서 끊었거나 서버가 바뀜). 다시 연결하세요."
          : offline
            ? "서버에 연결할 수 없습니다. 기기에 저장한 내용은 그대로이며, 연결되면 다시 동기화합니다."
            : e instanceof Error
              ? e.message
              : String(e);
      this.set({ running: false, lastError: message });
      return null;
    }
  }

  startAuto() {
    this.stopAuto();
    if (!this.status.settings?.auto) return;
    this.timer = setInterval(() => void this.run(), AUTO_INTERVAL);
    window.addEventListener("focus", this.onFocus);
    window.addEventListener("online", this.onFocus);
  }

  private stopAuto() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("focus", this.onFocus);
    window.removeEventListener("online", this.onFocus);
  }

  private lastFocusRun = 0;
  private onFocus = () => {
    // 창 전환마다 돌지 않게 1분에 한 번까지
    if (Date.now() - this.lastFocusRun < 60_000) return;
    this.lastFocusRun = Date.now();
    void this.run();
  };
}
