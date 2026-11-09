# keyring-widget 2단계(iframe 호스트 + Excalidraw) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 코드가 아니거나 인라인 기준을 넘는 위젯을 sandbox srcdoc iframe 안에서 1단계와 같은 API(`WidgetApi`)로 돌리고(높이·포커스 아웃·테마·언어·전체 화면·Esc·`Mod+S`), 큰 상태를 노트 첨부인 데이터 파일(`state.file`)에 두어 첨부 교체 규칙으로 쓰며(모아 쓰기·비우기·충돌 사본·파일 없음·이력 보기), `state.file` 을 첨부 링크로 쳐 이동·삭제 확인·깨진 링크에 잡히게 하고, 내장 위젯 Excalidraw 를 그 위에 올린다.

**Architecture:** iframe 은 `sandbox="allow-scripts"` + `srcdoc` 하나다. srcdoc 은 부모 CSP 를 물려받으므로 **부모 CSP(서버 `APP_CSP`, Tauri `security.csp`)의 `script-src` 에 고정 부트스트랩의 해시와 `blob:` 을 더하고**, srcdoc 안 meta CSP 가 `default-src 'none'` 으로 다시 좁힌다. iframe 은 URL 로 아무것도 받지 않는다 — 부모가 코드 글(런타임 → 위젯)·CSS·글꼴 바이트를 `postMessage` 로 건네고, 부트스트랩이 그것을 iframe 안에서 `blob:` 스크립트로 실행한다(서비스 워커가 샌드박스 iframe 요청을 보지 못하므로 이 길만 오프라인·기기 볼트·데스크톱에서 같이 돈다 — 아래 「CSP 실험」). 메시지 다리는 DOM 없는 두 반쪽이다: iframe 안 `frame/runtime.ts`(메시지 → `WidgetApi`)와 부모 `frame/host.ts`(메시지 → 1단계 `WidgetSession`·데이터 파일). DOM 접착은 `frame/mountFrame.ts` 하나. 데이터 파일 쓰기는 경로마다 하나인 `DataFileWriter`(DOM 없음)가 모아 쓰고 비운다. iframe 에 싣는 코드(런타임·Excalidraw·개발용 D-day)는 vite 플러그인이 중첩 빌드로 IIFE 한 파일씩 만들어 `/widget-frame/` 에 내고, 처음 쓸 때 부모가 받는다.

**Tech Stack:** TypeScript, 1단계 위젯 런타임(`web/src/widgets/*`), `postMessage`·`ResizeObserver`·Popover API(`popover="manual"`), WebCrypto(`crypto.subtle.digest`), vite 8(rolldown) 중첩 `build()`(`write: false`, `format: "iife"`), `@excalidraw/excalidraw` **0.18.1**(MIT) + 그 안의 React 19, vitest(Node — DOM 없음), Playwright chromium·webkit(브라우저 확인).

**Spec:** `docs/superpowers/specs/2026-11-09-keyring-widget-design.md` — 이 계획은 그 문서의 「단계」 2단계와 「데이터 파일(큰 상태)」 절을 다룬다. 실행자는 둘 다 읽는다. 둘이 다르면 설계 문서가 원본이고, 다르다는 것을 보고한다. 1단계 계획 `docs/superpowers/plans/2026-11-09-keyring-widget-phase1.md` 와 `docs/ops/ux.md` 「keyring-widget 1단계 구현」 의 정한 것(포커스 아웃 마이크로태스크 판정, 수정 필드의 시작 상태·호스트 등)은 그대로 이어진다.

## CSP 실험 (계획 단계, 2026-11-09 — 실험 코드는 커밋하지 않았다)

부모 페이지에 서버 `APP_CSP` 와 같은 헤더(`default-src 'self'; script-src 'self'; … frame-ancestors 'none'`)를 걸고 `sandbox="allow-scripts"` iframe 을 여러 방식으로 띄워 iframe 안 스크립트가 도는지, 부모 DOM·`localStorage`·쿠키·`fetch` 에 닿는지 쟀다. 엔진: Chromium(Playwright chromium 1234), WebKit(Playwright webkit 2370). 두 엔진의 결과가 같았다.

| 방식 | 결과 |
| --- | --- |
| srcdoc + 인라인 `<script>` | 막힘 — srcdoc 이 부모 CSP(`script-src 'self'`)를 물려받는다 |
| srcdoc + 인라인, 부모 `script-src` 에 그 스크립트 해시 | 돈다. 그러나 iframe 안 `eval`·`blob:` 스크립트는 막힘 |
| srcdoc + 인라인, 부모 `script-src` 에 해시 + `blob:`, srcdoc meta CSP `default-src 'none'; script-src '<해시>' blob:` | **돈다. 부모가 건넨 코드 글을 iframe 안에서 `blob:` 스크립트로 실행** — 부모 DOM·`localStorage`·쿠키 막힘, `self.origin` `"null"`, `fetch` 막힘(CSP) |
| srcdoc + `<script src="/boot.js">`(같은 출처, classic) | 돈다(‘self’ 는 부모 출처) — 단 아래 SW 우회 때문에 오프라인에서 못 받는다. `type="module"` 은 막힘(출처 `null` 의 CORS) |
| `src="/frame.html"`(자체 CSP 헤더) | 돈다, 자체 CSP 가 `eval`·`blob:` 허용 가능. 응답에 `frame-ancestors 'self'` 가 있으면 `x-frame-options: DENY` 를 이긴다 |
| 부모 서비스 워커가 있을 때 iframe 문서(`src`)·srcdoc 안 하위 요청 | **두 엔진 모두 SW 를 타지 않는다**(부모는 SW 가 제어 중임을 확인) — 샌드박스(불투명 출처) iframe 은 SW 밖이다 |
| 위 3행 방식으로 `@excalidraw/excalidraw` 0.18.1 IIFE(esbuild, 4.96MB / gzip 1,594,666 B, mermaid 변환 뺌) | 두 엔진 모두 뜬다(캔버스 2, API 객체). 글꼴은 CSS `url()`·CDN(`esm.sh`) 요청이 CSP 에 막힘 → 부모가 건넨 woff2 바이트로 `new FontFace(name, ArrayBuffer)` 하면 두 엔진 모두 통과(`document.fonts.check("28px Excalifont")` true) |

**고른 방법(사용자 결정, 코디네이터 경유 2026-11-09):** 3행. 서버 `APP_CSP` 와 `app/src-tauri/tauri.conf.json` 의 `security.csp` 의 `script-src` 에 `'<부트스트랩 해시>' blob:` 을 더한다. **부트스트랩 글이 바뀌면 해시가 어긋나 시험이 떨어지게 한다**(Task 3). 근거: `src` 방식은 SW 를 못 타 오프라인 PWA·오프라인 기기 볼트에서 열리지 않고, 데스크톱 앱은 Tauri 가 HTML 응답마다 앱 CSP 를 붙여 iframe 문서의 자체 CSP 를 쓸 수 없다. srcdoc 방식은 iframe 이 네트워크를 전혀 쓰지 않아 출처 체계(`tauri://`·`http://`)와 SW 에 기대지 않는다. 위험: 앱 페이지에 HTML 주입이 생겨도 `blob:` 주소는 스크립트 없이 만들 수 없는 무작위 UUID 라 낮다. Tauri 커스텀 스킴(`tauri://localhost`)의 실제 WKWebView 는 이 실험에 없었다 — Task 11 에서 데스크톱 앱으로 확인한다.

## 코디네이터 답과 이 계획의 판단

- **CSP(사용자 결정):** 위 「고른 방법」.
- **해시 충돌 때(코디네이터 결정 — 노트 동기화의 「충돌 사본」 관례):** 위젯이 들고 있던 바이트를 같은 폴더에 새 첨부로 올린다. 이름은 노트 충돌 사본 규칙 `conflictCopyPath`(볼트 언어 `vaultText().conflictCopy`, 예 `스케치-3f9a (충돌 사본 20261109-0905).excalidraw.json`), 알림에 그 경로를 보이고 원본을 다시 읽는다. 블록은 원본을 계속 가리킨다.
- **정한 것(워커):**
  - 데이터 파일은 인라인·iframe 어느 위젯이든 정의에 `dataFile` 이 있으면 쓴다(호스트 공통). 정의를 `dataFile?: { ext: string; initial(): Uint8Array; name?: Record<string, string> }` 로 넓힌다 — 서버가 빈 첨부를 거절(`file_empty`)하므로 처음 내용이 필요하고, 파일 이름 앞부분(`<위젯 이름>`)은 `name[볼트 언어] ?? title[볼트 언어] ?? title.en`. 이름 = `<앞부분>-<무작위 16진 4자리><ext>`, 같은 이름이 있으면(409) 무작위를 바꿔 50번까지.
  - `state.file` 의 정규형 = `normalizeVaultPath(file) === file`(이미 정규형인 볼트 상대 경로, `..`·절대·숨김·빈 칸·백슬래시 없음)이고 `ext` 로 끝난다(대소문자 무시). 아니면 「데이터 파일 경로가 올바르지 않습니다」 + 원문, 파일 API 없음.
  - core 의 링크 처리(`rewriteLinks` 와 그것을 쓰는 `linkingDocs`, `analyze().links`)는 **어느 `keyring-widget` 펜스든** `state.file` 을 본다(위젯 정의는 web 에 있어 core 는 모른다 — `state.file` 은 데이터 파일 위젯이 쓰는 예약 이름으로 친다). 펜스 판정은 `rewriteLinks` 의 지금 펜스 규칙(0~3칸 들여쓰기, 닫힌 것)이라 1단계의 「최상위 펜스만 위젯」 보다 넓다 — 목록 안 블록의 경로도 고쳐진다(놓치면 조용히 파일을 잃고, 넓게 잡아 손해 보는 경우는 없다). 고칠 때는 본문을 다시 직렬화하지 않고 `"file": "<값>"` 문자열 하나만 바꾼다(들여쓰기·사람이 쓴 모양 보존).
  - 데이터 파일 쓰기가 충돌로 끝날 때와 **쓰는 중 파일이 없어졌을 때(404)도** 같은 충돌 사본을 둔다(그린 것을 잃지 않게).
  - 같은 파일을 두 위젯(같은 노트 두 칸, 두 노트)이 열면 쓰기 담당은 경로마다 하나(`DataFileWriter`)이고, **위젯마다 자기가 마지막으로 읽거나 쓴 해시**를 기준으로 삼는다 — 다른 위젯이 먼저 쓴 뒤 옛 기준으로 쓰면 충돌(덮어쓰지 않음, 사본). 한 위젯이 쓰면 그 파일을 연 다른 위젯 중 쓰지 않은 것이 있는 위젯은 다시 읽는다.
  - 자동 저장 끔: 비우기는 `Mod+S`(앱 「저장」 명령)와 창 닫기 「저장하고 닫기」만. 위젯이 사라져도(탭 닫기·노트 바꾸기) 쓰지 않은 바이트는 그 경로의 writer 에 남아 「저장하지 않은 그림」 으로 남고, 다시 열면 그 바이트를 읽는다. 자동 저장 켬: 위젯 포커스 아웃·사라짐·`visibilitychange`(hidden)·창 닫기 때 비운다.
  - 전체 화면은 iframe 을 옮기지 않고 위젯 감싸개에 `popover="manual"` + `showPopover()`(top layer)로 한다 — DOM 에서 iframe 을 옮기면 엔진이 문서를 다시 불러오고, `position: fixed` 는 조상의 `transform`·`contain` 에 갇힐 수 있다. `WidgetContext` 에 `fullscreen?: boolean` 을 더한다(위젯이 높이를 정하게). 전체 화면 단추는 위젯 머리(호스트 몫)에 `display: block` 위젯만.
  - Esc 순서: iframe 안에서 위젯이 `preventDefault` 하지 않은 Esc(조합 중 아님 — 1단계 `widgetKeyAction`) → 부모로. 부모는 **전체 화면이면 닫기만**, 아니면 `session.escape()`(수정 중이면 초안 버림).
  - iframe 이 부모로 넘기는 키는 Esc 와 `Mod+S` 둘뿐이다(다른 앱 단축키는 iframe 안에서 먹지 않는다 — 문서에 적는다).
  - 높이 상한: 전체 화면이 아니면 `floor(window.innerHeight * 0.8)`, 아래 한도 48px(불러오는 동안).
  - 제3자 위젯 자리: `WidgetEntry` 를 인라인(`load`)과 iframe(`frame(): Promise<FrameCode>`, 코드 원천 = URL 또는 글)으로 가른다. `messages` 는 앱 메시지 앞머리(내장) 또는 언어별 표(`Record<lang, Record<key, text>>` — 제3자). `builtIn: false` 는 iframe·표만 받는다. 설치·받기는 만들지 않는다(설계 non-goal).
  - iframe 안 `api.t` 는 core `lookup` 그대로(복수형 `key#one` 포함) — 부모가 언어 사슬(`{ messages, locale }[]`)을 앞머리를 떼어 보낸다.
  - Excalidraw: `@excalidraw/mermaid-to-excalidraw` 를 빈 모듈로 바꿔 싣지 않는다(gzip 약 1MB 절감 — 실험 2,583,721 → 1,594,666 B). 글꼴은 Xiaolai(CJK, 209개 13MB)를 빼고 나머지(약 480KB)를 바이트로 건넨다 — 한글은 시스템 글꼴로 보인다. 위젯 UI 글꼴(Assistant)은 빌드에서 CSS 안 `data:` 로 바꾼다. 처음 그리는 높이 480px, 전체 화면이면 100%. 파일 이름 앞부분 `{ en: "sketch", ko: "스케치" }`, 이름 `{ en: "Excalidraw sketch", ko: "Excalidraw 스케치" }`. 묶음 크기 상한 gzip **2,097,152 B**(넘으면 빌드 실패), 런타임 상한 gzip **20,480 B**.
  - 개발 빌드(`import.meta.env.DEV`)에서만 `keyring/dday-frame`(D-day 를 iframe 으로)을 등록해 두 연결을 브라우저에서도 견준다. 배포 빌드에는 없다.
- **구현자 몫:** 메시지 이름 외의 세부 문구, 위젯 머리(전체 화면·저장 안 함 표시·충돌 알림) 모양, Excalidraw 의 테마 판정(`ctx.theme["--bg"]` 밝기)·언어 코드 대응(`ko` → `ko-KR`)·`UIOptions`(불러오기·파일 저장 숨김), 개발 서버에서 iframe 묶음을 내는 방법(같은 중첩 빌드를 미들웨어로).

## Global Constraints

- iframe: `sandbox="allow-scripts"` 만(**`allow-same-origin`·`allow-popups`·`allow-forms` 없음**), `srcdoc` 만(`src` 없음), `allow` 속성 없음. srcdoc 안 meta CSP 는 정확히 `default-src 'none'; script-src <해시> blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`.
- iframe 은 URL 로 아무것도 받지 않는다(코드·CSS·글꼴은 부모가 건넨다). CDN 금지 — 기기 볼트·데스크톱 앱·오프라인에서 돈다.
- 부모가 받는 메시지는 **자기가 만든 iframe 의 `contentWindow` 에서 온 것**이고 `kw === "kw1"`, `id === 그 인스턴스 id`, 모양 검사(`parseFrameMsg`)를 통과한 것만. iframe 쪽도 `e.source === parent` 인 것만.
- 부모 CSP: 서버 `APP_CSP` 와 `tauri.conf.json` `security.csp` 의 `script-src` 가 `'self' <WIDGET_FRAME_SCRIPT_HASH> blob:` 을 담는다. 다른 지시어는 바꾸지 않는다.
- 데이터 파일 쓰기 = 첨부 교체 API 하나(`api.replaceAttachment(path, blob, baseHash)` — 서버 `PUT /api/attachment?path=&baseHash=`, 기기 볼트 `vault.replaceFile` 해시 검사). 새 파일 = `api.uploadAttachment`. 읽기 = `api.readBytes` + `sha256Hex`. 노트 실행 취소에 들어가지 않는다. **덮어쓰지 않는다**(409 → 사본).
- 블록은 1단계 규칙 그대로 — 데이터 파일 위젯의 그림 변경은 블록을 바꾸지 않는다(`state.file` 만 있다).
- 자동 저장 설정은 `getPrefs().autosave`·`autosaveDelay`(기본 1500ms, 300~60000) 를 노트와 같이 쓴다.
- 화면 글은 `packages/core/src/messages/{en,ko}.json`, 키 앞머리 `kw.`, 알파벳 자리에 손으로, en·ko 같은 키(`packages/core/test/i18n.test.ts`).
- 새 의존성은 `@excalidraw/excalidraw` 0.18.1(정확한 판, web `dependencies`) 하나. 라이선스 고지는 `docs/guides/development.md` 「의존성과 라이선스 고지」 를 따른다 — iframe 묶음의 모듈도 `licenses.txt` 에 들어간다.
- 시험은 Node(vitest, DOM 없음). DOM 이 필요한 판단은 순수 함수로 떼어 시험하고 접착은 Task 11 브라우저 확인. web 의 tsconfig 에는 node 타입이 없다(해시는 `crypto.subtle`, 파일은 `?raw`).
- 시험 명령: core `cd packages/core && pnpm exec vitest run`(지금 256건), web `cd web && pnpm exec vitest run`(지금 799건), server `pnpm --filter @keyring-notes/server test`(지금 239건). 루트 `pnpm test` 는 첫 실패 패키지에서 멈춘다 — 떨어지면 패키지별로. 실행 개수가 늘었는지 본다.
- 커밋 메시지는 한국어(`feat(core): …`·`feat(web): …`·`feat(server): …`), 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 파일은 경로로 stage. `docs/ops/ux.md` 는 고치지 않는다.

## Review Focus

1. **미리보기 칸에서 그리는 중에 다른 칸·동기화가 노트를 고침** — 미리보기 HTML 이 다시 그려져 iframe 이 새로 만들어진다(Live Preview 는 `updateDOM` 으로 지킨다). 옛 위젯의 쓰지 않은 바이트는 사라지기 전에 writer 로 넘어가 비워지고(자동 저장 켬) 또는 남으며(끔), 새 iframe 은 그 바이트를 읽어 그린 것이 사라지지 않는다. Excalidraw 의 자체 실행 취소 기록은 잃는다(문서에 적는다). (Task 4: writer 가 위젯보다 오래 산다, Task 9: 사라질 때 넘김, Task 11 확인)
2. **창·앱 닫기, 탭 닫기, 노트 바꾸기 직전 1.5초 안에 그은 획** — 자동 저장 켬이면 비워져 파일에 남고, 끔이면 닫기 물음에 「저장하지 않은 그림」 이 들고 「저장하고 닫기」 가 쓴다. 데스크톱 앱(WKWebView)은 `beforeunload` 가 없어 닫기 지킴이 유일한 길이다. (Task 4: `flushAll`·`unsavedPaths`, Task 9: `guarded`·`closeWindowSafely`, Task 11 확인)
3. **같은 그림을 두 칸에 열고 번갈아 그림** — 한쪽이 쓰면 다른 쪽은 다시 읽고, 다시 읽기 전에 그은 획이 있으면 충돌 사본으로 남는다. 조용히 덮어쓰지 않는다. (Task 4 시험)
4. **iframe 안 Excalidraw 글 상자에서 한글 조합 중 Esc·Enter, 전체 화면에서 Esc** — 조합 중 키는 부모로 가지 않고, Excalidraw 가 처리한 Esc(글 편집 끝·선택 해제)는 전체 화면을 닫지 않으며, 처리하지 않은 Esc 만 닫는다. (Task 6: 런타임 키 시험, Task 11 확인 — Chromium·WebKit)
5. **iframe 으로 포커스가 들어갈 때** — 부모 `window` 의 `blur` 가 나 노트 자동 저장(`Workspace` 의 창 blur 저장)이 돈다. 위젯 수정이 끝나거나(포커스 아웃 오판) 데이터 파일이 비워지는 일은 없어야 한다(앱 `document.activeElement` 가 그 iframe 이면 안이다). 창 전체가 포커스를 잃을 때(다른 앱으로)도 안으로 본다. (Task 8: `frameFocusInside` 시험, Task 11 확인)
6. **오프라인에서 처음 그림 위젯을 엶(SW 캐시 전)** — 「위젯을 불러오지 못했습니다」 와 원문 블록이 보이고 노트는 그대로다. 한 번 연 뒤에는 오프라인에서도 열린다(SW 의 쓸 때 캐시). (Task 7: `/widget-frame/` 이 index.html 대체를 받지 않음, Task 11 확인)
7. **iframe 안에서 `Mod+S`** — 브라우저 「페이지 저장」 이 뜨지 않고 노트 저장과 그림 비우기가 함께 돈다. (Task 6 런타임 키 시험, Task 9 연결, Task 11 확인)
8. **블록을 원문으로 고쳐 `state.file` 을 `../밖.json`·`/abs.json`·`.hidden/x.excalidraw.json`·다른 확장자로 바꿈** — 위젯은 그 경로를 읽거나 쓰지 않고 오류 한 줄과 원문을 보이며, 원래 파일도 건드리지 않는다. (Task 1 시험, Task 9)

---

### Task 1: core — 데이터 파일 경로와 위젯 블록의 파일 참조

**Files:**
- Modify: `packages/core/src/keyringWidget.ts` — 아래 셋
- Modify: `packages/core/src/sync.ts:87` — `conflictCopyPath` 에 확장자 인자
- Test: `packages/core/test/keyringWidget.test.ts`, `packages/core/test/sync.test.ts`

**Interfaces:**
- Consumes: 1단계 `parseWidgetBlock`, `normalizeVaultPath`(`paths.ts`).
- Produces:
  ```ts
  /** state.file 이 정규형 볼트 경로이고 ext 로 끝나면(대소문자 무시, ext 보다 길 때) 그 값. ext 를 빼면 정규형만 본다 */
  export function widgetDataPath(state: unknown, ext?: string): string | null;
  /** 프런트매터 밖, 닫힌 ```keyring-widget(·~~~) 펜스(0~3칸 들여쓰기 — rewriteLinks 의 펜스 규칙)의 state.file 중 정규형인 것. 문서 순서, 중복 없음 */
  export function widgetFileRefs(content: string): string[];
  /** 펜스 본문 안 `"file"\s*:\s*"<JSON 문자열>"` 중 JSON.parse 값이 from 인 것을 JSON.stringify(to) 로. 그 밖의 글자는 그대로. 없으면 null */
  export function rewriteWidgetFileRefs(body: string, from: string, to: string): { body: string; count: number } | null;
  // sync.ts
  export function conflictCopyPath(path: string, label: string, exists: (p: string) => boolean, now?: Date, ext?: string): string; // ext 기본 ".md"
  ```

- [ ] **Step 1: 실패하는 시험** — `keyringWidget.test.ts`:
  - `widgetDataPath({ file: "회의록/스케치-3f9a.excalidraw.json" }, ".excalidraw.json")` → 그 값. `".EXCALIDRAW.JSON"` 로 끝나도 값. `{ file: "../밖.excalidraw.json" }`·`"/abs.excalidraw.json"`·`".h/x.excalidraw.json"`·`"a//b.excalidraw.json"`·`"a\\b.excalidraw.json"`·`"a/b.json"`·`".excalidraw.json"`·`{ file: 1 }`·`{}`·`null`·`"x"` → null. ext 없이 `{ file: "a/b.json" }` → 그 값.
  - `widgetFileRefs`: 펜스 둘(` ```keyring-widget ` 와 `~~~keyring-widget`)·목록 안 2칸 들여쓴 펜스 하나 → 세 경로 순서대로. 같은 경로 두 번 → 하나. ` ```json ` 펜스의 `"file"`, 닫히지 않은 펜스, 깨진 JSON, `state.file` 이 정규형이 아님, 프런트매터 안 → 없음. 본문을 `"스케치.excalidraw.json"` 처럼 이스케이프로 쓴 것 → 풀린 값 `"스케치.excalidraw.json"`.
  - `rewriteWidgetFileRefs('{\n  "widget": "a/b@1",\n  "state": {"file": "x/a.excalidraw.json", "n": 1}\n}', "x/a.excalidraw.json", "y/b c.excalidraw.json")` → `count` 1, 결과는 원문에서 그 문자열만 `"y/b c.excalidraw.json"` 으로 바뀐 글(줄·들여쓰기 그대로). 이스케이프로 쓴 같은 값도 바꾼다. 값이 다르면 null.
  - `sync.test.ts`: `conflictCopyPath("a/스케치-3f9a.excalidraw.json", "충돌 사본", () => false, new Date("2026-11-09T09:05:00Z"), ".excalidraw.json")` → `"a/스케치-3f9a (충돌 사본 20261109-0905).excalidraw.json"`. `exists` 가 첫 후보에 true → `… 20261109-0905 2).excalidraw.json`. ext 를 주지 않은 기존 `.md` 경우는 그대로(기존 시험 통과).
- [ ] **Step 2: 실패 확인** — `cd packages/core && pnpm exec vitest run test/keyringWidget.test.ts test/sync.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 펜스 훑기는 `links.ts` 의 `FENCE_RE`·닫힘 규칙(같은 글자, 여는 것 이상 길이)과 같게, 본문은 여는 펜스의 들여쓰기만큼 줄 앞 공백을 걷고 `parseWidgetBlock`. `conflictCopyPath` 는 경로가 `ext` 로 끝나면(대소문자 무시) 그 앞에 ` (label stamp[ n])` 를 넣는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. `cd packages/core && pnpm exec vitest run && pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add packages/core/src/keyringWidget.ts packages/core/src/sync.ts packages/core/test/keyringWidget.test.ts packages/core/test/sync.test.ts` → `feat(core): keyring-widget 데이터 파일 경로 검사와 블록의 파일 참조`

### Task 2: core·server — `state.file` 을 첨부 링크로

**Files:**
- Modify: `packages/core/src/links.ts` — `rewriteLinks` 의 본문 펜스 처리, 빠른 거르기
- Modify: `packages/core/src/markdown.ts:463` — `analyze().links` 에 `widgetFileRefs`
- Test: `packages/core/test/links.test.ts`, `packages/core/test/local.test.ts`, `server/test/movelinks.test.ts`

**Interfaces:**
- Consumes: Task 1 `widgetFileRefs`·`rewriteWidgetFileRefs`.
- Produces: 시그니처 변화 없음. `rewriteLinks` 가 위젯 펜스 안 `state.file` 도 고치고 센다 → `linkingDocs`(첨부 삭제 확인창 「가리키는 노트」, 첨부 `backlinks`), 서버 `vault.ts` 이동, 기기 `local.ts` `updateLinks` 가 따라온다. `analyze().links` 에 경로가 들어가 `lintVault` 의 `broken_link` 와 백링크 색인에 잡힌다.

- [ ] **Step 1: 실패하는 시험** —
  - `links.test.ts`: `ctx = { moves: new Map([["x/a.excalidraw.json", "y/b.excalidraw.json"]]), before: ["n.md", "x/a.excalidraw.json"], after: ["n.md", "y/b.excalidraw.json"] }`, 노트에 위젯 블록(한 줄 꼴·여러 줄 꼴 각각) → `rewriteLinks(c, "n.md", "n.md", ctx)` 가 `count` 1, 블록의 경로만 바뀌고 나머지 글 그대로. 목록 안 펜스도 바뀐다. 같은 노트의 ` ```json ` 펜스 안 `"file": "x/a.excalidraw.json"` 은 그대로. 이동하지 않은 경로 → null. 이스케이프로 쓴 경로(빠른 거르기를 지나야 한다) → 바뀐다.
  - `linkingDocs([{ path: "n.md", content: 블록 }], "x/a.excalidraw.json", ["n.md", "x/a.excalidraw.json"])` → `[{ path: "n.md", count: 1 }]`.
  - `analyze("n.md", 블록).links` 에 `"x/a.excalidraw.json"`. `lintVault` 에 `files` 가 그 경로를 빼면 `broken_link`(`target` 그 경로), 넣으면 없음.
  - `local.test.ts`: `LocalVault` 에 노트와 첨부를 두고 첨부를 `move` → 노트 블록의 경로가 새 경로, `backlinks(첨부)` 에 그 노트.
  - `movelinks.test.ts`: 서버 `/api/move` 로 첨부 이동 → 같은 커밋에서 노트의 블록 경로가 바뀐다(`git log -1 --format=%b` 에 「링크 갱신: <노트>」).
- [ ] **Step 2: 실패 확인** — core 두 파일, `pnpm --filter @keyring-notes/server exec vitest run test/movelinks.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `rewriteLinks` 의 본문 루프에서 정보 문자열 첫 낱말이 `keyring-widget` 인 펜스는 닫힐 때까지 줄을 모아, 그 펜스의 참조 `r0` 마다 `before` 에 있고 `expected = moves.get(r0) ?? r0` 가 `r0` 와 다르며 `after` 에 있으면 `rewriteWidgetFileRefs` 로 고치고 센다(펜스 안 글은 여전히 위키링크로 보지 않는다). 빠른 거르기는 본문에 `keyring-widget` 이 있으면 지나간다. `analyze` 는 `[...new Set([...wikilinkTargets(content), ...widgetFileRefs(content)])]`.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. core 전체·server 전체·`pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add packages/core/src/links.ts packages/core/src/markdown.ts packages/core/test/links.test.ts packages/core/test/local.test.ts server/test/movelinks.test.ts` → `feat(core): keyring-widget 의 state.file 을 첨부 링크로 친다(이동·가리키는 노트·깨진 링크)`

### Task 3: CSP — 부트스트랩 해시를 부모 CSP 에, 어긋나면 시험이 떨어진다

**Files:**
- Create: `packages/core/src/widgetFrame.ts`(해시 상수), `web/src/widgets/frame/bootstrap.ts`(부트스트랩 글·srcdoc)
- Modify: `packages/core/src/index.ts`(export), `server/src/app.ts:59`(`APP_CSP` 의 `script-src`), `app/src-tauri/tauri.conf.json:29`(`csp` 의 `script-src`)
- Test: `web/src/widgets/frame/bootstrap.test.ts`, `server/test/admin.test.ts`(「허용 호스트·보안 헤더·헬스체크」 에 단언 추가)

**Interfaces:**
- Produces:
  ```ts
  // core widgetFrame.ts
  export const WIDGET_FRAME_SCRIPT_HASH: string;   // "'sha256-<base64>'" — FRAME_BOOTSTRAP 의 해시. 바꾸면 시험이 알린다
  // web frame/bootstrap.ts
  export const FRAME_BOOTSTRAP: string;  // srcdoc 안 인라인 스크립트(아래 동작)
  export function frameSrcdoc(): string; // `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="…">` + `<script>${FRAME_BOOTSTRAP}</script></head><body></body></html>`
  export const FRAME_META_CSP: string;   // Global Constraints 의 meta CSP 글(해시 자리에 WIDGET_FRAME_SCRIPT_HASH)
  ```
  부트스트랩 동작(이것만): `message` 중 `e.source === parent` 이고 `{ kw: "kw1", type: "load", code: string }` 인 것을 `URL.createObjectURL(new Blob([code], { type: "text/javascript" }))` 의 `<script>` 로 `head` 에 붙인다(붙인 순서대로 실행 — `async = false`). 시작하자마자 `parent.postMessage({ kw: "kw1", type: "ready" }, "*")`. 다른 것은 하지 않는다 — 나머지는 런타임(Task 6)이 받는다.

- [ ] **Step 1: 실패하는 시험** — `bootstrap.test.ts`:
  - `"'sha256-" + base64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(FRAME_BOOTSTRAP))) + "'"` === `WIDGET_FRAME_SCRIPT_HASH`. 실패 메시지에 「부트스트랩이 바뀌었다 — 새 해시를 core widgetFrame.ts 와 tauri.conf.json 에 넣는다」 와 새 해시를 찍는다.
  - `import conf from "../../../../app/src-tauri/tauri.conf.json?raw"` → `JSON.parse(conf).app.security.csp` 의 `script-src` 지시어 낱말에 `'self'`·`WIDGET_FRAME_SCRIPT_HASH`·`blob:` 이 있다. 다른 지시어(`default-src`·`connect-src`·`img-src`·…)는 지금 값 그대로(문자열 비교).
  - `frameSrcdoc()` 가 `FRAME_META_CSP` 를 meta 로, `FRAME_BOOTSTRAP` 을 `<script>` 하나로 담고 다른 `<script>` 가 없다. `FRAME_META_CSP` 가 Global Constraints 의 글과 같다.
  - `admin.test.ts`: 앱 응답 CSP 의 `script-src` 에 `WIDGET_FRAME_SCRIPT_HASH` 와 `blob:`, `frame-ancestors 'none'` 은 그대로.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/frame/bootstrap.test.ts`, server `admin.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 부트스트랩을 쓰고 시험이 찍은 해시를 core 상수와 `tauri.conf.json` 에 넣는다. `APP_CSP` 는 core 상수로 만든다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. core·server·web 전체, `pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add packages/core/src/widgetFrame.ts packages/core/src/index.ts web/src/widgets/frame/bootstrap.ts web/src/widgets/frame/bootstrap.test.ts server/src/app.ts server/test/admin.test.ts app/src-tauri/tauri.conf.json` → `feat: keyring-widget iframe 부트스트랩과 앱 CSP(해시·blob:)`

### Task 4: web — 데이터 파일 쓰기(`DataFileWriter`)

**Files:**
- Create: `web/src/widgets/dataFile.ts`
- Test: `web/src/widgets/dataFile.test.ts`

**Interfaces:**
- Consumes: Task 1 `conflictCopyPath`(ext 인자), core `sha256Hex`.
- Produces:
  ```ts
  export interface DataFileIO {
    read(path: string): Promise<Uint8Array>;                                     // 없으면 DataFileError("missing")
    replace(path: string, bytes: Uint8Array, baseHash: string): Promise<{ hash: string | null }>; // 409 → "conflict", 404 → "missing"
    create(path: string, bytes: Uint8Array): Promise<string>;                    // 만든 경로. 이미 있으면 "exists"
  }
  export class DataFileError extends Error { constructor(readonly code: "missing" | "conflict" | "exists" | "failed") }
  export interface DataFileStatus { saving: boolean; unsaved: boolean; conflictCopy: string | null; error: "missing" | "failed" | null }
  export interface DataFileHandle {             // 위젯 하나가 쥐는 것
    read(): Promise<{ bytes: Uint8Array; hash: string }>;   // writer 에 쓰지 않은 바이트가 있으면 그것(hash 는 마지막으로 쓴 해시)
    write(bytes: Uint8Array, baseHash: string): Promise<{ hash: string }>; // 모아 쓰고 그 쓰기가 끝나면 풀린다
    onStatus(cb: (s: DataFileStatus) => void): () => void;
    onStale(cb: () => void): () => void;       // 다른 핸들이 썼다 — 이 핸들은 다시 읽어야 한다
    release(): void;                           // 위젯이 사라짐: 자동 저장 켬이면 바로 비우기
  }
  export interface DataFileOptions { autosave(): boolean; delay(): number; conflictLabel(): string; now?(): Date; timers?: { set(fn: () => void, ms: number): unknown; clear(t: unknown): void } }
  export function openDataFile(path: string, ext: string, io: DataFileIO, opts: DataFileOptions): DataFileHandle;
  export function flushDataFiles(): Promise<boolean>;  // 쓰지 않은 것 전부 지금(자동 저장 설정 무관 — Mod+S·닫기). 다 썼으면 true
  export function unsavedDataFiles(): string[];        // 쓰지 않은 바이트가 남은 경로
  export function createDataFile(io: DataFileIO, dir: string, stem: string, ext: string, initial: Uint8Array, rand?: () => string): Promise<string>;
  export function dataFileStem(name: string): string;  // uploadFiles 와 같은 글자 거르기([\\/:*?"<>|#^[\]] → 공백, trim)
  export function resetDataFilesForTest(): void;
  ```
  규칙: 경로마다 writer 하나(모듈 표), 핸들이 없고 쓰지 않은 바이트도 없으면 표에서 지운다. 핸들마다 `base`(자기가 마지막으로 읽거나 쓴 해시). `write` 는 `baseHash === handle.base` 이고 `handle.base === writer.head`(마지막으로 내려앉은 해시)일 때만 받는다 — 아니면 그 바이트로 충돌 사본을 만들고 `DataFileError("conflict")`. 받은 바이트는 `pending` 하나로 모은다(마지막 것만). 자동 저장 켬이면 `write` 마다 타이머를 `delay()` 로 다시 걸고, 끔이면 걸지 않고 `unsaved` 만. 한 번에 쓰기 하나 — 쓰는 중에 온 것은 다음 `pending`. 내려앉으면 `head`·쓴 핸들의 `base` 를 새 해시(`hash ?? sha256Hex(bytes)`)로, 기다리던 약속을 그 해시로 풀고, 다른 핸들에 `onStale`. 409·404 → 충돌 사본 `create(conflictCopyPath(path, conflictLabel(), 써 본 이름에 있음, now(), ext), pending)`(이미 있으면 다음 이름) → `status.conflictCopy`, 기다리던 약속은 `"conflict"`/`"missing"` 으로 거절, `pending` 비움.

- [ ] **Step 1: 실패하는 시험** — 가짜 `io`(호출을 적고, 해시는 `sha256Hex`), 가짜 타이머:
  - 자동 저장 켬, 지연 1500: `read` → `write(b1, h0)`·`write(b2, h0)` → 1499ms 에 `replace` 없음, 1500ms 에 `replace(path, b2, h0)` 한 번, 두 약속 모두 `{ hash: h(b2) }`. 그 뒤 `write(b3, h(b2))` 는 받는다, `write(b4, h0)` 은 `"conflict"`.
  - 쓰는 중(`replace` 가 아직 안 풀림)에 `write(b3, h0)` → 받고, 첫 쓰기가 끝난 뒤 `replace(path, b3, h(b2))`.
  - 끔: `write` 뒤 아무리 지나도 `replace` 없음, `status.unsaved` true, `unsavedDataFiles()` 에 경로. `release()` 뒤에도 남는다. 같은 경로를 다시 `openDataFile` → `read()` 가 그 바이트. `flushDataFiles()` → `replace` 한 번, true, `unsaved` false.
  - 켬: `release()` → 바로 `replace`(타이머를 기다리지 않음). 핸들이 없고 쓴 것이 끝나면 표에서 빠진다(`unsavedDataFiles()` 빈 배열).
  - `replace` 가 409: `create` 가 `"a/x (충돌 사본 20261109-0905).excalidraw.json"` 과 쓰지 않은 바이트로 불림, `status.conflictCopy` 그 경로, 약속 `"conflict"`. 첫 이름이 `"exists"` 면 ` 2)` 이름. 404 → 같은 사본, `"missing"`.
  - 두 핸들 A·B: 둘 다 `read`(h0). A 가 쓰고 내려앉음 → B 의 `onStale` 한 번. B 가 `write(bb, h0)` → `replace` 없이 사본 `create`, `"conflict"`.
  - `read` 가 없는 파일 → `"missing"`.
  - `createDataFile(io, "회의록/_첨부", "스케치", ".excalidraw.json", init, 차례로 "3f9a","0001")` → 첫 `create` 가 `"exists"` 면 `"회의록/_첨부/스케치-0001.excalidraw.json"`. `dataFileStem("a/b:c")` → `"a b c"`.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/dataFile.test.ts` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, web 전체·`pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add web/src/widgets/dataFile.ts web/src/widgets/dataFile.test.ts` → `feat(web): keyring-widget 데이터 파일 쓰기 — 모아 쓰기·비우기·충돌 사본`

> **── 검문 1 (Task 1–4): core 링크·경로, 앱 CSP, 데이터 파일 쓰기 규칙. 화면 변화 없음 — 시험과 코드 리뷰로 본다. 여기서 CSP 해시 강제(Task 3)와 덮어쓰지 않음(Task 4)을 특히 본다. ──**

### Task 5: web — 레지스트리를 iframe 위젯으로 넓힌다(코드 원천·제3자 글 자리)

**Files:**
- Modify: `web/src/widgets/types.ts`(`dataFile` 모양, `WidgetContext.fullscreen?`), `web/src/widgets/registry.ts`, `web/src/i18n.ts`(`messageChain()`)
- Create: `web/src/widgets/messages.ts`, `web/src/widgets/frame/protocol.ts`
- Test: `web/src/widgets/registry.test.ts`, `web/src/widgets/messages.test.ts`, `web/src/widgets/frame/protocol.test.ts`

**Interfaces:**
- Consumes: 1단계 레지스트리, core `lookup`.
- Produces:
  ```ts
  // types.ts
  dataFile?: { ext: string; initial(): Uint8Array; name?: Record<string, string> };
  // WidgetContext 에 fullscreen?: boolean
  // registry.ts
  export type WidgetMessageTable = Record<string, Record<string, string>>;      // 언어 → 키 → 글(키는 앞머리 없이, 복수형 "key#one")
  export type FrameCode = { kind: "url"; js: string; css?: string; fonts?: Record<string, string> } | { kind: "text"; js: string; css?: string };
  interface EntryBase { def: WidgetDefinition; builtIn: boolean; messages: string | WidgetMessageTable }
  export interface InlineWidgetEntry extends EntryBase { load(): Promise<{ render: WidgetRender }> }
  export interface FrameWidgetEntry extends EntryBase { frame(): Promise<FrameCode> }
  export type WidgetEntry = InlineWidgetEntry | FrameWidgetEntry;
  export function isFrameEntry(e: WidgetEntry): e is FrameWidgetEntry;
  // registerWidget: 같은 id → throw / effectiveIsolation 이 frame 인데 frame() 없음 → throw / inline 인데 load 없음 → throw /
  //   builtIn false 인데 messages 가 앞머리 글 → throw / dataFile.ext 가 "." 로 시작하지 않음 → throw. (1단계의 「frame 거부」 는 지운다)
  // messages.ts
  export type MessageChain = { messages: Record<string, string>; locale: string }[];
  export function widgetMessages(entry: WidgetEntry, lang: string): MessageChain; // 앞머리: messageChain() 의 각 단계에서 `${prefix}.` 키만, 앞머리를 뗀다. 표: [표[lang], 표[lang 의 앞 낱말], 표.en] 중 있는 것
  export function widgetT(chain: MessageChain, key: string, vars?: object): string; // core lookup
  // i18n.ts
  export function messageChain(): MessageChain;   // 지금 화면 언어 사슬(lookup 이 쓰는 것)
  // frame/protocol.ts
  export const KW = "kw1";
  export type HostMsg =
    | { kw: "kw1"; type: "load"; code: string }
    | { kw: "kw1"; id: string; type: "init"; ctx: WidgetContext; messages: MessageChain; css: string; fonts: Record<string, ArrayBuffer>; file: boolean; fullscreen: boolean }
    | { kw: "kw1"; id: string; type: "update"; ctx: WidgetContext; messages?: MessageChain }
    | { kw: "kw1"; id: string; type: "reply"; req: number; ok: true; value: unknown }
    | { kw: "kw1"; id: string; type: "reply"; req: number; ok: false; error: "missing" | "conflict" | "failed" | "denied" };
  export type FrameMsg =
    | { type: "ready" } | { type: "registered" } | { type: "height"; px: number }
    | { type: "setState"; patch: Record<string, unknown> } | { type: "requestEdit" } | { type: "exitEdit"; apply: boolean }
    | { type: "fileRead"; req: number } | { type: "fileWrite"; req: number; bytes: Uint8Array; baseHash: string }
    | { type: "toggleFullscreen" } | { type: "key"; key: "escape" | "save" } | { type: "blur" } | { type: "error"; message: string };
  /** kw·(ready 가 아니면) id 일치·type·필드 타입을 본다. px 는 0~100000 유한수, patch 는 배열이 아닌 객체, req 는 0 이상 정수, baseHash 는 64자 16진, message 는 500자로 자른다. 아니면 null */
  export function parseFrameMsg(data: unknown, id: string): FrameMsg | null;
  ```

- [ ] **Step 1: 실패하는 시험** —
  - `registry.test.ts`: `builtIn: false`·`isolation: "inline"`·`frame` 있음·표 → 등록되고 `effectiveIsolation` `"frame"`. `builtIn: false` + `load` 만 → throw. `builtIn: false` + `messages: "x.y"` → throw. `isolation: "frame"` + `load` 만 → throw. 내장 `frame` 위젯 등록(1단계에서는 throw 였다) → 된다. `dataFile.ext: "json"` → throw.
  - `messages.test.ts`: 표 `{ en: { a: "A {n}", "c#one": "one", "c#other": "{count} cs" }, ko: { a: "가 {n}" } }` → `widgetT(widgetMessages(e, "ko"), "a", { n: 1 })` `"가 1"`, `"c"` `{ count: 2 }` → `"2 cs"`(en 으로 내려감), 없는 키 → 키 그대로. `"ko-KR"` 도 ko 표. 앞머리 `"kw.dday"` → 사슬의 키가 `"date"` 등 앞머리 뗀 것이고 다른 앞머리 키가 섞이지 않는다.
  - `protocol.test.ts`: 맞는 메시지마다 통과, `kw` 다름·id 다름·`type` 모름·`px: NaN`/`-1`/`1e6`·`patch: []`·`req: 1.5`·`baseHash: "x"`·`bytes` 가 `Uint8Array` 아님 → null. `ready` 는 id 없이 통과.
- [ ] **Step 2: 실패 확인** — 세 파일 → FAIL.
- [ ] **Step 3: 구현** — 1단계 `mount.ts` 의 `api.t` 는 `widgetT(widgetMessages(entry, language()), …)` 로 바꾼다(앞머리 내장 위젯의 결과는 같다 — D-day 시험·화면이 그대로). 1단계 「frame 거부」 시험은 새 규칙으로 고친다.
- [ ] **Step 4: 통과 확인** — web 전체·`pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add web/src/widgets/types.ts web/src/widgets/registry.ts web/src/widgets/registry.test.ts web/src/widgets/messages.ts web/src/widgets/messages.test.ts web/src/widgets/frame/protocol.ts web/src/widgets/frame/protocol.test.ts web/src/widgets/mount.ts web/src/i18n.ts` → `feat(web): keyring-widget 레지스트리에 iframe 위젯 — 코드 원천과 위젯 글 자리`

### Task 6: web — 메시지 다리(런타임·호스트)와 두 연결 같음 시험

**Files:**
- Create: `web/src/widgets/widgetApi.ts`(인라인 API 만들기를 mount.ts 에서 뗀다), `web/src/widgets/frame/runtime.ts`(iframe 안, DOM 은 주입), `web/src/widgets/frame/host.ts`(부모)
- Modify: `web/src/widgets/mount.ts`(인라인 API 를 `bindWidgetApi` 로)
- Test: `web/src/widgets/frame/runtime.test.ts`, `web/src/widgets/frame/host.test.ts`, `web/src/widgets/frame/equivalence.test.ts`

**Interfaces:**
- Consumes: Task 5 `protocol`·`widgetT`·`MessageChain`, 1단계 `WidgetSession`·`widgetKeyAction`, Task 4 `DataFileHandle`.
- Produces:
  ```ts
  // widgetApi.ts — 인라인 연결
  export function bindWidgetApi(o: { session: WidgetSession; messages(): MessageChain; listeners: ((c: WidgetContext) => void)[];
    file: DataFileHandle | null; fullscreen: (() => void) | null }): WidgetApi;
  // frame/runtime.ts — iframe 연결의 iframe 쪽
  export interface FrameEnv {
    post(msg: FrameMsg & { kw: "kw1"; id?: string }, transfer?: Transferable[]): void;
    listen(cb: (data: unknown) => void): void;      // e.source === parent 인 것만 넘긴다(env 가 거른다)
    root: HTMLElement;                               // 위젯이 그릴 곳
    setTheme(theme: Record<string, string>): void;   // :root 에 토큰 CSS 변수
    addCss(css: string): void; setFonts(fonts: Record<string, ArrayBuffer>): void;
    observeHeight(cb: (px: number) => void): void;   // ResizeObserver(documentElement), 올림 정수, 바뀔 때만
    onKey(cb: (e: { key: string; isComposing: boolean; keyCode: number; mod: boolean; defaultPrevented: boolean; preventDefault(): void }) => void): void; // window keydown, 거품 단계
    onBlur(cb: () => void): void;
  }
  export function startFrameRuntime(env: FrameEnv): { register(render: WidgetRender): void };
  // 런타임은 self.keyringWidgetRegister = register 를 걸고(runtimeEntry, Task 7) { type: "registered" } 를 보낸다
  // frame/host.ts — iframe 연결의 부모 쪽
  export interface FrameHostOptions {
    id: string; post(msg: HostMsg, transfer?: Transferable[]): void;
    session: WidgetSession; ctx(): WidgetContext; messages(): MessageChain;
    file: DataFileHandle | null;
    fullscreen: { toggle(): void; on(): boolean; exit(): void } | null;
    height(px: number): void; blurred(): void; save(): void; failed(message: string): void;
    code: { runtime: string; widget: string; css: string; fonts: Record<string, ArrayBuffer> };
  }
  export class FrameHost {
    constructor(o: FrameHostOptions);
    receive(msg: FrameMsg): void;   // ready → load(runtime), registered 전 load(widget) 는 runtime 의 첫 메시지 뒤 — 순서: ready → load runtime → load widget → registered → init
    update(): void;                 // ctx·(언어가 바뀌었으면) messages 를 보낸다
  }
  ```
  런타임 규칙: `api.setState`·`requestEdit`·`exitEdit` 는 보내기만, 상태는 호스트 `update` 로 돌아온 `ctx` 로 `onUpdate`. `api.t` = `widgetT(받은 사슬)`. `init.file` 이면 `api.file`(req 번호로 짝, 바이트는 transfer), 아니면 없음. `init.fullscreen` 이면 `api.toggleFullscreen`. 키: `widgetKeyAction(e) === "escape"` 이고 `!defaultPrevented` → `{ key: "escape" }`. `mod && key` 가 `s`/`S` → `preventDefault()` 후 `{ key: "save" }`. 호스트 규칙: `setState` → `session.setState`, `requestEdit`·`exitEdit` 같은 이름, `fileRead`/`fileWrite` → `file` 핸들(없으면 `denied`), `key: "escape"` → 전체 화면이면 `exit()` 만, 아니면 `session.escape()`, `key: "save"` → `save()`, `height` → `height(px)`, `blur` → `blurred()`, `error` → `failed`.

- [ ] **Step 1: 실패하는 시험** —
  - `runtime.test.ts`(가짜 env): `init` 전 `register` → `registered` 한 번. `init` → `render(root, ctx, api)` 한 번, `setTheme(ctx.theme)`·`addCss`·`setFonts`. `api.t("a")` 가 받은 사슬로. `init.file: false` → `api.file` 없음. `api.file.read()` → `fileRead` req 0, `reply ok` → 풀림, `reply error "conflict"` → 거절(`.code === "conflict"`). Esc(`defaultPrevented: false`) → `{ key: "escape" }`, `defaultPrevented: true` → 없음, `isComposing: true`·`keyCode: 229` → 없음. `mod` + `"s"` → `preventDefault` 불림, `{ key: "save" }`. 높이 `observeHeight` 콜백 → `height`. 다른 `id` 의 `update` → 무시.
  - `host.test.ts`(가짜 post·세션 호스트): `ready` → `load`(runtime 글) 다음 `load`(위젯 글), `registered` → `init`(ctx·사슬·css·fonts, `file`·`fullscreen` 여부). 전체 화면 켬일 때 `key escape` → `exit` 만, 세션 수정 그대로. 끔 + 수정 중 → 초안 버림(`write` 없음). `fileWrite` 인데 `file` null → `reply ok:false error:"denied"`. `save` → `save()`.
  - `equivalence.test.ts` — **두 연결 같음**: 같은 각본을 (A) `bindWidgetApi` + `WidgetSession`, (B) `startFrameRuntime` ↔ `FrameHost`(메모리 통로: `structuredClone` 후 `queueMicrotask` 로 건넴) + `WidgetSession` 에 돌려 **세션 호스트 호출 기록(`write`·`startEdit`·`setDraft`·`endEdit`)과 위젯이 받은 `onUpdate` ctx 의 (`state`·`editing`) 차례가 같다**. 위젯은 D-day 정의(`ddayDef`, 블록 상태 `{ targetDate: "2026-12-25", label: "" }`)이고 각본은 D-day 가 하는 일 그대로: 보기에서 `requestEdit` → `setState({ targetDate: "2026-12-24" })` → `setState({ label: "가" })` → 바깥 변경(`session.external`) → `exitEdit(true)`; 다시 `requestEdit` → `setState` → Esc(B 는 런타임 키 → 호스트, A 는 `session.escape()`) ; `editable: false` 블록에서 `setState`·`requestEdit`; 바꾸지 않고 `exitEdit(true)`. 각 단계 뒤 통로를 비운다(`await` 마이크로태스크 몇 번 — 도우미 `drain()`).
- [ ] **Step 2: 실패 확인** — 세 파일 → FAIL.
- [ ] **Step 3: 구현** — `mount.ts` 의 `api` 객체를 `bindWidgetApi` 로 옮긴다(동작 그대로 — 1단계 시험과 D-day 화면이 같아야 한다).
- [ ] **Step 4: 통과 확인** — web 전체·`pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add web/src/widgets/widgetApi.ts web/src/widgets/mount.ts web/src/widgets/frame/runtime.ts web/src/widgets/frame/host.ts web/src/widgets/frame/runtime.test.ts web/src/widgets/frame/host.test.ts web/src/widgets/frame/equivalence.test.ts` → `feat(web): keyring-widget iframe 메시지 다리와 두 연결 같음 시험`

### Task 7: web·server — iframe 묶음 빌드(`/widget-frame/`)와 라이선스·SW

**Files:**
- Create: `web/frameBuild.ts`(vite 플러그인 — `licenses/plugin.ts` 처럼 설정 쪽), `web/src/widgetFrames.ts`(순수 도우미), `web/src/widgets/frame/runtimeEntry.ts`(IIFE 진입: `startFrameRuntime(domFrameEnv(self))`, `self.keyringWidgetRegister`), `web/src/widgets/frame/ddayEntry.ts`(개발용: `keyringWidgetRegister(render)` — `inline/dday.ts` 의 `render`), `web/src/virtual-widget-frames.d.ts`
- Modify: `web/vite.config.ts`(플러그인 더함), `web/licenses/plugin.ts`(`licenseNotices({ extraModules })` — 중첩 빌드 청크의 `moduleIds` 를 같은 수집에 넣는다), `web/public/sw.js`(`isHtmlForAsset` 에 `/widget-frame/`), `server/src/webApp.ts`(`/widget-frame/` 의 없는 경로는 404), `web/src/widgets/builtins.ts`(개발 빌드에서만 `keyring/dday-frame`)
- Test: `web/src/widgetFrames.test.ts`, `web/src/sw.test.ts`, `server/test/llmstxt.test.ts`(`mountWebApp` 을 다는 시험)

**Interfaces:**
- Produces:
  ```ts
  // widgetFrames.ts (순수)
  export const FRAME_DIR = "widget-frame";
  export const FRAME_RUNTIME_GZIP_LIMIT = 20480;
  export const FRAME_WIDGET_GZIP_LIMIT = 2_097_152;
  export function frameAssetName(name: string, code: string | Uint8Array, ext: string): string; // `widget-frame/${name}-${sha256 앞 8자}${ext}`
  export function inlineCssFonts(css: string, read: (rel: string) => Uint8Array | null): string; // url(...fonts/<rel>.woff2) → data:font/woff2;base64,…  못 읽으면 그대로
  export interface FrameManifestEntry { js: string; css?: string; fonts?: Record<string, string> } // 값은 "/widget-frame/…" 주소
  export function frameSizeErrors(sizes: { name: string; gzip: number }[]): string[]; // runtime 은 RUNTIME 한도, 나머지는 WIDGET 한도
  // virtual:widget-frames
  declare const frames: Record<string, FrameManifestEntry>;   // "runtime", (개발) "dday", (Task 10) "excalidraw"
  export default frames;
  // web/frameBuild.ts
  export interface FrameEntrySpec { name: string; entry: string; dev?: boolean; alias?: Record<string, string>; css?: string; fontsDir?: string; fontsSkip?: string[] }
  export function widgetFrames(entries: FrameEntrySpec[]): Plugin & { modules(): string[] };
  ```
  빌드: `buildStart` 에서 진입마다 vite `build({ configFile: false, logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' }, resolve: { conditions: 웹과 같게, alias }, build: { write: false, minify: true, rollupOptions: { input: entry, output: { format: "iife", inlineDynamicImports: true } } } })`, `generateBundle` 에서 `this.emitFile({ type: "asset", fileName: frameAssetName(…), source })`(js·`inlineCssFonts` 한 css·글꼴 파일), 크기를 `this.info` 로 찍고 `frameSizeErrors` 가 있으면 `this.error`. `virtual:widget-frames` 는 주소 표. 개발 서버(`configureServer`)는 같은 빌드를 한 번 돌려 `/widget-frame/*` 를 메모리에서 낸다. `/widget-frame/` 은 `assets/` 밖이라 SW `LAZY`(설치 때 받아 두기)에 들지 않고 처음 쓸 때 SW 가 캐시한다.

- [ ] **Step 1: 실패하는 시험** — `widgetFrames.test.ts`: `frameAssetName("runtime", "abc", ".js")` → `widget-frame/runtime-ba7816bf.js`. `inlineCssFonts('@font-face{src:url(./fonts/Assistant/A-1.woff2) format("woff2")}', 읽기)` → `data:font/woff2;base64,` 로 바뀜, 못 읽으면 그대로. `frameSizeErrors([{ name: "runtime", gzip: 20481 }, { name: "excalidraw", gzip: 2_097_152 }])` → 하나(runtime). `sw.test.ts`: `/widget-frame/x.js` 에 HTML 응답 → 캐시하지 않음. server: dist 를 단 앱에 `GET /widget-frame/없음.js` → 404, `GET /widget-frame/있음.js` → 200(임시 dist).
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현** — 위 「빌드」. `licenseNotices` 는 `extraModules: () => string[]` 를 받아 `bundlePackages` 에 더한다(묶임 검사도 같이).
- [ ] **Step 4: 통과 확인** — 시험 PASS. `cd web && pnpm build` → 출력에 `widget-frame runtime: N B gzip`, `dist/widget-frame/runtime-*.js` 있음, `dist/sw.js` 의 LAZY 에 `widget-frame` 없음, `dist/licenses.txt` 가 바뀌지 않음(런타임은 제3자 모듈이 없다 — Task 10 에서 늘어난다). 런타임 gzip 이 20480 보다 작다(넘으면 core i18n 의 메시지 JSON 이 끌려온 것 — `lookup` 만 가져오게 고친다). `FRAME_RUNTIME_GZIP_LIMIT` 를 잠시 `1` 로 → 빌드가 떨어지는지 보고 되돌린다(`git diff` 확인).
- [ ] **Step 5: web·server 전체·`pnpm typecheck`**.
- [ ] **Step 6: 커밋** — `git add web/frameBuild.ts web/src/widgetFrames.ts web/src/widgetFrames.test.ts web/src/widgets/frame/runtimeEntry.ts web/src/widgets/frame/ddayEntry.ts web/src/virtual-widget-frames.d.ts web/vite.config.ts web/licenses/plugin.ts web/public/sw.js web/src/sw.test.ts server/src/webApp.ts server/test/llmstxt.test.ts web/src/widgets/builtins.ts` → `feat(web): keyring-widget iframe 묶음 빌드(/widget-frame/)와 라이선스 수집`

### Task 8: web — iframe 호스트 DOM 접착(높이·포커스·테마·전체 화면·키)

**Files:**
- Create: `web/src/widgets/frame/mountFrame.ts`, `web/src/widgets/frame/source.ts`, `web/src/widgets/frame/layout.ts`(순수)
- Modify: `web/src/widgets/mount.ts`(위젯이면 `isFrameEntry` 로 갈라 `mountFrame`), `web/src/styles.css`(`.kw-frame`, `.kw-frame-wrap:popover-open`, `.kw-fullscreen-button`), messages — `kw.fullscreen`("Full screen"/"전체 화면"), `kw.exitFullscreen`("Exit full screen"/"전체 화면 닫기")
- Test: `web/src/widgets/frame/layout.test.ts`, `web/src/widgets/frame/source.test.ts`

**Interfaces:**
- Consumes: Task 3 `frameSrcdoc`, Task 5 `FrameCode`·`parseFrameMsg`, Task 6 `FrameHost`, Task 7 `virtual:widget-frames`.
- Produces:
  ```ts
  // layout.ts
  export const FRAME_MIN_HEIGHT = 48;
  export function frameHeight(px: number, viewport: number, fullscreen: boolean): number; // 전체 화면 = viewport, 아니면 clamp(ceil(px), 48, floor(viewport*0.8))
  /** 포커스 아웃 판정의 「안」: 앱 activeElement 가 뿌리 안(그 iframe 포함)이거나 relatedTarget 이 뿌리 안 */
  export function frameFocusInside(o: { activeInRoot: boolean; relatedInRoot: boolean }): boolean;
  // source.ts
  export function resolveFrameCode(c: FrameCode, get: { text(url: string): Promise<string>; bytes(url: string): Promise<ArrayBuffer> }): Promise<{ js: string; css: string; fonts: Record<string, ArrayBuffer> }>;
  // mountFrame.ts — mount.ts 가 부른다(세션·ctx·listeners·뿌리는 mount 가 만든 것)
  export function mountFrame(content: HTMLElement, o: { root: HTMLElement; entry: FrameWidgetEntry; session: WidgetSession; ctx(): WidgetContext;
    file: DataFileHandle | null; display: "block" | "inline"; onUpdate(cb: () => void): void; failed(): void }): { destroy(): void };
  ```
  접착: `iframe.sandbox = "allow-scripts"`, `srcdoc = frameSrcdoc()`, 인스턴스 id = `crypto.randomUUID()`. `window` `message` 는 `e.source === iframe.contentWindow` 인 것만 `parseFrameMsg(e.data, id)` → `host.receive`. 코드는 `resolveFrameCode(virtual 표의 runtime)` + `resolveFrameCode(await entry.frame())`(실패 → `failed()` → mount 의 `kw.loadFailed` + 원문). 높이 `frameHeight(px, innerHeight, fullscreen)`, `resize` 에 다시 잰다. 포커스 아웃: 뿌리 `focusout`(마이크로태스크 뒤, 1단계와 같은 길)과 `blurred()` 둘 다 `focusOutAction({ rootConnected: root.isConnected, relatedInside: frameFocusInside(…) })` 가 `"apply"` 일 때 `session.focusOut()`. 테마·언어 바뀜은 mount 의 `onUpdate` 로 `host.update()`. 전체 화면(`display: "block"` 만): 위젯 머리에 단추, 감싸개 `popover="manual"`·`showPopover()`/`hidePopover()`, 켜고 끌 때 `host.update()`(ctx.fullscreen)·높이 다시 재기, 감싸개 `keydown` Esc → `exit`. `save()` → `window.dispatchEvent(new Event("keyring:save"))`(Task 9 가 받는다). `destroy` → 리스너 떼기, iframe 지우기.

- [ ] **Step 1: 실패하는 시험** — `frameHeight(300, 1000, false)` 300, `(900, 1000, false)` 800, `(10, 1000, false)` 48, `(300.2, 1000, false)` 301, `(300, 1000, true)` 1000. `frameFocusInside` 넷. `resolveFrameCode({ kind: "text", js: "x" }, …)` → `{ js: "x", css: "", fonts: {} }`(받기 없음), `{ kind: "url", js: "/a.js", css: "/a.css", fonts: { "E/a.woff2": "/f/a.woff2" } }` → 세 번 받아 채움, 하나라도 실패 → 거절.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현** — 위 「접착」. 개발 서버에서 `keyring/dday-frame` 블록이 iframe 으로 그려지고 보기·수정·포커스 아웃 적용·Esc 버림이 인라인 D-day 와 같은지 Chromium 으로 한 번 본다(자세한 확인은 Task 11).
- [ ] **Step 4: 통과 확인** — web 전체·`pnpm typecheck`·`cd packages/core && pnpm exec vitest run test/i18n.test.ts`.
- [ ] **Step 5: 커밋** — `git add web/src/widgets/frame/mountFrame.ts web/src/widgets/frame/source.ts web/src/widgets/frame/layout.ts web/src/widgets/frame/layout.test.ts web/src/widgets/frame/source.test.ts web/src/widgets/mount.ts web/src/styles.css packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `feat(web): keyring-widget iframe 호스트 — 높이·포커스 아웃·테마·전체 화면`

> **── 검문 2 (Task 5–8): iframe 연결 전부(데이터 파일 연결 전). `keyring/dday-frame` 으로 두 연결이 같은지 시험(equivalence)과 개발 서버에서 본다. 메시지 출처 검사·Esc 순서·포커스 판정을 특히 본다. ──**

### Task 9: web — 데이터 파일을 호스트에 잇는다(넣기·이력 보기·없음·충돌·비우기 시점)

**Files:**
- Modify: `web/src/widgets/mount.ts`(정의에 `dataFile` 이 있으면 `widgetDataPath` → `openDataFile` → `bindWidgetApi`/`mountFrame` 에 핸들, 머리에 상태), `web/src/widgets/PreviewKeyringWidget.tsx`·`web/src/DocPane.tsx`(`history: !!revision` 을 넘긴다), `web/src/widgets/registry.ts`(`widgetInsertText(def, state?)`), `web/src/Workspace.tsx`(아래 연결), `web/src/styles.css`, messages — 아래
- Create: `web/src/widgets/dataFileIo.ts`(`api` 위의 `DataFileIO`)
- Test: `web/src/widgets/registry.test.ts`, `web/src/widgets/dataFileIo.test.ts`, `web/src/closeWindow.test.ts`(닫기 지킴 판정을 떼어 낸 함수)

**Interfaces:**
- Consumes: Task 1 `widgetDataPath`, Task 4 전부, Task 8 `mountFrame`.
- Produces:
  ```ts
  // MountOptions 에 history?: boolean (이력 보기 — 데이터 파일 위젯은 그리지 않는다)
  export function apiDataFileIO(a: Pick<VaultApi, "readBytes" | "replaceAttachment" | "uploadAttachment">): DataFileIO; // ApiError 409 → conflict/exists, 404·fileNotFound → missing
  export function widgetInsertText(def: WidgetDefinition, state?: unknown): string; // state 를 주면 그것으로
  // closeWindow.ts
  export function closeGuarded(o: { desktop: boolean; dirtyDocs: number; unsavedFiles: number }): boolean;
  ```
  호스트 규칙: `dataFile` 위젯이면 — `history` → 위젯 대신 `kw.historyNoFile` + 경로(파일을 읽지 않는다). `widgetDataPath(state, ext)` null → `kw.badFile` + 원문. 첫 `read` 가 `missing` → `kw.fileMissing` + 경로(만들지 않는다). 머리: 끔이고 `unsaved` → `kw.unsavedDrawing`, `conflictCopy` → 알림 `kw.fileConflict`(경로, 「열기」 동작) 후 위젯을 다시 그린다(다시 읽기). `onStale` → 쓰지 않은 것이 없으면 다시 그린다. 블록의 `state.file` 이 바뀐 바깥 변경 → 다시 그린다. 포커스 아웃(수정 끝과 같은 판정) → 켬이면 그 핸들의 writer 를 비운다. `destroy` → `release()`.
  Workspace: 「위젯 넣기」 의 `dataFile` 위젯 → `createDataFile(apiDataFileIO(api), attachmentDirFor(getVaultSettings(), wsOfPath(doc.path), uiLang), dataFileStem(name), ext, initial())` 성공 뒤 `widgetInsertText(def, { ...def.defaultState(), file })`(실패 → `toastError`, 넣지 않음), 그 뒤 `vaultChanged()`·`refreshTree()`. `save()`(Mod+S·명령)와 `keyring:save` 이벤트 → 노트 저장 + `flushDataFiles()`. `visibilitychange` hidden → (켬일 때) `flushDataFiles()`. 닫기: `guarded = closeGuarded(…)`, `closeWindowSafely` 의 `dirty` 에 `unsavedDataFiles()`, `save` 에 `flushDataFiles()`. `beforeunload` 경고에 `unsavedDataFiles()`. 옵션은 `getPrefs()`·`vaultText(vaultLang()).conflictCopy`.
  messages: `kw.historyNoFile`("Drawings are not shown in history view: {path}"/"이력 보기에서는 그림을 보이지 않습니다: {path}"), `kw.badFile`("The widget's data file path is invalid"/"위젯의 데이터 파일 경로가 올바르지 않습니다"), `kw.fileMissing`("File not found: {path}"/"파일을 찾을 수 없습니다: {path}"), `kw.unsavedDrawing`("Unsaved drawing"/"저장하지 않은 그림"), `kw.fileConflict`("This file was changed elsewhere. Your version was saved as {path}"/"다른 곳에서 이 파일이 바뀌었습니다. 고친 내용은 {path} 로 저장했습니다"), `kw.fileFailed`("Couldn't save the file"/"파일을 저장하지 못했습니다").

- [ ] **Step 1: 실패하는 시험** — `widgetInsertText(def, { file: "a/b.x.json" })` 의 본문 `state` 가 그것. `apiDataFileIO`: 가짜 api 의 `ApiError(409)` → `DataFileError("conflict")`(replace)·`("exists")`(create), `ApiError(404)` → `"missing"`, 그 밖 → `"failed"`; `replace` 는 `Blob` 으로 넘긴다. `closeGuarded({ desktop: true, dirtyDocs: 0, unsavedFiles: 1 })` true, `desktop: false` → false, 둘 다 0 → false.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현** — 위 규칙. 데이터 파일 경로와 이력 보기 판정은 `mount.ts` 한 곳에서(인라인·iframe 공통).
- [ ] **Step 4: 통과 확인** — web 전체·`pnpm typecheck`·i18n 시험. 개발 서버에서 시험용 데이터 파일 위젯(Task 10 전이면 `keyring/dday-frame` 에 잠시 `dataFile` 을 단 지역 변경 — 커밋하지 않는다) 으로 넣기·이력 보기·파일 지움을 한 번 본다.
- [ ] **Step 5: 커밋** — `git add web/src/widgets/mount.ts web/src/widgets/PreviewKeyringWidget.tsx web/src/DocPane.tsx web/src/widgets/registry.ts web/src/widgets/registry.test.ts web/src/widgets/dataFileIo.ts web/src/widgets/dataFileIo.test.ts web/src/Workspace.tsx web/src/closeWindow.ts web/src/closeWindow.test.ts web/src/styles.css packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `feat(web): keyring-widget 데이터 파일 — 넣기·이력 보기·파일 없음·충돌 사본·비우기 시점`

### Task 10: 내장 위젯 Excalidraw

**Files:**
- Modify: `web/package.json`(`"@excalidraw/excalidraw": "0.18.1"`), `pnpm-lock.yaml`, `web/vite.config.ts`(`widgetFrames` 진입 `excalidraw`: `entry` `src/widgets/excalidraw/frame.tsx`, `alias` `{ "@excalidraw/mermaid-to-excalidraw": "src/widgets/excalidraw/mermaidStub.ts" }`, `css` 패키지의 `dist/prod/index.css`, `fontsDir` `dist/prod/fonts`, `fontsSkip` `["Xiaolai"]`), `web/src/widgets/builtins.ts`, `web/licenses/manual.ts`(아래), messages — `kw.excalidraw.*`(구현자 몫)
- Create: `web/src/widgets/excalidraw/def.ts`(앱 묶음), `web/src/widgets/excalidraw/frame.tsx`(iframe 묶음), `web/src/widgets/excalidraw/fontShim.ts`, `web/src/widgets/excalidraw/scene.ts`(순수), `web/src/widgets/excalidraw/mermaidStub.ts`, `web/licenses/bundled/<글꼴>.txt`
- Test: `web/src/widgets/excalidraw/scene.test.ts`

**Interfaces:**
- Consumes: Task 5 `FrameWidgetEntry`, Task 6 런타임(`keyringWidgetRegister`), Task 7 `virtual:widget-frames`, Task 9 데이터 파일.
- Produces:
  ```ts
  // def.ts
  export const excalidrawDef: WidgetDefinition; // id "keyring/excalidraw", version 1, isolation "frame", display "block",
  //   dataFile { ext: ".excalidraw.json", initial: () => utf8(EMPTY_SCENE), name: { en: "sketch", ko: "스케치" } },
  //   defaultState: () => ({}), title { en: "Excalidraw sketch", ko: "Excalidraw 스케치" }
  // scene.ts
  export const EMPTY_SCENE: string; // {"type":"excalidraw","version":2,"source":"keyring-notes","elements":[],"appState":{},"files":{}}
  export function parseScene(bytes: Uint8Array): { elements: unknown[]; appState: object; files: object } | null; // 깨지면 null
  export function sceneChanged(prev: string | null, next: string): boolean; // 직렬화 글 비교
  // fontShim.ts — frame.tsx 의 첫 import. window.FontFace 를 감싸 src 글에 "fonts/<rel>.woff2" 가 있고 setFonts 로 받은 표에 있으면 ArrayBuffer 로 만든다
  export function installFontShim(lookup: (rel: string) => ArrayBuffer | undefined): void;
  ```
  `frame.tsx`: `window.EXCALIDRAW_ASSET_PATH = "/"`(주소는 끝내 쓰지 않는다 — 글꼴은 shim 이 바이트로). `keyringWidgetRegister(render)`: `api.file.read()` → `parseScene`(null → 위젯 안 오류 한 줄, 쓰지 않음) → `<Excalidraw initialData …>`(`viewModeEnabled = !ctx.editable || ctx.readOnly`, 테마·언어는 ctx, `UIOptions` 로 불러오기·파일 저장 숨김). `onChange` → `serializeAsJSON(elements, appState, files, "local")` 이 `sceneChanged` 면 `api.file.write(utf8(글), base)` 하고 풀린 해시를 `base` 로(거절이면 그리기를 멈추고 호스트가 다시 그리기를 기다린다). 높이: `ctx.fullscreen ? "100vh" : "480px"`. 자체 실행 취소는 Excalidraw 것.
  라이선스: `@excalidraw/excalidraw` 는 패키지에 LICENSE·author 가 없다 → `HOLDERS` 에 원저장소 LICENSE 의 저작권자(github.com/excalidraw/excalidraw `LICENSE` 를 보고 적는다). 실은 글꼴 파일마다 `kind: "bundled"`, `via: "@excalidraw/excalidraw"`, 전문 `web/licenses/bundled/`(글꼴마다 라이선스를 원저장소에서 확인 — OFL-1.1 이 많다). `dist/prod/*.js` 에 소스맵이 없으므로 미리 묶인 남의 코드가 있는지 직접 본다(가이드 「묶임 검사」).

- [ ] **Step 1: 실패하는 시험** — `parseScene(utf8(EMPTY_SCENE))` → 빈 elements, `parseScene(utf8("{"))` null, `parseScene(utf8('{"type":"x"}'))` null(type 이 excalidraw 아님). `sceneChanged(null, "a")` true, `("a", "a")` false. `excalidrawDef` 값이 위와 같고 `widgetInsertText(excalidrawDef, { file: "a/스케치-3f9a.excalidraw.json" })` 본문이 `parseWidgetBlock` ok, `widgetDataPath(그 state, ".excalidraw.json")` 가 그 경로.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현과 등록** — `registerBuiltins` 에 `{ def: excalidrawDef, builtIn: true, messages: "kw.excalidraw", frame: async () => ({ kind: "url", ...frames.excalidraw }) }`.
- [ ] **Step 4: 통과 확인** — web 전체·`pnpm typecheck`. `cd web && pnpm build` → `widget-frame excalidraw: N B gzip` 한 줄(2,097,152 보다 작다 — 실험 값 약 1.6MB), `dist/widget-frame/` 에 js·css·글꼴(Xiaolai 없음), `licenses.txt` 에 `@excalidraw/excalidraw`·`roughjs`·`jotai` 등과 글꼴 줄, 빌드가 고지 누락으로 멈추지 않는다. 인라인 크기 시험(1단계)은 그대로 D-day 만 잰다.
- [ ] **Step 5: 커밋** — `git add web/package.json pnpm-lock.yaml web/vite.config.ts web/src/widgets/excalidraw web/src/widgets/builtins.ts web/licenses/manual.ts web/licenses/bundled packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `feat(web): 내장 위젯 Excalidraw(iframe, 데이터 파일)`

### Task 11: 사용자 문서·개발 문서와 전체 확인

**Files:**
- Modify: `docs/manual/en/how-to/use-widgets.md`(원본), `docs/manual/ko/how-to/use-widgets.md` — 「노트 안 위젯」 절에 Excalidraw: 넣으면 첨부 폴더에 그림 파일이 생기고 블록에는 경로만, 그리는 대로 저장(자동 저장 간격·끔이면 「저장하지 않은 그림」 과 `Mod+S`), 전체 화면·Esc, 다른 곳에서 바뀌면 충돌 사본, 이력 보기에서는 그림이 보이지 않음(첨부 이력으로 본다), 첨부를 옮기면 블록 경로도 바뀜, 블록을 지워도 파일은 남음, 미리보기에서 다른 칸이 노트를 고치면 그림의 실행 취소 기록이 사라짐, iframe 안에서는 앱 단축키가 `Mod+S` 말고는 먹지 않음, 처음 쓸 때 내려받음(오프라인이면 한 번 연 뒤부터).
- Modify: `docs/manual/{en,ko}/reference.md` — `### keyring-widget blocks` 에 `state.file`(볼트 기준 경로, 정규형) 한 단락.
- Modify: `docs/guides/development.md` — 새 절 「위젯 iframe 과 CSP」: 위 「CSP 실험」 표 요약, 고른 방법과 근거, 부트스트랩을 고치면 `bootstrap.test.ts` 가 찍는 새 해시를 `packages/core/src/widgetFrame.ts` 와 `app/src-tauri/tauri.conf.json` 에 넣는다는 절차, `/widget-frame/` 묶음 빌드와 크기 한도.
- Modify: `CHANGELOG.md` — `[Unreleased]` `### Added` 한 줄.

- [ ] **Step 1: 문서** — 쓰기 전에 `docs/guideline/public-docs/02-manual.md`·`03-i18n.md`·`04-style.md` 를 읽는다.
- [ ] **Step 2: 루트 검증** — `pnpm test`(core 256·web 799·server 239 보다 늘었는지), `pnpm typecheck`, `pnpm build`(크기 줄), `pnpm fmt:check`, `pnpm lint`.
- [ ] **Step 3: 브라우저 확인(Chromium·WebKit 둘 다)** — 시험 서버(임시 `KEYRING_DATA`, 다른 포트, `docs/guides/development.md`)를 Chromium(neo 또는 Playwright)과 Playwright webkit 으로. 하나씩: 「위젯 넣기」 → Excalidraw → 첨부 폴더에 `스케치-xxxx.excalidraw.json`, 그리기 → 1.5초 뒤 파일 한 번 바뀜(git 커밋 수), 계속 그리면 멈춘 뒤 한 번, 전체 화면 들어가고(그리던 것 그대로 — iframe 을 다시 만들지 않음) Esc 로 닫힘, 글 상자 편집 중 Esc 는 전체 화면을 닫지 않음, 한글 글 상자 조합 중 Esc·Enter, iframe 안 `Mod+S`(페이지 저장 대화상자 없음), 자동 저장 끔 → 「저장하지 않은 그림」 → `Mod+S`, 끔 상태로 탭 닫고 다시 열기(그린 것 남음), 같은 노트 두 칸에서 번갈아 그리기(충돌 사본 알림·덮어쓰지 않음), 다른 창에서 같은 파일을 첨부 「내용 바꾸기」 뒤 이 창에서 그리기 → 충돌 사본, 첨부 이동 → 블록 경로 바뀜·위젯 그대로, 첨부 삭제 확인창의 「가리키는 노트」, 파일을 지움 → 「파일을 찾을 수 없습니다」, 블록 `state.file` 을 `../x.excalidraw.json` 으로 → 오류 한 줄, 이력 보기 → 안내와 경로, 미리보기 칸에서 그리는 중 다른 칸이 노트를 고침(그린 것 남음), 테마·언어 바꾸기, 390px·터치 그리기, `?local`(기기 볼트), 서비스 워커 오프라인(처음 열기 전 → 불러오지 못함과 원문 / 연 뒤 → 열림), `keyring/dday-frame`(개발 서버)과 인라인 D-day 의 보기·수정·포커스 아웃 적용·Esc 버림·`Mod+Z` 한 번이 같음. iframe 격리: 개발자 도구에서 iframe 문맥으로 `parent.document`·`localStorage`·`document.cookie`·`fetch("/api/tree")`·`new Image().src = "https://example.com/x"` 가 모두 막히는지.
- [ ] **Step 4: 데스크톱 앱(WKWebView, Tauri 커스텀 스킴)** — `pnpm app:dev` 로: Excalidraw 가 뜨고 그리기·저장·전체 화면이 되는지, 앱 CSP 위반 콘솔이 없는지, **iframe 문맥에서 `window.__TAURI_INTERNALS__` 가 없고 `window.webkit?.messageHandlers` 로 명령을 부를 수 없는지**(부를 수 있으면 멈추고 escalation — 격리 실패다), 창 닫기(`Mod+Q`)에 쓰지 않은 그림이 물음에 드는지. 못 보면 못 본 것으로 적는다.
- [ ] **Step 5: 띄운 서버·탭·앱을 끈다** — `띄운 것/끈 것` 줄을 보고에 적는다.
- [ ] **Step 6: 커밋** — `git add docs/manual/en/how-to/use-widgets.md docs/manual/ko/how-to/use-widgets.md docs/manual/en/reference.md docs/manual/ko/reference.md docs/guides/development.md CHANGELOG.md` → `문서: keyring-widget 2단계 — iframe 위젯·Excalidraw·데이터 파일`

> **── 검문 3 (Task 9–11): 데이터 파일 연결, Excalidraw, 문서와 엔진별 확인. Review Focus 1·2·3·6·7 을 실제 화면으로 본다. ──**

---

## 설계 항목별 대응

| 설계 항목(2단계·데이터 파일) | Task |
| --- | --- |
| iframe `sandbox="allow-scripts"`·srcdoc·iframe 안 CSP `default-src 'none'` + 해시 | 3, 8 |
| CSP — 데스크톱 `security.csp`·서버 앱 헤더, srcdoc 이 부모 CSP 를 물려받는 문제, 엔진별 확인과 문서 | 3(강제 시험), 11(WebKit 앱·문서), 위 「CSP 실험」 |
| 부트스트랩·`postMessage` 다리, 인스턴스 id, 자기 iframe 의 `contentWindow` 만 | 3, 5(`parseFrameMsg`), 6, 8 |
| 높이(`ResizeObserver`, 상한 80%) | 6(런타임), 8(`frameHeight`) |
| 포커스 아웃(앱 `document.activeElement`, 1단계 마이크로태스크 판정과 같은 길) | 8 |
| 테마·언어 `onUpdate` | 6, 8 |
| 전체 화면(다시 만들지 않고 겹침, Esc 는 위젯 먼저) | 6(키), 8(popover), 10(높이), 11 |
| 공통 API 같음 — D-day 를 iframe 연결로도 돌리는 시험 | 6(equivalence), 7·8(`keyring/dday-frame`), 11 |
| 제3자 위젯 자리(출처로 frame 강제, 코드 원천·글 자리) | 5 |
| 데이터 파일 만들기(첨부 위치·이름) | 4(`createDataFile`), 9(넣기) |
| `api.file` 은 그 블록의 `state.file` 만, 경로 검사(정규형) | 1, 9 |
| 쓰기 = 첨부 교체 API(서버 PUT·기기 해시 검사) | 4, 9(`apiDataFileIO`) |
| 쓰는 시점(자동 저장 규칙, 포커스 아웃·탭 닫기·노트 바꾸기·`visibilitychange`·앱 닫기 전 비우기, 끔이면 「저장하지 않은 그림」 + `Mod+S`) | 4, 9 |
| 해시 충돌 알림·덮어쓰지 않음(+ 충돌 사본 — 코디네이터 결정) | 4, 9 |
| 파일 없음 → 「파일을 찾을 수 없습니다」, 만들지 않음 | 4, 9 |
| `state.file` 을 첨부 링크로 — `rewriteLinks`·`updateLinks`·`linkingDocs`·`analysis.ts` 깨진 링크·서버 이동, 경로 정규형 | 1, 2 |
| 이력 보기에서 데이터 파일 위젯은 안내와 경로 | 9 |
| 블록을 지워도 파일은 남음(non-goal) | 11(문서) |
| Excalidraw(frame, 데이터 파일, 처음 쓸 때만, 자체 실행 취소) | 7, 10 |
| Excalidraw 판·라이선스 고지·크기·CDN 없음 | 10(0.18.1, `HOLDERS`·글꼴 bundled, 2 MiB 한도), 7(`/widget-frame/`) |
| 기기 볼트·데스크톱·오프라인에서 돎 | 3(방식), 7(SW), 11 |
| iframe 이 앱 `document`·`localStorage`·`fetch`·Tauri IPC 에 닿지 못함 | 3(CSP), 11 |
| 사용자 문서 | 11 |
