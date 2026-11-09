import { language, onLanguageChange, t } from "../i18n";
import { resolveWidgetView, widgetViewChange, type WidgetView } from "./registry";
import { focusOutAction, widgetKeyAction, WidgetSession } from "./session";
import type { WidgetApi, WidgetContext } from "./types";

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
  edit: { start(draft: unknown): void; draft(draft: unknown): void; focus(index: number | null): void; end(): void };
  /** 있으면 머리에 「원문으로 편집」(Live Preview). 오류 블록을 누를 때도 쓴다 */
  onRaw?: () => void;
}

export interface Resume {
  draft: unknown;
  base: unknown;
  focus: number | null;
}

export interface MountedWidget {
  update(body: string): void;
  gone(): void;
  destroy(): void;
}

export const THEME_TOKENS: readonly string[] = ["--bg", "--bg-soft", "--fg", "--muted", "--border", "--accent", "--danger"];

function readTheme(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const k of THEME_TOKENS) out[k] = cs.getPropertyValue(k).trim();
  return out;
}

const FOCUSABLE = "input, textarea, select, button, [tabindex]";

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

  const start = (resume: Resume | null) => {
    if (view.kind === "error") {
      errorBlock(el, body, t(view.key, view.vars), opts.onRaw);
      return;
    }
    const v = view;
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
    const content = document.createElement("div");
    content.className = "kw-content";
    root.append(content);
    el.replaceChildren(root);

    let theme = readTheme();
    const listeners: ((ctx: WidgetContext) => void)[] = [];
    const ctx = (): WidgetContext => ({
      state: session.state,
      editing: session.editing,
      editable: session.editable,
      display: v.display,
      lang: language(),
      theme,
      readOnly: opts.readOnly,
    });
    const fire = () => {
      const c = ctx();
      for (const cb of listeners) cb(c);
    };
    // 세션 생성자가 이어받기를 거절하며 끝낼 때만 미룬다 — 위젯을 만드는 중(편집기 업데이트 안)이라 그 자리 dispatch 는 편집기가 막는다.
    // 그 밖의 끝은 미루지 않는다: 미루면 적용(쓰기)으로 다시 그려진 다른 호스트의 위젯이 아직 지워지지 않은 수정 상태를 이어받는다
    let constructing = true;
    const session = new WidgetSession(
      { state: v.state, editable: v.editable, readOnly: opts.readOnly, resumeDraft: resume?.draft, resumeBase: resume?.base },
      {
        write: (s) => opts.write(s, v.entry.def.version),
        startEdit: (d) => opts.edit.start(d),
        setDraft: (d) => opts.edit.draft(d),
        endEdit: () => (constructing ? queueMicrotask(() => opts.edit.end()) : opts.edit.end()),
        changed: () => fire(),
      },
    );
    constructing = false;
    const api: WidgetApi = {
      setState: (p) => session.setState(p),
      requestEdit: () => session.requestEdit(),
      exitEdit: (apply) => session.exitEdit(apply),
      t: (k, vars) => t(`${v.entry.messages}.${k}`, vars as Parameters<typeof t>[1]),
      onUpdate: (cb) => void listeners.push(cb),
    };

    // 판정은 핸들러 안이 아니라 마이크로태스크 뒤에 — 엔진에 따라 포커스된 요소를 지우는 처리 중에 blur 가 나
    // 그 순간에는 isConnected 가 아직 true 일 수 있다. 다시 그리기로 빠지는 뿌리의 blur 로 적용하지 않기 위해서다.
    // 안에서 안으로 옮기는 것은 relatedTarget 으로 본다: 마이크로태스크는 새 요소가 포커스를 받기 전(focusin 앞)에 돌아
    // 그때 activeElement 는 body 다(Chromium 실측 — 날짜 칸에서 이름 칸을 누르면 수정이 끝나 버렸다).
    const onFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      queueMicrotask(() => {
        if (dead || live?.root !== root || !session.editing) return;
        const relatedInside = (!!related && root.contains(related)) || root.contains(document.activeElement);
        if (focusOutAction({ rootConnected: root.isConnected, relatedInside }) === "apply") session.focusOut();
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
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
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
        cleanup?.();
        cleanup = null;
      },
    };
    const mine = live;
    v.entry.load().then(
      ({ render }) => {
        if (dead || live !== mine) return;
        cleanup = render(content, ctx(), api);
        if (resume?.focus != null) [...root.querySelectorAll<HTMLElement>(FOCUSABLE)][resume.focus]?.focus();
      },
      () => {
        if (dead || live !== mine) return;
        mine.stop();
        live = null;
        errorBlock(el, body, t("kw.loadFailed"), opts.onRaw);
      },
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
      if (live && widgetViewChange(view, nextView) === "external" && nextView.kind === "widget") {
        view = nextView;
        live.session.external(nextView.state, nextView.editable);
        return;
      }
      // 다시 그린다. 수정 중이었고 같은 위젯이면(display 만 바뀜) 초안을 이어받고, 아니면 수정을 끝낸다
      const was: Resume | null = live?.session.editing ? { draft: live.session.state, base: live.session.editBase, focus: null } : null;
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
