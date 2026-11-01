# 모바일(PWA) 다듬기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 터치 기기에서 트리 펴고 접기를 쉽게, 노트를 열 때 키보드를 올리지 않게, 좁은 화면에 상위 경로를 보이게, 뒤로가기가 위에 뜬 것을 하나씩 닫게 한다.

**Architecture:** 터치 판정을 한곳(`web/src/touch.ts`)에 두고 세 기능이 같이 쓴다. 판단은 DOM 없이 시험할 수 있는 순수 함수·모듈로 떼고(`treeTap.ts`, `backStack.ts`), 컴포넌트는 그것을 부르기만 한다. 뒤로가기는 「주소 기록에 표시 하나」(B 방식) — `backStack.ts` 가 위에 뜬 것의 목록과 표시 항목(`history.state.kOverlay`)을 관리하고, `Modal`·`Menu`·`dialog.ts`·서랍이 열 때 등록, 닫힐 때 해제한다.

**Tech Stack:** React 19 + TypeScript, Vite, vitest(node 환경 — jsdom 없음, `renderToStaticMarkup` 과 가짜 객체로 시험), CodeMirror 6, Lucide.

**Spec:** `docs/superpowers/specs/2026-11-02-mobile-pwa-polish-design.md`(실행자는 반드시 함께 읽는다)

## Global Constraints

- 2·3·5 는 **터치 환경(`(pointer: coarse)`)에만**. 마우스 환경은 창 폭과 상관없이 지금 그대로.
- 노트 사이 뒤로가기는 없다. 노트를 열 때의 주소 갱신은 계속 `replaceState`.
- 뒤로가기로 닫히는 것은 넷뿐: 확인 창(`dialog.ts`), `Menu`, `Modal` 스택 맨 위, 서랍(왼쪽·오른쪽). 설정 화면(`SettingsModal`)은 기존 해시 방식 그대로이고 표시 항목을 쓰지 않는다.
- 확인 창의 뒤로가기: confirm·choose = 취소, alert = 확인.
- 화면 글은 `packages/core/src/messages/{en,ko}.json`(영어 기준, 키는 알파벳 순서 자리에 손으로 넣는다).
- 같은 디렉터리에 대소문자만 다른 파일 이름을 두지 않는다.
- 포맷·린트는 도구로(`pnpm exec oxfmt`, `pnpm exec oxlint --fix`) — 손으로 맞추지 않는다.
- 끝나기 전에 루트에서 `pnpm test`, `pnpm typecheck`, `pnpm build`. 시험 개수가 0 이 아닌지 본다.

## Review Focus

1. **단추·배경·Esc 로 닫은 직후 다른 기록 조작이 오는 경우**(더 보기 → 설정 열기, 탭 시트에서 노트 고르기): 쌓아 둔 표시를 치우는 비동기 `history.back()` 이 그 뒤의 `pushState`/`replaceState` 를 되돌리면 설정이 바로 닫히거나 주소가 틀어진다 — 기대: 설정은 열린 채, 주소는 고른 노트. Task 4 시험 `settles before push`·`replaces marker when navigating from overlay`.
2. **닫기 확인(`CloseGuard`)이 거부한 뒤로가기**: 모달이 열린 채인데 표시가 없어 다음 뒤로가기에 앱이 꺼진다 — 기대: 표시가 다시 쌓인다. Task 4 시험 `re-pushes marker when close refused`.
3. **겹쳐 연 것**(서랍 위 메뉴, 모달 위 확인 창): 뒤로가기 한 번에 둘 다 닫히거나 아래 것이 닫힌다 — 기대: 맨 위 하나만. Task 4 시험 `closes only top`.
4. **새로 고침·앱 다시 열기 때 표시 항목에 서 있는 경우**: 첫 뒤로가기가 아무 일도 안 한다 — 기대: 시작 때 정리. Task 4 시험 `cleans stale marker on init`.
5. **마우스 환경에서 무엇이든 바뀌는 것**: 기대: 트리·포커스·기록 모두 그대로. Task 1·2 시험의 `touch: false` 경우, Task 4 시험 `noop when not touch`.

---

### Task 1: 터치 판정과 트리 — 이름은 펴고 접기, 오른쪽 열기 단추

**Files:**
- Create: `web/src/touch.ts`, `web/src/treeTap.ts`, `web/src/treeTap.test.ts`
- Modify: `web/src/Tree.tsx`(노드 행 `onClick`·열기 단추, 약 600-700행), `web/src/styles.css`(`@media (pointer: coarse)` 블록, 약 1048행), `packages/core/src/messages/{en,ko}.json`

**Interfaces:**
- Produces: `isTouch(): boolean` (`web/src/touch.ts`) — `window.matchMedia?.("(pointer: coarse)").matches ?? false`. Task 2·4 가 쓴다.
- Produces: `nodeTap(o: { touch: boolean; canExpand: boolean; hasNote: boolean; onChevron: boolean }): "toggle" | "open"` 와 `showOpenButton(o: { touch: boolean; canExpand: boolean; hasNote: boolean }): boolean` (`web/src/treeTap.ts`).

- [ ] **Step 1: 실패하는 시험** `treeTap.test.ts`
  - `nodeTap({touch:true, canExpand:true, hasNote:true, onChevron:false})` → `"toggle"`
  - `nodeTap({touch:true, canExpand:false, hasNote:true, onChevron:false})` → `"open"`
  - `nodeTap({touch:false, canExpand:true, hasNote:true, onChevron:false})` → `"open"`(마우스는 그대로)
  - `nodeTap({touch:false, canExpand:true, hasNote:true, onChevron:true})` → `"toggle"`
  - `showOpenButton` 은 `touch && canExpand && hasNote` 일 때만 true(넷 경우).
  - 노트가 없는 행(워크스페이스 최상위)은 `activate` 의 기존 분기가 계속 맡는다 — `nodeTap` 은 `hasNote:true` 인 행에만 쓴다.
- [ ] **Step 2:** `pnpm --filter @keyring-notes/web exec vitest run src/treeTap.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3:** `touch.ts`·`treeTap.ts` 구현. `Tree.tsx` 노드 행 `onClick` 을 `nodeTap` 결과로(`"toggle"` → `toggle(n.path)`, `"open"` → 기존 `activate(r)`), 노트가 없는 행은 지금대로. `showOpenButton` 이면 행 오른쪽 끝(이름 뒤, `margin-left: auto`)에 `button.tree-open` — Lucide 아이콘(예 `ArrowRight`/`SquareArrowOutUpRight`, 빌더 몫), `aria-label={t("tree.openNote", { name: n.name })}`, `onClick` 에서 `e.stopPropagation()` 후 `actions.open(n, { newTab: true })`(지금 `activate` 와 같은 호출), 끌기 시작하지 않게 `draggable={false}`. CSS: `(pointer: coarse)` 에서 `.tree-open` 최소 44×36px, 마우스 환경에서는 그리지 않는다(컴포넌트에서 `showOpenButton` 이 false). `(pointer: coarse)` 에서 `.tree-chevron` 의 누르는 자리도 넓힌다(시각 크기는 그대로, 패딩·음수 마진으로 너비 28px 이상). 새 키 `tree.openNote`: en `"Open {{name}}"`, ko `"{{name}} 열기"` — 같은 파일의 기존 매개변수 문법을 따른다.
- [ ] **Step 4:** 같은 시험 → PASS. `pnpm --filter @keyring-notes/web typecheck` 통과.
- [ ] **Step 5: 커밋** `git add web/src/touch.ts web/src/treeTap.ts web/src/treeTap.test.ts web/src/Tree.tsx web/src/styles.css packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `git commit -m "트리(터치): 하위가 있는 노트는 이름을 누르면 펴고 접고, 오른쪽 열기 단추로 연다"`

### Task 2: 터치에서 노트를 열 때 편집기에 포커스하지 않기

**Files:**
- Create: `web/src/editorFocus.ts`, `web/src/editorFocus.test.ts`
- Modify: `web/src/DocPane.tsx`(`autoFocus={focused}` 약 586행), 필요하면 `web/src/Workspace.tsx`(`focusTitle`·`createDoc` 길, 약 495·1665·1719행)

**Interfaces:**
- Consumes: `isTouch()` (Task 1)
- Produces: `editorAutoFocus(o: { touch: boolean; focused: boolean }): boolean` — `focused && !touch`.

- [ ] **Step 1: 실패하는 시험** `editorFocus.test.ts`: `{touch:false, focused:true}` → true, `{touch:true, focused:true}` → false, `{touch:false, focused:false}` → false.
- [ ] **Step 2:** 시험 실행 → FAIL.
- [ ] **Step 3:** 구현하고 `DocPane` 이 `autoFocus={editorAutoFocus({ touch: isTouch(), focused })}` 를 넘긴다. **제목 칸 포커스(`titleFocus`)는 건드리지 않는다** — 「새 노트」 길은 `focusTitle` 로 제목에 커서가 가므로 그대로 키보드가 올라온다. 확인할 것: 데일리 노트 열기(`openDaily`, 없으면 만들어짐)·없는 링크로 만들어지는 길이 `focusTitle` 을 부르면 터치에서는 부르지 않게 한다(스펙: 「새 노트」 를 눌렀을 때만). 「이름 바꾸기」(F2·메뉴)의 `focusTitle` 은 사람이 고른 것이므로 그대로. 사람이 본문을 누르면 포커스되는 지금 동작(`focusAt`)은 그대로.
- [ ] **Step 4:** 시험 PASS, typecheck 통과.
- [ ] **Step 5: 커밋** `git add web/src/editorFocus.ts web/src/editorFocus.test.ts web/src/DocPane.tsx web/src/Workspace.tsx` → `git commit -m "편집기(터치): 노트를 열 때 포커스하지 않는다 — 새 노트의 제목 칸만 커서"`

### Task 3: 좁은 화면 빵부스러기

**Files:**
- Modify: `web/src/styles.css`(좁은 화면 블록의 `.crumbs .crumb:not(.current) { display: none; }` 약 1044행), `web/src/DocPane.tsx`(`nav.crumbs`, 약 434행)

**Interfaces:** 없음

- [ ] **Step 1:** 좁은 화면 규칙의 숨김을 걷고 `.crumbs` 를 한 줄 가로 스크롤로(`overflow-x: auto`, `white-space: nowrap`, 스크롤 막대 숨김 `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`, `-webkit-overflow-scrolling` 은 필요 없다). 칸들은 줄어들지 않게(`flex-shrink: 0`, 지금의 `text-overflow: ellipsis`/`overflow: hidden` 은 좁은 화면에서 풀기). `(pointer: coarse)` 에서 `.crumb-btn` 높이 32px 이상. 문서 머리의 `.doc-tools`·`.daily-nav` 는 밀리지 않는다(`.crumbs` 가 `flex: 1; min-width: 0` 인 지금 구조 유지).
- [ ] **Step 2:** `DocPane` 에서 `nav.crumbs` 에 ref 를 달고 `useLayoutEffect` 로 `doc.path`·`crumbs.join("/")` 가 바뀔 때 `scrollLeft = scrollWidth` (오른쪽 끝 = 지금 노트).
- [ ] **Step 3:** `pnpm --filter @keyring-notes/web typecheck`·`test` 통과(이 Task 는 단위 시험 없음 — 브라우저 확인은 Task 5).
- [ ] **Step 4: 커밋** `git add web/src/styles.css web/src/DocPane.tsx` → `git commit -m "좁은 화면: 문서 머리에 상위 경로를 한 줄로 보이고 옆으로 밀어 본다"`

### Task 4: 뒤로가기로 위에 뜬 것 닫기 (B)

**Files:**
- Create: `web/src/backStack.ts`, `web/src/backStack.test.ts`
- Modify: `web/src/Modal.tsx`(쌓기 `useLayoutEffect`, `Modal` props), `web/src/Settings.tsx`(`SettingsModal` 의 `<Modal>` 에 `backClose={false}`), `web/src/ui.tsx`(`Menu`), `web/src/dialog.ts`(`open`), `web/src/Workspace.tsx`(서랍·오른쪽 서랍, 주소 `replaceState` 1322행, `hashchange` 처리기 1327-1347행, `openSettings` 약 2344행), `web/src/main.tsx`(시작 때 정리)

**Interfaces:**
- Consumes: `isTouch()` (Task 1)
- Produces (`web/src/backStack.ts`):
  - `createBackStack(env: BackEnv): BackStack` — 시험용 팩토리. `BackEnv = { history: Pick<History, "state" | "pushState" | "replaceState" | "back">; addPopListener(fn: (e: { state: unknown }) => void): void; enabled(): boolean }`.
  - `interface BackStack { push(close: () => boolean | void | Promise<boolean | void>): () => void; settle(): Promise<void>; navigate(url: string, state?: Record<string, unknown>): Promise<void>; replace(url: string): void; initClean(): void }`
  - 앱 전역 인스턴스 `backStack`(실제 `window.history`, `popstate`, `enabled: isTouch`)과 `pushOverlay = backStack.push` 를 내보낸다.
  - 표시: `history.state` 에 `kOverlay: true`(다른 키는 보존 — `settingsNav.ts` 의 `{ back }` 등).

**동작(시험이 고정한다):**
- `push(close)`: `enabled()` 가 false 면 아무것도 안 하고 noop 해제 함수를 돌려준다. 목록이 0→1 이 되면 `pushState({ ...state, kOverlay: true }, "")`(주소 인자 없음 = 같은 주소). 돌려준 해제 함수는 항목을 빼고, 목록이 비고 표시가 서 있으면 `back()` 을 「우리가 부른 것」 으로 표시하고 부른다(그 popstate 는 닫기로 치지 않는다). 해제는 두 번 불려도 한 번만.
- popstate(표시를 떠남, 우리가 부른 것 아님): 맨 위 항목의 `close()` 를 부른다. 결과가 `false` 면(닫기 거부) 표시를 다시 쌓는다. 닫힌 뒤 목록이 남아 있으면 표시를 다시 쌓는다. 닫는 쪽 컴포넌트는 닫히면서 해제 함수를 부르는데, 이때는 이미 표시를 떠났으므로 `back()` 을 부르지 않는다.
- `settle()`: 우리가 부른 `back()` 의 popstate 가 아직 오지 않았으면 그때까지 기다린다(없으면 바로).
- `navigate(url, state)`: 표시가 서 있으면 `replaceState(state ?? null, "", url)` 로 갈아 끼우고 표시를 내린 것으로 친다(남은 항목들의 해제가 `back()` 을 부르지 않는다). 아니면 `await settle()` 후 `pushState(state ?? null, "", url)`.
- `replace(url)`: 지금 state(표시 포함)를 지킨 채 `replaceState(history.state, "", url)`.
- `initClean()`: 시작 때 `history.state?.kOverlay` 면 `back()` 을 우리가 부른 것으로 부른다(같은 주소의 앞 항목으로 — 첫 뒤로가기가 헛돌지 않게).

- [ ] **Step 1: 실패하는 시험** `backStack.test.ts` — 가짜 history(항목 배열 + 인덱스, `back()` 은 인덱스를 줄이고 popstate 를 **비동기로**(microtask) 쏜다)로:
  - `noop when not touch`: `enabled:false` 면 push 해도 기록 길이 그대로.
  - `push adds one marker for many`: 둘 push → 기록 +1, `state.kOverlay === true`, 기존 state 키 보존.
  - `back closes only top`: 둘 push 후 뒤로 → 위 것의 close 만 호출, 표시 다시 쌓임(기록 길이 원래+1).
  - `last close by button pops marker`: 하나 push → 해제 → `back` 호출됨, 그 popstate 에서 close 호출 안 됨.
  - `re-pushes marker when close refused`: close 가 `Promise<false>` → 표시 다시 쌓임.
  - `settles before push`: push → 해제(비동기 back 진행 중) → `navigate("#/:settings/general")` → 최종 기록 맨 위가 설정 주소이고 그 아래가 원래 항목(설정이 back 에 꺼내지지 않음).
  - `replaces marker when navigating from overlay`: push → `navigate(url)` → 기록 길이 원래+1, 맨 위 주소 = url, `kOverlay` 없음 → 이어서 해제 → `back` 호출 안 됨.
  - `replace keeps marker`: push → `replace("#/B.md")` → 맨 위 주소 `#/B.md`, `kOverlay` 유지.
  - `cleans stale marker on init`: 시작 state 가 `{ kOverlay: true }` → `initClean()` → `back` 호출됨.
- [ ] **Step 2:** `pnpm --filter @keyring-notes/web exec vitest run src/backStack.test.ts` → FAIL.
- [ ] **Step 3:** `backStack.ts` 구현 → 시험 PASS.
- [ ] **Step 4: 배선**
  - `Modal`: prop `backClose?: boolean`(기본 true). 쌓기 `useLayoutEffect` 에서 `backClose` 면 `pushOverlay(() => entry.attempt())`, 정리에서 해제. `SettingsModal` 은 `backClose={false}`.
  - `Menu`: 마운트 때 `pushOverlay(() => onClose())`, 언마운트 때 해제.
  - `dialog.ts` `open`: 붙일 때 `pushOverlay(() => done(cancelable ? null : ""))`, `done` 에서 해제(alert 는 확인과 같다).
  - `Workspace` 서랍: `drawer !== null` 인 동안 `pushOverlay(() => setDrawer(null))`(왼쪽 보기를 바꿔도 같은 등록 유지), 좁은 화면 오른쪽 패널 서랍이 열린 동안도 같은 식(닫기는 지금 오른쪽 패널을 닫는 경로).
  - `Workspace` 주소 효과(1322행): `history.replaceState(null, "", want)` → `backStack.replace(want)`. 단 표시가 없을 때는 지금처럼 state 를 `null` 로 둔다(설정에서 돌아온 `{ back }` 을 지우던 동작 유지) — `replace` 가 표시가 없으면 `null`, 있으면 `{ kOverlay: true }` 만 남기게 해도 된다(빌더 몫, 시험 `replace keeps marker` 를 만족).
  - `openSettings`(2348행 `history.pushState(null, "", ...)`)와 `hashchange` 처리기의 거부 때 `pushState`(1335행): `await backStack.navigate(url)` 로. 처리기의 확인 창은 `dialog.ts` 경유라 자동으로 등록된다.
  - `main.tsx`: 렌더 전에 `backStack.initClean()`(동기화 화면으로 주소를 바꾸는 기존 `replaceState` 보다 먼저).
- [ ] **Step 5:** `pnpm --filter @keyring-notes/web test`(실행 개수 확인)·`typecheck` 통과.
- [ ] **Step 6: 커밋** `git add web/src/backStack.ts web/src/backStack.test.ts web/src/Modal.tsx web/src/Settings.tsx web/src/ui.tsx web/src/dialog.ts web/src/Workspace.tsx web/src/main.tsx` → `git commit -m "뒤로가기(터치): 확인 창·메뉴·모달·서랍을 하나씩 닫는다 — 주소 기록에 표시 하나"`

### Task 5: 브라우저 확인과 문서

**Files:**
- Modify: `docs/ops/ux.md`(새 절 「모바일 다듬기 (2026-11-02)」, 그리고 「모바일 하단 바·PWA 색·새 버전 알림」 의 「확인하지 못한 것」 에 하단 내비게이션 줄 결론), `docs/manual/en/*`·`docs/manual/ko/*`(모바일 트리·뒤로가기를 적을 자리가 있으면 같은 커밋에서 둘 다)

- [ ] **Step 1: 시험 서버**: 임시 `KEYRING_DATA`, 기본과 다른 포트(`docs/guides/development.md` 참고). 깊이 3 이상의 노트와 하위가 있는 노트를 만든다.
- [ ] **Step 2: 헤드리스 Chromium(Playwright, `isMobile`·`hasTouch`, 390×844)** — 스펙 「확인」 절의 목록을 모두 돈다. 특히: 트리 이름 → 펴고 접기 / 열기 단추 → 열림 / 노트 열기 뒤 `document.activeElement` 가 편집기가 아님 / ＋ 새 노트는 제목 칸 포커스 / 깊은 노트의 빵부스러기 오른쪽 끝 보임 / `page.goBack()` 으로 서랍·더 보기·탭 시트·그래프·메뉴·확인 창이 하나씩 닫히고 주소 그대로 / 겹쳐 연 둘에 뒤로 두 번 / X 로 닫은 뒤 뒤로 / 더 보기 → 설정 → 뒤로 한 번에 노트 / 설정 닫기 확인 창 위 뒤로 = 설정 유지 / 탭 시트에서 고른 뒤 주소 = 그 노트 / 새로 고침 뒤 첫 뒤로. 그리고 **1280 마우스(터치 아님)** 에서 트리 클릭·편집기 포커스·뒤로가기가 지금과 같은지, **800 아래로 줄인 마우스 창** 에서도 뒤로가기가 서랍을 닫지 않는지(지금 동작).
- [ ] **Step 3:** 찾은 문제는 해당 Task 파일에서 고치고 그 Task 의 시험을 보탠다.
- [ ] **Step 4: 문서**: `ux.md` 새 절에 사용자 결정(하단 색 안 함, 이름 = 펴고 접기 + 오른쪽 열기 단추, 노트 사이 뒤로가기 없음, B 방식)과 코디네이터 판단(스펙의 「코디네이터 판단」 항목들), 확인한 것·못 한 것(실기기 안드로이드 뒤로가기 단추는 사용자 확인 몫). 사용자 문서 en·ko.
- [ ] **Step 5:** 루트에서 `pnpm test`, `pnpm typecheck`, `pnpm build` — 실행 개수 기록.
- [ ] **Step 6: 커밋** 바꾼 파일만 경로로 stage → `git commit -m "문서: 모바일 다듬기 — 결정·확인한 것, 하단 내비게이션 줄 색 결론"`
