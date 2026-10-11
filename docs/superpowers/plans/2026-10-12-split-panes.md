# 화면 분할(두 칸 편집) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹 화면의 가운데를 편집 가능한 두 칸으로 나누고, 칸마다 탭을 두되 같은 문서는 원본 하나를 공유한다.

**Architecture:** `Workspace.tsx` 의 문서 하나짜리 상태(`doc`·`saveState`·`conflict`·`tabCache`)를 **경로 → 문서 항목** 저장소(`openDocs.ts`)로, 탭 배열(`keyring:tabs`)을 **칸 배치**(`panes.ts`, `keyring:panes`)로 바꾼다. 둘 다 순수 함수로 두고 vitest 로 검증한다. 화면은 문서 머리·배너·에디터·미리보기를 `DocPane` 컴포넌트로 뽑아 칸마다 하나씩 그린다. 같은 문서가 두 칸에 있으면 CodeMirror `ChangeSet` 을 다른 뷰에 전달한다.

**Tech Stack:** React 19, CodeMirror 6(`@codemirror/state` `ChangeSet`·`Annotation`·`Transaction.addToHistory`), vitest(web 패키지, node 환경), 기존 `useStored`/`readStored`.

**Spec:** `docs/superpowers/specs/2026-10-12-split-panes-design.md`

## Global Constraints

- 화면 글은 `packages/core/src/messages/{en,ko}.json` 에 넣는다(키 정렬, 들여쓰기 1칸). 영어가 기준이다.
- 패키지 매니저는 `pnpm`. 다 했다고 하기 전에 루트에서 `pnpm test`·`pnpm typecheck`·`pnpm build`, 포맷·린트는 `pnpm exec oxfmt`·`pnpm exec oxlint`(훅이 돌린다).
- 칸 하나의 최소 폭 **280px**, 가운데 폭이 **560px** 미만이면 분할 불가. 좁은 화면 판정은 지금 `narrow()`(`max-width: 800px`)를 그대로 쓴다.
- 분할 비율은 이 기기 설정(`keyring:prefs`)이고 **따라가는 설정(`SYNCED_KEYS`)에 넣지 않는다.**
- 저장 키는 새로 `keyring:panes`. 옛 `keyring:tabs` 는 처음 읽을 때 옮기고 지운다.
- 한 칸일 때 화면·동작은 지금과 같아야 한다.
- 위아래 분할·세 칸 이상·좁은 화면 분할은 하지 않는다.
- 새 CSS 클래스는 `split-` 접두어를 쓴다. `.panes`·`.pane` 은 이미 **한 문서 안의 편집·미리보기 나란히**에 쓰고 있어 겹치면 안 된다.
- 다른 파일을 가리킬 때 줄번호를 쓰지 않는다(함수·변수 이름으로 가리킨다).

## Review Focus

- 활성 탭을 다른 문서로 **바꿔치기**해서 저장 안 한 문서가 모든 칸에서 사라졌을 때 — 초안은 저장소에 남고 자동 저장이 계속 돌아야 한다(Task 2 `dropDoc` 규칙, Task 4 자동 저장 효과).
- 같은 문서를 두 칸에 열고 한쪽이 **과거 판 보기** 중일 때 다른 쪽에서 치면 — 자동 저장이 그 문서를 건너뛰어야 하고, 과거 판을 닫으면 다시 저장돼야 한다(Task 4).
- 두 뷰의 내용 길이가 어긋난 상태에서 ChangeSet 이 오면 — 예외 없이 문자열 diff 로 맞춘다(Task 3 `canMirror`).
- 가운데 폭이 560px 미만이거나 좁은 화면에서 `Mod+클릭` — 둘째 칸을 만들지 않고 같은 칸의 새 탭으로 연다(Task 1 `canSplit`, Task 6).
- 옛 `keyring:tabs` 에 탭은 있는데 `keyring:last-doc` 이 없거나 탭에 없는 문서를 가리킬 때 — 마지막 탭을 활성으로 연다(Task 1 `fromTabs`).

---

### Task 1: 칸 배치 순수 함수 `panes.ts`

**Files:**
- Create: `web/src/panes.ts`
- Test: `web/src/panes.test.ts`

**Interfaces:**
- Consumes: 없음(`ViewMode` 는 `Workspace.tsx` 의 `type ViewMode` 를 이 파일로 옮기고 `Workspace.tsx` 는 import 한다).
- Produces:
  ```ts
  export type ViewMode = "split" | "edit" | "preview";
  export interface Pane { tabs: string[]; active: string | null; mode: ViewMode }
  /** panes 는 0~2개, 왼쪽이 [0]. focused 는 panes 범위 안(비면 0) */
  export interface Layout { panes: Pane[]; focused: number }
  export const emptyLayout: () => Layout;
  export const isLayout: (v: unknown) => v is Layout;
  export function fromTabs(tabs: string[], last: string | null, mode: ViewMode): Layout;
  /** 옛 keyring:tabs / keyring:last-doc 원문 → 범위별 Layout. 둘 중 하나라도 모양이 틀리면 {} */
  export function migrateLayouts(tabsRaw: string | null, lastRaw: string | null, mode: ViewMode): Record<string, Layout>;
  export function openIn(l: Layout, pane: number, path: string, opts?: { newTab?: boolean; mode?: ViewMode }): Layout;
  export function closeIn(l: Layout, pane: number, path: string): Layout;
  export function moveTab(l: Layout, from: number, to: number, path: string): Layout;
  export function mergePanes(l: Layout): Layout;
  export function renamePath(l: Layout, from: string, to: string): Layout;
  export function removePaths(l: Layout, gone: (p: string) => boolean): Layout;
  export function setActive(l: Layout, pane: number, path: string): Layout;
  export function setMode(l: Layout, pane: number, mode: ViewMode): Layout;
  export function focusPane(l: Layout, pane: number): Layout;
  export function panesWith(l: Layout, path: string): number[];
  /** 둘째 칸을 열 수 있는가: 좁은 화면이 아니고 가운데 폭이 560 이상 */
  export function canSplit(centerWidth: number, narrow: boolean): boolean;
  ```
- 규칙(테스트가 고정한다):
  - `openIn`: `pane === l.panes.length && pane < 2` 면 칸을 새로 만든다(`mode` 는 `opts.mode ?? l.panes[0]?.mode ?? "edit"`). 그 칸에 이미 있는 경로면 활성만 바꾼다. `newTab` 이거나 활성 탭이 없으면 뒤에 붙이고, 아니면 활성 탭 자리를 바꿔친다(지금 `open` 의 `keep` 규칙). 결과의 `focused` 는 `pane`.
  - `closeIn`: 탭을 빼고, 닫은 것이 활성이면 `rest[min(i, rest.length-1)]` 을 활성으로(지금 `closeTab` 규칙). 칸이 비면 그 칸을 뺀다. 왼쪽이 빠지면 오른쪽이 `[0]` 이 된다. `focused` 는 범위 안으로 조인다.
  - `moveTab`: `from` 에서 `closeIn` 하고 `to` 에 `openIn(..., { newTab: true })`. `to` 가 `from` 이면 그대로. `from` 칸이 비어 사라지면 `to` 인덱스를 그만큼 당긴다.
  - `mergePanes`: 둘째 칸의 탭을 첫째 칸 뒤에 이어 붙인다(중복 제거). 활성은 `focused` 칸의 활성. 결과는 칸 하나, `focused: 0`.
  - `removePaths`: 모든 칸에서 `gone` 인 탭을 빼고 빈 칸을 없앤다(활성이 사라지면 `closeIn` 과 같은 이웃 규칙).
  - `fromTabs`: 빈 배열이면 `emptyLayout()`. `last` 가 탭에 있으면 그것, 아니면 마지막 탭이 활성.

- [ ] **Step 1: 실패하는 테스트 작성** — `web/src/panes.test.ts`. `describe("칸 배치")` 아래 최소 다음 `it`:
  ```ts
  it("fromTabs: 마지막 문서가 탭에 없으면 마지막 탭이 활성", () =>
    expect(fromTabs(["a.md", "b.md"], "z.md", "edit")).toEqual({ panes: [{ tabs: ["a.md", "b.md"], active: "b.md", mode: "edit" }], focused: 0 }));
  it("fromTabs: 빈 탭은 칸이 없다", () => expect(fromTabs([], null, "edit")).toEqual({ panes: [], focused: 0 }));
  it("migrateLayouts: 범위마다 옮기고, 모양이 틀리면 빈 객체", () => {
    expect(migrateLayouts('{"업무":["업무/a.md"]}', '{"업무":"업무/a.md"}', "edit")).toEqual({ 업무: { panes: [{ tabs: ["업무/a.md"], active: "업무/a.md", mode: "edit" }], focused: 0 } });
    expect(migrateLayouts('["a.md"]', null, "edit")).toEqual({});
  });
  const one = (tabs: string[], active: string, mode: ViewMode = "edit"): Layout => ({ panes: [{ tabs, active, mode }], focused: 0 });
  it("openIn: 활성 탭을 바꿔치고, newTab 이면 뒤에 붙인다", () => {
    expect(openIn(one(["a", "b"], "a"), 0, "c")).toEqual(one(["c", "b"], "c"));
    expect(openIn(one(["a", "b"], "a"), 0, "c", { newTab: true })).toEqual(one(["a", "b", "c"], "c"));
    expect(openIn(one(["a", "b"], "a"), 0, "b")).toEqual(one(["a", "b"], "b"));
  });
  it("openIn: 둘째 칸을 만들 수 있고 셋째는 못 만든다", () => {
    const l = openIn(one(["a"], "a"), 1, "b");
    expect(l).toEqual({ panes: [{ tabs: ["a"], active: "a", mode: "edit" }, { tabs: ["b"], active: "b", mode: "edit" }], focused: 1 });
    expect(openIn(l, 2, "c")).toBe(l);
  });
  it("closeIn: 이웃이 활성이 되고, 빈 칸은 사라지며 오른쪽이 왼쪽으로 온다", () => {
    expect(closeIn(one(["a", "b", "c"], "b"), 0, "b")).toEqual(one(["a", "c"], "c"));
    expect(closeIn(one(["a", "b", "c"], "c"), 0, "c")).toEqual(one(["a", "b"], "b"));
    const two = openIn(one(["a"], "a"), 1, "b");
    expect(closeIn(two, 0, "a")).toEqual(one(["b"], "b"));
    expect(closeIn(one(["a"], "a"), 0, "a")).toEqual(emptyLayout());
  });
  it("moveTab: 옮기면 원래 칸이 비어 사라져도 대상 인덱스가 맞다", () => {
    const two = openIn(one(["a"], "a"), 1, "b");                       // [a] | [b], focused 1
    expect(moveTab(two, 1, 0, "b")).toEqual(one(["a", "b"], "b"));     // 둘째가 비어 사라짐
    expect(moveTab(one(["a", "b"], "a"), 0, 1, "a")).toEqual({ panes: [{ tabs: ["b"], active: "b", mode: "edit" }, { tabs: ["a"], active: "a", mode: "edit" }], focused: 1 });
    expect(moveTab(two, 0, 0, "a")).toBe(two);
  });
  it("mergePanes: 중복 없이 이어 붙이고 focused 칸의 활성을 지킨다", () => {
    const l: Layout = { panes: [{ tabs: ["a", "b"], active: "a", mode: "edit" }, { tabs: ["b", "c"], active: "c", mode: "preview" }], focused: 1 };
    expect(mergePanes(l)).toEqual(one(["a", "b", "c"], "c"));
    expect(mergePanes(one(["a"], "a"))).toEqual(one(["a"], "a"));
  });
  it("removePaths: 사라진 문서를 모든 칸에서 빼고 빈 칸을 없앤다", () => {
    const l: Layout = { panes: [{ tabs: ["a", "x"], active: "x", mode: "edit" }, { tabs: ["x"], active: "x", mode: "edit" }], focused: 1 };
    expect(removePaths(l, (p) => p === "x")).toEqual(one(["a"], "a"));
  });
  it("isLayout: 모양이 틀리면 false", () => { expect(isLayout({ panes: [{ tabs: ["a"], active: "a", mode: "edit" }], focused: 0 })).toBe(true); expect(isLayout({ panes: "x" })).toBe(false); expect(isLayout({ panes: [{ tabs: ["a"], active: "a", mode: "edit" }], focused: 3 })).toBe(false); });
  it("canSplit: 560 미만이거나 좁은 화면이면 false", () => { expect(canSplit(560, false)).toBe(true); expect(canSplit(559, false)).toBe(false); expect(canSplit(1200, true)).toBe(false); });
  ```
- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/web exec vitest run src/panes.test.ts`. 기대: `Cannot find module './panes'` 로 FAIL.
- [ ] **Step 3: `web/src/panes.ts` 구현** — 위 시그니처대로. 모두 입력을 바꾸지 않는 순수 함수. `isLayout` 은 `readStored` 의 `valid` 로 쓰이므로 `focused` 가 `panes` 범위 안인지까지 본다(빈 배치는 `focused: 0`).
- [ ] **Step 4: 통과 확인** — 같은 명령. 기대: 모든 `it` PASS, 실행 개수를 보고에 적는다.
- [ ] **Step 5: Commit** — `git add web/src/panes.ts web/src/panes.test.ts && git commit -m "웹: 칸 배치 순수 함수(panes.ts)"`

### Task 2: 열린 문서 저장소 `openDocs.ts`

**Files:**
- Create: `web/src/openDocs.ts`
- Test: `web/src/openDocs.test.ts`
- Modify: `web/src/Workspace.tsx` — `interface OpenDoc`·`interface Conflict`·`type SaveState` 정의를 지우고 import.

**Interfaces:**
- Produces:
  ```ts
  export interface OpenDoc { /* Workspace.tsx 의 것을 그대로 옮긴다 */ }
  export interface Conflict { /* 그대로 */ }
  export type SaveState = /* 그대로 */;
  export interface DocEntry { doc: OpenDoc; save: SaveState; conflict: Conflict | null }
  export type DocStore = Record<string, DocEntry>;
  /** 새로 읽은 문서: save idle, conflict null, seq 는 있던 것 + 1 */
  export function upsertDoc(s: DocStore, doc: Omit<OpenDoc, "seq">): DocStore;
  export function patchDoc(s: DocStore, path: string, patch: (d: OpenDoc) => OpenDoc): DocStore; // 없으면 s 그대로
  export function setSave(s: DocStore, path: string, save: SaveState): DocStore;
  export function setConflict(s: DocStore, path: string, conflict: Conflict | null): DocStore;
  export function renameDoc(s: DocStore, from: string, to: string, patch?: (d: OpenDoc) => OpenDoc): DocStore;
  /** 어느 칸에도 없는 문서를 치운다. 단 초안이 다른(저장 안 한) 문서는 남긴다 */
  export function dropUnused(s: DocStore, inUse: (path: string) => boolean): DocStore;
  export const isDirty: (e: DocEntry) => boolean; // draft !== saved && !generated
  export function dirtyPaths(s: DocStore): string[];
  ```

- [ ] **Step 1: 실패하는 테스트** — `openDocs.test.ts`:
  ```ts
  it("upsertDoc: 같은 경로를 다시 넣으면 seq 가 오르고 상태가 초기화된다", ...); // seq 1 → 2, save idle, conflict null
  it("patchDoc: 없는 경로는 같은 객체를 돌려준다", () => { const s = {}; expect(patchDoc(s, "x.md", (d) => d)).toBe(s); });
  it("dropUnused: 안 쓰는 문서는 치우되 저장 안 한 것은 남긴다", ...); // a 깨끗·b 초안 다름, inUse 모두 false → b 만 남음
  it("renameDoc: 키와 path 를 함께 바꾼다", ...);
  it("dirtyPaths: generated 는 초안이 달라도 빼고, 경로 순서로 준다", ...);
  ```
- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/web exec vitest run src/openDocs.test.ts`. 기대: 모듈 없음으로 FAIL.
- [ ] **Step 3: 구현** — `openDocs.ts` 작성, `Workspace.tsx` 의 세 타입 정의를 지우고 import 로 바꾼다. 동작 변경 없음.
- [ ] **Step 4: 통과 확인** — 테스트 PASS + `pnpm --filter @keyring-notes/web typecheck` 통과.
- [ ] **Step 5: Commit** — `웹: 열린 문서 저장소 순수 함수(openDocs.ts)`

### Task 3: 에디터 사이 ChangeSet 전달

**Files:**
- Modify: `web/src/Editor.tsx` — `interface Props`, `interface EditorHandle`, `EditorView.updateListener` 안, `handle.current = {...}` 안.
- Test: `web/src/Editor.mirror.test.ts`(node 환경, `@codemirror/state` 만 쓴다)

**Interfaces:**
- Produces:
  ```ts
  // Editor.tsx
  export const mirrored: Annotation<boolean>;          // 다른 칸에서 온 트랜잭션 표식
  export function canMirror(docLength: number, changes: ChangeSet): boolean; // changes.length === docLength
  interface Props { /* 추가 */ onChanges?: (changes: ChangeSet) => void }  // 내용이 바뀐 트랜잭션마다, mirrored 가 아닌 것만
  interface EditorHandle { /* 추가 */ applyChanges(changes: ChangeSet, fallback: string): void }
  ```
- `applyChanges`: `canMirror` 면 `view.dispatch({ changes, annotations: [mirrored.of(true), Transaction.addToHistory.of(false)] })`, 아니면 기존 `setContent(fallback)`.
- `onChanges` 호출 지점: `updateListener` 에서 `u.docChanged` 인 트랜잭션 중 `tr.annotation(mirrored) !== true` 인 것만 `tr.changes` 를 넘긴다(트랜잭션이 여럿이면 각각).
- **`onChange`(문자열) 호출은 그대로 둔다** — 저장소의 `draft` 는 이 값으로 바뀐다. `applyChanges` 로 받은 변경도 `onChange` 를 부르지만, 받은 쪽의 `draft` 는 이미 같은 값이라 저장소에 변화가 없다.

- [ ] **Step 1: 실패하는 테스트** — `Editor.mirror.test.ts`:
  ```ts
  import { ChangeSet } from "@codemirror/state";
  it("canMirror: 문서 길이가 같을 때만 true", () => {
    const c = ChangeSet.of({ from: 0, insert: "x" }, 5);
    expect(canMirror(5, c)).toBe(true);
    expect(canMirror(6, c)).toBe(false);
  });
  ```
  `Editor.tsx` 가 DOM 을 import 시점에 건드리지 않는지 확인한다. 건드리면 `canMirror` 와 `mirrored` 를 `web/src/mirror.ts` 로 빼고 `Editor.tsx` 가 import 한다.
- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/web exec vitest run src/Editor.mirror.test.ts`. 기대: export 없음으로 FAIL.
- [ ] **Step 3: 구현** — 위 인터페이스. 기존 `setContent` 는 그대로 둔다.
- [ ] **Step 4: 통과 확인** — 테스트 PASS, `typecheck` 통과.
- [ ] **Step 5: Commit** — `웹: 에디터 ChangeSet 전달(applyChanges·onChanges)`

### Task 4: Workspace 를 저장소·칸 배치 위에 올린다(한 칸, 동작 동일)

**Files:**
- Modify: `web/src/Workspace.tsx` — 상태 선언부(`useState<OpenDoc | null>`·`saveState`·`conflict`·`tabCache`·`tabsByScope`), `patchDoc`, `save`, `flush`, 자동 저장 `useEffect` 둘, `showDoc`, `load`, `open`, `closeTab`, `switchScope`, 처음 열기 `useEffect`, 트리 갱신 때 탭 정리(`alive`/`keep`), 이름 바꾸기 핸들러(`if (aside === from)` 가 있는 함수), `tabBar`·`center` 의 `doc`/`tabCache` 참조.

**Interfaces:**
- Consumes: Task 1 `Layout`·`openIn`·`closeIn`·`removePaths`·`renamePath`·`setActive`·`focusPane`·`migrateLayouts`·`isLayout`·`emptyLayout`; Task 2 전부.
- Produces(이 파일 안에서 뒤 Task 가 쓰는 이름):
  ```ts
  const [docs, setDocs] = useState<DocStore>({}); const docsRef = useRef(docs);
  const [layoutByScope, setLayoutByScope] = useStored<Record<string, Layout>>("keyring:panes", initialLayouts, isRecordOf(isLayout));
  const layout: Layout;                       // = layoutByScope[scopeKey] ?? emptyLayout()
  const setLayout: (fn: (l: Layout) => Layout) => void;   // 지금 범위
  const focusedPane: Pane | undefined;        // layout.panes[layout.focused]
  const doc: OpenDoc | null;                  // 활성 칸의 활성 문서(오른쪽 패널·상태 표시줄·명령이 쓰던 이름 유지)
  const [revisions, setRevisions] = useState<(RevisionView | null)[]>([null, null]); // 칸마다
  const save: (path?: string, opts?: { auto?: boolean }) => Promise<boolean>;  // path 기본은 활성 문서
  const flush: (paths?: string[]) => Promise<boolean>;      // 기본은 dirtyPaths 전부
  const open: (path: string, opts?: { newTab?: boolean; noHistory?: boolean; pane?: number }) => Promise<void>;
  const closeTab: (pane: number, path: string) => Promise<void>;
  ```
- 규칙:
  - `initialLayouts` 는 `useStored` 의 `initial` 로 `migrateLayouts(localStorage.getItem("keyring:tabs"), localStorage.getItem("keyring:last-doc"), narrow() ? "preview" : "edit")` 를 넘기고(실패하면 `{}`), 마운트 뒤 `useEffect` 한 번으로 `localStorage.removeItem("keyring:tabs")`. `mode` 상태(`useState<ViewMode>`)는 없애고 `focusedPane.mode` 를 쓴다(`setMode` 는 `setLayout(l => setMode(l, l.focused, m))`).
  - 이름 겹침: `openDocs.ts` 의 `patchDoc`·`setConflict` 는 Workspace 안의 같은 이름과 겹치므로 `import { patchDoc as patchStoreDoc, setConflict as setStoreConflict, setSave as setStoreSave } from "./openDocs"` 로 들인다. Workspace 의 `patchDoc(path, patch)` 콜백은 이름을 유지하고 몸은 `setDocs(s => patchStoreDoc(s, path, patch))` 로 바꾼다. `tabCache` 는 지운다.
  - `save(path)`: `docsRef.current[path]` 를 읽는다. 진행 중 표시는 `savingRef: Set<string>`·`againRef: Set<string>`. 그 문서가 `conflict` 거나 **어느 칸이든 그 경로를 과거 판으로 보는 중**(`revisions[i] && layout.panes[i].active === path`)이면 `false`. 성공·실패 처리는 지금 그대로, 단 `setSaveState(x)` → `setDocs(s => setStoreSave(s, path, x))`, `setConflict(x)` → `setDocs(s => setStoreConflict(s, path, x))`, `setDoc(...)` → `patchDoc(path, ...)`.
  - 삭제(노드·문서 삭제 핸들러와 되돌리기): `setLayout(l => removePaths(l, p => gone(p)))` + `setDocs(s => dropUnused(s, inUse))`. 되돌리기로 돌아오면 다시 `open`.
  - 자동 저장 효과: `docs` 가 바뀔 때마다 `dirtyPaths` 중 `conflict` 없는 경로마다 타이머(`Map<string, ReturnType<typeof setTimeout>>`)를 다시 건다. 더 이상 dirty 가 아닌 경로의 타이머는 지운다. 포커스 이탈·숨김에서는 `flush()`.
  - `open(path, opts)`: `pane = opts.pane ?? layout.focused` (`pane === layout.panes.length` 면 새 칸). 저장소에 없으면 `load(path)` 가 `upsertDoc`. 배치는 `openIn`. 다른 워크스페이스로 바꾸는 분기(`switching`)는 그 범위의 배치에 `openIn(..., 0, path, { newTab: true })`. 지금 "탭이 아닌 문서를 바꿔치기할 때 묻기"(`doc.discardAndOpen`)는 **없앤다** — 초안은 저장소에 남는다.
  - `closeTab(pane, path)`: 닫는 문서가 dirty 면 지금처럼 `flush([path])` 뒤 남은 초안이 있으면 `tab.discardClose` 로 묻는다. 그 뒤 `setLayout(l => closeIn(l, pane, path))`, 저장소는 `dropUnused(s, p => 모든 칸의 tabs 에 p 가 있는가)`.
  - 주소(`history.replaceState`)는 **활성 칸의 활성 문서**를 따른다 — `showDoc`·`load`·`focusPane` 뒤.
  - 이름 바꾸기·이동: `setLayout(l => renamePath(l, from, to))` + `setDocs(s => renameDoc(s, from, to, patch))`. `aside` 관련 줄은 Task 6 까지 그대로 둔다.
  - 트리 갱신 때 탭 정리: `setLayout(l => removePaths(l, p => !alive(p)))`, `alive` 의 `keep` 은 `isDirty(docsRef.current[p])`.
  - `tabBar` 는 `focusedPane?.tabs ?? []` 와 `docs[tp]` 로 dirty 표시. 아직 한 칸만 그린다.

- [ ] **Step 1: 테스트** — 이 Task 는 순수 함수가 없어 새 단위 테스트 대신 **기존 전부**를 통과시킨다. 시작 전 `pnpm --filter @keyring-notes/web test` 로 지금 개수를 적어 둔다.
- [ ] **Step 2: 구현** — 위 규칙대로 바꾼다. `tabCache`·`saveState`·`conflict`·`mode`·`setDoc` 참조가 하나도 남지 않을 때까지(`grep -nE 'tabCache|setSaveState|setConflict\(|setDoc\(|setMode\(' web/src/Workspace.tsx` 가 0줄).
- [ ] **Step 3: 확인** — `pnpm typecheck` · `pnpm test`(개수 변화 없음) · `pnpm build`. 시험 서버(임시 `KEYRING_DATA`, 워크트리 전용 포트) 또는 `?local` 에서: 탭 열기·바꾸기·닫기·되돌리기(최근 닫은 탭), 자동 저장(상태 표시줄), 이름 바꾸기 뒤 탭 이름, 워크스페이스 바꾸기 뒤 탭 복원, 새로고침 뒤 옛 `keyring:tabs` 가 `keyring:panes` 로 옮겨지고 지워짐(개발자 도구 Application 탭).
- [ ] **Step 4: Commit** — `웹: 문서 저장소·칸 배치로 상태 정리(한 칸, 동작 동일)`

### Task 5: `DocPane` 컴포넌트로 뽑기(한 칸, 동작 동일)

**Files:**
- Create: `web/src/DocPane.tsx`
- Modify: `web/src/Workspace.tsx` — `center` JSX(`<header className="doc-head">` 부터 `.doc-area` 끝까지), 그 JSX 만 쓰는 파생값·훅.

**Interfaces:**
- Produces:
  ```tsx
  export interface DocPaneProps {
    pane: number;
    entry: DocEntry;                 // docs[layout.panes[pane].active]
    mode: ViewMode;
    focused: boolean;
    revision: RevisionView | null;
    handle: MutableRefObject<EditorHandle | null>;
    titleFocus: number;              // focused 칸이고 path 가 맞을 때만 신호, 아니면 0
    pendingAnchor: ... | null;       // focused 칸에만 넘긴다
    ctx: PaneContext;                // Workspace 가 가진 공통 값·콜백 묶음(아래)
  }
  export interface PaneContext {
    prefs: Prefs; lang: string; local: boolean; isNarrow: boolean;
    resolver: LinkResolver; daily: DailyLookup; shared: VaultSettings; linkCandidates: LinkCandidate[];
    vaultVersion: number; iconOf: (p: string) => string | null; docLabel: ...; keyOf: (id: string) => string | undefined;
    open: typeof open; openNode; save: (path: string) => Promise<boolean>; load; onDraft: (path: string, draft: string) => void;
    onChanges: (pane: number, path: string, changes: ChangeSet) => void;  // Task 6 에서 다른 칸에 전달
    uploadFiles; renameNode; setIconPick; followLinkEl; onWidgetChanged; showRight; toggleRight; setRevision: (pane: number, r: RevisionView | null) => void;
    saveConflictCopy: (path: string) => Promise<void>; rollback: (pane: number) => Promise<void>; setMode: (pane: number, m: ViewMode) => void;
    setCursor: (pane: number, c: { line: number; col: number }) => void; onFocus: (pane: number) => void; setDocMenu; dailyStep; openDaily;
  }
  ```
- `DocPane` 안으로 **들어가는 것**(문서마다 다른 파생값·훅): `rendered`(`renderMarkdown` useMemo), `widgetSlots` 상태와 포털, `previewRef`, `onPreviewClick`, `crumbs`, `docDaily`, `docFm`/`propCount`/`docIcon`, `docNode`/`isWsDoc`, `refs` 중 **문서 끝 백링크**(`prefs.backlinksInDoc` 일 때 자기 문서 것을 `api` 로 받는다), `foldVersion`.
- `Workspace` 에 **남는 것**: 오른쪽 패널(활성 문서의 `refs`·`commits`·속성), 상태 표시줄(활성 칸의 `cursor`·save 상태), 명령 목록, 트리, 팔레트, 모달.
- `editorHandle` → `paneHandles = [useRef<EditorHandle|null>(null), useRef<EditorHandle|null>(null)]`, 명령은 `paneHandles[layout.focused].current`.
- `cursor` → `cursors: {line,col}[]`(칸마다), 상태 표시줄은 `cursors[layout.focused]`.

- [ ] **Step 1: 구현** — JSX 와 위 목록의 파생값을 `DocPane.tsx` 로 옮긴다. 아직 한 칸만 그린다: `<DocPane pane={0} .../>`.
- [ ] **Step 2: 확인** — `pnpm typecheck`·`pnpm test`·`pnpm build`. 브라우저: 제목 인라인 수정, 보기 모드 전환, Live Preview, 미리보기 링크 클릭, 위젯, 문서 끝 백링크(설정 켬), 충돌 배너(둘째 브라우저로 같은 문서 고치기), 과거 판 보기·되돌리기, 390px 폭.
- [ ] **Step 3: Commit** — `웹: 문서 칸을 DocPane 컴포넌트로`

### Task 6: 두 칸 그리기·경계·포커스·다른 칸에서 열기·옆 칸 제거

**Files:**
- Modify: `web/src/Workspace.tsx` — `<main className="center">` 안, `followLink`, `commands`(`id: "aside"`), `docMenuItems`, 이름 바꾸기의 `aside` 줄, `AsidePreview` import.
- Modify: `web/src/Aside.tsx` — `AsidePreview` 삭제(`FileViewer` 는 남긴다).
- Modify: `web/src/prefs.ts` — `Prefs` 에 `splitRatio: number`(기본 `0.5`), `DEFAULT_PREFS`, **`SYNCED_KEYS` 에는 넣지 않는다.**
- Modify: `web/src/styles.css`(`.aside-pane` 규칙이 있는 파일) — `.aside-pane` 두 규칙 삭제, `.split-root`·`.split-pane`·`.split-divider` 추가.
- Modify: `packages/core/src/messages/en.json`·`ko.json`.

**Interfaces:**
- Consumes: Task 1 `openIn`·`mergePanes`·`focusPane`·`panesWith`·`canSplit`; Task 3 `applyChanges`·`onChanges`; Task 5 `DocPane`·`PaneContext.onChanges`.
- 규칙:
  - 렌더: `layout.panes.map((p, i) => <DocPane key={i} pane={i} .../>)`. 칸이 둘이면 사이에 `Resizer`(`ui.tsx`) — 폭은 `prefs.splitRatio * centerWidth` 로 환산하고 `min 280`, `max centerWidth - 280`, 두 번 누르면 `0.5`. `centerWidth` 는 `main.center` 의 `ResizeObserver`.
  - 활성 칸: `DocPane` 루트의 `onFocusCapture`·`onMouseDownCapture` → `ctx.onFocus(pane)` → `setLayout(l => focusPane(l, pane))`. 활성 칸에 `split-pane focused` 클래스.
  - 같은 문서 두 칸: `ctx.onChanges(pane, path, changes)` → `panesWith(layout, path)` 중 `pane` 이 아닌 칸의 `paneHandles[j].current?.applyChanges(changes, docsRef.current[path].doc.draft)`.
  - `followLink(..., aside=true)`(`Mod+클릭`): `const other = layout.panes.length === 2 ? 1 - layout.focused : 1;` `canSplit(centerWidth, isNarrow)` 면 `open(target, { pane: other, newTab: true })`, 아니면 `open(target, { newTab: true })`.
  - 명령: `id: "aside"` → `id: "split"`, 라벨은 칸이 둘이면 `cmd.splitClose` 아니면 `cmd.splitOpen`, 키 `Mod+\` 유지. 실행: 둘이면 `setLayout(mergePanes)`; 하나면 `doc && open(doc.path, { pane: 1, newTab: true })`(둘째 칸의 `mode` 는 첫째와 같음). 새 명령 `move-tab-other`(`cmd.moveTabOther`: 활성 탭을 다른 칸으로, 없으면 만든다 — `moveTab(l, focused, other, active)`), `focus-other-pane`(`cmd.focusOtherPane`). 두 명령의 기본 키는 `commands` 배열의 기존 `keys`·`webKeys`·`macKeys` 와 겹치지 않는 것을 고르고 보고에 적는다.
  - 문서 메뉴(`docMenuItems`)에 「다른 칸에서 열기」(`doc.openOther` → `open(doc.path, { pane: other, newTab: true })`) 추가. 옆 칸 항목 삭제.
  - `aside` 상태·`AsidePreview`·`.aside-pane` CSS·`aside.*`/`cmd.aside*` 메시지 삭제. 새 키: `cmd.splitOpen`("Open in a second pane"), `cmd.splitClose`("Close the second pane"), `cmd.moveTabOther`("Move tab to the other pane"), `cmd.focusOtherPane`("Focus the other pane"), `doc.openOther`("Open in the other pane"), `pane.label`("Pane {n}"), `pane.width`("Pane width"). 한국어는 `ko.json` 에 같은 키.
  - 좁은 화면(`isNarrow`)이면 칸이 둘이어도 **첫째 칸만 그리지 않고** Task 8 의 합치기가 먼저 돈다. 이 Task 에서는 `isNarrow` 일 때 `Resizer` 를 숨기는 것까지만.

- [ ] **Step 1: 구현** — 위 규칙대로. `grep -rn 'aside' web/src packages/core/src/messages` 에 `aside-pane`·`AsidePreview`·`cmd.aside` 가 남지 않아야 한다(`<aside>` 태그·`left-panel`/`right-panel` 의 `aside` 요소는 남는다).
- [ ] **Step 2: 확인** — `pnpm typecheck`·`pnpm test`·`pnpm build`. 브라우저(스펙 「검증」):
  - `Mod+클릭` → 오른쪽 칸 새 탭. 양쪽에서 각각 고치면 각각 저장(네트워크 탭에서 `write` 요청 2건, 상태 표시줄은 활성 칸).
  - 같은 문서 두 칸: 한쪽 입력이 다른 쪽에 즉시 보임, 저장 요청 1건, `Mod+Z` 는 그 칸의 입력만 되돌림.
  - 둘째 브라우저로 충돌 → 두 칸 모두 배너, 한쪽에서 다시 읽기 → 둘 다 사라짐.
  - 같은 문서를 두 칸에 열고 한쪽이 과거 판 보기 중일 때 다른 쪽에서 치면 저장 요청이 없고(상태 표시줄 "편집 중"), 과거 판을 닫으면 자동 저장 간격 뒤 저장된다.
  - `Mod+\` 토글, 경계 끌기·두 번 누르기·`←`·`→`, 새로고침 뒤 칸·탭·비율 복원.
  - 한 칸일 때 화면이 Task 5 와 같다. 어두운 테마.
- [ ] **Step 3: Commit** — `웹: 두 칸 편집 분할(경계·포커스·다른 칸에서 열기), 옆 칸 제거`

### Task 7: 탭 옮기기 — 끌기·탭 메뉴

**Files:**
- Modify: `web/src/Workspace.tsx` — `tabBar`(칸마다 하나가 되어 있다: `renderTabBar(pane)`), `Menu` 사용.
- Modify: `packages/core/src/messages/en.json`·`ko.json` — `tab.moveOther`("Move to the other pane"), `tab.menu`("Tab menu").

**Interfaces:**
- Consumes: Task 1 `moveTab`.
- 규칙:
  - 탭 `<span className="tab">` 에 `draggable`, `onDragStart` 로 `dataTransfer.setData("application/x-keyring-tab", JSON.stringify({ pane, path }))`. 각 칸의 `.tab-list` 에 `onDragOver`(그 타입이면 `preventDefault`, `drop-target` 클래스)·`onDrop` → `setLayout(l => moveTab(l, from, pane, path))`. **끌기로는 칸을 새로 만들지 않는다**(칸이 둘일 때만 동작) — 둘째 칸은 메뉴·명령·`Mod+클릭`으로 만든다.
  - 탭 `onContextMenu` → `Menu`(`ui.tsx`) 항목: `cmd.closeTab`, `tab.moveOther`(칸이 하나면 둘째 칸을 만들며 옮긴다: `moveTab(l, pane, 1, path)`), 칸이 둘이고 `canSplit` 이 아니면 옮기기 항목을 숨긴다.
  - 시각 피드백은 트리의 끌어 옮기기(`Tree.tsx` 의 `drop-target` 류 클래스)와 같은 색·두께를 쓴다.

- [ ] **Step 1: 테스트** — Task 1 의 `panes.test.ts` 에 `moveTab` 경계 케이스를 보탠다: 같은 칸으로 옮기면 그대로(`toBe(l)`), 마지막 탭을 옮겨 칸이 사라질 때 `focused` 가 0.
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `vitest run src/panes.test.ts`.
- [ ] **Step 3: 확인** — 브라우저: 끌어서 옮기기(마지막 탭이면 빈 칸이 사라짐), 메뉴로 옮기기(한 칸에서 둘째 칸 생성), 390px 에서 메뉴가 화면 안에 뜬다.
- [ ] **Step 4: Commit** — `웹: 탭을 다른 칸으로(끌기·탭 메뉴)`

### Task 8: 좁은 화면·최소 폭에서 합치기

**Files:**
- Modify: `web/src/Workspace.tsx` — `isNarrow` 효과 근처, `centerWidth` 관찰.

**Interfaces:**
- Consumes: Task 1 `mergePanes`·`canSplit`.
- 규칙: `useEffect([isNarrow, centerWidth, layout.panes.length])` — 칸이 둘이고 `!canSplit(centerWidth, isNarrow)` 면 `setLayout(mergePanes)`. 좁은 화면에서는 `Mod+클릭`·`split`·`move-tab-other` 가 새 탭/무동작으로 떨어지는 것은 Task 6·7 의 `canSplit` 분기로 이미 된다. `revisions`·`cursors` 는 합칠 때 `[focused 것, null]` 로 맞춘다.

- [ ] **Step 1: 구현**
- [ ] **Step 2: 확인** — 브라우저: 두 칸에 각각 저장 안 한 초안을 두고 창을 800px 이하로 → 한 칸, 두 탭 모두 있고 각각 초안 유지(탭의 dirty 점). 다시 넓혀도 한 칸 그대로. 가운데 폭 560px 미만(왼·오른 패널을 넓혀서)에서도 합쳐진다.
- [ ] **Step 3: Commit** — `웹: 좁은 화면·최소 폭에서 칸 합치기`

### Task 9: 문서·마무리 검증

**Files:**
- Modify: `docs/ops/ux.md` — 「구현 현황」 표의 "8. 화면 분할" 행(1차 표)과 「8. 화면 분할」 절, 「2차 남은 것·알려진 한계」 등에서 "옆 칸" 을 말하는 줄.
- Modify: `README.md`·`README.ko.md` — 기능 목록에 옆 칸·미리보기 설명이 있으면 두 칸 편집으로 고친다(둘을 함께).

- [ ] **Step 1: 문서** — `ux.md` 8번 행을 "됨"으로, 메모에 「좌우 두 칸, 칸별 탭, 같은 문서는 원본 하나, 탭 끌어 옮기기, 좁은 화면은 합침」. "옆 칸" 서술은 지운다(`grep -n '옆 칸' docs/ops/ux.md README.md README.ko.md` 로 센다). 1차 표의 낡은 행 둘(「10. 문서 아이콘」·「남은 것」의 웹훅 묶기)도 2차 표와 맞춘다.
- [ ] **Step 2: 전체 검증** — 루트에서 `pnpm test`(core·server·web 세 묶음의 **실행 개수**를 적는다), `pnpm typecheck`, `pnpm build`, `pnpm exec oxfmt --check .`, `pnpm exec oxlint .`. 스펙 「검증」 목록을 시험 서버와 `?local` 양쪽에서 끝까지 돌리고 화면을 찍어 보고에 붙인다.
- [ ] **Step 3: Commit** — `사용성(8번): 화면 분할 구현 현황·문서 갱신`
