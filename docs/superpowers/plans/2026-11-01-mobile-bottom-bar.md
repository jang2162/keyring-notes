# 모바일 하단 바·PWA 상하단 색·PWA 새 버전 알림 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 좁은 화면(800px 이하)에 파일·검색·＋·탭·더 보기 하단 바를 두고, PWA 의 상하단 시스템 영역을 앱 배경색으로 칠하고, 열려 있는 PWA 가 새 버전을 받으면 알린다.

**Architecture:** 판단은 작은 순수 모듈(`themeColor.ts`·`pwaUpdate.ts`·`bottomBar.ts`)과 서비스 워커(`sw.js`)에 두고 시험한다. 화면은 `BottomBar.tsx` 컴포넌트를 `Workspace.tsx` 가 좁은 화면일 때만 그리고, 좁은 화면에서 위쪽 탭 줄·상태 표시줄·서랍 안 레일을 뺀다. 새 버전 알림의 「새로 고침」 은 데스크톱 창 닫기의 `closeWindowSafely` 를 그대로 쓴다.

**Tech Stack:** React 19, TypeScript, Vite, vitest(node 환경 — DOM 이 없다. 컴포넌트는 `renderToStaticMarkup` 으로 본다), lucide-react, 서비스 워커(평문 JS).

**Spec:** `docs/superpowers/specs/2026-11-01-mobile-bottom-bar-design.md`

## Global Constraints

- 좁은 화면 기준은 지금과 같은 `max-width: 800px`(`Workspace.tsx` 의 `narrow()`·`isNarrow`, `styles.css` 의 같은 미디어 쿼리). 넓은 화면(800px 초과)·데스크톱 앱 창의 배치는 바꾸지 않는다.
- 새 노트는 지금처럼 `createDoc()`(읽던 노트 옆, `currentParent()`). 빠른 메모 전용 자리를 만들지 않는다.
- 화면 글은 `packages/core/src/messages/{en,ko}.json`, 영어가 기준. 새 키는 알파벳 정렬된 자리에 손으로 넣는다(oxfmt 는 키 순서를 맞추지 않는다).
- 패키지 매니저는 pnpm. 코드를 쓴 뒤 `pnpm fmt`·`pnpm lint`(루트 스크립트) 를 돌린다.
- 다 했다고 말하기 전에 루트에서 `pnpm test`·`pnpm typecheck`·`pnpm build`. 시험은 **실행 개수**를 보고에 적는다.
- 사용자 문서 en(원본)·ko(번역)는 같은 커밋에서 고친다. `docs/ops/ux.md` 에 이 작업의 절을 둔다.
- 커밋 메시지는 한국어, 저장소 관례(`영역: 무엇을 — 왜`). 파일은 경로로 stage 한다.

## Review Focus

1. **안드로이드에서 키보드가 레이아웃 뷰포트까지 줄이는 경우** — `window.innerHeight` 도 함께 줄어 「창 높이 대비」 비교가 0 이 되면 바가 키보드 위에 뜬다. 기준은 「지금까지 본 가장 큰 `visualViewport.height`」(가로 폭이 바뀌면 다시 잰다)로 한다 → Task 4 의 `keyboardUp` 시험.
2. **＋ 길게 누르기가 짧은 누르기·iOS 길게 누르기 메뉴와 겹침** — 길게 눌러 오늘 노트가 열린 뒤 손을 떼며 `click` 이 또 새 노트를 만들면 안 된다. iOS 의 글 선택·콜아웃도 뜨면 안 된다 → Task 4 의 `pressOutcome` 시험, Task 5 의 CSS.
3. **화면 폭이 800px 을 넘나들 때(회전) 열려 있던 「더 보기」** — 넓은 화면으로 가면 닫혀야 한다(지금 서랍·탭 시트를 닫는 효과와 같은 자리) → Task 5 의 브라우저 확인.
4. **새 워커가 빌드 id 에 답하지 않음(옛 워커, 시간 초과)·오프라인에서 `update()` 실패** — 알림 없이 조용히 넘어가야 하고 오류 알림을 띄우면 안 된다 → Task 3 의 `askBuild`·`watchUpdates` 시험.
5. **노트가 하나도 열려 있지 않은 홈 화면(좁은 화면)** — 지금은 홈에서도 탭 줄(☰)이 유일한 서랍 입구다. 탭 줄을 뺀 뒤에도 하단 바로 파일·검색·새 노트가 되어야 한다 → Task 5 의 브라우저 확인.

---

### Task 1: PWA 상하단 색을 앱 배경색으로

**Files:**
- Create: `web/src/themeColor.ts`, `web/src/themeColor.test.ts`
- Modify: `web/index.html`, `web/public/manifest.webmanifest`, `web/src/prefs.ts:313-318`(`applyTheme`)

**Interfaces:**
- Produces: `THEME_BG: { light: "#ffffff"; dark: "#17191c" }`, `themeColorContents(theme: Prefs["theme"]): { light: string; dark: string }`, `applyThemeColor(theme: Prefs["theme"], doc?: Document): void`

- [ ] **Step 1: 실패하는 시험** — `web/src/themeColor.test.ts`

```ts
import stylesCss from "./styles.css?raw";
it("THEME_BG 는 styles.css 의 --bg 와 같다", () => {
  expect(stylesCss).toContain(`--bg: ${THEME_BG.light};`);
  expect(stylesCss).toContain(`--bg: ${THEME_BG.dark};`);
});
it("system 은 미디어 쿼리별로 두 색", () => expect(themeColorContents("system")).toEqual({ light: "#ffffff", dark: "#17191c" }));
it("light 를 고르면 두 메타 모두 밝은 색", () => expect(themeColorContents("light")).toEqual({ light: "#ffffff", dark: "#ffffff" }));
it("dark 를 고르면 두 메타 모두 어두운 색", () => expect(themeColorContents("dark")).toEqual({ light: "#17191c", dark: "#17191c" }));
it("applyThemeColor 는 media 가 light·dark 인 메타의 content 를 바꾼다", () => {
  // 가짜 doc: querySelector("meta[name=theme-color][media*=light]") 등 두 개를 돌려주는 객체
  applyThemeColor("dark", fakeDoc);
  expect(fakeDoc.light.content).toBe("#17191c");
  expect(fakeDoc.dark.content).toBe("#17191c");
});
it("메타가 없으면 아무것도 하지 않는다(던지지 않는다)", () => expect(() => applyThemeColor("dark", emptyDoc)).not.toThrow());
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/web exec vitest run src/themeColor.test.ts` → 모듈 없음으로 FAIL.

- [ ] **Step 3: 구현**
  - `web/src/themeColor.ts` 에 위 세 export. `applyThemeColor` 는 `doc.querySelector('meta[name="theme-color"][media*="light"]')`·`[media*="dark"]` 의 `content` 를 바꾼다.
  - `web/src/prefs.ts` 의 `applyTheme` 끝에서 `applyThemeColor(theme)` 를 부른다.
  - `web/index.html`: `<meta name="theme-color" content="#3b6fd8" />` 를 두 줄로 — `media="(prefers-color-scheme: light)" content="#ffffff"`, `media="(prefers-color-scheme: dark)" content="#17191c"`. 그리고 `<meta name="apple-mobile-web-app-status-bar-style" content="default" />` 를 명시한다(결정: `black-translucent` 는 상태 표시줄 글자가 흰색이라 밝은 테마에서 안 보이므로 버린다. `default` 에서 iOS 홈 화면 앱이 `theme-color` 로 상태 표시줄을 칠하는지는 실기기로만 확인된다 — Task 6 에서 `ux.md` 에 「확인 필요」 로 적는다).
  - `web/public/manifest.webmanifest`: `theme_color` 를 `#ffffff`. `background_color` 는 그대로.

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS(6개).

- [ ] **Step 5: 커밋**

```bash
git add web/src/themeColor.ts web/src/themeColor.test.ts web/src/prefs.ts web/index.html web/public/manifest.webmanifest
git commit -m "PWA 상하단 색: 강조 파랑 대신 앱 배경색 — 시스템 테마는 미디어 쿼리 두 벌, 설정에서 고른 테마도 따른다"
```

### Task 2: 서비스 워커 — 옛 캐시 한 세대 남기기, 빌드 id 답하기

**Files:**
- Modify: `web/public/sw.js`
- Create: `web/src/sw.test.ts`

**Interfaces:**
- Produces: 서비스 워커가 `message` 이벤트에서 `event.data?.type === "build"` 이면 `event.ports[0].postMessage(BUILD)` 로 답한다. Task 3 의 `askBuild` 가 이것을 쓴다.

- [ ] **Step 1: 실패하는 시험** — `web/src/sw.test.ts`. `import swSource from "../public/sw.js?raw"` 를 `new Function("self", "caches", "fetch", swSource)` 로 가짜 `self`(`addEventListener` 로 처리기를 모으고 `clients.claim`·`navigator`·`skipWaiting` 을 가진 객체)·가짜 `caches`(`keys`·`delete`·`open`·`match`)와 함께 돌린다. `__KEYRING_BUILD__` 자리는 소스 글을 `"b0005"` 로 바꿔 넣는다.

```ts
it("activate 는 지금 빌드와 바로 앞 빌드 캐시를 남기고 더 오래된 것만 지운다", async () => {
  caches.keys = ["keyring-shell-b0001", "keyring-shell-b0003", "keyring-shell-b0005", "other-cache"];
  await fire("activate");
  expect(deleted).toEqual(["keyring-shell-b0001"]);
});
it("되돌린 배포(지금 빌드가 더 옛것)에서도 다른 것 중 가장 새것 하나를 남긴다", async () => {
  // 현재 b0005, 남은 것 b0007·b0009 → b0009 를 남기고 b0007 을 지운다
});
it("build 메시지에 포트로 빌드 id 를 답한다", async () => {
  const port = { postMessage: vi.fn() };
  await fire("message", { data: { type: "build" }, ports: [port] });
  expect(port.postMessage).toHaveBeenCalledWith("b0005");
});
it("다른 메시지·포트 없는 메시지는 무시한다(던지지 않는다)", async () => { /* ... */ });
```

빌드 id 의 순서는 `parseInt(id, 36)` 의 숫자 크기로 비교한다(빌드 id 는 `Date.now().toString(36)`). 시험의 `b0001` 등은 36진수로 읽혀 크기 순서가 맞는다.

- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/web exec vitest run src/sw.test.ts` → 첫 시험(두 개 지움)·메시지 시험 FAIL.

- [ ] **Step 3: 구현** — `sw.js`
  - `activate`: `keyring-shell-` 로 시작하고 `CACHE` 가 아닌 것들 중 빌드 id 숫자가 가장 큰 하나를 남기고 나머지를 지운다. 머리 주석의 「예전 assets를 정리한다」 를 「바로 앞 빌드 하나는 남긴다 — 새로 고치기 전의 옛 화면이 아직 안 불러온 조각을 받게」 로 고친다.
  - `self.addEventListener("message", …)`: 위 Interfaces 대로.

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS(4개 이상).

- [ ] **Step 5: 커밋**

```bash
git add web/public/sw.js web/src/sw.test.ts
git commit -m "서비스 워커: 바로 앞 빌드 캐시를 남기고, 빌드 id 를 물으면 답한다 — 새로 고치기 전의 옛 화면이 조각을 받게"
```

### Task 3: PWA 새 버전 알림과 안전한 새로 고침

**Files:**
- Modify: `web/vite.config.ts`(빌드 id 를 한 번 만들어 `stampServiceWorker` 와 `define` 이 같이 쓴다), `web/src/main.tsx`(등록 뒤 감시 시작), `web/src/Workspace.tsx`(알림·새로 고침), `packages/core/src/messages/{en,ko}.json`
- Create: `web/src/build.d.ts`, `web/src/pwaUpdate.ts`, `web/src/pwaUpdate.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `build` 메시지.
- Produces:
  - `declare const __KEYRING_BUILD__: string`(`build.d.ts`), vite `define: { __KEYRING_BUILD__: JSON.stringify(BUILD) }`
  - `CHECK_EVERY_MS = 30 * 60_000`
  - `shouldCheck(now: number, last: number): boolean` — `now - last >= CHECK_EVERY_MS`
  - `isNewBuild(workerBuild: string | null, pageBuild: string): boolean` — `workerBuild !== null && workerBuild !== pageBuild`
  - `askBuild(sw: Pick<ServiceWorker, "postMessage">, timeoutMs = 3000): Promise<string | null>` — `MessageChannel` 로 묻고, 시간 초과·오류면 `null`
  - `watchUpdates(reg: Pick<ServiceWorkerRegistration, "update">, env: UpdateEnv, pageBuild = __KEYRING_BUILD__): () => void` — `UpdateEnv` 는 `{ now(): number; visible(): boolean; onVisible(fn): () => void; onControllerChange(fn): () => void; controller(): Pick<ServiceWorker,"postMessage"> | null }`(시험에서 가짜를 넣는다. `main.tsx` 는 `document`·`navigator.serviceWorker` 로 만든 것을 넘긴다)
  - `onNewVersion(fn: () => void): () => void` — 구독. 감시가 새 버전을 이미 알아챈 뒤에 구독하면 바로 한 번 부른다(Workspace 가 늦게 그려져도 놓치지 않게).

- [ ] **Step 1: 실패하는 시험** — `web/src/pwaUpdate.test.ts`

```ts
it("shouldCheck: 30분이 지나야 다시 확인", () => { expect(shouldCheck(30 * 60_000, 0)).toBe(true); expect(shouldCheck(30 * 60_000 - 1, 0)).toBe(false); });
it("isNewBuild: 다를 때만, null 이면 아니다", () => { expect(isNewBuild("b2", "b1")).toBe(true); expect(isNewBuild("b1", "b1")).toBe(false); expect(isNewBuild(null, "b1")).toBe(false); });
it("askBuild: 답이 없으면 시간 초과로 null", async () => { /* postMessage 가 아무것도 안 하는 가짜, timeoutMs 10 */ });
it("askBuild: 포트로 온 답을 돌려준다", async () => { /* postMessage(msg, [port]) 에서 port.postMessage("b2") */ });
it("watchUpdates: 보이게 될 때 마지막 확인 뒤 30분이 지났을 때만 update()", () => { /* now 를 0 → 10분 → 31분, update 호출 1회(31분) */ });
it("watchUpdates: update() 가 거부돼도(오프라인) 던지지 않고 알리지 않는다", async () => {});
it("watchUpdates: controllerchange 뒤 워커 빌드가 다르면 onNewVersion 을 부른다", async () => {});
it("watchUpdates: 같은 빌드(배포 뒤 처음 연 화면·처음 설치)면 알리지 않는다", async () => {});
it("onNewVersion: 알아챈 뒤 구독해도 한 번 불린다", async () => {});
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/web exec vitest run src/pwaUpdate.test.ts` → FAIL.

- [ ] **Step 3: 구현**
  - `vite.config.ts`: 파일 위쪽에 `const BUILD = Date.now().toString(36)` 하나. `stampServiceWorker` 는 그 값을 쓰고(지금 `closeBundle` 안에서 만드는 것을 뺀다), `defineConfig` 에 `define` 을 더한다.
  - `pwaUpdate.ts`: 위 Interfaces.
  - `main.tsx`: 기존 `register("/sw.js")` 의 `then(reg => watchUpdates(reg, browserEnv()))`. 조건(`PROD && !isTauri()`)은 그대로.
  - `Workspace.tsx`:
    - 창 닫기 처리기(1310행 근처 `closeAskHandler({ … save: async () => { … } })`)의 `save` 람다를 컴포넌트 안 함수 `saveAllDirty()` 로 꺼내 두 곳이 같이 쓴다.
    - `useEffect(() => onNewVersion(() => toast(t("pwa.newVersion"), { duration: 0, action: { label: t("pwa.reload"), run: () => void reloadSafely() } })), [])`.
    - `reloadSafely()` 는 `closeWindowSafely({ dirty: () => dirtyPaths(docsRef.current), ask, save: saveAllDirty, unsaved: (paths) => toast(t("pwa.saveFailed", { names: unsavedSummary(paths, stemOf).names }), { kind: "error" }), close: async () => location.reload(), hold: closeHold.current, dropPending: () => dropAutosaves(autosaveTimers.current, autosaveArmed.current) })`. `ask` 는 자동 저장이 켜져 있으면(`prefsRef.current.autosave`) 묻지 않고 `"save"` 를 돌려주고, 꺼져 있으면 `chooseDialog(t(more ? "pwa.unsavedMore" : "pwa.unsaved", { names, count }), { value: "save", label: t("pwa.reloadSave") }, [{ value: "discard", label: t("pwa.reloadDiscard") }])`.
  - 메시지(en / ko):
    - `pwa.newVersion`: "A new version is available." / "새 버전이 있습니다."
    - `pwa.reload`: "Reload" / "새로 고침"
    - `pwa.reloadDiscard`: "Reload without saving" / "저장하지 않고 새로 고침"
    - `pwa.reloadSave`: "Save and reload" / "저장하고 새로 고침"
    - `pwa.saveFailed`: "Could not save {names}, so the page was not reloaded." / "{names} 을(를) 저장하지 못해 새로 고치지 않았습니다."
    - `pwa.unsaved`: "Unsaved changes in {names}. Save them before reloading?" / "{names} 에 저장하지 않은 변경이 있습니다. 새로 고치기 전에 저장할까요?"
    - `pwa.unsavedMore`: "{count} notes have unsaved changes ({names}, …). Save them before reloading?" / "노트 {count}개({names}, …)에 저장하지 않은 변경이 있습니다. 새로 고치기 전에 저장할까요?"

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS(9개 이상). `pnpm typecheck` 통과.

- [ ] **Step 5: 확인(빌드 두 번)** — `pnpm build` 뒤 서버를 임시 `KEYRING_DATA`·다른 포트로 띄워 PWA 화면을 열고, 다시 `pnpm build` 해 서버가 새 `dist` 를 내도록 한 뒤 개발자 도구 콘솔에서 `(await navigator.serviceWorker.ready).update()` 를 부른다(30분 문턱 때문에 탭을 숨겼다 보이게 하는 것으로는 바로 확인되지 않는다 — 문턱 상수를 바꾸지 않는다) → 「새 버전이 있습니다 · 새로 고침」 이 뜨는지, 새로 고치기 전 아이콘 고르기 창이 열리는지, 자동 저장을 끄고 고친 뒤 「새로 고침」 이 세 갈래로 묻는지. 결과를 보고에 적는다.

- [ ] **Step 6: 커밋**

```bash
git add web/vite.config.ts web/src/build.d.ts web/src/pwaUpdate.ts web/src/pwaUpdate.test.ts web/src/main.tsx web/src/Workspace.tsx packages/core/src/messages/en.json packages/core/src/messages/ko.json
git commit -m "PWA 새 버전 알림: 돌아올 때 워커를 확인하고 빌드가 다를 때만 알린다 — 새로 고침은 저장을 거치고, 자동 저장이 꺼져 있으면 묻는다"
```

### Task 4: 하단 바 컴포넌트와 판단

**Files:**
- Create: `web/src/bottomBar.ts`, `web/src/bottomBar.test.ts`, `web/src/BottomBar.tsx`, `web/src/BottomBar.test.tsx`
- Modify: `packages/core/src/messages/{en,ko}.json`

**Interfaces:**
- Produces (`bottomBar.ts`):
  - `interface MoreStatus { offline: boolean; outbox: number; saveIssue: boolean; syncError: boolean; reviewWaiting: number; update: boolean }`
  - `moreBadge(s: MoreStatus): number | "dot" | null` — `outbox + reviewWaiting > 0` 이면 그 수, 아니면 `offline || saveIssue || syncError || update` 이면 `"dot"`, 아니면 `null`
  - `KEYBOARD_GAP = 150`, `keyboardUp(viewport: number, tallest: number, editing: boolean): boolean` — `editing && tallest - viewport > KEYBOARD_GAP`
  - `LONG_PRESS_MS = 500`, `pressOutcome(heldMs: number, canHold: boolean): "tap" | "hold"` — `canHold && heldMs >= LONG_PRESS_MS` 면 `"hold"`
- Produces (`BottomBar.tsx`):
  - `BottomBar(props: { active: "files" | "search" | null; tabCount: number; canNew: boolean; badge: number | "dot" | null; onFiles(): void; onSearch(): void; onNew(): void; onNewHold: (() => void) | null; onTabs(): void; onMore(): void })`
  - `MoreSheet(props: { status: MoreStatusLine[]; entries: MoreEntry[]; onClose(): void })`
  - `interface MoreEntry { id: string; label: string; icon: LucideIcon; badge?: number; dot?: boolean; run(): void }`
  - `interface MoreStatusLine { id: string; text: string; kind: "" | "warn" | "error"; run?: () => void }`

- [ ] **Step 1: 실패하는 시험**

`web/src/bottomBar.test.ts`:
```ts
it("moreBadge: 보낼 변경·검토 대기는 수로 더한다", () => expect(moreBadge({ ...calm, outbox: 2, reviewWaiting: 1 })).toBe(3));
it("moreBadge: 수가 없고 오프라인·저장 문제·동기화 오류·업데이트면 점", () => { for (const k of ["offline", "saveIssue", "syncError", "update"]) expect(moreBadge({ ...calm, [k]: true })).toBe("dot"); });
it("moreBadge: 평소에는 없음", () => expect(moreBadge(calm)).toBeNull());
it("keyboardUp: 입력 중이고 가장 컸던 높이보다 150px 넘게 줄었을 때만", () => {
  expect(keyboardUp(500, 800, true)).toBe(true);
  expect(keyboardUp(650, 800, true)).toBe(false); // 정확히 150 은 아니다
  expect(keyboardUp(500, 800, false)).toBe(false);
});
it("pressOutcome: 500ms 이상 누르면 hold, 길게 누르기가 없으면 늘 tap", () => {
  expect(pressOutcome(499, true)).toBe("tap");
  expect(pressOutcome(500, true)).toBe("hold");
  expect(pressOutcome(900, false)).toBe("tap");
});
```

`web/src/BottomBar.test.tsx`(`renderToStaticMarkup`, `setLanguage("en")`):
```ts
it("다섯 칸이 이 순서: Files · Search · New note · Tabs · More", () => { /* aria-label 순서 */ });
it("active 칸은 aria-pressed=true", () => {});
it("탭 칸에 열린 탭 수가 보인다", () => { /* tabCount 3 → "3" */ });
it("badge 가 수면 더 보기 칸에 수, dot 이면 점 요소", () => {});
it("canNew=false 면 ＋ 가 disabled", () => {});
it("onNewHold 가 있으면 ＋ 의 설명에 길게 누르기 안내가 붙고, 없으면 안 붙는다", () => {});
it("MoreSheet: status 줄이 entries 보다 먼저, run 이 있는 줄은 단추", () => {});
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @keyring-notes/web exec vitest run src/bottomBar.test.ts src/BottomBar.test.tsx` → FAIL.

- [ ] **Step 3: 구현**
  - `bottomBar.ts`: 위 Interfaces.
  - `BottomBar.tsx`: `<nav className="bottom-bar" aria-label={t("bar.label")}>` 안에 단추 다섯 개. 아이콘은 레일과 같은 lucide(`Files`·`Search`·`Plus`·탭은 `TabSwitcher` 의 탭 개수 단추가 쓰던 것·`Ellipsis`), 각 단추 아래 작은 이름. ＋ 는 `pointerdown` 시각을 잡고 `pointerup` 에서 `pressOutcome` 으로 가르며, `"hold"` 면 타이머가 `LONG_PRESS_MS` 에 `onNewHold` 를 부르고 이어지는 `click` 을 한 번 무시한다. `pointercancel`·`pointerleave` 는 타이머를 지운다. `onNewHold` 가 `null` 이면 길게 눌러도 `onNew` 한 번(짧은 누르기와 같다).
  - `MoreSheet`: `TabSwitcher` 의 시트와 같은 모양(배경 누르면 닫힘, Esc 로 닫힘). 위에 `status` 줄, 아래 `entries` 목록. 항목을 누르면 `onClose()` 뒤 `run()`.
  - 메시지(en / ko): `bar.label` "Main" / "주 메뉴", `bar.more` "More" / "더 보기", `bar.tabs` "Tabs" / "탭", `bar.newHold` "Hold for today's note" / "길게 누르면 오늘 노트". 파일·검색·새 노트 이름은 기존 `rail.files`·`rail.search`·`tree.newNote`.

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS(12개 이상).

- [ ] **Step 5: 커밋**

```bash
git add web/src/bottomBar.ts web/src/bottomBar.test.ts web/src/BottomBar.tsx web/src/BottomBar.test.tsx packages/core/src/messages/en.json packages/core/src/messages/ko.json
git commit -m "하단 바: 다섯 칸·더 보기 시트 컴포넌트, 배지·키보드·길게 누르기 판단"
```

### Task 5: 좁은 화면에 하단 바를 붙이고 위·아래 줄과 서랍 레일을 뺀다

**Files:**
- Modify: `web/src/Workspace.tsx`, `web/src/styles.css`(좁은 화면 블록 1000행 근처, `.toasts` 898행), `web/src/TabSwitcher.tsx`(`TabCountButton` 삭제)

**Interfaces:**
- Consumes: Task 4 의 `BottomBar`·`MoreSheet`·`moreBadge`·`keyboardUp`.

- [ ] **Step 1: Workspace 배선**
  - **탭 줄:** 좁은 화면에서는 `renderTabBar` 를 그리지 않는다(칸 안 3559행 근처, 노트 없을 때 `center` 의 3605행 근처). 그러면 `nav-toggle` 단추·`withNav` 인자·`TabCountButton` 이 쓰이지 않으므로 지운다(`TabSwitcher.tsx` 의 export 와 `.nav-toggle`·`.tab-count`·`.tabbar .tab-new { margin-left: auto }` CSS 포함). `TabSwitcher` 시트 자체는 남는다.
  - **상태 표시줄:** `{!isNarrow && statusBar}`.
  - **서랍 레일:** `dock-body` 안 `{rail}` 을 `{!isNarrow && rail}`.
  - **하단 바:** `isNarrow` 일 때 `shell` 안에 `<BottomBar>`.
    - `active`: `drawer === "left" && (prefs.leftView === "files" || prefs.leftView === "search") ? prefs.leftView : null`
    - `onFiles`/`onSearch`: 기존 `showLeft("files")`·검색 명령과 같은 동작(`setPrefs({ leftOpen: true, leftView: "search" })`, `setDrawer("left")`, `searchInput` 포커스). 같은 보기로 열려 있으면 서랍을 닫는다.
    - `onNew`: `createDoc()`. `canNew`: `!!ws || wsNames.length > 0`.
    - `onNewHold`: `dailyCfg ? () => void openDaily(0) : null`(데일리를 끈 워크스페이스는 길게 누르기 없음).
    - `onTabs`: `focusedPane && setTabSheet(focusedPane.id)`. `tabCount`: 지금 칸의 탭 수.
    - `badge`: `moreBadge({ offline: !local && !online, outbox: local ? 0 : outboxCount, saveIssue, syncError: !!(local && syncStatus?.lastError), reviewWaiting: local ? 0 : pendingCount, update: !!newVersion })`. `saveIssue = !!doc && (conflict || saveState.kind === "conflict" || (saveState.kind === "error" && dirty))`.
  - **더 보기:** 상태 `moreOpen`. 좁은 화면이 아니게 되면 닫는다(346행 근처에서 `setDrawer(null)`·`setTabSheet(null)` 하는 효과에 같이).
    - `status` 줄: 저장 실패·충돌(누르면 `save()`), 오프라인(보낼 변경 수 포함)·「지금 보내기」(`flushOutbox()`), 로컬 동기화 오류(누르면 `openSettings("device")`), 검토 대기(누르면 `setReviewOpen(true)`). 글은 지금 상태 표시줄이 쓰는 키(`status.*`·`sync.failed`)를 그대로.
    - `entries`(레일과 같은 조건·순서): 오늘 노트(`dailyCfg`), 태그·첨부(`showLeft`), 그래프, 수집(`!local`), 검토(`!local`, `badge: pendingCount`), 정리 점검, 동기화(`local`), 설정(`dot: !!newVersion`), 로그아웃(`!local` — 레일의 로그아웃 처리기를 함수로 꺼내 같이 쓴다).
  - **키보드:** `visualViewport` 의 `resize` 를 듣는 효과. `tallest` 는 지금까지 본 가장 큰 높이(가로 폭이 바뀌면 다시 잰다), `editing` 은 `document.activeElement` 가 `input`·`textarea`·`[contenteditable]`. `keyboardUp(...)` 이면 `shell` 에 `kb-up` 클래스.

- [ ] **Step 2: CSS**(좁은 화면 블록 안)
  - `.shell { grid-template-rows: minmax(0, 1fr) auto; grid-template-areas: "center" "bar"; }`, 넓은 화면에서는 `.bottom-bar { display: none }`.
  - `.bottom-bar { grid-area: bar; display: grid; grid-template-columns: repeat(5, 1fr); height: var(--bar-h); padding-bottom: env(safe-area-inset-bottom); background: var(--bg); border-top: 1px solid var(--border); z-index: 31; }`, `--bar-h: 56px`. 단추마다 누르는 자리 44×44px 이상. ＋ 는 강조색 원.
  - ＋ 단추: `-webkit-touch-callout: none; user-select: none; touch-action: manipulation;`.
  - 서랍·서랍 배경(`.left-dock`·`.right-panel`·`.nav-backdrop`)의 `bottom` 을 `calc(var(--bar-h) + env(safe-area-inset-bottom))` 로 — 바가 서랍 아래에 보이고 눌린다.
  - `.toasts` 의 좁은 화면 `bottom` 을 바 위로.
  - `.shell.kb-up .bottom-bar { display: none }`, `.shell.kb-up` 에서는 서랍 `bottom: 0`, 알림도 원래 자리.
  - `.statusbar .status-item.muted { display: none }` 줄은 상태 표시줄이 좁은 화면에서 없으므로 지운다.

- [ ] **Step 3: 시험·검사** — 루트에서 `pnpm test`·`pnpm typecheck`·`pnpm build`, `pnpm fmt`·`pnpm lint`. 실행 개수를 적는다.

- [ ] **Step 4: 브라우저 확인**(시험 서버: 임시 `KEYRING_DATA`, 워크트리 전용 포트. 390×844·412×915 터치 에뮬레이션, 밝은·어두운 테마)
  - 다섯 칸 동작: 파일·검색 서랍 열고 닫기(같은 칸 다시 누르면 닫힘), 서랍이 열린 채로 다른 칸 누르기, ＋ 짧게(읽던 노트 옆에 새 노트)·길게(오늘 노트, 이어서 새 노트가 생기지 않음), 탭 시트, 더 보기.
  - 위쪽 탭 줄·상태 표시줄·서랍 안 레일이 없음. 노트가 없는 홈 화면에서도 바로 파일·검색·새 노트가 됨(Review Focus 5).
  - 오프라인(개발자 도구)·보낼 변경이 있을 때 「더 보기」 칸의 점·수와 목록 맨 위 상태. 서버 모드에서 로그아웃이 「더 보기」 끝에 있음.
  - 편집기에 포커스하고 `visualViewport` 높이를 줄였을 때 바가 숨음(에뮬레이션으로 키보드를 띄울 수 없으면 창 높이를 줄여 재현하고 그렇게 적는다).
  - 본문 마지막 줄까지 스크롤되고 바에 가리지 않음. 알림이 바 위에 뜸.
  - 폭을 800px 넘게 바꾸면 「더 보기」 가 닫히고 넓은 화면(1280px) 배치가 이전과 같음(Review Focus 3).

- [ ] **Step 5: 커밋**

```bash
git add web/src/Workspace.tsx web/src/styles.css web/src/TabSwitcher.tsx
git commit -m "좁은 화면: 하단 바(파일·검색·＋·탭·더 보기) — 위쪽 탭 줄·상태 표시줄·서랍 레일을 빼고, 알아야 할 상태는 더 보기에 모은다"
```

### Task 6: 문서

**Files:**
- Modify: `docs/ops/ux.md`(새 절 `## 모바일 하단 바·PWA 색·새 버전 알림 (2026-11-01)`), `docs/manual/en/how-to/arrange-tabs-and-panes.md`·`docs/manual/ko/how-to/arrange-tabs-and-panes.md`(15·27행 근처의 좁은 화면 설명), `docs/manual/en/how-to/edit-notes.md`·`docs/manual/ko/how-to/edit-notes.md`(76행 근처 설치한 웹 앱 문단에 업데이트), `CHANGELOG.md`(Unreleased)

- [ ] **Step 1: 옛 설명 찾기** — `grep -rnE 'tab count|탭 개수|☰|status bar|상태 표시줄' README.md README.ko.md docs/manual` 로 좁은 화면의 탭 개수 단추·☰·상태 표시줄을 말하는 곳을 모두 찾고 표본을 열어 본다.

- [ ] **Step 2: 쓰기**
  - `ux.md`: 사용자 결정(설계 문서의 「결정 (사용자)」 표), 내 결정, 구현 자리(파일·함수), 그리고 **확인하지 못한 것** — 실제 아이폰 홈 화면 앱의 상태 표시줄 색(`default` + `theme-color`), 안드로이드 하단 내비게이션 줄 색, 실기기 키보드에서의 바 숨김. 앱 전환 화면이 어두운 테마에서도 밝게 보일 수 있다(manifest `theme_color` 한 값).
  - 사용자 문서 en(원본)·ko: 좁은 화면 하단 바의 다섯 칸과 ＋ 길게 누르기, 「더 보기」 에 있는 것과 상태 점. 설치한 웹 앱은 서버가 새 버전이 되면 「새 버전이 있습니다」 알림의 「새로 고침」 으로 바꾼다(자동 저장이 꺼져 있으면 저장할지 묻는다).
  - CHANGELOG Unreleased: Added(하단 바, 새 버전 알림), Changed(PWA 상하단 색, 좁은 화면의 탭 개수 단추·☰·상태 표시줄이 하단 바로).

- [ ] **Step 3: 커밋**

```bash
git add docs/ops/ux.md docs/manual/en/how-to/arrange-tabs-and-panes.md docs/manual/ko/how-to/arrange-tabs-and-panes.md docs/manual/en/how-to/edit-notes.md docs/manual/ko/how-to/edit-notes.md CHANGELOG.md
git commit -m "문서: 모바일 하단 바·PWA 상하단 색·새 버전 알림 — ux.md 절, 사용자 문서 en·ko, CHANGELOG"
```
