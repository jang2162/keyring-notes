import {
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  searchPanelOpen,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, runScopeHandlers, type Command, type KeyBinding, type Panel, type ViewUpdate } from "@codemirror/view";
import { t } from "./i18n";
import { countLabel, matchStats, nextMatch, prevMatch, type Match } from "./findQuery";
import { formatCombo } from "./shortcuts";

/**
 * 노트 안 찾기 막대(Mod+F). @codemirror/search 의 상태·검색어·바꾸기 명령은 그대로 쓰고 패널만 바꾼다.
 * 에디터 위 오른쪽에 떠 있어(높이 0인 위쪽 패널 안) 열고 닫아도 본문이 밀리지 않는다. 칸마다 뷰가 따로라 막대도 따로다.
 */

/** 바꾸기 줄을 펼쳤는지. 막대를 새로 열 때(Mod+F) 접고, Mod+Alt+F 로 펼친다 */
const setReplaceOpen = StateEffect.define<boolean>();
const replaceOpen = StateField.define<boolean>({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setReplaceOpen)) v = e.value;
    return v;
  },
});

/** 막대가 떠 있는 동안의 패널(바꾸기 칸에 포커스를 주려고) */
const panels = new WeakMap<EditorView, FindPanel>();

// 아이콘: lucide(ISC) 의 그림 그대로. 패널은 React 밖이라 SVG 를 직접 만든다
type IconNode = [string, Record<string, string>][];
const ICONS: Record<string, IconNode> = {
  chevron: [["path", { d: "m9 18 6-6-6-6" }]],
  up: [
    ["path", { d: "m5 12 7-7 7 7" }],
    ["path", { d: "M12 19V5" }],
  ],
  down: [
    ["path", { d: "M12 5v14" }],
    ["path", { d: "m19 12-7 7-7-7" }],
  ],
  close: [
    ["path", { d: "M18 6 6 18" }],
    ["path", { d: "m6 6 12 12" }],
  ],
  case: [
    ["path", { d: "m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" }],
    ["path", { d: "M22 9v7" }],
    ["path", { d: "M3.304 13h6.392" }],
    ["circle", { cx: "18.5", cy: "12.5", r: "3.5" }],
  ],
  word: [
    ["circle", { cx: "7", cy: "12", r: "3" }],
    ["path", { d: "M10 9v6" }],
    ["circle", { cx: "17", cy: "12", r: "3" }],
    ["path", { d: "M14 7v8" }],
    ["path", { d: "M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" }],
  ],
  regexp: [
    ["path", { d: "M17 3v10" }],
    ["path", { d: "m12.67 5.5 8.66 5" }],
    ["path", { d: "m12.67 10.5 8.66-5" }],
    ["path", { d: "M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z" }],
  ],
  replace: [
    ["path", { d: "M14 4a1 1 0 0 1 1-1" }],
    ["path", { d: "M15 10a1 1 0 0 1-1-1" }],
    ["path", { d: "M21 4a1 1 0 0 0-1-1" }],
    ["path", { d: "M21 9a1 1 0 0 1-1 1" }],
    ["path", { d: "m3 7 3 3 3-3" }],
    ["path", { d: "M6 10V5a2 2 0 0 1 2-2h2" }],
    ["rect", { x: "3", y: "14", width: "7", height: "7", rx: "1" }],
  ],
  replaceAll: [
    ["path", { d: "M14 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" }],
    ["path", { d: "M14 4a1 1 0 0 1 1-1" }],
    ["path", { d: "M15 10a1 1 0 0 1-1-1" }],
    ["path", { d: "M19 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" }],
    ["path", { d: "M21 4a1 1 0 0 0-1-1" }],
    ["path", { d: "M21 9a1 1 0 0 1-1 1" }],
    ["path", { d: "m3 7 3 3 3-3" }],
    ["path", { d: "M6 10V5a2 2 0 0 1 2-2h2" }],
    ["rect", { x: "3", y: "14", width: "7", height: "7", rx: "1" }],
  ],
};

const SVG = "http://www.w3.org/2000/svg";
function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(k, v);
  for (const [tag, attrs] of ICONS[name]) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/** 이름(툴팁·스크린 리더) 뒤에 단축키 */
const withKey = (label: string, combo?: string) => (combo ? `${label} (${formatCombo(combo)})` : label);

function button(name: keyof typeof ICONS, label: string, run: () => void, toggle = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "find-btn";
  b.title = label;
  b.setAttribute("aria-label", label);
  if (toggle) b.setAttribute("aria-pressed", "false");
  b.appendChild(icon(name));
  // 누르는 동안 입력칸의 포커스를 뺏지 않는다(Safari·WKWebView 는 단추에 포커스를 주지 않아 아무 데도 없게 된다)
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", run);
  return b;
}

function field(placeholder: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "find-input";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  return input;
}

/** 일치로 선택을 옮기고 보이게 한다(접힌 곳이면 CodeMirror 가 편다) */
function selectMatch(view: EditorView, m: Match | null) {
  if (!m) return false;
  view.dispatch({
    selection: EditorSelection.single(m.from, m.to),
    effects: EditorView.scrollIntoView(m.from, { y: "nearest", yMargin: 96 }),
    userEvent: "select.search",
  });
  return true;
}

const step =
  (dir: 1 | -1): Command =>
  (view) => {
    const q = getSearchQuery(view.state);
    if (!searchPanelOpen(view.state) || !q.valid) return openFind(view);
    return selectMatch(view, (dir > 0 ? nextMatch : prevMatch)(view.state, q));
  };

/** 다음·이전 일치. 막대가 닫혀 있으면 연다 */
export const findNextMatch = step(1);
export const findPrevMatch = step(-1);

/** Mod+F: 막대를 연다(새로 열 때는 바꾸기를 접는다). 이미 열려 있으면 입력칸으로 */
export const openFind: Command = (view) => {
  if (!searchPanelOpen(view.state)) view.dispatch({ effects: setReplaceOpen.of(false) });
  openSearchPanel(view);
  panels.get(view)?.focusFind();
  return true;
};

/** Mod+Alt+F: 바꾸기를 펼쳐 연다. 찾을 글이 있으면 바꿀 글 칸으로 */
export const openReplace: Command = (view) => {
  if (view.state.readOnly) return openFind(view);
  view.dispatch({ effects: setReplaceOpen.of(true) });
  openSearchPanel(view);
  panels.get(view)?.focusReplace();
  return true;
};

class FindPanel implements Panel {
  dom: HTMLElement;
  top = true;
  private query: SearchQuery;
  private find = field(t("find.find"));
  private replace = field(t("find.replace"));
  private count = document.createElement("span");
  private expand: HTMLButtonElement;
  private toggles: { case: HTMLButtonElement; word: HTMLButtonElement; regexp: HTMLButtonElement };
  private replaceRow = document.createElement("div");
  private readOnly: boolean;

  constructor(private view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.readOnly = view.state.readOnly;
    this.find.setAttribute("main-field", "true");
    this.find.value = this.query.search;
    this.replace.value = this.query.replace;
    for (const input of [this.find, this.replace]) input.addEventListener("input", () => this.commit(input === this.find));

    const flip = (key: "caseSensitive" | "wholeWord" | "regexp") => () => {
      this.commit(true, { [key]: !this.query[key] });
      this.find.focus();
    };
    this.toggles = {
      case: button("case", t("find.matchCase"), flip("caseSensitive"), true),
      word: button("word", t("find.wholeWord"), flip("wholeWord"), true),
      regexp: button("regexp", t("find.regexp"), flip("regexp"), true),
    };
    this.expand = button("chevron", t("find.toggleReplace"), () => this.setExpanded(!view.state.field(replaceOpen)));
    this.expand.classList.add("find-expand");
    this.count.className = "find-count";
    this.count.setAttribute("aria-live", "polite");

    const findBox = document.createElement("div");
    findBox.className = "find-field";
    findBox.append(this.find, this.toggles.case, this.toggles.word, this.toggles.regexp);
    const findRow = document.createElement("div");
    findRow.className = "find-row";
    findRow.append(
      ...(this.readOnly ? [] : [this.expand]),
      findBox,
      this.count,
      button("up", withKey(t("find.prev"), "Mod+Shift+G"), () => findPrevMatch(view)),
      button("down", withKey(t("find.next"), "Mod+G"), () => findNextMatch(view)),
      button("close", withKey(t("find.close"), "Escape"), () => {
        closeSearchPanel(view);
        view.focus();
      }),
    );

    const replaceBox = document.createElement("div");
    replaceBox.className = "find-field";
    replaceBox.append(this.replace);
    this.replaceRow.className = "find-row find-replace-row";
    this.replaceRow.append(
      replaceBox,
      button("replace", withKey(t("find.replaceOne"), "Enter"), () => replaceNext(view)),
      button("replaceAll", withKey(t("find.replaceAll"), "Mod+Enter"), () => replaceAll(view)),
    );

    this.dom = document.createElement("div");
    this.dom.className = "find-bar";
    this.dom.setAttribute("role", "search");
    this.dom.append(findRow, ...(this.readOnly ? [] : [this.replaceRow]));
    this.dom.addEventListener("keydown", (e) => this.keydown(e));
    this.sync();
    panels.set(view, this);
  }

  mount() {
    this.focusFind();
  }

  destroy() {
    panels.delete(this.view);
  }

  focusFind() {
    this.find.focus();
    this.find.select();
  }

  focusReplace() {
    const target = this.find.value ? this.replace : this.find;
    target.focus();
    target.select();
  }

  private setExpanded(open: boolean) {
    this.view.dispatch({ effects: setReplaceOpen.of(open) });
    (open ? this.replace : this.find).focus();
  }

  /** 입력칸·토글 → 검색어. 찾을 글이 바뀌면 지금 자리부터 첫 일치로 옮긴다(입력하며 찾기) */
  private commit(jump: boolean, patch: Partial<ConstructorParameters<typeof SearchQuery>[0]> = {}) {
    const q = new SearchQuery({
      search: this.find.value,
      replace: this.replace.value,
      caseSensitive: this.query.caseSensitive,
      wholeWord: this.query.wholeWord,
      regexp: this.query.regexp,
      ...patch,
    });
    if (q.eq(this.query)) return;
    this.query = q;
    this.view.dispatch({ effects: setSearchQuery.of(q) });
    if (jump && q.valid) {
      // 선택한 일치에서 다시 찾으면 그 자리에 머문다(글자를 더 쳐도 앞으로 건너뛰지 않게)
      selectMatch(this.view, nextMatch(this.view.state, q, this.view.state.selection.main.from));
    }
  }

  private keydown(e: KeyboardEvent) {
    // 단축키(Mod+F·Mod+G·Esc…)는 searchKeymap·findKeymap 의 search-panel 범위로
    if (runScopeHandlers(this.view, e, "search-panel")) {
      e.preventDefault();
      return;
    }
    // 한글 조합을 끝내는 Enter 는 찾기로 치지 않는다
    if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.target === this.find) {
      e.preventDefault();
      if (e.altKey) {
        // 모든 일치를 선택하고 에디터로(VS Code 의 Alt+Enter)
        if (selectMatches(this.view)) this.view.focus();
      } else (e.shiftKey ? findPrevMatch : findNextMatch)(this.view);
    } else if (e.target === this.replace) {
      e.preventDefault();
      (mod ? replaceAll : replaceNext)(this.view);
    }
  }

  update(u: ViewUpdate) {
    const q = getSearchQuery(u.state);
    if (!q.eq(this.query)) {
      // 밖에서 바뀐 검색어(Mod+F 로 선택한 글을 가져오는 등). 이 막대에서 친 것은 commit 이 이미 this.query 로 두었다
      this.query = q;
      this.find.value = q.search;
      this.replace.value = q.replace;
    }
    const queryChanged = u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)));
    if (queryChanged || u.docChanged || u.selectionSet || u.startState.field(replaceOpen) !== u.state.field(replaceOpen)) this.sync();
  }

  private sync() {
    const q = this.query;
    const stats = matchStats(this.view.state, q);
    this.count.textContent = countLabel(q, stats, t);
    this.dom.classList.toggle("no-match", !!q.search && stats.total === 0);
    this.toggles.case.setAttribute("aria-pressed", String(q.caseSensitive));
    this.toggles.word.setAttribute("aria-pressed", String(q.wholeWord));
    this.toggles.regexp.setAttribute("aria-pressed", String(q.regexp));
    const open = !this.readOnly && this.view.state.field(replaceOpen);
    this.replaceRow.hidden = !open;
    this.expand.setAttribute("aria-expanded", String(open));
  }
}

/** searchKeymap 앞에 둔다: Mod+F·Mod+G 를 이 막대의 것으로, Mod+Alt+F 바꾸기 */
export const findKeymap: readonly KeyBinding[] = [
  { key: "Mod-f", run: openFind, scope: "editor search-panel", preventDefault: true },
  { key: "Mod-Alt-f", run: openReplace, scope: "editor search-panel", preventDefault: true },
  { key: "Mod-g", run: findNextMatch, shift: findPrevMatch, scope: "editor search-panel", preventDefault: true },
  { key: "F3", run: findNextMatch, shift: findPrevMatch, scope: "editor search-panel", preventDefault: true },
];

export function findBar(): Extension {
  return [
    replaceOpen,
    search({
      top: true,
      createPanel: (view) => new FindPanel(view),
      scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: "nearest", yMargin: 96 }),
    }),
  ];
}
