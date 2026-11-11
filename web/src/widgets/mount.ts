import { widgetDataPath } from "@keyring-notes/core";
import { api as vaultApi } from "../api";
import { language, onLanguageChange, t } from "../i18n";
import { toast } from "../toast";
import { DataFileError, dataFileOptions, openDataFile, type DataFileHandle, type DataFileStatus } from "./dataFile";
import { apiDataFileIO } from "./dataFileIo";
import { mountFrame } from "./frame/mountFrame";
import { THEME_TOKEN_NAMES } from "./frame/themeTokens";
import { widgetThemeValue } from "./themeValue";
import { widgetMessages } from "./messages";
import type { WidgetDraftChange } from "./blockEdit";
import { resumePlan } from "./refresh";
import { isFrameEntry, resolveWidgetView, widgetEntryKey, widgetViewChange, type WidgetView } from "./registry";
import { focusOutAction, pinFile, widgetKeyAction, WidgetSession } from "./session";
import type { WidgetContext } from "./types";
import { bindWidgetApi } from "./widgetApi";

/**
 * 인라인 위젯의 DOM 접착 — Live Preview(liveWidget.ts)와 미리보기(PreviewKeyringWidget.tsx)가 같이 쓴다.
 * 판단은 DOM 없는 함수들(session.ts 의 focusOutAction·widgetKeyAction, registry.ts 의 widgetViewChange)이 지고 여기는 잇기만 한다.
 */

export interface MountOptions {
  body: string;
  readOnly: boolean;
  /** 다시 붙는 위젯이 이어받을 초안·시작 상태·포커스 자리(편집기 필드에 남아 있던 것) */
  resume?: Resume | null;
  /** 블록을 트랜잭션 하나로 다시 쓴다. 못 쓰면 false */
  write(state: unknown, version: number): boolean;
  edit: {
    start(draft: unknown, stateFrom: number, entryKey: string): void;
    draft(change: WidgetDraftChange): void;
    focus(index: number | null): void;
    end(): void;
  };
  /** 그 호스트가 지금 편집기 필드에서 이어받을 수 있는 수정(widgetResume 과 같은 조건) — 레지스트리 바뀜의 다시 그리기가 쓴다 */
  currentEdit?(): Resume | null;
  /** 있으면 머리에 「원문으로 편집」(Live Preview). 오류 블록을 누를 때도 쓴다 */
  onRaw?: () => void;
  /** 이력 보기 — 데이터 파일 위젯은 그 판의 파일을 그리지 않는다(지금 그림을 옛 노트에 보이면 속인다 — 설계 「데이터 파일」) */
  history?: boolean;
  /** 이 위젯이 든 노트 경로 — 데이터 파일 쓰기의 주인(탭 닫기·노트 바꾸기에서 그 노트의 그림만 비운다) */
  owner: string;
}

/** 데이터 파일 충돌 사본 알림의 「열기」 — Workspace 가 받아 그 첨부를 연다 */
export const OPEN_PATH_EVENT = "keyring:open-path";

export interface Resume {
  draft: unknown;
  base: unknown;
  focus: number | null;
  /** 초안의 판, 수정을 시작한 레지스트리 항목(widgetEntryKey) */
  stateFrom: number;
  entryKey: string;
}

export interface MountedWidget {
  update(body: string): void;
  gone(): void;
  destroy(): void;
}

export const THEME_TOKENS = THEME_TOKEN_NAMES;

function readTheme(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const k of THEME_TOKENS) out[k] = widgetThemeValue(cs.getPropertyValue(k));
  return out;
}

const FOCUSABLE = "input, textarea, select, button, [tabindex]";

/** 원문 없이 안내 한 줄(이력 보기의 데이터 파일 위젯) */
function noticeBlock(el: HTMLElement, message: string) {
  const box = document.createElement("div");
  box.className = "kw-notice";
  box.textContent = message;
  el.replaceChildren(box);
}

/** state.file 의 원래 글(오류·안내에 보일 것) */
const rawFile = (state: unknown): string =>
  state !== null && typeof state === "object" && typeof (state as { file?: unknown }).file === "string" ? (state as { file: string }).file : "";

/** 블록에 적힌 state.file(글자일 때만) — 받은 위젯에서 오는 상태의 file 을 이것으로 고정한다 */
const blockFile = (state: unknown): string | undefined =>
  state !== null && typeof state === "object" && typeof (state as { file?: unknown }).file === "string" ? (state as { file: string }).file : undefined;

function errorBlock(el: HTMLElement, body: string, message: string, onRaw?: () => void) {
  const box = document.createElement("div");
  box.className = "kw-error-block";
  const line = document.createElement("div");
  line.className = "kw-error";
  line.textContent = message;
  const pre = document.createElement("pre");
  pre.className = "kw-raw";
  pre.textContent = body;
  box.append(line, pre);
  if (onRaw) {
    // 원문으로 고칠 길: 누르면 커서가 블록 안으로 들어가 원문이 된다
    box.classList.add("kw-clickable");
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      onRaw();
    });
  }
  el.replaceChildren(box);
}

interface Live {
  session: WidgetSession;
  root: HTMLElement;
  stop(): void;
}

export function mountKeyringWidget(el: HTMLElement, opts: MountOptions): MountedWidget {
  let body = opts.body;
  let view: WidgetView = resolveWidgetView(body);
  let live: Live | null = null;
  let dead = false;

  const start = (resumeIn: Resume | null) => {
    const plan = resumePlan(resumeIn, view.kind === "widget" ? { kind: "widget", version: view.entry.def.version } : { kind: "error" });
    if (view.kind === "error") {
      // 이어받지 못하는 수정("hold")은 필드에 그대로 둔다 — 쓰지도 끝내지도 않는다(사용자 결정 2026-11-11)
      errorBlock(el, body, t(view.key, view.vars), opts.onRaw);
      return;
    }
    // 위젯 판이 초안의 판보다 낮다 — 그 초안을 이 판에 건네지 않는다(「hold」, 위와 같다)
    if (plan === "hold") return errorBlock(el, body, t("kw.tooNew"), opts.onRaw);
    const resume = plan === "resume" ? resumeIn : null;
    const v = view;
    const df = v.entry.def.dataFile;
    let file: DataFileHandle | null = null;
    let filePath: string | null = null;
    if (df) {
      if (opts.history) return noticeBlock(el, t("kw.historyNoFile", { path: rawFile(v.state) }));
      filePath = widgetDataPath(v.state, df.ext);
      if (filePath === null) return errorBlock(el, body, t("kw.badFile"), opts.onRaw);
      file = openDataFile(filePath, df.ext, opts.owner, apiDataFileIO(vaultApi), dataFileOptions());
    }
    const root = document.createElement("div");
    root.className = `kw-root kw-display-${v.display}`;
    // 뿌리가 포커스를 받을 수 있어야 Esc·focusout 을 뿌리에서 받는다
    root.tabIndex = -1;
    if (opts.onRaw) {
      const head = document.createElement("div");
      head.className = "kw-head";
      const raw = document.createElement("button");
      raw.type = "button";
      raw.className = "kw-raw-button";
      raw.textContent = t("kw.editRaw");
      raw.addEventListener("click", () => opts.onRaw?.());
      head.append(raw);
      root.append(head);
    }
    // 데이터 파일 상태 한 줄(저장하지 않은 그림·다른 칸에서 고치는 중·저장하지 못함)
    const status = document.createElement("div");
    status.className = "kw-file-status";
    status.hidden = true;
    if (file) root.append(status);
    const content = document.createElement("div");
    content.className = "kw-content";
    root.append(content);
    el.replaceChildren(root);
    let stale = false;

    let theme = readTheme();
    const listeners: ((ctx: WidgetContext) => void)[] = [];
    const ctx = (): WidgetContext => ({
      state: session.state,
      editing: session.editing,
      editable: session.editable,
      display: v.display,
      lang: language(),
      theme,
      // 다른 칸의 쓰기가 받아들여진 동안은 보기 전용 — 이 위젯이 써도 어차피 거절되므로 그리지 못하게
      readOnly: opts.readOnly || stale,
    });
    const fire = () => {
      const c = ctx();
      for (const cb of listeners) cb(c);
    };
    // 세션 생성자가 이어받기를 거절하며 끝낼 때만 미룬다 — 위젯을 만드는 중(편집기 업데이트 안)이라 그 자리 dispatch 는 편집기가 막는다.
    // 그 밖의 끝은 미루지 않는다: 미루면 적용(쓰기)으로 다시 그려진 다른 호스트의 위젯이 아직 지워지지 않은 수정 상태를 이어받는다
    let constructing = true;
    const entryKey = widgetEntryKey(v.entry);
    const session = new WidgetSession(
      {
        state: v.state,
        editable: v.editable,
        readOnly: opts.readOnly,
        resumeDraft: resume?.draft,
        resumeBase: resume?.base,
        version: v.entry.def.version,
        from: v.from,
        resumeFrom: resume?.stateFrom,
        // 받은 위젯은 state.file 을 바꾸지 못한다 — 그 순간의 블록 값(바깥 변경이 오면 바뀐 블록)으로 고정
        pinFile: v.entry.builtIn ? undefined : (s) => pinFile(s, view.kind === "widget" ? blockFile(view.block.state) : undefined),
      },
      {
        write: (s) => opts.write(s, v.entry.def.version),
        startEdit: (d, from) => opts.edit.start(d, from, entryKey),
        setDraft: (d, from, base) => opts.edit.draft(base === undefined ? { draft: d, stateFrom: from } : { draft: d, stateFrom: from, base }),
        endEdit: () => (constructing ? queueMicrotask(() => opts.edit.end()) : opts.edit.end()),
        changed: () => fire(),
      },
    );
    constructing = false;
    // 다른 항목(판 교체)이 이어받았으면 필드의 항목 키를 지금 것으로 — 편집기 업데이트 안일 수 있어 미룬다
    if (resume && session.editing && resume.entryKey !== entryKey)
      queueMicrotask(() => opts.edit.draft({ draft: session.state, stateFrom: session.stateFrom, entryKey }));
    // 위젯에 건네는 파일: 첫 읽기가 「없음」 이면 그 자리를 「파일을 찾을 수 없습니다」 로 바꾼다(새로 만들지 않는다)
    let firstRead = true;
    const widgetFile: DataFileHandle | null = file && {
      ...file,
      read: () => {
        const first = firstRead;
        firstRead = false;
        return file!.read().catch((e) => {
          if (first && e instanceof DataFileError && e.code === "missing") queueMicrotask(() => fail("kw.fileMissing", { path: filePath! }));
          throw e;
        });
      },
      write: (b, h) => file!.write(b, h),
      onStatus: (cb) => file!.onStatus(cb),
      onStale: (cb) => file!.onStale(cb),
      onSettled: (cb) => file!.onSettled(cb),
      drain: () => file!.drain(),
      release: () => file!.release(),
      flush: () => file!.flush(),
    };
    const api = bindWidgetApi({ session, messages: () => widgetMessages(v.entry, language()), listeners, file: widgetFile, fullscreen: null });
    // 포커스가 위젯 밖으로 나가면(수정 끝과 같은 판정) 자동 저장 켬일 때 그 그림을 비운다
    const fileFocusOut = () => {
      if (file && dataFileOptions().autosave()) void file.flush();
    };
    // 사본 경로는 writer 에 남는다 — 구독할 때 곧바로 오는 첫 상태의 것은 기준으로만 두고, 그 뒤 새로 생긴 것만 알린다
    let lastCopy: string | null | undefined = undefined;
    const offStatus = file?.onStatus((st: DataFileStatus) => {
      const line = stale
        ? t("kw.fileStale")
        : st.error === "failed"
          ? t("kw.fileFailed")
          : st.unsaved && !dataFileOptions().autosave()
            ? t("kw.unsavedDrawing")
            : "";
      status.textContent = line;
      status.hidden = !line;
      if (lastCopy === undefined) {
        lastCopy = st.conflictCopy;
        return;
      }
      if (!st.conflictCopy || st.conflictCopy === lastCopy) return;
      const copy = st.conflictCopy;
      lastCopy = copy;
      toast(t("kw.fileConflict", { path: copy }), {
        kind: "warn",
        duration: 10000,
        action: { label: t("common.open"), run: () => window.dispatchEvent(new CustomEvent(OPEN_PATH_EVENT, { detail: copy })) },
      });
      // 원본을 다시 읽는다(블록은 원본을 계속 가리킨다)
      queueMicrotask(() => restart());
    });
    const offStale = file?.onStale(() => {
      stale = true;
      status.textContent = t("kw.fileStale");
      status.hidden = false;
      fire();
    });
    // 다른 칸의 쓰기가 다 내려앉으면 한 번만 다시 그린다(다시 읽기) — 받아들임마다 iframe 을 새로 만들지 않는다
    const offSettled = file?.onSettled(() => {
      if (stale) queueMicrotask(() => restart());
    });

    // 판정은 핸들러 안이 아니라 마이크로태스크 뒤에 — 엔진에 따라 포커스된 요소를 지우는 처리 중에 blur 가 나
    // 그 순간에는 isConnected 가 아직 true 일 수 있다. 다시 그리기로 빠지는 뿌리의 blur 로 적용하지 않기 위해서다.
    // 안에서 안으로 옮기는 것은 relatedTarget 으로 본다: 마이크로태스크는 새 요소가 포커스를 받기 전(focusin 앞)에 돌아
    // 그때 activeElement 는 body 다(Chromium 실측 — 날짜 칸에서 이름 칸을 누르면 수정이 끝나 버렸다).
    const onFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      queueMicrotask(() => {
        if (dead || live?.root !== root || !session.editing) return;
        const relatedInside = (!!related && root.contains(related)) || root.contains(document.activeElement);
        if (focusOutAction({ rootConnected: root.isConnected, relatedInside }) !== "apply") return;
        session.focusOut();
      });
      // 데이터 파일은 수정 모드와 상관없이 위젯 밖으로 나가면 비운다
      queueMicrotask(() => {
        if (dead || live?.root !== root || !file) return;
        const relatedInside = (!!related && root.contains(related)) || root.contains(document.activeElement);
        if (focusOutAction({ rootConnected: root.isConnected, relatedInside }) === "apply") fileFocusOut();
      });
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!session.editing) return;
      const i = [...root.querySelectorAll(FOCUSABLE)].indexOf(e.target as Element);
      opts.edit.focus(i < 0 ? null : i);
    };
    const onKey = (e: KeyboardEvent) => {
      if (widgetKeyAction(e) !== "escape" || !session.escape()) return;
      e.preventDefault();
      e.stopPropagation();
      // 입력칸이 숨으면 포커스가 body 로 떨어진다 — 뿌리에 남겨 둔다
      root.focus({ preventScroll: true });
    };
    root.addEventListener("focusout", onFocusOut);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("keydown", onKey);

    const onTheme = () => {
      theme = readTheme();
      fire();
    };
    const offLang = onLanguageChange(() => fire());
    const themeObserver = new MutationObserver(onTheme);
    // 받은 테마는 토큰을 documentElement.style 에 쓴다 — data-theme 이 그대로여도 style 바뀜으로 다시 읽는다
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", onTheme);

    let cleanup: (() => void) | null = null;
    live = {
      session,
      root,
      stop: () => {
        root.removeEventListener("focusout", onFocusOut);
        root.removeEventListener("focusin", onFocusIn);
        root.removeEventListener("keydown", onKey);
        offLang();
        themeObserver.disconnect();
        media.removeEventListener("change", onTheme);
        listeners.length = 0;
        offStatus?.();
        offStale?.();
        offSettled?.();
        cleanup?.();
        cleanup = null;
        // iframe 위젯은 mountFrame 이 drain 한 뒤 놓는다(지운 iframe 이 이미 보낸 쓰기를 받으려고). 인라인만 여기서 곧바로 놓는다
        if (file && !frameOwnsFile) file.release();
      },
    };
    let frameOwnsFile = false;
    const mine = live;
    const entry = v.entry;
    const fail = (key = "kw.loadFailed", vars?: Record<string, string>) => {
      if (dead || live !== mine) return;
      mine.stop();
      live = null;
      errorBlock(el, body, t(key, vars), opts.onRaw);
    };
    /** 같은 블록으로 다시 그린다(데이터 파일 다시 읽기) */
    const restart = () => {
      if (dead || live !== mine) return;
      stopLive();
      start(null);
    };
    if (isFrameEntry(entry)) {
      // iframe 연결: 세션·ctx·뿌리는 여기 것을 쓰고 DOM 접착은 mountFrame 이 한다
      const frame = mountFrame(content, {
        root,
        entry,
        session,
        ctx,
        file: widgetFile,
        display: v.display,
        onUpdate: (cb) => void listeners.push(() => cb()),
        failed: (key) => fail(key),
        focusOut: fileFocusOut,
        migrated: (s) => session.adoptMigrated(s),
      });
      frameOwnsFile = true;
      cleanup = () => frame.destroy();
      return;
    }
    entry.load().then(
      ({ render }) => {
        if (dead || live !== mine) return;
        cleanup = render(content, ctx(), api);
        if (resume?.focus != null) [...root.querySelectorAll<HTMLElement>(FOCUSABLE)][resume.focus]?.focus();
      },
      () => fail(),
    );
  };

  const stopLive = () => {
    live?.stop();
    live = null;
  };

  start(opts.resume ?? null);

  return {
    update(next) {
      if (dead || next === body) return;
      const nextView = resolveWidgetView(next);
      body = next;
      // 같은 위젯이어도 데이터 파일 경로가 바뀌면 다른 그림이다 — 다시 그린다
      const fileChanged =
        view.kind === "widget" && nextView.kind === "widget" && !!nextView.entry.def.dataFile && rawFile(view.state) !== rawFile(nextView.state);
      if (live && !fileChanged && widgetViewChange(view, nextView) === "external" && nextView.kind === "widget") {
        view = nextView;
        live.session.external(nextView.state, nextView.editable, nextView.from);
        return;
      }
      // 다시 그린다. 수정 중이었고 같은 위젯이면(display 만 바뀜) 초안을 이어받고, 아니면 수정을 끝낸다
      const was: Resume | null =
        live?.session.editing && view.kind === "widget"
          ? { draft: live.session.state, base: live.session.editBase, focus: null, stateFrom: live.session.stateFrom, entryKey: widgetEntryKey(view.entry) }
          : null;
      const sameWidget = view.kind === "widget" && nextView.kind === "widget" && view.entry === nextView.entry;
      stopLive();
      view = nextView;
      if (was && !sameWidget) opts.edit.end();
      start(was && sameWidget ? was : null);
    },
    gone() {
      live?.session.gone();
    },
    destroy() {
      dead = true;
      // 세션 끝(endEdit)은 부르지 않는다 — 다시 그리기로 치워진 것이면 새 위젯이 필드의 초안을 이어받는다
      stopLive();
    },
  };
}
