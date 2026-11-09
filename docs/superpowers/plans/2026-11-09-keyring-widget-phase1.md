# keyring-widget 1단계(런타임 + D-day) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ` ```keyring-widget `(JSON) 블록을 Live Preview·미리보기에서 앱 내장 인라인 위젯으로 그리고, 보기 상호작용·수정 모드(포커스 아웃 적용·Esc 버림)로 상태를 바꿔 그 칸의 편집기 트랜잭션 한 번으로 블록을 다시 쓰며, 내장 위젯 D-day 와 「위젯 넣기」, 인라인 크기 빌드 시험을 만든다.

**Architecture:** 블록 본문의 파싱·직렬화·판 올리기는 core 의 순수 함수(`keyringWidget.ts`)다. web 은 세 층이다 — (1) 편집기 상태 위의 순수 함수(`widgets/blockEdit.ts`: 블록 찾기, 다시 쓰기 트랜잭션, 수정 중 블록 위치를 따라가는 `StateField`), (2) DOM 없는 상태 기계(`widgets/session.ts`: 「상태가 바뀌는 길」 전부), (3) DOM 접착(`widgets/mount.ts`)과 두 호스트(Live Preview 의 `widgets/liveWidget.ts`, 미리보기의 `widgets/PreviewKeyringWidget.tsx`). **본문 문서가 유일한 원본**이고, 미리보기도 숨은 편집기(`EditorHandle`)를 거쳐 쓴다. 위젯 코드(`widgets/inline/*`)는 처음 쓸 때 `import()` 로 불러오며, vite 플러그인이 그 청크의 처음 불러오는 크기(gzip)를 재서 넘으면 빌드를 떨어뜨린다.

**Tech Stack:** TypeScript, CodeMirror 6(`@codemirror/state`·`view`·`commands` 의 `history`/`isolateHistory`·`language` 의 `syntaxTree`), lezer markdown, markdown-it(미리보기), React(`createPortal`), vite 8(rolldown — rollup 호환 훅 `generateBundle`·`this.error`·`this.info`), Node `zlib.gzipSync`, vitest(Node — DOM 없음).

**Spec:** `docs/superpowers/specs/2026-11-09-keyring-widget-design.md` — 이 계획은 그 문서의 「단계」 1단계만 다룬다. 실행자는 둘 다 읽는다. 둘이 다르면 설계 문서가 원본이고, 다르다는 것을 보고한다. 설계에 없던 두 판단은 코디네이터 답(2026-11-09)이 근거다 — 아래 「코디네이터 답과 이 계획의 판단」.

## 코디네이터 답과 이 계획의 판단

- **80자 규칙(코디네이터 답):** 블록 JSON 전체를 한 줄 꼴(`": "`·`", "` 띄움, 안쪽 값도 같은 꼴)로 썼을 때 JS 문자열 길이(UTF-16) 80 이하면 한 줄. 넘으면 `JSON.stringify(정렬한 객체, null, 2)` 그대로(예약 키마다 한 줄, `state` 값도 펼침). 목적: 상태 필드 하나가 바뀌면 diff 에 그 줄만 보이게.
- **migrate 없음(코디네이터 답):** 블록 판 < 위젯 판이고 정의에 `migrate` 가 없으면 호환으로 보고 상태를 그대로 쓰며, 다음 적용 때 위젯 판으로 쓴다.
- **계획이 정함(코디네이터 확인):** 모르는 키는 지우지 않고 예약 키 뒤에 원래 순서로 둔다 / `display`·`editable` 은 블록에 있을 때만 다시 쓴다 / 「위젯 넣기」 는 `widget`·`display`·`state` 만 쓴다 / 미리보기에는 「원문으로 편집」 단추가 없다(Live Preview 만) / 크기 기준 50KB = **51200 바이트 gzip**, 넘으면 빌드 실패.
- **계획이 정함(묻지 않음):** 위젯 블록은 **문서 최상위(Document 바로 아래)이고 닫는 펜스가 있는** 펜스만이다 — 인용·목록 안이나 닫히지 않은 블록은 보통 코드 블록으로 남는다(목록·인용 접두가 붙은 줄을 다시 쓰지 않기 위해, 표 편집기의 `topTables` 와 같은 범위). 위젯 id 는 `^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$`, 판은 1 이상 정수. `state` 가 없으면 그릴 때 `defaultState()` 를 쓰고 파일은 적용 때만 바뀐다. `display`·`editable` 값이 틀리면(예: `"wide"`, `"no"`) 오류 블록. 화면 글 키 앞머리는 `kw.`.
- **구현자 몫:** D-day 의 모양·화면 글 세부(`kw.dday.*`), 위젯 머리 모양, 테마·언어 바뀜을 알아채는 방법(`data-theme` 관찰·`matchMedia`·`onLanguageChange`), 오류 블록의 모양.

## Global Constraints

- 블록 언어 `keyring-widget`, 본문은 **엄격한 JSON**(주석·끝 쉼표·따옴표 없는 키 없음). 예약 키 순서 **`widget`·`display`·`editable`·`state`**, 여러 줄은 **2칸 들여쓰기**, 한 줄 기준 **80자(UTF-16)**.
- `widget` 값은 `<id>@<판>`. `display` 는 `"block" | "inline"`(없으면 정의 기본값), `editable` 은 boolean(없으면 `true`).
- 사람이 원문으로 쓴 모양은 앱이 그 블록을 다시 쓸 때까지 그대로다 — **그리기·포커스·수정 모드 들어가기만으로 문서가 바뀌면 안 된다**(파일은 적용이나 상호작용 한 번에 한 번).
- 블록 다시 쓰기는 늘 그 칸의 `EditorView.dispatch` 트랜잭션 **하나**, `userEvent: "input.widget"`, `isolateHistory.of("full")` — 본문 `Mod+Z` 한 번으로 되돌아간다. 자동 저장·같은 문서 다른 칸(`mirror.ts`)·동기화는 기존 `updateListener` → `onChange`/`onChanges` 경로 그대로 탄다(새 저장 경로를 만들지 않는다).
- 읽기 전용(`EditorState.readOnly`, 이력 보기, 생성 문서)에서는 쓰지 않고 수정 모드에 들어가지 않는다.
- 위젯 정의에 `isolation: "inline" | "frame"`. 앱과 함께 빌드된 코드가 아니면 `frame` 으로 강제(`effectiveIsolation`). 1단계에는 iframe 호스트가 없으므로 `frame` 위젯은 등록을 거부한다(2단계가 연다).
- 인라인 위젯의 리뷰 점검 넷(전역 이벤트·전역 CSS 없음, 자기 입력칸 키만, 자기 실행 취소 기록 없음, DOM 수백 개 이하·루프 없음)은 시험으로 보증되지 않는다 — Task 4 리뷰에서 본다. 스타일은 `.kw-` 클래스 안, 색은 테마 토큰(`--fg`·`--bg`·`--accent` …).
- 인터페이스(`WidgetDefinition`·`render`·`WidgetContext`·`WidgetApi`)는 설계 「공통 API」 그대로 — `file?`·`toggleFullscreen?`·`dataFile?` 도 타입에 두고 1단계에서는 비운다(2단계가 채운다).
- 기존 ` ```widget `(YAML 쿼리 위젯, `Widget.tsx`·`markdown.ts` 의 `widget-slot`)은 고치지 않는다.
- 화면 글은 `packages/core/src/messages/{en,ko}.json`. 영어가 기준, 키는 알파벳 순서 자리에 손으로 넣는다(oxfmt 는 키 순서를 맞추지 않는다). en·ko 같은 키는 `packages/core/test/i18n.test.ts` 가 지킨다.
- 새 의존성 없음.
- 시험은 Node(vitest, DOM 없음). DOM 이 필요한 동작은 순수 함수·상태 기계로 떼어 시험하고 나머지는 Task 9 브라우저 확인.
- 시험 명령: core `cd packages/core && pnpm exec vitest run`(지금 238건), web `cd web && pnpm exec vitest run`(지금 715건), server `pnpm --filter @keyring-notes/server test`. 루트 `pnpm test` 는 core → server → web 순서로 돌고 **첫 실패 패키지에서 멈춘다** — 떨어지면 뒤 패키지를 따로 돌려 개수를 본다. 실행 개수가 0 이 아닌지, 늘었는지 본다.
- 커밋 메시지는 한국어(`feat(core): …`·`feat(web): …`), 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 파일은 경로로 stage 한다. `docs/ops/ux.md` 는 코디네이터 몫이라 고치지 않는다.

## Review Focus

1. **D-day 이름 칸에서 한글 조합 중 `Esc`·`Enter`·다른 곳 클릭** — 조합 중 `Esc` 는 초안을 버리지 않고, 조합 중인 글자가 사라지거나 두 번 들어가지 않으며, 수정 중 `setState` 가 입력칸을 다시 만들지 않는다. (Task 3: `widgetKeyAction` 시험, Task 4: 리뷰 점검)
2. **같은 문서를 두 칸에 열고 A 칸에서 수정 중에 B 칸이 같은 블록을 고침** — A 의 초안은 남고, A 가 적용하면 B 의 바뀐 블록 위에 쓰며(블록이 원자 단위), B 가 블록을 지웠으면 A 는 초안을 버리고 알린다. (Task 2 시험)
3. **본문에서 글을 친 직후(500ms 안) 위젯을 적용하고 `Mod+Z`** — 위젯 변경만 되돌아가고 친 글은 남는다(history 묶음에 섞이지 않는다). (Task 2 시험)
4. **위젯을 누르거나 포커스가 들어왔다 나가기만 함(바꾼 것 없음)** — 문서·초안·저장·다른 칸 어느 것도 바뀌지 않는다. (Task 2: 수정 시작 트랜잭션이 `docChanged` false·`outgoingChanges` 빈 배열, Task 3: 같은 초안이면 쓰지 않음)
5. **깨진 JSON·모르는 위젯 id·새 판 블록을 원문으로 고치기** — 늘 원문과 오류 한 줄이 보이고, 커서를 넣으면 원문으로 고칠 수 있으며 고치는 동안 글이 사라지지 않는다. (Task 1·3 시험, Task 5: 오류 블록도 커서가 들어오면 원문)
6. **미리보기 칸에서 수정 중에 다른 칸·동기화가 노트를 바꿈** — 미리보기 HTML 이 다시 그려져 입력칸이 DOM 에서 빠져도 그 자리에서 적용되지 않고, 다시 붙은 위젯이 초안과 포커스를 이어받는다. focusout 판정은 핸들러 안이 아니라 `queueMicrotask` 뒤다 — 제거 처리 중 blur 에서는 뿌리가 아직 붙어 있을 수 있다. (Task 3: `focusOutAction` 시험, Task 5: 지연 판정, Task 6: 재부착 규칙, Task 9: Chromium·WebKit 둘 다 확인)
7. **터치·Safari/WebKit** — 탭 → 수정 → 가상 키보드 닫기나 `<input type="date">` 네이티브 피커(iOS 「완료」)가 적용으로 끝나고, Safari 가 조합을 끝내는 `Esc`/`Enter` 를 `isComposing: false`·`keyCode 229` 로 보낼 때도 초안을 버리지 않는다. 데스크톱 앱(WebKit)의 contenteditable 안 `<input>` IME 는 표 칸 편집기(`cellEditor.ts`)가 같은 자리에서 겪은 것을 참고한다. (Task 3: `widgetKeyAction` 229 시험, Task 9 확인)
8. **코드 블록 수백 개인 큰 노트에서 커서 이동** — 블록 찾기가 펜스마다 문서 전체를 다시 훑지 않아(펜스 수 제곱 없음) 타이핑·화살표가 느려지지 않는다. (Task 2: `widgetBlockAt` 은 그 자리 노드만, Task 9 확인)

---

### Task 1: core — 블록 파서·직렬화·판 올리기

**Files:**
- Create: `packages/core/src/keyringWidget.ts`
- Modify: `packages/core/src/index.ts` (`export * from "./keyringWidget.js";` — `./widget.js` 줄 앞, 알파벳 자리)
- Test: `packages/core/test/keyringWidget.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const KEYRING_WIDGET_LANG = "keyring-widget";
  export const WIDGET_RESERVED_KEYS = ["widget", "display", "editable", "state"] as const;
  export interface WidgetRef { id: string; version: number }
  export function parseWidgetRef(s: string): WidgetRef | null;
  export function formatWidgetRef(r: WidgetRef): string;          // "keyring/dday@1"
  export interface KeyringWidgetBlock {
    widget: WidgetRef;
    display?: "block" | "inline";
    editable?: boolean;
    state?: unknown;
    extra: [string, unknown][];   // 예약 키가 아닌 키, 원래 순서
  }
  export type WidgetBlockError = "json" | "notObject" | "noWidget" | "badWidget" | "badDisplay" | "badEditable";
  export type WidgetBlockParse = { ok: true; block: KeyringWidgetBlock } | { ok: false; error: WidgetBlockError; detail?: string };
  export function parseWidgetBlock(body: string): WidgetBlockParse;       // body = 펜스 사이 글
  export function serializeWidgetBlock(block: KeyringWidgetBlock): string; // 펜스 없이, 끝 줄바꿈 없음
  export function widgetOneLine(value: unknown): string;                  // `": "`·`", "` 꼴 한 줄 JSON
  export type ResolvedWidgetState = { kind: "ok"; state: unknown; migrated: boolean } | { kind: "tooNew" };
  export function resolveWidgetState(block: KeyringWidgetBlock, def: { version: number; migrate?(state: unknown, from: number): unknown }): ResolvedWidgetState;
  /** 적용 때: 상태를 바꾸고 판을 version 으로. display·editable·extra 는 그대로 */
  export function withWidgetState(block: KeyringWidgetBlock, state: unknown, version: number): KeyringWidgetBlock;
  ```

- [ ] **Step 1: 실패하는 시험을 쓴다** — `keyringWidget.test.ts`:
  - 설계 예시 `{"widget": "keyring/dday@1", "display": "block", "editable": true, "state": {"targetDate": "2026-12-25", "label": "크리스마스"}}` → `ok`, `widget` `{ id: "keyring/dday", version: 1 }`, `display` `"block"`, `editable` `true`, `state` 그대로, `extra` `[]`.
  - `serializeWidgetBlock(parse('{"widget":"a/b@1","state":{"n":1}}'))` → 정확히 `'{"widget": "a/b@1", "state": {"n": 1}}'`(한 줄 꼴).
  - 키 순서: `'{"state":{"n":1},"x":2,"editable":false,"widget":"a/b@1"}'` → `'{"widget": "a/b@1", "editable": false, "state": {"n": 1}, "x": 2}'`.
  - 80자 경계: `base = '{"widget": "a/b@1", "state": {"label": ""}}'`(43자)에 `label` 을 `"x".repeat(37)` 로 채운 블록 → 80자 한 줄. 38자면 결과가 `JSON.stringify({ widget: "a/b@1", state: { label } }, null, 2)` 와 같다(여러 줄, `state` 도 펼침). `label` 이 한글 37자면 한 줄(UTF-16 길이).
  - 설계 예시 블록 직렬화(80자 넘음) → `"{\n  \"widget\": \"keyring/dday@1\",\n  \"display\": \"block\",\n  \"editable\": true,\n  \"state\": {\n    \"targetDate\": \"2026-12-25\",\n    \"label\": \"크리스마스\"\n  }\n}"`.
  - `display`·`editable` 이 없는 블록 → 직렬화에도 없다. 왕복 `serialize(parse(serialize(b)))` 가 같다.
  - `widgetOneLine([1, {"a": []}, {}])` → `'[1, {"a": []}, {}]'`.
  - 엄격 JSON: `'{"widget":"a/b@1", // x\n}'`, `'{"widget":"a/b@1",}'`, `'{widget:"a/b@1"}'` → `{ ok: false, error: "json" }`.
  - `'[]'`·`'1'` → `notObject`. `'{}'` → `noWidget`. `widget` 이 `"dday"`, `"a/b@0"`, `"a/b@1.5"`, `"A/b@1"`, `1` → `badWidget`. `display: "wide"` → `badDisplay`. `editable: "no"` → `badEditable`.
  - `resolveWidgetState`: 정의 `{ version: 2, migrate: (s, from) => ({ ...(s as object), from }) }` 에 `@1` 블록 → `{ kind: "ok", state: { …, from: 1 }, migrated: true }`. `migrate` 없는 정의 판 2 에 `@1` → `{ kind: "ok", state: 원래 그대로, migrated: false }`(코디네이터 답). 같은 판 → 그대로. `@3` → `{ kind: "tooNew" }`.
  - `withWidgetState(블록@1 + extra, {n: 2}, 2)` → `widget.version` 2, `display`·`editable`·`extra` 같음.
  - 정수꼴 키: `'{"widget":"a/b@1","1":true,"state":{}}'` → 직렬화에서 `"1"` 이 `state` **뒤**에 있다(`'{"widget": "a/b@1", "state": {}, "1": true}'`). extra 끼리의 순서는 `JSON.parse` 결과의 `Object.entries` 순서다(정수꼴 키가 앞 — JS 객체의 규칙이라 원문 순서를 더 지킬 수 없다).
  - `'{"widget":"a/b@1","__proto__":{"x":1},"state":{"__proto__":2}}'` → 왕복 뒤에도 바깥 `"__proto__"` extra 와 `state` 안의 `"__proto__"` 가 남는다(조용히 지워지지 않는다).
- [ ] **Step 2: 실패 확인** — `cd packages/core && pnpm exec vitest run test/keyringWidget.test.ts` → FAIL(모듈 없음).
- [ ] **Step 3: 구현** — 파싱은 `JSON.parse` 하나(엄격함은 그것이 준다). 바깥 층은 **새 객체를 만들지 않고** `[키, 값]` 목록(예약 키 순서 + extra)을 직접 이어 쓴다 — 여러 줄은 `"{\n" + 항목.map(([k, v]) => "  " + JSON.stringify(k) + ": " + JSON.stringify(v, null, 2) 의 둘째 줄부터 2칸 더 들여쓴 것).join(",\n") + "\n}"`(보통 객체에서는 `JSON.stringify(obj, null, 2)` 와 같은 글), 한 줄은 `widgetOneLine` 을 직접 쓴 재귀(문자열·숫자는 `JSON.stringify`, 객체는 `Object.entries`). 객체를 새로 만들어 `obj[k] = v` 로 채우면 정수꼴 키가 앞으로 가고 `__proto__` 가 사라진다. `state: undefined` 는 키를 쓰지 않는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. 그다음 `cd packages/core && pnpm exec vitest run && pnpm typecheck` → 전체 통과, 실행 개수가 238 보다 늘었는지.
- [ ] **Step 5: 커밋** — `git add packages/core/src/keyringWidget.ts packages/core/src/index.ts packages/core/test/keyringWidget.test.ts` → `feat(core): keyring-widget 블록 파서·직렬화와 판 올리기`

### Task 2: web — 블록 찾기·다시 쓰기 트랜잭션·수정 중 위치 따라가기

**Files:**
- Create: `web/src/widgets/blockEdit.ts`
- Modify: `web/src/Editor.tsx` (확장 목록에 `widgetEditField` — **`liveSlot` 밖**에 둔다: 미리보기만 보는 칸·Live Preview 를 끈 칸에서도 미리보기 호스트가 쓴다)
- Test: `web/src/widgets/blockEdit.test.ts`

**Interfaces:**
- Consumes: Task 1 `KEYRING_WIDGET_LANG`·`parseWidgetBlock`·`withWidgetState`·`serializeWidgetBlock`.
- Produces:
  ```ts
  export interface WidgetBlockRange {
    from: number; to: number;          // 여는 펜스 줄 처음 ~ 닫는 펜스 줄 끝
    bodyFrom: number; bodyTo: number;  // 펜스 사이 글(첫 본문 줄 처음 ~ 마지막 본문 줄 끝)
    body: string;
    line: number;                      // 여는 펜스 줄 번호(1부터)
  }
  /** 문서 최상위·닫힌 ```keyring-widget 펜스(정보 문자열 첫 낱말이 keyring-widget) */
  export function widgetBlocks(state: EditorState): WidgetBlockRange[];
  /** 그 자리 노드만 본다: from 이 든 줄의 첫 공백 아닌 글자(펜스 시작 문자) 자리에서 resolveInner(그 자리, 1) → 위로 FencedCode, 부모가 Document. 줄 처음으로 resolve 하면 1~3칸 들여쓴 최상위 펜스에서 Document 만 나온다(재리뷰 실측) — 큰 문서에서 펜스마다 전체를 훑지 않게 */
  export function widgetBlockAt(state: EditorState, from: number): WidgetBlockRange | null;
  /** liveBlocks·liveSyntax 가 트리를 돌다 만난 FencedCode 노드로 바로 판정 */
  export function widgetBlockOfNode(state: EditorState, node: SyntaxNode): WidgetBlockRange | null;
  export function widgetBlockAtLine(state: EditorState, line: number): WidgetBlockRange | null;
  /** 지금 블록 본문 위에 상태를 얹은 새 본문. 본문이 깨졌으면 null */
  export function nextWidgetBody(body: string, state: unknown, version: number): string | null;
  /** 본문을 body 로 바꾸는 트랜잭션. 같으면·읽기 전용이면 null. userEvent "input.widget", isolateHistory.of("full"), 선택은 건드리지 않는다 */
  export function rewriteWidgetBlock(state: EditorState, block: WidgetBlockRange, body: string): TransactionSpec | null;
  export interface WidgetEdit { from: number; draft: unknown; gone: boolean; focus: number | null } // focus: 위젯 안 포커스 자리(Task 5)
  export const startWidgetEdit: StateEffectType<{ from: number; draft: unknown }>;
  export const setWidgetDraft: StateEffectType<unknown>;
  export const setWidgetFocus: StateEffectType<number | null>;
  export const endWidgetEdit: StateEffectType<null>;
  /** 칸마다 수정 중인 위젯 하나. from 은 문서 변경에 mapPos(from, 1)(그 자리 바로 앞에 넣은 글 뒤로 따라간다), 그 자리에 위젯 블록이 없어지면 gone */
  export const widgetEditField: StateField<WidgetEdit | null>;
  /** 이 트랜잭션에서 gone 이 false → true 로 바뀌었는가(Editor 의 알림 플러그인이 한 번만 알린다) */
  export function widgetGoneNow(tr: Transaction): boolean;
  /** 위젯 넣기: 커서 자리에 블록을 자기 줄로 넣고 선택을 닫는 펜스 다음 줄 처음에(Task 7). 읽기 전용이면 null */
  export function insertWidgetBlock(state: EditorState, text: string): TransactionSpec | null;
  ```

- [ ] **Step 1: 실패하는 시험** — `EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), history(), widgetEditField] })` + `ensureSyntaxTree`(`tableWidget.test.ts` 의 `state()` 도우미 모양):
  - `"앞\n\n```keyring-widget\n{\"widget\": \"a/b@1\"}\n```\n\n뒤"` → `widgetBlocks` 하나, `line` 3, `body` `'{"widget": "a/b@1"}'`, `from`·`to` 가 펜스 줄 전체. 정보 문자열 `keyring-widget x` 도 잡는다.
  - `"> ```keyring-widget\n> {}\n> ```"`(인용 안), `"- a\n  ```keyring-widget\n  {}\n  ```"`(목록 안), 닫는 펜스 없는 블록, ` ```json ` → 없음.
  - `widgetBlockAtLine(s, 3)` 은 같은 범위, `widgetBlockAtLine(s, 4)` 는 null.
  - `nextWidgetBody('{"widget":"a/b@1","x":1,"state":{"n":1}}', { n: 2 }, 1)` → `'{"widget": "a/b@1", "state": {"n": 2}, "x": 1}'`. 판 2 를 주면 `a/b@2`. 깨진 본문 → null.
  - 실행 취소 한 번: 본문 끝에 `"z"` 를 `userEvent: "input.type"` 로 넣고 곧바로(같은 `Transaction.time`) `rewriteWidgetBlock` 적용 → `undo` 한 번에 블록 본문만 원래대로, `"z"` 는 남는다. 다시 `undo` → `"z"` 사라짐.
  - `rewriteWidgetBlock` 의 트랜잭션은 `mirrored` 가 없어 `outgoingChanges([tr], key, key)` 에 들어간다(자동 저장·다른 칸 경로). 같은 본문이면 null. `EditorState.readOnly.of(true)` 면 null. 선택이 그대로다.
  - `startWidgetEdit.of({ from, draft: { n: 9 } })` 트랜잭션 → `docChanged` false, `outgoingChanges` 빈 배열, 필드 `{ from, draft: { n: 9 }, gone: false, focus: null }`. `setWidgetFocus.of(1)` → `focus` 1. `setWidgetDraft` 로 초안만 바뀐다. `endWidgetEdit` → null.
  - 바깥 변경(`mirrored.of(true)`, `Transaction.addToHistory.of(false)`): 문서 앞에 `"새 줄\n"` → 필드 `from` 이 그만큼 밀리고 초안은 그대로. **`from` 정확히 그 자리(여는 펜스 줄 처음)에 `"새 줄\n"`** → `gone` false, `from` 이 `"새 줄\n".length`(4) 밀림. 블록이 문서 맨 앞(`from` 0)인 문서에서 0 에 넣어도 같다. 블록 본문을 바꿈 → `from` 같음, `gone` false. 블록 전체를 지움 → `gone` true, `widgetGoneNow(tr)` true, 그다음 아무 트랜잭션의 `widgetGoneNow` 는 false.
  - 바깥 변경 위에 적용: 수정 시작 뒤 바깥에서 본문에 `"x": 1` 을 넣은 블록으로 바꿈 → `nextWidgetBody(widgetBlockAt(s, 필드.from).body, 초안, 1)` 결과에 `"x": 1` 과 초안 상태가 둘 다 있다.
  - 들여쓴 최상위 펜스: `"a\n\n  ```keyring-widget\n  {}\n  ```\n"`(1칸·3칸도) → `widgetBlocks` 가 잡고(`from` 은 그 줄 처음 3), `widgetBlockAt(state, range.from)` 이 같은 범위를 준다. 그 블록으로 수정을 시작한 뒤 아무 문서 변경에도 `gone` 이 false 다(그리기 `widgetBlockOfNode` 와 쓰기·필드 `widgetBlockAt` 이 갈리지 않는다).
  - 필드가 바뀌지 않으면 같은 값: 수정 중(필드 non-null)에 효과·문서 변경 없는 트랜잭션 → `tr.state.field(widgetEditField) === tr.startState.field(widgetEditField)`(같은 객체).
  - 그리기만으로 문서가 바뀌지 않는다: 위 어느 경우에도 `widgetBlocks`·`widgetBlockAt` 호출 뒤 `state.doc` 이 같다(순수 함수).
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/blockEdit.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `widgetBlocks` 는 `topTables` 처럼 `syntaxTree(state).cursor()` 의 최상위 자식만 돈다. 판정(`widgetBlockOfNode`)은 `FencedCode`, 부모가 `Document`, `CodeInfo` 첫 낱말, `CodeMark` 가 둘 이상(닫힘). 프런트매터 안은 뺀다(`frontmatterEnd`). `widgetBlockAt` 은 `from` 줄의 앞 공백을 건너뛴 자리에서 `resolveInner(그 자리, 1)` 로 그 자리 노드만 본다(`widgetBlocks` 를 부르지 않는다). 필드의 `from` 은 `tr.changes.mapPos(from, 1)`, `gone` 은 `widgetBlockAt(tr.state, mapped)` 가 null 일 때. 필드 `update` 는 효과·문서 변경이 없거나 값이 그대로면 **받은 객체를 그대로 돌려준다**(Task 5 의 `blockFieldNeedsUpdate` 가 참조 비교에 기댄다).
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS.
- [ ] **Step 5: `Editor.tsx` 에 `widgetEditField` 를 확장 목록에 넣고 `cd web && pnpm exec vitest run && pnpm typecheck`** → 통과, 개수 확인.
- [ ] **Step 6: 커밋** — `git add web/src/widgets/blockEdit.ts web/src/widgets/blockEdit.test.ts web/src/Editor.tsx` → `feat(web): keyring-widget 블록 찾기와 다시 쓰기 트랜잭션`

### Task 3: web — 위젯 타입·레지스트리·세션(상태가 바뀌는 길)

**Files:**
- Create: `web/src/widgets/types.ts`, `web/src/widgets/registry.ts`, `web/src/widgets/session.ts`
- Modify: `packages/core/src/messages/{en,ko}.json` — `kw.errorJson`("The widget block is not valid JSON"/"위젯 블록이 올바른 JSON 이 아닙니다"), `kw.errorNotObject`("The widget block must be a JSON object"/"위젯 블록은 JSON 객체여야 합니다"), `kw.errorNoWidget`("The widget block has no \"widget\" key"/"위젯 블록에 \"widget\" 키가 없습니다"), `kw.errorField`("The widget block has an invalid \"{key}\" value"/"위젯 블록의 \"{key}\" 값이 올바르지 않습니다"), `kw.notFound`("Widget {id} not found"/"위젯 {id} 를 찾을 수 없습니다"), `kw.tooNew`("This widget needs a newer version"/"이 위젯의 새 판이 필요합니다")
- Test: `web/src/widgets/registry.test.ts`, `web/src/widgets/session.test.ts`

**Interfaces:**
- Consumes: Task 1 전부.
- Produces:
  ```ts
  // types.ts — 설계 「공통 API」 그대로
  export interface WidgetDefinition { id: string; version: number; isolation: "inline" | "frame"; display: "block" | "inline";
    dataFile?: { ext: string }; defaultState(): unknown; migrate?(state: unknown, from: number): unknown; title: Record<string, string> }
  export interface WidgetContext { state: unknown; editing: boolean; editable: boolean; display: "block" | "inline"; lang: string; theme: Record<string, string>; readOnly: boolean }
  export interface WidgetApi { setState(patch: object): void; requestEdit(): void; exitEdit(apply: boolean): void; t(key: string, vars?: object): string;
    file?: { read(): Promise<{ bytes: Uint8Array; hash: string }>; write(bytes: Uint8Array, baseHash: string): Promise<{ hash: string }> };
    toggleFullscreen?(): void; onUpdate(cb: (ctx: WidgetContext) => void): void }
  export type WidgetRender = (el: HTMLElement, ctx: WidgetContext, api: WidgetApi) => () => void;

  // registry.ts
  export interface WidgetEntry { def: WidgetDefinition; builtIn: boolean; messages: string /* "kw.dday" — api.t(k) = t(`${messages}.${k}`) */; load(): Promise<{ render: WidgetRender }> }
  export function effectiveIsolation(e: WidgetEntry): "inline" | "frame";   // !builtIn → "frame"
  export function registerWidget(e: WidgetEntry): void;   // 같은 id 두 번·frame(1단계) → throw
  export function findWidget(id: string): WidgetEntry | null;
  export function widgetList(): WidgetEntry[];            // 등록 순서
  export function widgetInsertText(def: WidgetDefinition): string; // "```keyring-widget\n" + 본문 + "\n```"
  export type WidgetView =
    | { kind: "widget"; entry: WidgetEntry; block: KeyringWidgetBlock; state: unknown; editable: boolean; display: "block" | "inline" }
    | { kind: "error"; key: string; vars?: Record<string, string> };
  export function resolveWidgetView(body: string): WidgetView;

  // session.ts — DOM 없음
  export interface SessionHost {
    write(state: unknown): boolean;          // 블록을 한 번 다시 쓴다(위젯 판으로). 못 쓰면 false
    startEdit(draft: unknown): void; setDraft(draft: unknown): void; endEdit(): void; // widgetEditField 효과
    changed(ctx: Pick<WidgetContext, "state" | "editing">): void;                  // onUpdate 로 보낼 때
  }
  export class WidgetSession {
    constructor(init: { state: unknown; editable: boolean; readOnly: boolean; resumeDraft?: unknown }, host: SessionHost);
    readonly state: unknown; readonly editing: boolean;
    setState(patch: object): void; requestEdit(): void; exitEdit(apply: boolean): void;
    focusOut(): void;                 // = exitEdit(true)
    escape(): boolean;                // 수정 중이었으면 버리고 true
    external(state: unknown, editable: boolean): void; // 바깥에서 블록이 바뀜
    gone(): void;                     // 블록이 사라짐: 초안 버림, 쓰지 않음
  }
  /** 위젯 뿌리에서 받은 키를 세션 동작으로. 조합 중(isComposing 또는 keyCode 229 — Safari)이면 늘 null */
  export function widgetKeyAction(e: { key: string; isComposing: boolean; keyCode: number }): "escape" | null;
  /** 뿌리의 focusout 을 어떻게 볼까. 뿌리가 DOM 에서 빠지는 중(다시 그리기)이면 적용하지 않는다 */
  export function focusOutAction(e: { rootConnected: boolean; relatedInside: boolean }): "apply" | "ignore";
  // registry.ts
  /** 같은 자리의 위젯 블록이 바뀌었을 때: 같은 위젯이면 세션에 external, 위젯 id·판정 종류(위젯↔오류)가 바뀌면 다시 그리기 */
  export function widgetViewChange(prev: WidgetView, next: WidgetView): "external" | "remount";
  ```

- [ ] **Step 1: 실패하는 시험** —
  - `registry.test.ts`(시험마다 새 레지스트리를 쓰도록 `resetWidgetsForTest()` 를 export): 시험용 정의 `t/x@2`(`migrate` 있음, `defaultState` → `{ n: 0 }`, `display: "inline"`) 등록 뒤 `resolveWidgetView('{"widget":"t/x@1","state":{"n":1}}')` → `kind: "widget"`, 올린 상태, `editable` true, `display` `"inline"`(정의 기본값). 블록에 `"display":"block"` 이면 `"block"`. `state` 없음 → `{ n: 0 }`. 깨진 JSON → `{ kind: "error", key: "kw.errorJson" }`, `badDisplay` → `{ key: "kw.errorField", vars: { key: "display" } }`, 모르는 id → `{ key: "kw.notFound", vars: { id: "t/y" } }`, `@3` → `{ key: "kw.tooNew" }`.
  - `effectiveIsolation({ builtIn: false, def: { isolation: "inline" } })` → `"frame"`. `registerWidget` 에 `frame` 이나 같은 id → throw.
  - `widgetInsertText(def)` → `` "```keyring-widget\n{\"widget\": \"t/x@2\", \"display\": \"inline\", \"state\": {\"n\": 0}}\n```" ``, 그 본문이 `parseWidgetBlock` 으로 `ok`.
  - `session.test.ts`(가짜 host 가 호출을 적는다):
    - 보기 모드 `{ n: 1, m: 0 }` 에 `setState({ n: 2 })` → `write` 한 번 `{ n: 2, m: 0 }`(얕은 병합 — `{ ...state, ...patch }`, `Object.assign` 은 `__proto__` 를 setter 로 받아 쓰지 않는다), `state` 도 그것. `JSON.parse('{"__proto__": 1}')` 을 patch 로 주면 결과에 own 키 `__proto__` 가 남는다.
    - `editable: false` 또는 `readOnly: true`: `setState` → `write` 없음, `requestEdit` → `editing` false, `startEdit` 없음.
    - `requestEdit` → `editing` true, `startEdit` 한 번. `setState` 두 번 → `write` 없음, `setDraft` 두 번. `focusOut` → `write` 한 번(합친 초안), `endEdit`, `editing` false. 다시 `focusOut` → 더 없음.
    - 수정 들어가 바꾸지 않고(또는 바꿨다 되돌려 같은 값으로) `focusOut` → `write` 없음(값 비교는 `JSON.stringify` 같음).
    - 수정 중 `escape()` → true, `write` 없음, `state` 원래대로. 보기 모드 `escape()` → false.
    - `exitEdit(true)` 는 `focusOut` 과 같고, `exitEdit(false)` 는 `escape` 와 같다.
    - 수정 중 `external({ n: 5 }, true)` → 초안 유지, `focusOut` 이 초안을 쓴다. 보기 모드 `external` → `state` 바뀜, `write` 없음.
    - 수정 중 `gone()` → `endEdit`, `write` 없음, `editing` false.
    - `resumeDraft` 를 주고 만들면 `editing` true, `state` 가 초안, `startEdit` 은 부르지 않는다(이미 필드에 있다).
    - 만들기·`changed` 만으로는 `write` 가 없다.
    - `widgetKeyAction({ key: "Escape", isComposing: false, keyCode: 27 })` → `"escape"`, `isComposing: true` → null, `{ key: "Escape", isComposing: false, keyCode: 229 }` → null, `"Enter"` → null.
    - `focusOutAction({ rootConnected: true, relatedInside: false })` → `"apply"`, `relatedInside: true` → `"ignore"`, `rootConnected: false` → `"ignore"`(어느 쪽이든).
  - `registry.test.ts` 에 더: `widgetViewChange` — 같은 id 의 상태만 다름 → `"external"`, id 가 바뀜·위젯 → 오류·오류 → 위젯 → `"remount"`.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/registry.test.ts src/widgets/session.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 화면 글은 위 키를 en·ko 알파벳 자리에.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. `cd packages/core && pnpm exec vitest run test/i18n.test.ts` → PASS(en·ko 키 같음).
- [ ] **Step 5: `cd web && pnpm exec vitest run && pnpm typecheck`** → 통과.
- [ ] **Step 6: 커밋** — `git add web/src/widgets/types.ts web/src/widgets/registry.ts web/src/widgets/session.ts web/src/widgets/registry.test.ts web/src/widgets/session.test.ts packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `feat(web): keyring-widget 레지스트리와 상태가 바뀌는 길(세션)`

### Task 4: D-day 위젯

**Files:**
- Create: `web/src/widgets/ddayModel.ts`(순수, 앱 묶음), `web/src/widgets/inline/dday.ts`(`render` — 처음 쓸 때 불러오는 청크), `web/src/widgets/builtins.ts`(내장 등록: `registerWidget({ def: ddayDef, builtIn: true, messages: "kw.dday", load: () => import("./inline/dday") })`)
- Modify: `web/src/styles.css`(`.kw-dday` — 토큰 색, 밝은·어두운), messages — `kw.dday.*`(문구는 구현자 몫, 최소 날짜 칸·이름 칸 라벨과 날짜 없음 표시)
- Test: `web/src/widgets/ddayModel.test.ts`

**Interfaces:**
- Consumes: Task 3 `WidgetDefinition`·`WidgetRender`·`registerWidget`.
- Produces:
  ```ts
  export interface DdayState { targetDate: string; label: string }   // YYYY-MM-DD
  export function ddayCount(target: string, today: string): number | null; // target − today(일), 잘못된 날짜 → null
  export function ddayText(n: number | null): string;  // 3 → "D-3", 0 → "D-day", -2 → "D+2", null → ""
  export function todayLocal(now: Date): string;        // 지역 시간의 YYYY-MM-DD
  export const ddayDef: WidgetDefinition;  // ddayModel.ts(앱 묶음 — 정의는 늘 실리고 render 만 지연). id "keyring/dday", version 1, isolation "inline", display "inline",
                                           // defaultState → { targetDate: todayLocal(new Date()), label: "" }, title { en: "D-day", ko: "D-day" }
  export const render: WidgetRender;       // inline/dday.ts
  export function registerBuiltins(): void; // builtins.ts, main.tsx 에서 한 번
  ```

- [ ] **Step 1: 실패하는 시험** — `ddayCount("2026-12-25", "2026-12-22")` 3, 같은 날 0, `("2026-12-20", "2026-12-22")` -2, 서머타임 끼는 `("2026-03-30", "2026-03-28")` 2, 윤년 `("2028-03-01", "2028-02-28")` 2, `("2026-02-30", …)`·`("", …)`·`("2026-1-5", …)` null. `ddayText` 넷. `todayLocal(new Date(2026, 0, 5, 23, 59))` → `"2026-01-05"`. `ddayDef` 의 값이 위와 같고 `defaultState()` 가 `parseWidgetBlock(widgetInsertText(ddayDef) 본문)` 으로 `ok`.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/ddayModel.test.ts` → FAIL.
- [ ] **Step 3: 모델 구현** — 날짜 차는 `Date.UTC` 로(지역 시간 자정 차는 서머타임에 23·25시간이 된다).
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: `render` 와 등록** — 보기: 이름 + `ddayText` 를 담은 `<button type="button">`(포커스를 받으므로 누르기·`Enter` 둘 다 된다) → `api.requestEdit()`(`editable`·`readOnly` 면 세션이 무시한다). **수정으로 바뀌는 `onUpdate`(editing false → true)에서 첫 입력칸에 `focus()`** — 포커스가 위젯 안에 있어야 밖을 눌렀을 때 focusout 이 나고 `Esc` 가 뿌리에 온다(뿌리 `tabindex="-1"` 은 Task 5 의 mount 가 단다). 수정: `<input type="date">`·`<input type="text">`, `input` 마다 `api.setState`. `onUpdate` 에서 **수정 중에는 입력칸을 다시 만들지 않고** 표시 부분만 고친다(IME). 리뷰 점검 넷을 지킨다 — `window`·`document` 에 리스너 없음, 자기 클래스 밖 CSS 없음, 입력칸 밖 키 가로채기 없음, 자체 실행 취소 없음. `registerBuiltins()` 를 `main.tsx` 에서 부른다.
- [ ] **Step 6: `cd web && pnpm exec vitest run && pnpm typecheck`** → 통과.
- [ ] **Step 7: 커밋** — `git add web/src/widgets/ddayModel.ts web/src/widgets/ddayModel.test.ts web/src/widgets/inline/dday.ts web/src/widgets/builtins.ts web/src/main.tsx web/src/styles.css packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `feat(web): 내장 위젯 D-day`

### Task 5: Live Preview 호스트

**Files:**
- Create: `web/src/widgets/mount.ts`(DOM 접착 — 두 호스트가 같이 쓴다), `web/src/widgets/liveWidget.ts`(CodeMirror 위젯)
- Modify: `web/src/liveBlocks.ts` — `findBlocks` 의 `FencedCode` 가지: `widgetBlockOfNode(state, n.node)` 가 있으면 `kind: "keyring-widget"`(mermaid 와 같은 자리, 트리를 다시 훑지 않는다). `blockField.update` 조건에 `tr.startState.field(widgetEditField, false) !== tr.state.field(widgetEditField, false)` 를 더한다 — 수정 시작·끝이 효과만 있는 트랜잭션이라 지금 조건(`docChanged || selection || 트리`)으로는 장식이 다시 계산되지 않는다(수정 중 「원문으로 편집」 뒤 끝나도 위젯이 남는다). 조건을 `export function blockFieldNeedsUpdate(tr: Transaction): boolean` 로 뗀다. `buildBlocks`: 그 kind 는 `KeyringBlockWidget`, 그리고 `widgetEditField` 의 `from` 과 같은 블록은 커서 줄이어도 그린다. `findBlocks` 를 시험용으로 `export function liveBlockRanges(state: EditorState): { from: number; to: number; kind: string }[]` 로 내보내고, 그리기 판정을 `export function shouldDrawBlock(lines: [number, number], active: Set<number>, editing: boolean): boolean` 로 뗀다.
- Modify: `web/src/liveSyntax.ts` — `fenced`: `lang === "mermaid"` 옆에 **위젯 블록일 때**(`widgetBlockOfNode(state, node)` 가 있을 때)만 건너뛴다(인용·목록 안 펜스는 코드 상자 그대로).
- Modify: `web/src/styles.css`(`.kw-root`, `.kw-display-inline { width: fit-content }`, `.kw-head`, `.kw-error`), messages — `kw.editRaw`("Edit as Markdown"/"원문으로 편집"), `kw.blockGone`("The widget block was removed, so your changes were discarded"/"위젯 블록이 사라져 고친 내용을 버렸습니다"), `kw.loadFailed`("Couldn't load the widget"/"위젯을 불러오지 못했습니다")
- Modify: `web/src/Editor.tsx` — `widgetEditField` 의 `gone` 을 보는 작은 `ViewPlugin`(`liveSlot` 밖): 업데이트의 트랜잭션 중 `widgetGoneNow(tr)` 가 있으면 `toast(t("kw.blockGone"), { kind: "warn" })` 한 번 후 `endWidgetEdit`(업데이트 안에서 dispatch 하지 않고 `queueMicrotask` 로).
- Test: `web/src/widgets/liveWidget.test.ts`, `web/src/liveSyntax.test.ts`(한 경우 추가)

**Interfaces:**
- Consumes: Task 2 `widgetBlockAt`·`nextWidgetBody`·`rewriteWidgetBlock`·`widgetEditField`와 효과들, Task 3 `resolveWidgetView`·`WidgetSession`·`widgetKeyAction`.
- Produces:
  ```ts
  // mount.ts
  export interface MountOptions {
    body: string; readOnly: boolean; resumeDraft?: unknown; resumeFocus?: number | null;
    write(state: unknown, version: number): boolean;
    edit: { start(draft: unknown): void; draft(draft: unknown): void; focus(index: number | null): void; end(): void };
    onRaw?: () => void;          // 있으면 머리에 「원문으로 편집」(Live Preview)
  }
  export interface MountedWidget { update(body: string): void; gone(): void; destroy(): void }
  export function mountKeyringWidget(el: HTMLElement, opts: MountOptions): MountedWidget;
  export const THEME_TOKENS: readonly string[];  // "--bg","--bg-soft","--fg","--muted","--border","--accent","--danger"
  // liveWidget.ts
  export class KeyringBlockWidget extends WidgetType { constructor(body: string, getCtx: GetCtx) }
  ```

- [ ] **Step 1: 실패하는 시험** — `liveWidget.test.ts`(`markdown`·`widgetEditField` 로 만든 `EditorState`):
  - 위젯 블록 하나 → `liveBlockRanges` 에 `{ kind: "keyring-widget", from: 여는 펜스 줄 처음, to: 닫는 펜스 줄 끝 }`. 인용 안·닫히지 않은 블록 → 그 kind 없음. ` ```mermaid ` 은 그대로 `mermaid`.
  - `shouldDrawBlock([3, 5], new Set([4]), false)` false, `(…, new Set([4]), true)` true, `(…, new Set([1]), false)` true.
  - `blockFieldNeedsUpdate`: `startWidgetEdit` 효과만 있는 트랜잭션 → true, `endWidgetEdit` 만 → true, 아무 효과 없는 빈 트랜잭션 → false(필드가 null 일 때와 **수정 중이라 필드가 non-null 일 때** 둘 다 — 필드가 같은 객체를 돌려주기 때문), 선택만 바뀜 → true.
  - `liveSyntax.test.ts`: 최상위 위젯 블록에는 `fenceHead`·`codeLine` 이 없고, `"> ```keyring-widget\n> {}\n> ```"` 에는 있다.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/liveWidget.test.ts src/liveSyntax.test.ts` → FAIL.
  (mount.ts 의 DOM 접착 — 리스너 달기·포커스 되돌리기·WeakMap 대응·알림 플러그인 — 은 Node 시험이 없다. 판단은 Task 3 의 `focusOutAction`·`widgetKeyAction`·`widgetViewChange` 와 Task 2 의 `widgetGoneNow` 가 지고, 접착은 Task 9 브라우저 확인과 리뷰가 본다.)
- [ ] **Step 3: 판정 구현** — `liveBlocks.ts`·`liveSyntax.ts` 의 위 변경.
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: `mount.ts`** — `resolveWidgetView(body)`: 오류면 `<pre>` 원문 + `.kw-error` 한 줄(`t(key, vars)`), 위젯이면 `.kw-root.kw-display-<display>` 를 만들고 `entry.load()`(실패 → `kw.loadFailed` + 원문) 뒤 `render(el, ctx, api)`. `api` 는 `WidgetSession` 에 잇고 `api.t(k, v)` = `t(`${entry.messages}.${k}`, v)`. `ctx.theme` 은 `getComputedStyle(document.documentElement)` 의 `THEME_TOKENS`, `lang` 은 `language()`; 테마·언어가 바뀌면 `onUpdate` 콜백들을 부른다(알아채는 방법은 구현자 몫, 리스너는 `destroy` 에서 뗀다). 뿌리 요소는 `tabindex="-1"`. `focusout` 핸들러 안에서는 판정하지 않고 **`queueMicrotask` 뒤에** `focusOutAction({ rootConnected: root.isConnected, relatedInside: root.contains(document.activeElement) })` 가 `"apply"` 일 때만 `session.focusOut()`(그사이 `destroy` 됐으면 아무것도 하지 않는다) — 엔진에 따라 포커스된 요소를 지우는 **처리 중**에 blur 가 나 핸들러 안의 `isConnected` 가 아직 true 일 수 있다. 지연 뒤에는 빠져 있으므로 뿌리가 DOM 에서 빠지는 중(미리보기 HTML 다시 그리기, 편집기가 위젯을 화면 밖으로 치움)에 나는 blur 로 적용하지 않는다. 리뷰 점검: 이 판정이 지연 뒤에 있는가. `focusin` 마다 뿌리 안 포커스 자리(`root.querySelectorAll("input, textarea, select, button, [tabindex]")` 안 순번)를 `opts.edit.focus(i)` 로 남기고, `resumeDraft` 로 다시 붙을 때 `resumeFocus` 자리에 `focus()` 를 되돌린다. `keydown`(`widgetKeyAction(e)` 가 `"escape"` 이고 `session.escape()` 가 true 면 `preventDefault`·`stopPropagation`). `write` 는 `opts.write(state, entry.def.version)`. `update(body)` → 새 `resolveWidgetView` 를 `widgetViewChange` 로 갈라 `session.external` 또는 다시 그리기. `destroy` → 정리 함수.
- [ ] **Step 6: `liveWidget.ts`** — `toDOM(view)`: `mountKeyringWidget`, `write` = `view.posAtDOM(dom)` 의 `widgetBlockAt` → `nextWidgetBody` → `rewriteWidgetBlock` → `view.dispatch`(null 이면 false), `edit` = `startWidgetEdit`·`setWidgetDraft`·`endWidgetEdit` 를 `view.dispatch({ effects })`, `resumeDraft`·`resumeFocus` = 필드의 `from` 이 이 블록이면 그 초안·포커스 자리(편집기가 화면 밖으로 치웠다 다시 만든 위젯도 이어받는다), `edit.focus` = `setWidgetFocus`, `onRaw` = `view.dispatch({ selection: { anchor: block.bodyFrom }, scrollIntoView: true })` 후 `view.focus()`(커서가 블록 안이라 원문이 된다), `readOnly` = `view.state.readOnly`. `eq` = 본문이 같다. `updateDOM(dom, view)` 는 모듈의 `WeakMap<HTMLElement, MountedWidget>` 에서 그 dom 의 것을 찾아 `update(body)` 하고 true(DOM·세션·초안을 지킨다), 없으면 false. `ignoreEvent()` true(편집기가 위젯 안 마우스·키를 받지 않아 선택이 블록 안으로 들어가지 않는다). `destroy(dom)` → `destroy()`. 필드의 `gone` 은 Editor 의 플러그인이 알리고, 위젯은 `gone()` 으로 세션을 닫는다.
- [ ] **Step 7: `cd web && pnpm exec vitest run && pnpm typecheck`** → 통과.
- [ ] **Step 8: 커밋** — `git add web/src/widgets/mount.ts web/src/widgets/liveWidget.ts web/src/widgets/liveWidget.test.ts web/src/liveBlocks.ts web/src/liveSyntax.ts web/src/liveSyntax.test.ts web/src/Editor.tsx web/src/styles.css packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `feat(web): Live Preview 에서 keyring-widget 을 그리고 그 자리에서 고친다`

### Task 6: 미리보기 호스트

**Files:**
- Create: `web/src/widgets/slot.ts`(순수), `web/src/widgets/PreviewKeyringWidget.tsx`
- Modify: `web/src/markdown.ts` — core 규칙 하나(`kw_fence`: `state.src` 로 fence 토큰의 닫힘을 보고 `t.meta = { kwClosed: true }`), `md.renderer.rules.fence` 에 `isKeyringFence(info, token.level, closed)` 면 `keyringSlotHtml(i, line)` 를 내고 원문을 `ctx.keyringWidgets` 에 넣는다(`widget-slot` 과 같은 방식, 다른 클래스). `line` = `lineOffset + token.map[0] + 1`(할 일·접기 줄 번호와 같은 계산). `Rendered` 에 `keyringWidgets: { body: string; line: number }[]`(`RenderEnv`·`renderInlineMarkdown` 의 env 에도 빈 배열).
- Modify: `web/src/Editor.tsx` — `EditorHandle` 에 아래 여섯.
- Modify: `web/src/DocPane.tsx` — `widgetSlots` 옆에 `kwSlots`(`.kw-slot`), `createPortal(<PreviewKeyringWidget … />, el, `${i}:${line}:${body}`)`. `readOnly` = `!!revision || doc.generated || !handle.current`(이력 보기는 쓰지 않는다 — 설계).
- Test: `web/src/widgets/slot.test.ts`

**Interfaces:**
- Consumes: Task 2 `widgetBlockAtLine`·`nextWidgetBody`·`rewriteWidgetBlock`·`widgetEditField`, Task 5 `mountKeyringWidget`.
- Produces:
  ```ts
  // slot.ts
  export function isKeyringFence(info: string, level: number, closed: boolean): boolean; // 첫 낱말 keyring-widget && level 0 && closed
  export function keyringSlotHtml(index: number, line: number): string; // `<div class="kw-slot" data-kw="${index}" data-kw-line="${line}"></div>`
  // EditorHandle (Editor.tsx)
  writeWidget(line: number, state: unknown, version: number): boolean;   // 그 줄의 위젯 블록을 트랜잭션 하나로
  startWidgetEdit(line: number, draft: unknown): void;
  setWidgetDraft(draft: unknown): void;
  endWidgetEdit(): void;
  setWidgetFocus(index: number | null): void;
  widgetEdit(): { line: number; draft: unknown; focus: number | null } | null; // 미리보기를 다시 그린 뒤 초안·포커스를 이어받는다
  // PreviewKeyringWidget.tsx
  export function PreviewKeyringWidget(p: { body: string; line: number; readOnly: boolean; handle: MutableRefObject<EditorHandle | null> }): null;
  ```

- [ ] **Step 1: 실패하는 시험** — `isKeyringFence("keyring-widget", 0, true)` true, `("keyring-widget x", 0, true)` true, `(…, 1, true)` false, `(…, 0, false)` false, `("widget", 0, true)` false. `keyringSlotHtml(2, 14)` → `'<div class="kw-slot" data-kw="2" data-kw-line="14"></div>'`.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/slot.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `slot.ts`, 그리고 `markdown.ts` 의 규칙. 닫힘 판정은 `token.map[1] - 1` 줄이 `^\s*(`{3,}|~{3,})\s*$` 이고 여는 펜스와 같은 글자인가.
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 호스트** — `EditorHandle` 의 여섯은 Task 2 함수를 `view` 에 거는 얇은 겉(`writeWidget` 은 `widgetBlockAtLine` → `nextWidgetBody` → `rewriteWidgetBlock` → `dispatch`, 블록이 없으면 false). `PreviewKeyringWidget` 은 `useEffect` 에서 `mountKeyringWidget`(`write` → `handle.current.writeWidget(line, …)`, `edit` → 핸들의 `startWidgetEdit`·`setWidgetDraft`·`setWidgetFocus`·`endWidgetEdit`, `resumeDraft`·`resumeFocus` = `handle.current.widgetEdit()` 의 `line` 이 이 블록이면 그 초안·포커스 자리). **미리보기 HTML 이 다시 그려지는 경우가 이 Task 의 핵심이다**: 다른 칸·동기화가 숨은 편집기를 바꾸면 `rendered.html` 이 바뀌고 슬롯 요소가 새것이 되어 포털이 새로 붙는다. 이때 옛 뿌리는 DOM 에서 빠지며 blur 가 나도 `focusOutAction` 이 `"ignore"` 라 적용하지 않고(React 커밋 중 편집기 dispatch 재진입도 없다), 새 뿌리가 초안과 포커스를 이어받는다. 옛 마운트의 `destroy` 는 `endWidgetEdit` 를 부르지 않는다(세션 끝은 적용·버림·gone 만). `onRaw` 없음. 미리보기 `onPreviewClick` 이 `.kw-slot` 안의 클릭을 가로채지 않는지 확인한다.
- [ ] **Step 6: `cd web && pnpm exec vitest run && pnpm typecheck`** → 통과.
- [ ] **Step 7: 커밋** — `git add web/src/widgets/slot.ts web/src/widgets/slot.test.ts web/src/widgets/PreviewKeyringWidget.tsx web/src/markdown.ts web/src/Editor.tsx web/src/DocPane.tsx` → `feat(web): 미리보기에서 keyring-widget 을 그리고 숨은 편집기로 쓴다`

### Task 7: 명령 팔레트 「위젯 넣기」

**Files:**
- Modify: `web/src/widgets/registry.ts` — 아래 함수, `web/src/widgets/blockEdit.ts` — `insertWidgetBlock`(Task 2 Interfaces 에 이름만 있음)
- Modify: `web/src/Editor.tsx` — `EditorHandle.insertWidget(text: string): void`: 커서가 0 이고 프런트매터가 있으면 `insertText` 처럼 `bodyStart` 뒤로 옮긴 다음 `insertWidgetBlock` 을 dispatch, `view.focus()`
- Modify: `web/src/Workspace.tsx` — `palette` 상태 타입(`:529`)에 `"widgets"`, 명령 목록의 `tpl-insert` 옆(`doc && !doc.generated` 안)에 `{ id: "widget-insert", group: g.doc, label: t("cmd.widgetInsert"), run: () => setPalette("widgets") }`, `<Palette>` 의 `placeholder`·`items` 갈래에 `"widgets"`(`t("palette.widgets")`, `widgetPaletteItems(language(), (text) => editorHandle.current?.insertWidget(text))`) — `insertText(…, { ownLine: true })` 는 선택을 닫는 펜스 줄 끝에 두어 Live Preview 가 막 넣은 블록을 원문으로 보이므로 쓰지 않는다
- Modify: messages — `cmd.widgetInsert`("Insert widget"/"위젯 넣기"), `palette.widgets`("Widgets"/"위젯")
- Test: `web/src/widgets/registry.test.ts`, `web/src/widgets/blockEdit.test.ts`

**Interfaces:**
- Consumes: Task 3 `widgetList`·`widgetInsertText`, Task 2 `insertWidgetBlock`·`widgetBlocks`.
- Produces:
  ```ts
  export function widgetPaletteItems(lang: string, insert: (text: string) => void): { id: string; label: string; detail: string; run: () => void }[];
  // label = def.title[lang] ?? def.title.en ?? def.id, detail = def.id, run → insert(widgetInsertText(def))
  ```

- [ ] **Step 1: 실패하는 시험** — 정의 둘(`title` `{ en: "X", ko: "엑스" }`, `{ en: "Y" }`) 등록 뒤 `widgetPaletteItems("ko", f)` 의 `label` `["엑스", "Y"]`, `detail` 이 id, 첫 항목 `run()` → `f` 가 `widgetInsertText(첫 정의)` 로 한 번.
  - `blockEdit.test.ts` 의 `insertWidgetBlock(state, B)`(`B` = 펜스 포함 블록 글): 문서 `"abc"` 커서 3 → `"abc\n" + B + "\n"`, 선택은 문서 끝(닫는 펜스 **다음** 빈 줄). `"ab"` 커서 1 → `"a\n" + B + "\nb"`, 선택은 `b` 줄 처음. `"a\nb"` 커서 1 → `"a\n" + B + "\nb"`(줄바꿈을 겹쳐 넣지 않는다), 선택은 `b` 줄 처음. 빈 문서 → `B + "\n"`, 선택 끝. 어느 경우든 넣은 뒤 `widgetBlocks` 가 그 블록 하나를 잡고, 선택 줄이 블록 줄 범위 밖이다(Live Preview 가 바로 위젯으로 그린다). 읽기 전용 → null. 고른 글이 있으면 그것을 바꾼다.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/registry.test.ts src/widgets/blockEdit.test.ts` → FAIL.
- [ ] **Step 3: 구현과 연결**.
- [ ] **Step 4: 통과 확인**, 그리고 `cd web && pnpm exec vitest run && pnpm typecheck`, `cd packages/core && pnpm exec vitest run test/i18n.test.ts`.
- [ ] **Step 5: 커밋** — `git add web/src/widgets/registry.ts web/src/widgets/registry.test.ts web/src/Workspace.tsx packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `feat(web): 명령 팔레트 「위젯 넣기」`

### Task 8: 인라인 위젯 크기 빌드 시험

**Files:**
- Create: `web/src/widgetBudget.ts`(순수 — `vite.config.ts` 가 `./src/emojiCatalog.ts` 처럼 불러온다)
- Modify: `web/vite.config.ts` — 플러그인 `inlineWidgetBudget()`(`apply: "build"`, `generateBundle(_, bundle)`)를 `plugins` 에 더한다
- Test: `web/src/widgetBudget.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const INLINE_WIDGET_GZIP_LIMIT = 51200;   // 설계 「약 50KB」 — 코디네이터 확인
  export const INLINE_WIDGET_DIR = "/src/widgets/inline/";
  export interface BudgetChunk { fileName: string; code: string; imports: string[]; isEntry: boolean; facadeModuleId: string | null }
  /** target 청크를 처음 쓸 때 새로 받는 파일: target 과 그 정적 imports(재귀) 중 진입 청크들의 정적 그래프에 없는 것 */
  export function firstUseFiles(chunks: BudgetChunk[], target: string): string[];
  export function firstUseGzip(chunks: BudgetChunk[], target: string): number; // gzipSync 길이의 합
  /** facade 가 INLINE_WIDGET_DIR 안인 청크마다 크기. 그런 청크가 없으면 throw(위젯이 정적으로 묶여 지연 불러오기가 깨진 것) */
  export function inlineWidgetSizes(chunks: BudgetChunk[]): { fileName: string; facade: string; bytes: number; over: boolean }[];
  ```

- [ ] **Step 1: 실패하는 시험** — 가짜 청크: 진입 `index.js`(imports `shared.js`), `dday.js`(facade `/w/web/src/widgets/inline/dday.ts`, imports `shared.js`·`lib.js`), `lib.js`(imports `lib2.js`), `lib2.js`(imports `lib.js` — 순환). `firstUseFiles(…, "dday.js")` → `["dday.js", "lib.js", "lib2.js"]`(순서 무관 비교), `shared.js` 없음. 압축이 안 되는 결정적 글(선형 합동 난수로 만든 60000자)을 `dday.js` code 로 → `over` true, 짧은 글 → false. 인라인 청크가 없는 목록 → throw.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgetBudget.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 플러그인은 `bundle` 의 `type === "chunk"` 를 `BudgetChunk` 로 옮겨 `inlineWidgetSizes` 를 부르고, 넘는 것이 있으면 `this.error(`${facade}: ${bytes} B gzip > ${INLINE_WIDGET_GZIP_LIMIT} B — 인라인 기준을 넘는다(설계 「인라인/iframe 기준」). 줄이거나 isolation: "frame" 으로`)`, 아니면 청크마다 `this.info` 로 크기 한 줄.
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 빌드로 확인** — `cd web && pnpm build`(vite 8 = rolldown. `generateBundle`·`this.error`·`this.info` 는 rollup 호환 훅으로 돌고 info 는 vite 의 `onRollupLog` 가 찍는다. core 는 `keyring-source` 조건으로 원본을 읽어 먼저 빌드하지 않아도 된다) → 성공, 출력에 `widgets/inline/dday.ts` 의 크기 한 줄(51200 보다 훨씬 작다). 그다음 `INLINE_WIDGET_GZIP_LIMIT` 를 잠시 `1` 로 바꿔 `pnpm build` 가 위 메시지로 **떨어지는지** 보고 되돌린다(되돌린 것을 `git diff` 로 확인).
- [ ] **Step 6: `cd web && pnpm exec vitest run && pnpm typecheck`** → 통과.
- [ ] **Step 7: 커밋** — `git add web/src/widgetBudget.ts web/src/widgetBudget.test.ts web/vite.config.ts` → `feat(web): 인라인 위젯의 처음 불러오는 크기를 빌드에서 막는다`

### Task 9: 사용자 문서와 전체 확인

**Files:**
- Modify: `docs/manual/en/how-to/use-widgets.md`(원본), `docs/manual/ko/how-to/use-widgets.md` — 새 절 「노트 안 위젯(D-day)」: 명령 팔레트 **Insert widget**, 누르면 고치기·밖을 누르면 적용·`Esc` 버림, **Edit as Markdown**, `editable: false`, 블록이 깨졌거나 위젯이 없을 때 보이는 것, 목록·인용 안에 있거나 닫는 펜스가 없는 블록은 코드 블록으로 남는다는 것, ` ```widget `(쿼리 위젯)과 다른 점 한 줄. ko 첫 줄 `<!-- source: … @ v… -->` 표시는 `docs/guideline/public-docs/03-i18n.md` 를 따른다.
- Modify: `docs/manual/{en,ko}/reference.md` — 「Widget syntax」(`## Widget syntax`) 아래 `### keyring-widget blocks`: 키 표(`widget`·`display`·`editable`·`state`), 엄격 JSON, 앱이 다시 쓰는 모양(예약 키 순서, 80자 한 줄 / 넘으면 2칸 여러 줄), 판이 높을 때.
- Modify: `CHANGELOG.md` — `[Unreleased]` 의 `### Added` 한 줄.
- (고치지 않음) `docs/ops/ux.md` — 코디네이터 몫. 확인 결과는 worker_done 보고에 적는다.

- [ ] **Step 1: 문서를 쓴다** — 쓰기 전에 `docs/guideline/public-docs/02-manual.md`·`03-i18n.md`·`04-style.md` 를 읽는다.
- [ ] **Step 2: 루트 검증** — `pnpm test`(core 238·web 715 보다 늘었는지, server 개수도 적는다. 멈추면 패키지별로), `pnpm typecheck`, `pnpm build`(크기 줄 확인), `pnpm fmt:check`, `pnpm lint`.
- [ ] **Step 3: 브라우저 확인** — 시험 서버(임시 `KEYRING_DATA`, 다른 포트, `docs/guides/development.md`)를 neo 로. 하나씩: Live Preview 에서 「위젯 넣기」 → **원문이 아니라 위젯이 바로 보임**(커서가 블록 다음 줄), 누르면 수정·밖을 누르면 적용, **누르고 입력칸을 건드리지 않고 바로 밖을 누름 → 수정이 끝남**, 수정 중 「원문으로 편집」 → 원문이 보이고 위젯이 남지 않음(파일 한 번 바뀜 — 저장 표시·git 커밋 수), `Esc` 버림, 바꾸지 않고 들어갔다 나가면 파일 그대로, 적용 뒤 `Mod+Z` 한 번, 「원문으로 편집」, 커서가 블록 안이면 원문, 깨진 JSON·모르는 id·`@9` 블록, `editable: false`, 미리보기에서 수정·적용(숨은 편집기 경로), 나란히 보기, 같은 문서 두 칸(한쪽 수정 중 다른 쪽이 블록을 고침·지움, 블록 바로 앞 줄에 글을 넣음 — 「사라짐」 알림이 나면 안 된다), **미리보기 칸에서 수정 중에 다른 칸이 노트의 다른 곳을 고침**(적용되지 않고 초안·포커스가 남는다 — Chromium 과 WebKit 둘 다), 코드 블록 수백 개인 노트에서 화살표·타이핑 속도, 이름 칸 한글 입력(조합 중 `Esc`·`Enter`·클릭), 밝은·어두운, 390px·터치 에뮬레이션(탭 → 수정 → 날짜 피커·가상 키보드 닫기), `?local`, 이력 보기(쓰지 않음). 데스크톱 앱(WebKit)은 할 수 있으면 보고, 못 보면 못 본 것으로 적는다. 본 것·못 본 것을 보고용으로 적어 둔다.
- [ ] **Step 4: 띄운 서버·탭을 끈다** — `띄운 것/끈 것` 줄을 보고에 적는다.
- [ ] **Step 5: 커밋** — `git add docs/manual/en/how-to/use-widgets.md docs/manual/ko/how-to/use-widgets.md docs/manual/en/reference.md docs/manual/ko/reference.md CHANGELOG.md` → `문서: keyring-widget 1단계 — 노트 안 위젯과 D-day`

---

## 설계 항목별 대응

| 설계 항목(1단계) | Task |
| --- | --- |
| 블록 형식·엄격 JSON·오류 한 줄 | 1, 3, 5 |
| 예약 키 순서·2칸·80자·원문 보존 | 1, 2(그리기만으로 안 바뀜) |
| migrate·판이 높을 때 | 1, 3 |
| `isolation`·출처로 frame 강제 | 3 |
| 공통 API 타입(2단계가 쓸 모양 그대로) | 3 |
| 상태가 바뀌는 길: 보기 상호작용·수정·포커스 아웃 적용·Esc·`exitEdit`·`editable: false` | 3, 5 |
| 트랜잭션 하나·실행 취소 한 번·같은 문서 다른 칸·자동 저장 | 2 |
| 미리보기 숨은 편집기 길, 이력 보기는 쓰지 않음 | 6 |
| 수정 중 바깥 변경·블록 사라짐 | 2, 3, 5 |
| Live Preview 그리기(mermaid 자리)·커서 들어오면 원문·「원문으로 편집」 | 5 |
| 미리보기 자리(`widget-slot` 방식, 다른 클래스) | 6 |
| `display: inline` = `width: fit-content` | 5 |
| 「위젯 넣기」 | 7 |
| 등록되지 않은 id | 3, 5, 6 |
| D-day(inline) | 4 |
| 크기 기준 빌드 시험(gzip 51200) | 8 |
| 사용자 문서 | 9 |
| 2단계로 미룸: iframe 호스트·CSP·데이터 파일(`api.file`·`state.file` 링크·해시 충돌)·전체 화면·Excalidraw·「두 연결 같음」 시험 | — |
