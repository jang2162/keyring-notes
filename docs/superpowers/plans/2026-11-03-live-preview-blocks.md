# Live Preview 요소 그리기 + 표 편집기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 편집 화면(Live Preview)에서 원문으로 남던 구분선·인용·글머리·할 일·코드 블록·줄 안 이미지·HTML 블록을 그리고, 표를 칸 편집기(CodeMirror)로 그 자리에서 고치는 표 편집기를 만든다.

**Architecture:** 7가지 요소는 기존 `livePreview.ts`(줄 안 기호 숨기기)·`liveBlocks.ts`(블록 위젯) 틀에 노드를 더한다. 판정은 순수 함수(`liveSyntax.ts`)로 떼어 `EditorState` 단위로 시험한다. 표는 순수 모델(`tableModel.ts` — 파싱·칸 위치 대응·작업 → `ChangeSpec[]`)과 화면(`tableWidget.ts` — 블록 위젯, `cellEditor.ts` — 칸 하나에만 붙는 CodeMirror)으로 나눈다. **본문 문서가 유일한 원본**이고, 칸 편집기는 본문 선택이 한 칸 안에 있을 때 그 칸에 열리는 창이다.

**Tech Stack:** CodeMirror 6(`@codemirror/state`·`view`·`lang-markdown`·`commands`·`autocomplete`), lezer markdown(GFM), markdown-it(미리보기 렌더러 재사용), React(`ui.tsx` 의 `Menu`), vitest(Node — DOM 없음).

**Spec:** `docs/superpowers/specs/2026-11-03-live-preview-blocks-design.md` — 이 계획은 그 문서를 따른다. 실행자는 둘 다 읽는다. 둘이 다르면 설계 문서가 원본이고, 다르다는 것을 보고한다.

## Global Constraints

- 화면 글은 `packages/core/src/messages/{en,ko}.json` 에 둔다. 영어가 기준, 키는 알파벳 순서 자리에 손으로 넣는다(oxfmt 는 키 순서를 맞추지 않는다).
- 표 작업이 파일에서 바꾸는 범위는 설계 6.5 「파일에 쓰는 범위」 그대로다. 표 전체를 다시 써 `|` 사이 공백을 맞추지 않는다.
- 모든 표 작업은 본문 트랜잭션 **하나**(실행 취소 한 번).
- 칸 편집기에는 자기 `history()` 를 두지 않는다. `Mod-z`/`Mod-Shift-z`/`Mod-y` 는 본문 뷰의 `undo`/`redo`.
- 고치는 칸은 원문이다(칸 편집기에 Live Preview 기호 숨기기·줄 안 장식을 붙이지 않는다 — 설계 6.3, 사용자).
- 읽기 전용(`EditorState.readOnly`)이면 체크박스·칸 편집기·손잡이·메뉴가 없다.
- Live Preview 가 꺼지면 이 계획의 모든 그리기가 꺼진다(`liveSlot` Compartment 안에 둔다).
- 같은 디렉터리에 대소문자만 다른 파일 이름을 두지 않는다.
- 시험은 Node(vitest, DOM 없음)다. DOM 이 필요한 동작은 순수 함수로 떼어 시험하고, 나머지는 Task 10 의 브라우저 확인으로 본다.
- 커밋 메시지는 한국어(`feat(web): …`), 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 파일은 경로로 stage 한다.

## Review Focus

1. **칸에서 한글 조합 중 `Tab`·`Enter`·다른 칸 클릭** — 조합 중인 글자가 사라지거나 두 번 들어가지 않고, 조합이 끝난 글이 원래 칸에 남은 뒤 이동한다. (Task 7: 조합 중에는 이동 키를 받지 않는 판정 함수 시험)
2. **`\|` 가 든 칸과 칸이 모자란 행** — 칸 글은 `|` 로 보이고, 고쳐도 이웃 칸이 깨지지 않으며, 빈 자리 칸을 고치면 그 행에 칸이 붙는다. (Task 4·5 시험)
3. **칸을 고치는 중 다른 칸(같은 문서를 연 다른 편집기)이 표 앞쪽 글을 바꿈** — 열린 칸의 커서가 같은 글자 자리에 남는다. (Task 7: `mapPos` 시험)
4. **프런트매터 바로 뒤의 표, 문서 끝에 줄바꿈 없이 끝나는 표, 표 바로 앞의 `---`** — 표·구분선·프런트매터 판정이 서로 먹지 않는다. (Task 1·4 시험)
5. **칸에서 친 글자 여러 개를 실행 취소** — 본문 타이핑처럼 한 묶음으로 되돌아가고, 본문에서 친 것과 순서가 섞이지 않는다. (Task 7 시험)

---

### Task 1: 구분선·인용·글머리·할 일 판정과 그리기

**Files:**
- Create: `web/src/liveSyntax.ts`
- Modify: `web/src/livePreview.ts` (`build` — 아래 판정의 결과를 장식으로 바꾼다. 위젯 클래스·테마 추가)
- Test: `web/src/liveSyntax.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SyntaxMark =
    | { kind: "hide"; from: number; to: number }
    | { kind: "hr"; from: number; to: number }                 // 줄 내용 전체
    | { kind: "bullet"; from: number; to: number }             // ListMark 한 글자
    | { kind: "task"; from: number; to: number; done: boolean; line: number } // "- [ ] " 전체, line 은 1부터
    | { kind: "quoteLine"; line: number; depth: number }       // 줄 장식(커서 줄 포함)
    | { kind: "codeLine"; line: number }                       // Task 2
    | { kind: "fenceHead"; from: number; to: number; lang: string; code: string } // Task 2
    | { kind: "fenceTail"; from: number; to: number };         // Task 2
  export function syntaxMarks(state: EditorState, from: number, to: number, active: Set<number>): SyntaxMark[];
  export function toggleTaskAt(state: EditorState, line: number): TransactionSpec | null; // "[ ]"↔"[x]" 한 글자, userEvent "input"
  ```

- [ ] **Step 1: 실패하는 시험을 쓴다** — `liveSyntax.test.ts` 에서 `EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })` 로 상태를 만들고 `ensureSyntaxTree` 뒤 `syntaxMarks(state, 0, doc.length, new Set([커서 줄]))` 를 본다.
  - `"a\n\n---\n\nb"`, 커서 1줄 → `{kind:"hr", from:3, to:6}` 하나. 커서가 3줄이면 없음.
  - `"---\nedited: x\n---\n\n***"` → 프런트매터의 `---` 두 줄에는 `hr` 이 없고 5줄 `***` 에만 있다.
  - `"글\n---"` → `hr` 없음(Setext 제목).
  - `"> 인용\n>> 겹침"`, 커서 없음 → `quoteLine` 1줄 depth 1, 2줄 depth 2, `>`·`>>` 와 뒤 공백 하나는 `hide`. 커서 1줄이면 1줄의 `hide` 는 없고 `quoteLine` 은 있다.
  - `"> [!note] 제목\n> 내용"` → `quoteLine`·`hide` 없음(콜아웃).
  - `"- a\n  * b\n1. c"` → `bullet` 은 `-`(0–1)과 `*`(4–5) 둘, `1.` 은 없음.
  - `"- [ ] 할 일\n- [x] 끝"` → `task` 두 개(`from` 은 `-`, `to` 는 `]` 뒤 공백 다음), `done` false/true, `bullet` 은 없음.
  - `toggleTaskAt(state, 2)` 를 적용하면 `"- [ ] 할 일\n- [ ] 끝"`, 선택은 그대로.
- [ ] **Step 2: 시험이 실패하는지 돌린다** — `cd web && pnpm exec vitest run src/liveSyntax.test.ts` → FAIL(모듈 없음).
- [ ] **Step 3: `syntaxMarks`·`toggleTaskAt` 을 구현한다** — `syntaxTree(state).iterate` 로 `HorizontalRule`·`Blockquote`/`QuoteMark`·`ListMark`·`Task`/`TaskMarker` 를 본다. 프런트매터 범위는 `livePreview.ts` 의 `frontmatterEnd` 를 export 해 쓴다. 콜아웃 판정은 `liveBlocks.ts` 의 정규식(`/^\s*>\s*\[![A-Za-z][\w-]*\][+-]?/`)과 같은 것을 한곳에 두고 둘이 쓴다.
- [ ] **Step 4: 시험이 통과하는지 돌린다** — 같은 명령 → PASS.
- [ ] **Step 5: `livePreview.ts` 의 `build` 에 붙인다** — `hr` → 가로줄 위젯(누르면 그 줄로 커서), `bullet` → `•` 위젯, `task` → 체크박스 위젯(`mousedown` 에서 `preventDefault` 후 `view.dispatch(toggleTaskAt(...))`, 읽기 전용이면 `disabled`), `quoteLine` → `Decoration.line({ class: "cm-lp-quote", attributes: { style: "--quote-depth: N" } })`, `hide` → 기존 `hide`. 끝낸 할 일 줄 글은 미리보기의 `task-item` 모양을 따른다.
- [ ] **Step 6: 웹 시험 전체와 타입체크** — `cd web && pnpm test && pnpm typecheck` → 통과, 실행 개수 확인.
- [ ] **Step 7: 커밋** — `git add web/src/liveSyntax.ts web/src/liveSyntax.test.ts web/src/livePreview.ts web/src/liveBlocks.ts` → `feat(web): Live Preview 에서 구분선·인용·글머리·할 일을 그린다`

### Task 2: 코드 블록

**Files:**
- Modify: `web/src/liveSyntax.ts`, `web/src/livePreview.ts`
- Modify: `packages/core/src/messages/{en,ko}.json` — `code.copy`("Copy"/"복사"), `code.copied`("Copied"/"복사함")
- Test: `web/src/liveSyntax.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `SyntaxMark` 의 `codeLine`·`fenceHead`·`fenceTail`.

- [ ] **Step 1: 실패하는 시험** —
  - `"앞\n```ts\nconst a = 1;\n```\n뒤"`, 커서 1줄 → `fenceHead`(2줄 전체, `lang: "ts"`, `code: "const a = 1;"`), `codeLine` 3줄, `fenceTail`(4줄 전체).
  - 커서 3줄(블록 안) → `fenceHead`·`fenceTail` 없음, `codeLine` 3줄은 있음.
  - ` ```mermaid ` 블록 → 셋 다 없음(liveBlocks 가 그린다).
  - 들여쓴 코드 블록(`"    code"`) → `codeLine` 만.
  - 닫는 펜스 없이 문서가 끝나는 블록 → `fenceHead` 는 있고 `fenceTail` 없음, `code` 는 끝까지.
- [ ] **Step 2: 돌려서 실패 확인** — `pnpm exec vitest run src/liveSyntax.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `FencedCode`(`CodeInfo` 로 언어, `CodeText` 로 안쪽)·`CodeBlock`.
- [ ] **Step 4: 돌려서 통과 확인**.
- [ ] **Step 5: 장식** — `fenceHead` → 줄 내용을 머리 위젯(언어 이름 + 「복사」 단추, `navigator.clipboard.writeText(code)` 뒤 `code.copied` 를 잠깐), `fenceTail` → 줄 내용을 빈 위젯으로(줄은 상자 아래 여백으로 남는다), `codeLine` → `Decoration.line({ class: "cm-lp-codeblock" })`. 코드 접기(`codeFoldProp`)로 접힌 블록에서도 머리가 보이는지 Task 10 에서 본다.
- [ ] **Step 6: `pnpm test && pnpm typecheck`** (web).
- [ ] **Step 7: 커밋** — `feat(web): Live Preview 에서 코드 블록의 펜스 줄을 숨기고 상자로 그린다`

### Task 3: 줄 안 `![글](주소)` 와 HTML 블록

**Files:**
- Modify: `web/src/liveBlocks.ts` (`findBlocks` 에 `html`, `buildInline` 에 `![](...)`), `web/src/livePreview.ts`(`if (name === "Image") return false;` 주석 정리)
- Create: `web/src/liveImage.ts` — 순수 함수
- Test: `web/src/liveImage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** 줄 안 마크다운 이미지의 주소를 그릴 URL 로. 볼트 상대 경로면 resolve 결과, http(s) 면 그대로, SAFE_URI 에 걸리면 null */
  export function inlineImageUrl(url: string, resolve: (target: string) => string | null, rawUrl: (path: string) => string): string | null;
  export function isCommentBlock(text: string): boolean; // HTML 블록이 <!-- … --> 하나뿐인가
  ```

- [ ] **Step 1: 실패하는 시험** — `inlineImageUrl("img/a.png", r, u)` 는 `u(r("img/a.png"))`, `"https://x/a.png"` 그대로, `"javascript:alert(1)"` null, `"없는.png"`(resolve null) null. `isCommentBlock("<!-- uploading… -->")` true, `"<div>a</div>"` false, `"<!-- a -->\n<div/>"` false.
- [ ] **Step 2: 실패 확인** — `pnpm exec vitest run src/liveImage.test.ts`.
- [ ] **Step 3: 구현** — `SAFE_URI` 는 `markdown.ts` 의 것을 쓴다.
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 붙이기** — `buildInline`: 줄에 다른 글이 있을 때 lezer `Image` 노드(`URL` 자식)를 `InlineImage` 로. `findBlocks`: `HTMLBlock` 이고 `!isCommentBlock` 이면 `kind: "html"` 블록(`BlockWidget`).
- [ ] **Step 6: `pnpm test && pnpm typecheck`** (web).
- [ ] **Step 7: 커밋** — `feat(web): Live Preview 에서 줄 안 이미지와 HTML 블록을 그린다`

### Task 3A: 코드 블록 언어별 색 — 미리보기와 공통 테마 색

설계 9절. 1차(Task 1–3)에 함께 들어간다.

**Files:**
- Create: `web/src/codeHighlight.ts`
- Modify: `web/src/enhance.ts`(그린 뒤 `pre > code[class*="language-"]` 를 칠한다), `web/src/Editor.tsx`(`defaultHighlightStyle` → `classHighlighter`), `web/src/styles.css`(`.tok-*` 규칙, 밝은·어두운 테마 토큰)
- Test: `web/src/codeHighlight.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** 코드 글을 lezer 파서로 나눈 조각. 언어를 모르거나 불러오지 못하면 null */
  export async function highlightPieces(code: string, lang: string): Promise<{ text: string; cls: string }[] | null>;
  /** code 요소의 글을 조각대로 <span class="tok-…"> 로 다시 채운다(글 노드로 만든다, innerHTML 을 쓰지 않는다) */
  export function paintCode(el: HTMLElement, pieces: { text: string; cls: string }[]): void;
  ```

- [ ] **Step 1: 실패하는 시험** — `highlightPieces("const a = 1;", "ts")` 의 조각을 이으면 원래 글과 같고, `const` 조각의 `cls` 에 `tok-keyword` 가 든다. `"js"`·`"typescript"` 같은 별칭도 찾는다. `highlightPieces("x", "없는언어")` → null. 빈 글 → 빈 배열.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/codeHighlight.test.ts`.
- [ ] **Step 3: 구현** — `LanguageDescription.matchLanguageName(languages, lang, true)` → `load()` → `support.language.parser.parse(code)` → `highlightCode(code, tree, classHighlighter, put, br)`.
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 붙이기** — `enhance.ts` 에서 markdown-it 이 단 `class="language-xxx"` 로 언어를 읽어 `highlightPieces` → `paintCode`. Mermaid 블록은 건너뛴다. 편집 화면은 `syntaxHighlighting(classHighlighter)` 로 바꾸고 `.tok-*` 색을 `styles.css` 에 테마 토큰으로(밝은·어두운 둘 다, 기존 `:root`·어두운 테마 블록 관례를 따른다).
- [ ] **Step 6: `pnpm test && pnpm typecheck && pnpm build`** (web — 언어 청크가 빌드 결과에 나뉘어 들어가는지 확인).
- [ ] **Step 7: 커밋** — `feat(web): 미리보기 코드 블록을 언어별로 칠하고 편집 화면과 같은 테마 색을 쓴다`

### Task 4: 표 모델 — 파싱과 칸 위치 대응

**Files:**
- Create: `web/src/tableModel.ts`
- Test: `web/src/tableModel.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Align = "left" | "center" | "right" | null;
  /** 칸의 문서 구간: 앞뒤 공백을 뺀 글. 빈 칸은 from === to(여는 | 다음 공백 하나 뒤, 공백이 없으면 | 바로 뒤) */
  export interface TableCell { from: number; to: number; raw: string }
  export interface TableRow { from: number; to: number; text: string; cells: TableCell[] } // 줄 하나
  export interface TableModel {
    from: number; to: number;
    header: TableRow; delim: TableRow; body: TableRow[];
    align: Align[]; columns: number;   // columns = 구분 줄의 칸 수
    outerPipes: boolean;               // 첫 줄이 | 로 시작하는가
  }
  export function parseTable(doc: Text, from: number, to: number): TableModel | null; // from/to = lezer Table 노드
  export function cellText(raw: string): string;                 // "\|" → "|"
  export function textToRawPos(raw: string, textPos: number): number;
  export function rawToTextPos(raw: string, rawPos: number): number;
  export function escapeCellInput(text: string): string;         // "|" → "\|", "\n" → "<br>"
  /** 칸 편집기의 변경(칸 글 좌표)을 본문 변경으로. 이스케이프에 맞춰 위치를 옮긴다 */
  export function cellChangesToDoc(cell: TableCell, changes: ChangeSet): ChangeSpec[];
  /** row: 0 = 머리, 1.. = 본문. 칸이 모자란 행이면 칸을 붙이는 변경과 붙인 뒤의 칸 위치 */
  export function ensureCell(m: TableModel, row: number, col: number): { changes: ChangeSpec[]; at: number };
  export function cellAt(m: TableModel, pos: number): { row: number; col: number } | null; // pos 가 한 칸 구간 안(양끝 포함)인가
  ```

- [ ] **Step 1: 실패하는 시험** —
  - `"| a | b |\n| :-- | --: |\n| 1 | 2 |"` → `outerPipes` true, `columns` 2, `align` `["left","right"]`, `header.cells[1].raw` `"b"`, 본문 칸 `from/to` 가 문서에서 `"1"`·`"2"` 를 가리킨다.
  - 바깥 `|` 없는 `"a | b\n--- | :-:\n1 | 2"` → `outerPipes` false, `align` `[null,"center"]`.
  - `"| a \| b | c |\n|---|---|\n| x |"` → 머리 칸 2개(`raw` `"a \| b"`), 본문 행 칸 1개(모자람).
  - `"| a |  |\n|---|---|"` → 둘째 칸 빈 칸(`from === to`).
  - 프런트매터 뒤(`"---\nx: 1\n---\n| a |\n|---|"`)와 끝 줄바꿈 없는 표 → `to` 가 문서 끝.
  - `cellText("a \\| b")` → `"a | b"`, `textToRawPos("a \\| b", 3)` → 4, `rawToTextPos(같은, 5)` → 4.
  - `escapeCellInput("x|y\nz")` → `"x\\|y<br>z"`.
  - `cellChangesToDoc`: 칸 `"a \| b"` 에서 칸 글 위치 4(`|` 뒤)에 `"Q"` 를 넣는 ChangeSet → 문서 위치는 `cell.from + 5`.
  - `ensureCell(m, 1, 1)`(모자란 행) → 행 끝에 `" |"`(outerPipes 면 `"  |"` 꼴, 기존 모양을 따름)을 붙이는 변경과 새 칸 위치.
  - `cellAt`: 칸 구간 밖(`|` 위)이면 null.
- [ ] **Step 2: 실패 확인** — `pnpm exec vitest run src/tableModel.test.ts`.
- [ ] **Step 3: 구현** — 칸 나누기는 이스케이프되지 않은 `|` 기준(GFM: 인라인 코드 안의 `|` 도 이스케이프가 필요하다 — 따로 다루지 않는다).
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 커밋** — `feat(web): 표 편집기의 표 모델(파싱·칸 위치 대응)을 더한다`

### Task 5: 표 모델 — 행·열 작업, 정렬, sort

**Files:**
- Modify: `web/src/tableModel.ts`
- Test: `web/src/tableModel.test.ts`

**Interfaces:**
- Consumes: Task 4 의 `TableModel`.
- Produces (모두 `ChangeSpec[]` 를 돌려준다. 본문 행 번호 `i` 는 0부터):
  ```ts
  export function insertRow(m: TableModel, at: number): ChangeSpec[];       // at: 0..body.length, 빈 칸은 "  "
  export function deleteRow(m: TableModel, i: number): ChangeSpec[];
  export function moveRow(m: TableModel, from: number, to: number): ChangeSpec[];
  export function insertColumn(m: TableModel, at: number): ChangeSpec[];   // at: 0..columns
  export function deleteColumn(m: TableModel, col: number): ChangeSpec[];  // columns > 1 일 때만
  export function moveColumn(m: TableModel, from: number, to: number): ChangeSpec[];
  export function setAlign(m: TableModel, col: number, align: Align): ChangeSpec[];
  export function sortRows(m: TableModel, col: number, dir: "asc" | "desc"): ChangeSpec[];
  export function visibleText(raw: string): string;   // 마크다운 기호를 뺀 글
  export function compareCells(a: string, b: string): number; // 숫자면 숫자로, 아니면 localeCompare numeric·base
  ```

- [ ] **Step 1: 실패하는 시험** — 시험 도우미 `apply(doc, specs)` 로 결과 글을 보고, **바뀐 줄 번호 집합**도 함께 본다(`changedLines(before, after)`).
  - `insertRow(m, 1)` → 본문 2번째 자리에 `"|  |  |"` 꼴 줄 하나, 다른 줄은 바뀌지 않음. 바깥 `|` 없는 표도 새 빈 행은 `"|  |  |"` 꼴(공백뿐인 첫·끝 칸은 `|` 로 닫아야 GFM 이 칸으로 읽는다 — 2차 구현에서 확인).
  - `deleteRow` → 그 줄만 사라짐. `moveRow(m, 2, 0)` → 줄 글은 그대로, 순서만.
  - `insertColumn(m, 1)` → 모든 줄에 칸 하나, 구분 줄에는 `---`. 다른 칸 글·공백 그대로(`"|  a   | b |"` 의 `"  a   "` 가 남는다).
  - `deleteColumn`·`moveColumn` 도 같은 방식. 칸이 모자란 행에서 없는 칸을 지우거나 옮겨도 깨지지 않는다.
  - `setAlign(m, 0, "center")` → 구분 줄만 바뀌고 `"| :--: |"` 꼴(원래 `-` 개수 유지, 최소 3). `null` 이면 콜론 제거.
  - `sortRows`(한 열): `["10","9","","2%","1,000"]` 오름차순 → `["2%","9","10","1,000",""]`, 내림차순 → `["1,000","10","9","2%",""]`(빈 칸은 어느 쪽이든 끝). 글 `["b","a","B"]` 오름차순 → `["a","b","B"]`(`b`·`B` 는 같은 값이라 원래 순서 — 안정). 머리 행·구분 줄은 그대로, 바뀐 줄은 본문 줄뿐.
  - `compareCells("1,000", "10") > 0`, `compareCells("-3", "2") < 0`, `compareCells("1.5", "1.25") > 0`, `compareCells("2%", "10%") < 0`. 숫자와 글이 섞이면 `localeCompare(…, undefined, { numeric: true, sensitivity: "base" })`.
  - `visibleText("**12**")` → `"12"`, `visibleText("[[노트|별칭]]")` → `"별칭"`, `visibleText("[[노트]]")` → `"노트"`, `visibleText("[글](u)")` → `"글"`.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 커밋** — `feat(web): 표 모델에 행·열 작업·정렬·sort 를 더한다`

### Task 6: 표 위젯 — 그리기와 「원문으로 편집」

**Files:**
- Create: `web/src/tableWidget.ts`
- Modify: `web/src/livePreview.ts` (`livePreview(ctx, table?)` 로 표 확장을 함께 켠다), `web/src/Editor.tsx`(넘길 옵션)
- Modify: `web/src/markdown.ts` — `export function renderInlineMarkdown(raw: string, ctx: RenderContext): string`(markdown-it `renderInline` + 위키링크 규칙 + DOMPurify, 수식 자리 포함)
- Modify: messages — `table.menu`("Table menu"/"표 메뉴"), `table.editRaw`("Edit as Markdown"/"원문으로 편집")
- Test: `web/src/tableWidget.test.ts`

**Interfaces:**
- Consumes: Task 4 `parseTable`.
- Produces:
  ```ts
  export interface TableOptions {
    linkCandidates: () => LinkCandidate[];
    onFiles?: (files: File[]) => Promise<string[]>;
  }
  export function tableEditor(getCtx: GetCtx, opts: TableOptions): Extension;
  /** 그릴 표의 범위(테스트용). rawTables 에 든 표는 빼고 */
  export function tableRanges(state: EditorState): { from: number; to: number }[];
  export const editTableRaw: StateEffectType<number>;   // 표 from 을 원문 모드로
  ```

- [ ] **Step 1: 실패하는 시험** — `EditorState`(markdown + `tableEditor(() => null, opts)` 의 상태 부분)에서 `tableRanges`:
  - 최상위 표 하나 → 범위 하나(표 줄 전체). 커서가 표 안이어도 범위는 있다.
  - `"> | a |\n> |---|"`(인용 안) → 없음.
  - `editTableRaw.of(표from)` 를 보낸 뒤 → 없음. 커서를 표 밖으로 옮기는 트랜잭션 뒤 → 다시 있음.
  - 읽기 전용 상태에서도 범위는 있다(그리기는 한다).
- [ ] **Step 2: 실패 확인** — `pnpm exec vitest run src/tableWidget.test.ts`.
- [ ] **Step 3: 구현** — `StateField` 로 원문 모드 표 집합(`editTableRaw` 로 넣고, 선택이 그 표 밖으로 나가면 뺀다, 문서 변경에 `mapPos`)과 `Decoration.replace({ widget, block: true })` 를 둔다. 위젯은 `<table>` 를 그리고 칸은 `renderInlineMarkdown`, 열 정렬은 `text-align`, 칸 안 링크는 `ctx.onLink`. 표 오른쪽 위 ⋯ 단추 → `Menu`(`createRoot` 로 `document.body` 의 칸에 띄움) → 「원문으로 편집」. `WidgetType.eq` 는 표 글이 같으면 true, `updateDOM` 으로 같은 DOM 을 지켜 칸만 바꾼다(Task 7 의 열린 칸 편집기를 잃지 않게).
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: `pnpm test && pnpm typecheck`** (web).
- [ ] **Step 6: 커밋** — `feat(web): Live Preview 에서 표를 그리고 원문으로 편집할 수 있게 한다`

### Task 7: 칸 편집기 — 열기·동기화·실행 취소·IME

**Files:**
- Create: `web/src/cellEditor.ts`
- Modify: `web/src/tableWidget.ts`, `web/src/Editor.tsx`(`wikilinkSource`·`headingStyle`·서식 명령(`wrapSelection`·`insertLink`)을 export 해 칸 편집기가 쓴다)
- Test: `web/src/cellEditor.test.ts`

**Interfaces:**
- Consumes: Task 4 `cellAt`·`cellChangesToDoc`·`textToRawPos`·`rawToTextPos`, Task 6 `tableEditor`.
- Produces:
  ```ts
  /** 본문 선택이 한 칸 안이면 그 칸(표 from, row, col)과 칸 글 좌표의 선택. 여러 칸·표 밖에 걸치면 null */
  export function selectedCell(state: EditorState): { table: number; row: number; col: number; anchor: number; head: number } | null;
  /** 칸 편집기 트랜잭션 → 본문 트랜잭션(같은 userEvent, 선택도 옮김) */
  export function cellTransactionToMain(main: EditorState, cell: TableCell, tr: Transaction): TransactionSpec;
  /** 조합 중이면 이동 키·다시 그리기를 미룬다 */
  export function shouldDefer(composing: boolean, key: string): boolean;
  export interface ActiveCell { insert(text: string): void }
  export function activeCell(view: EditorView): ActiveCell | null;
  ```

- [ ] **Step 1: 실패하는 시험** —
  - `selectedCell`: 커서가 칸 `"a \| b"` 의 `|` 뒤 → `col`·`anchor`(칸 글 좌표 3). 선택이 두 칸에 걸치면 null, `Mod-A` 처럼 문서 전체면 null.
  - 실행 취소 묶음: `EditorState.create({ extensions: [history(), markdown(...)] })` 에서 칸에 `"가"`, `"나"`, `"다"` 를 `cellTransactionToMain` 으로(각각 `userEvent: "input.type"`, 시간 간격 짧게 — `Transaction.time` 어노테이션) 넣은 뒤 `undo` 한 번 → 셋 다 사라짐. 그 앞에 본문에서 친 글은 남는다.
  - 다른 칸에서 온 변경(`mirrored`, 표 앞에 글 넣기)을 적용한 뒤 `selectedCell` 의 `anchor` 가 같은 글자 자리.
  - `shouldDefer(true, "Tab")` true, `shouldDefer(false, "Tab")` false, `shouldDefer(true, "a")` false.
- [ ] **Step 2: 실패 확인** — `pnpm exec vitest run src/cellEditor.test.ts`.
- [ ] **Step 3: 순수 부분 구현** — `selectedCell`·`cellTransactionToMain`·`shouldDefer`.
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 화면 부분** — 표 위젯이 본문 선택을 보다가 `selectedCell` 이 이 표면 그 칸 자리에 칸 편집기(`EditorView`: markdown 언어, `syntaxHighlighting(headingStyle)`·기본 색, `autocompletion({ override: [wikilinkSource(opts.linkCandidates)] })`, 서식 키맵, `codeFont`, `Mod-z`/`Mod-Shift-z`/`Mod-y` → 본문 `undo`/`redo`)를 붙이고 포커스한다. 칸 편집기의 모든 트랜잭션은 `cellTransactionToMain` 으로 본문에 보내고, 칸 편집기 자신은 본문이 바뀐 뒤 칸 글을 다시 받아 맞춘다(한 방향: 본문 → 칸). 조합 중(`view.composing`)에는 본문 쪽 다시 그리기를 칸에 반영하지 않고 `compositionend` 뒤에 맞춘다. 칸을 떠나면 칸 편집기를 `destroy` 하고 HTML 로. 칸을 누르면 본문 선택을 그 칸 위치로 옮기는 것으로 연다(열기 경로를 하나로). 칸 안 붙여넣기: 여러 줄 → `escapeCellInput`, 파일 → `opts.onFiles` 결과를 공백으로 이어 넣기(자리 표시는 줄바꿈 없는 글).
- [ ] **Step 6: `Editor.tsx` 의 `insertText`** — `activeCell(view)` 가 있으면: `ownLine` 이 없거나 한 줄 글이면 `cell.insert(text)`, 여러 줄이면 칸 편집기를 닫고(본문 선택을 표 뒤 줄로) 그 줄에 넣는다(설계 6.3.2).
- [ ] **Step 7: `pnpm test && pnpm typecheck`** (web).
- [ ] **Step 8: 커밋** — `feat(web): 표 칸을 칸 편집기로 그 자리에서 고친다`

### Task 8: 키보드 이동

**Files:**
- Create: `web/src/tableNav.ts`
- Modify: `web/src/cellEditor.ts`(키맵), `web/src/livePreview.ts` 또는 `tableWidget.ts`(본문에서 표로 들어가는 `↑`·`↓`)
- Test: `web/src/tableNav.test.ts`

**Interfaces:**
- Consumes: Task 4 `TableModel`, Task 5 `insertRow`.
- Produces:
  ```ts
  export type NavKey = "Tab" | "Shift-Tab" | "Enter" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
  export type NavResult = { kind: "cell"; row: number; col: number } | { kind: "newRow" } | { kind: "exit"; where: "before" | "after" } | { kind: "stay" };
  /** atStart/atEnd: 칸 글의 처음/끝에 커서가 있는가(← → 에만 쓴다) */
  export function navigate(m: TableModel, row: number, col: number, key: NavKey, atStart: boolean, atEnd: boolean): NavResult;
  ```

- [ ] **Step 1: 실패하는 시험** — 2열·머리+본문 2행 표에서 설계 6.4 표의 각 줄: `Tab` 은 오른쪽, 줄 끝에서 다음 행 첫 칸, 마지막 칸에서 `newRow`; `Shift-Tab` 반대, 머리 첫 칸에서 `stay`; `Enter` 아래, 마지막 행에서 `newRow`; `↑` 머리에서 `exit before`, `↓` 마지막 행에서 `exit after`; `←` 는 `atStart` 일 때만 왼쪽 칸(첫 칸이면 `stay`), `→` 는 `atEnd` 일 때만.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 키맵에 붙이기** — 자동완성이 열려 있으면 `completionKeymap` 이 먼저. `shouldDefer` 면 아무것도 하지 않는다. `newRow` → `insertRow` 후 새 행 첫 칸(Tab) / 같은 열(Enter). `exit` → 본문 선택을 표 앞 줄 끝 / 뒤 줄 처음으로 옮기고 본문 포커스. `Esc` → 표 뒤 줄. `Shift+Enter` → `<br>`. 본문에서: 커서가 표 바로 위 줄에서 `↓` → 머리 첫 칸, 바로 아래 줄에서 `↑` → 마지막 행 첫 칸.
- [ ] **Step 6: `pnpm test && pnpm typecheck`** (web).
- [ ] **Step 7: 커밋** — `feat(web): 표 편집기에서 키보드로 칸을 옮겨 다닌다`

### Task 9: 행·열 손잡이, 메뉴, 끌어 옮기기

**Files:**
- Modify: `web/src/tableWidget.ts`, `web/src/styles.css`(손잡이·끌기 선·표 모양, 토큰 색)
- Modify: messages — `table.rowAbove`("Insert row above"/"위에 행 넣기"), `table.rowBelow`("Insert row below"/"아래에 행 넣기"), `table.rowUp`("Move row up"/"위로 옮기기"), `table.rowDown`("Move row down"/"아래로 옮기기"), `table.rowDelete`("Delete row"/"행 지우기"), `table.colLeft`("Insert column left"/"왼쪽에 열 넣기"), `table.colRight`("Insert column right"/"오른쪽에 열 넣기"), `table.colMoveLeft`("Move column left"/"왼쪽으로 옮기기"), `table.colMoveRight`("Move column right"/"오른쪽으로 옮기기"), `table.colDelete`("Delete column"/"열 지우기"), `table.alignLeft`("Align left"/"왼쪽 정렬"), `table.alignCenter`("Align center"/"가운데 정렬"), `table.alignRight`("Align right"/"오른쪽 정렬"), `table.alignNone`("No alignment"/"정렬 없음"), `table.sortAsc`("Sort ascending"/"오름차순 정렬"), `table.sortDesc`("Sort descending"/"내림차순 정렬"), `table.rowHandle`("Row menu"/"행 메뉴"), `table.colHandle`("Column menu"/"열 메뉴")
- Create: `web/src/tableMenu.ts` — 메뉴 항목을 정하는 순수 함수
- Test: `web/src/tableMenu.test.ts`

**Interfaces:**
- Consumes: Task 5 작업 함수.
- Produces:
  ```ts
  export type TableAction =
    | { op: "insertRow"; at: number } | { op: "deleteRow"; i: number } | { op: "moveRow"; from: number; to: number }
    | { op: "insertColumn"; at: number } | { op: "deleteColumn"; col: number } | { op: "moveColumn"; from: number; to: number }
    | { op: "setAlign"; col: number; align: Align } | { op: "sort"; col: number; dir: "asc" | "desc" };
  /** row: 0 = 머리. 머리 행이면 넣기(아래)만, 옮기기·지우기 없음. 첫/끝 행이면 위로/아래로 옮기기 없음 */
  export function rowMenu(m: TableModel, row: number): { key: string; action: TableAction }[];
  /** 열이 하나면 지우기 없음, 첫/끝 열이면 왼쪽/오른쪽 옮기기 없음 */
  export function colMenu(m: TableModel, col: number): { key: string; action: TableAction }[];
  export function applyAction(m: TableModel, a: TableAction): ChangeSpec[];
  ```

- [ ] **Step 1: 실패하는 시험** — 머리 행 메뉴 키가 `["table.rowBelow"]` 뿐, 본문 첫 행에 `table.rowUp` 없음, 1열 표의 열 메뉴에 `table.colDelete` 없음, 첫 열에 `table.colMoveLeft` 없음, 정렬 4개·sort 2개 포함. `applyAction` 이 Task 5 함수와 같은 결과.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 화면** — 행 왼쪽·열 위 손잡이(마우스 올리면 보임, `(pointer: coarse)` 에서는 칸 편집 중인 행·열에 늘 보임). 누르면 `Menu`(항목 글 `t(key)`, 지우기는 `danger`), 고르면 `applyAction` 을 본문 트랜잭션 하나로. 끌기: 포인터 이벤트(`setPointerCapture`), 놓을 자리 선, 놓으면 `moveRow`/`moveColumn`, `Esc` 취소. 머리 행 손잡이는 끌 수 없다. 읽기 전용이면 손잡이 없음.
- [ ] **Step 6: `pnpm test && pnpm typecheck`**, 루트 `pnpm exec oxfmt` 와 `pnpm lint`(있으면).
- [ ] **Step 7: 커밋** — `feat(web): 표 편집기에 행·열 메뉴·정렬·sort·끌어 옮기기를 더한다`

### Task 10: 문서와 전체 확인

**Files:**
- Modify: `docs/manual/en/how-to/edit-notes.md`(원본), `docs/manual/ko/how-to/edit-notes.md` — 「Live Preview」 절의 「코드 블록과 표는 원문으로 보입니다」 를 고치고, 「표 편집」 절(칸 고치기·고치는 칸은 원문·키 표·행/열 메뉴·끌어 옮기기·정렬·sort 는 파일 순서를 바꾼다·원문으로 편집·고치지 않는 칸에는 찾기 강조가 없다)을 더한다. 첫 줄 `<!-- source: … @ v… -->` 표시는 ko 쪽 관례를 따른다.
- Modify: `docs/manual/{en,ko}/reference.md` — 단축키 표에 표 편집기 키를 넣을 자리가 있으면.
- Modify: `docs/ops/ux.md` — 새 절(요청·정한 것·확인한 것), 「2차 남은 것·알려진 한계」 의 「Live Preview는 표·목록 글머리·HTML은 원문 그대로다」 줄 고침.
- Modify: `CHANGELOG.md` — `[Unreleased]` 의 `### Added`/`### Changed`.

- [ ] **Step 1: 문서를 쓴다** — 쓰기 전에 `docs/guideline/public-docs/03-i18n.md`·`04-style.md` 를 읽는다.
- [ ] **Step 2: 루트 검증** — `pnpm test`(실행 개수 확인 — 앞선 기준 963건보다 늘어야 한다), `pnpm typecheck`, `pnpm build`, oxfmt·oxlint.
- [ ] **Step 3: 브라우저 확인** — 시험 서버(임시 `KEYRING_DATA`, 다른 포트, `docs/guides/development.md`)를 neo 로(AGENTS.md 「BrowserOS neo」). 설계 「시험과 확인」 의 목록을 하나씩: 8가지 그리기와 원문 전환, 표에서 한글 입력(조합 중 `Tab`·`Enter`·클릭), 칸 안 `[[` 자동완성, 실행 취소 순서(본문 → 칸 → 행 작업), 같은 문서를 두 칸에 열고 한쪽 표 고치기, 찾기로 표 안 글 찾기, 끌어 옮기기(마우스·390px 터치 에뮬레이션), 읽기 전용 노트, 어두운 테마, 코드 블록 언어별 색(편집·미리보기, 밝은·어두운), 수백 칸 표(예: 50×10)의 타이핑. 본 것과 못 본 것을 `ux.md` 의 「확인한 것」 에 적는다.
- [ ] **Step 4: 띄운 서버·탭을 끈다.**
- [ ] **Step 5: 커밋** — `문서: Live Preview 요소 그리기와 표 편집기`
