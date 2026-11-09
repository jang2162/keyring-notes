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
- **탭 닫기·노트 바꾸기(코디네이터 결정 — `Workspace.tsx` `closeTab` 선례):** 자동 저장 설정과 상관없이 그 노트가 연 데이터 파일을 비우고(flush), 실패하면 노트처럼 버릴지 묻는다(취소하면 닫지·바꾸지 않는다). 화면에 안 보이는 「메모리에만 남은 그림」 상태를 만들지 않는다.
- **iframe 자기 탐색(리뷰 C2, 워커 결정):** iframe 문서가 바뀌면(두 번째 `load` 또는 두 번째 `ready`) 부모가 그 iframe 을 바로 지우고 「위젯이 다른 페이지로 이동하려 해 멈췄습니다」 와 원문을 보이며 그 인스턴스의 메시지에 더 답하지 않는다. 위젯이 이미 가진 상태·파일 바이트를 탐색 URL 이나 WebRTC(STUN)로 내보내는 것은 CSP·sandbox 로 막을 수 없다 — 내장 위젯은 앱 코드라 믿고, 제3자 위젯에 대해서는 마켓플레이스 설계로 넘기는 **알려진 한계**로 `docs/guides/development.md` 「위젯 iframe 과 CSP」 에 적는다(Task 11).
- **정한 것(워커):**
  - 데이터 파일은 인라인·iframe 어느 위젯이든 정의에 `dataFile` 이 있으면 쓴다(호스트 공통). 정의를 `dataFile?: { ext: string; initial(): Uint8Array; name?: Record<string, string> }` 로 넓힌다 — 서버가 빈 첨부를 거절(`file_empty`)하므로 처음 내용이 필요하고, 파일 이름 앞부분(`<위젯 이름>`)은 `name[볼트 언어] ?? title[볼트 언어] ?? title.en`. 이름 = `<앞부분>-<무작위 16진 4자리><ext>`, 같은 이름이 있으면(409) 무작위를 바꿔 50번까지.
  - `state.file` 의 정규형 = `normalizeVaultPath(file) === file`(이미 정규형인 볼트 상대 경로, `..`·절대·숨김·빈 칸·백슬래시 없음)이고 `ext` 로 끝난다(대소문자 무시). 아니면 「데이터 파일 경로가 올바르지 않습니다」 + 원문, 파일 API 없음.
  - core 의 링크 처리(`rewriteLinks` 와 그것을 쓰는 `linkingDocs`, `analyze().links`)는 **어느 `keyring-widget` 펜스든** `state.file` 을 본다(위젯 정의는 web 에 있어 core 는 모른다 — `state.file` 은 데이터 파일 위젯이 쓰는 예약 이름으로 친다). 펜스 판정은 `rewriteLinks` 의 지금 펜스 규칙(0~3칸 들여쓰기, 닫힌 것)이라 1단계의 「최상위 펜스만 위젯」 보다 넓다 — 목록 안 블록의 경로도 고쳐진다(놓치면 조용히 파일을 잃고, 넓게 잡아 손해 보는 경우는 없다). 고칠 때는 본문을 다시 직렬화하지 않고 `"file": "<값>"` 문자열만 바꾼다(들여쓰기·사람이 쓴 모양 보존). **고칠지는 `state.file` 이 옮긴 경로일 때만 정하고**, 그때 본문 안에서 값이 같은 `"file"` 문자열은 모두 고친다(같은 첨부를 가리키는 다른 키가 옛 경로로 남지 않게). 셈은 펜스마다 1(`widgetFileRefs` 와 같은 범위).
  - `lintVault` 는 링크를 `resolveLink`(대소문자 무시·끝 일치)로 풀므로, `state.file` 이 없는 경로인데 끝이 같은 다른 파일이 있으면 깨진 링크로 잡히지 않는다 — 알려진 한계로 Task 2 시험 주석과 사용자 문서에 적는다(위젯 자체는 정확한 경로만 읽고 「파일을 찾을 수 없습니다」 를 보인다).
  - 데이터 파일 쓰기가 충돌로 끝날 때와 **쓰는 중 파일이 없어졌을 때(404)도** 같은 충돌 사본을 둔다(그린 것을 잃지 않게). **네트워크·오프라인·5xx(`failed`) 와 사본 만들기 실패는 바이트를 지우지 않고** 「저장하지 못함」 으로 남겨 다음 쓰기·비우기 때 다시 시도한다(서버 볼트에서 오프라인이면 그림은 저장되지 않는다 — 노트의 IndexedDB 오프라인 편집과 다르다는 것을 사용자 문서에 적는다).
  - 같은 파일을 두 위젯(같은 노트 두 칸, 두 노트)이 열면 쓰기 담당은 경로마다 하나(`DataFileWriter`)이고, **writer 의 판(rev — 받아들인 쓰기마다 오른다)** 으로 가른다: 위젯은 자기가 마지막으로 읽었거나 받아들여진 판과 writer 의 판이 같을 때만 쓸 수 있고, 아니면 충돌(덮어쓰지 않음, 사본). 쓰기를 **받아들이는 순간**(내려앉을 때가 아니라) 다른 위젯은 stale 이 되어 보기 전용으로 바뀌고, 그 경로의 쓰기가 모두 내려앉은 뒤 **한 번** 다시 읽는다(리뷰 C1, 재리뷰 N4). 주인 핸들은 두지 않는다 — 사라진 위젯이 남긴 바이트는 그 뒤 읽은 위젯이 이어 쓴다. 다시 붙는 위젯은 사라지는 위젯의 drain 이 끝난 뒤 읽는다(재리뷰 N1). 거절된 쓰기의 바이트는 원본 경로에 쓰지 않고 「사본 대기」 로만 둔다(재리뷰 N2).
  - 자동 저장 끔: 비우기는 `Mod+S`(앱 「저장」 명령), 창 닫기·새로 고침 「저장하고 닫기」, 그리고 **탭 닫기·노트 바꾸기**(코디네이터 결정 — 위). 화면 밖으로 스크롤되거나 미리보기가 다시 그려져 위젯이 잠깐 사라질 때는 쓰지 않고 writer 에 남는다(같은 노트의 위젯이 곧 다시 붙어 그 바이트를 읽고 「저장하지 않은 그림」 을 보인다). 자동 저장 켬: 위젯 포커스 아웃·사라짐·`visibilitychange`(hidden)·`beforeunload`·창 닫기 때 비운다. 닫기 묻는 동안(`closeHold`)은 writer 타이머도 쉰다.
  - 전체 화면은 iframe 을 옮기지 않고 위젯 감싸개에 `popover="manual"` + `showPopover()`(top layer)로 한다 — DOM 에서 iframe 을 옮기면 엔진이 문서를 다시 불러오고, `position: fixed` 는 조상의 `transform`·`contain` 에 갇힐 수 있다. `popover` 속성은 **전체 화면에 들어갈 때만 달고 나올 때 뗀다**(달려 있으면 닫힌 동안 UA 스타일이 `display: none` 을 건다). Popover API 가 없는 엔진(Safari 17 전 — `tauri.conf.json` 에 `minimumSystemVersion` 이 없어 옛 macOS 의 WKWebView 가 있을 수 있다)은 `"showPopover" in HTMLElement.prototype` 로 보고 `position: fixed` 겹침 클래스로 대신한다. `WidgetContext` 에 `fullscreen?: boolean` 을 더한다(위젯이 높이를 정하게). 전체 화면 단추는 위젯 머리(호스트 몫)에 `display: block` 위젯만.
  - Esc 순서: iframe 안에서 위젯이 `preventDefault` 하지 않은 Esc(조합 중 아님 — 1단계 `widgetKeyAction`) → 부모로. 부모는 **전체 화면이면 닫기만**, 아니면 `session.escape()`(수정 중이면 초안 버림).
  - iframe 이 부모로 넘기는 키는 Esc 와 `Mod+S` 둘뿐이다(다른 앱 단축키는 iframe 안에서 먹지 않는다 — 문서에 적는다).
  - 높이 상한: 전체 화면이 아니면 `floor(window.innerHeight * 0.8)`, 아래 한도 48px(불러오는 동안).
  - 제3자 위젯 자리: `WidgetEntry` 를 인라인(`load`)과 iframe(`frame(): Promise<FrameCode>`, 코드 원천 = URL 또는 글)으로 가른다. `messages` 는 앱 메시지 앞머리(내장) 또는 언어별 표(`Record<lang, Record<key, text>>` — 제3자). `builtIn: false` 는 iframe·표만 받는다. 설치·받기는 만들지 않는다(설계 non-goal).
  - iframe 안 `api.t` 는 core `lookup` 그대로(복수형 `key#one` 포함) — 부모가 언어 사슬(`{ messages, locale }[]`)을 앞머리를 떼어 보낸다. 런타임이 앱 메시지 JSON 을 끌어오지 않게 `lookup`·`interpolate`·`pluralOf` 를 JSON 을 import 하지 않는 core 모듈 `packages/core/src/lookup.ts` 로 옮기고(`i18n.ts` 는 다시 내보낸다 — 동작 그대로) core `exports` 에 `"./lookup"` 을 더한다. `widgetT` 는 React·`web/src/i18n.ts` 를 부르지 않는 `web/src/widgets/widgetT.ts` 에 둔다(리뷰 M1).
  - Excalidraw: `@excalidraw/mermaid-to-excalidraw` 를 빈 모듈로 바꿔 싣지 않는다(gzip 약 1MB 절감 — 실험 2,583,721 → 1,594,666 B). 글꼴은 Xiaolai(CJK, 209개 13MB)를 빼고 나머지(약 480KB)를 바이트로 건넨다 — 한글은 시스템 글꼴로 보인다. 위젯 UI 글꼴(Assistant)은 빌드에서 CSS 안 `data:` 로 바꾼다. 처음 그리는 높이 480px, 전체 화면이면 100%. 파일 이름 앞부분 `{ en: "sketch", ko: "스케치" }`, 이름 `{ en: "Excalidraw sketch", ko: "Excalidraw 스케치" }`. 묶음 크기 상한 gzip **2,097,152 B**(넘으면 빌드 실패), 런타임 상한 gzip **20,480 B**.
  - Excalidraw 는 열기만 해서는 쓰지 않는다(리뷰 I1): 불러온 장면의 첫 직렬화를 쓰지 않는 기준선으로 두고, `window.EXCALIDRAW_EXPORT_SOURCE = "keyring-notes"` 로 `source` 를 고정하며(srcdoc 에서는 `location.origin` 이 `"null"`), `onChange` 마다 직렬화하지 않고 `getSceneVersion(elements)` 와 `files` 키로 먼저 거른다.
  - Excalidraw 의 CSP 아래에서 안 되는 기능은 숨기거나 막는다(리뷰 M3): 이미지 내보내기·PNG 복사(글꼴 subset WASM — `'wasm-unsafe-eval'` 없음, 워커), 클립보드 권한(`allow` 없음 — 같은 iframe 안 복사·붙여넣기는 Task 11 에서 본다), 요소 링크는 `onLinkOpen` 에서 `preventDefault` 로 열지 않는다(자기 탐색 — C2).
  - 개발 빌드(`import.meta.env.DEV`)에서만 `keyring/dday-frame`(D-day 를 iframe 으로)을 등록해 두 연결을 브라우저에서도 견준다. 배포 빌드에는 없다. iframe 안에는 앱 CSS 가 없어 모양이 다르므로 **동작만** 견준다(리뷰 M10).
- **구현자 몫:** 메시지 이름 외의 세부 문구, 위젯 머리(전체 화면·저장 안 함 표시·충돌 알림) 모양, Excalidraw 의 테마 판정(`ctx.theme["--bg"]` 밝기)·언어 코드 대응(`ko` → `ko-KR`)·`UIOptions`(불러오기·파일 저장 숨김), 개발 서버에서 iframe 묶음을 내는 방법(같은 중첩 빌드를 미들웨어로).

## Global Constraints

- iframe: `sandbox="allow-scripts"` 만(**`allow-same-origin`·`allow-popups`·`allow-forms` 없음**), `srcdoc` 만(`src` 없음), `allow` 속성 없음. srcdoc 안 meta CSP 는 정확히 `default-src 'none'; script-src <해시> blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`.
- iframe 은 URL 로 아무것도 받지 않는다(코드·CSS·글꼴은 부모가 건넨다). CDN 금지 — 기기 볼트·데스크톱 앱·오프라인에서 돈다.
- 부모가 받는 메시지는 **자기가 만든 iframe 의 `contentWindow`(만들 때 잡아 둔 WindowProxy — iframe 이 DOM 에서 빠지면 `iframe.contentWindow` 는 `null` 이 된다)에서 온 것**이고, **`e.origin === "null"`(srcdoc 샌드박스는 불투명 출처)이어야 한다 — 같은 창에서 온 메시지인데 출처가 `"null"` 이 아니면 문서가 다른 곳으로 옮겨 간 것이라 그 자리에서 kill**(재리뷰 N3 — 옮겨 간 문서가 `load`·`ready` 전에 보낸 첫 메시지부터 막는다), 그리고 `kw === "kw1"`, `id === 그 인스턴스 id`, 모양 검사(`parseFrameMsg`)를 통과한 것만. iframe 쪽도 `e.source === parent` 인 것만.
- iframe 문서는 srcdoc 하나뿐이어야 한다: 두 번째 `load` 나 두 번째 `ready` 가 오면 부모는 iframe 을 지우고 오류(`kw.frameNavigated`)를 보이며 그 인스턴스에 더 답하지 않는다(리뷰 C2).
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

1. **미리보기 칸에서 그리는 중에 다른 칸·동기화가 노트를 고침, 또는 긴 노트에서 그림 블록을 스크롤해 화면 밖으로 보냈다 돌아옴** — 미리보기는 다시 마운트되고 CodeMirror 는 먼 줄의 위젯 DOM 을 치웠다 다시 만들어, 둘 다 iframe 이 새로 만들어진다(약 5MB 코드를 다시 건네고 파싱, 화면 위치·Excalidraw 실행 취소 기록을 잃는다 — 사용자 문서에 적는다). **iframe 에서 이미 떠난 바이트까지는** 잃지 않는다: 사라지는 iframe 이 보낸 `fileWrite` 는 잡아 둔 WindowProxy 로 받아 핸들에 넘기고, 쓰지 않은 바이트는 writer 에 남아 새 iframe 이 읽는다. 아직 iframe 안 `onChange` 에서 보내지 않은 마지막 순간의 획은 잃을 수 있다. 다시 붙은 위젯의 획은 사본 없이 이어서 쓰인다(주인 없음, drain 이 끝난 뒤 읽기). (Task 4: writer 가 위젯보다 오래 산다·N1 시험, Task 8: 사라진 뒤 1초 동안 `fileWrite` 만 받음, Task 11 확인)
2. **창·앱 닫기, PWA 「새로 고침」, 탭 닫기, 노트 바꾸기 직전 1.5초 안에 그은 획** — 탭 닫기·노트 바꾸기는 설정과 상관없이 비우고 실패하면 묻는다. 창 닫기·새로 고침은 닫기 물음에 「저장하지 않은 그림」 이 들고 「저장하고 닫기」 가 쓴다. 노트는 깨끗하고 그림만 남았어도 지킴이 켜진다(writer 표 바뀜 구독). 데스크톱 앱(WKWebView)은 `beforeunload` 가 없어 닫기 지킴이 유일한 길이다. (Task 4: `flushDataFiles`·`unsavedDataFiles`·`onDataFilesChange`, Task 9: `guarded`·`closeWindowSafely`·`reloadSafely`·`closeTab`·`warn`, Task 11 확인)
3. **같은 그림을 두 칸에 열고 번갈아 그림** — A 가 그리는 순간 B 는 보기 전용(「다른 칸에서 고치는 중」)이 되고 A 의 쓰기가 내려앉은 뒤 한 번 다시 읽는다. 그 사이 B 가 그린 것(전환 직전)은 조용히 덮어쓰지 않고 충돌 사본이 된다. B 칸 iframe 이 A 의 획마다 다시 만들어지지 않는다. (Task 4 시험, Task 9)
4. **iframe 안 Excalidraw 글 상자에서 한글 조합 중 Esc·Enter, 전체 화면에서 Esc** — 조합 중 키는 부모로 가지 않고, Excalidraw 가 처리한 Esc(글 편집 끝·선택 해제)는 전체 화면을 닫지 않으며, 처리하지 않은 Esc 만 닫는다. (Task 6: 런타임 키 시험, Task 11 확인 — Chromium·WebKit)
5. **iframe 으로 포커스가 들어갈 때** — 부모 `window` 의 `blur` 가 나 노트 자동 저장(`Workspace` 의 창 blur 저장)이 돈다. 위젯 수정이 끝나거나(포커스 아웃 오판) 데이터 파일이 비워지는 일은 없어야 한다(앱 `document.activeElement` 가 그 iframe 이면 안이다). 창 전체가 포커스를 잃을 때(다른 앱으로)도 안으로 본다. (Task 8: `frameFocusInside` 시험, Task 11 확인)
6. **오프라인에서 처음 그림 위젯을 엶(SW 캐시 전)** — 「위젯을 불러오지 못했습니다」 와 원문 블록이 보이고 노트는 그대로다. 한 번 연 뒤에는 오프라인에서도 열린다(SW 의 쓸 때 캐시) — 단 SW 캐시는 빌드마다 새것이고 바로 앞 빌드 하나만 남으므로(`sw.js` `staleCaches`) 앱이 두 번 업데이트되면 다시 받아야 한다. 서버 볼트에서 오프라인이면 그림을 저장하지 못하고 「저장하지 못함」 으로 남는다. (Task 4: `failed` 는 바이트 유지, Task 7: `/widget-frame/` 이 index.html 대체를 받지 않음, Task 11 확인)
7. **iframe 안에서 `Mod+S`** — 브라우저 「페이지 저장」 이 뜨지 않고 노트 저장과 그림 비우기가 함께 돈다. (Task 6 런타임 키 시험, Task 9 연결, Task 11 확인)
8. **블록을 원문으로 고쳐 `state.file` 을 `../밖.json`·`/abs.json`·`.hidden/x.excalidraw.json`·다른 확장자로 바꿈** — 위젯은 그 경로를 읽거나 쓰지 않고 오류 한 줄과 원문을 보이며, 원래 파일도 건드리지 않는다. (Task 1 시험, Task 9)
9. **그림을 열기만 하고 닫음** — 파일·커밋이 바뀌지 않는다(Excalidraw 가 처음 그릴 때도 `onChange` 를 부르고, srcdoc 의 `source` 가 `"null"` 이다). (Task 10: `SceneGate` 시험, Task 11 확인)
10. **제3자 위젯이 `location.href = "https://…"` 로 자기 iframe 을 옮김** — 부모가 iframe 을 지우고 오류를 보이며, 옮겨 간 문서의 메시지(출처가 `"null"` 이 아님 — `ready` 전의 `fileRead` 포함)에 답하지 않는다. (Task 8: `frameEventAction`·`frameGuard` 시험, Task 11 확인)

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
  /** 본문을 parseWidgetBlock 해 state.file 이 from 일 때만, 본문 안 `"file"\s*:\s*"<JSON 문자열>"` 중 JSON.parse 값이 from 인 것을 모두 JSON.stringify(to) 로. 그 밖의 글자는 그대로. count 는 1(펜스 하나). state.file 이 from 이 아니면 null */
  export function rewriteWidgetFileRefs(body: string, from: string, to: string): { body: string; count: number } | null;
  // sync.ts
  export function conflictCopyPath(path: string, label: string, exists: (p: string) => boolean, now?: Date, ext?: string): string; // ext 기본 ".md"
  ```

- [ ] **Step 1: 실패하는 시험** — `keyringWidget.test.ts`:
  - `widgetDataPath({ file: "회의록/스케치-3f9a.excalidraw.json" }, ".excalidraw.json")` → 그 값. `".EXCALIDRAW.JSON"` 로 끝나도 값. `{ file: "../밖.excalidraw.json" }`·`"/abs.excalidraw.json"`·`".h/x.excalidraw.json"`·`"a//b.excalidraw.json"`·`"a\\b.excalidraw.json"`·`"a/b.json"`·`".excalidraw.json"`·`{ file: 1 }`·`{}`·`null`·`"x"` → null. ext 없이 `{ file: "a/b.json" }` → 그 값.
  - `widgetFileRefs`: 펜스 둘(` ```keyring-widget ` 와 `~~~keyring-widget`)·목록 안 2칸 들여쓴 펜스 하나 → 세 경로 순서대로. 같은 경로 두 번 → 하나. ` ```json ` 펜스의 `"file"`, 닫히지 않은 펜스, 깨진 JSON, `state.file` 이 정규형이 아님, 프런트매터 안 → 없음. 본문의 경로를 JSON 이스케이프로 쓴 것 — 시험 코드에 `` String.raw`{"widget": "a/b@1", "state": {"file": "\uc2a4\ucf00\uce58.excalidraw.json"}}` `` 처럼 쓴다(`String.raw` 안에서는 따옴표를 이스케이프하지 않는다 — `\"` 를 쓰면 백슬래시가 남아 JSON 이 깨진다. `\uXXXX` 의 백슬래시만 글자 그대로 남는다, 재리뷰 N7) → 풀린 값 `"스케치.excalidraw.json"`.
  - `rewriteWidgetFileRefs('{\n  "widget": "a/b@1",\n  "state": {"file": "x/a.excalidraw.json", "n": 1}\n}', "x/a.excalidraw.json", "y/b c.excalidraw.json")` → `count` 1, 결과는 원문에서 그 문자열만 `"y/b c.excalidraw.json"` 으로 바뀐 글(줄·들여쓰기 그대로). 이스케이프로 쓴 같은 값(위와 같이 `String.raw`)도 바꾼다. `state.file` 이 다른 값이고 모르는 키 `"x": {"file": "x/a.excalidraw.json"}` 에만 있으면 null(고치지도 세지도 않는다). `state.file` 이 from 이고 모르는 키에도 같은 값이 있으면 둘 다 바뀌고 `count` 1.
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
  - `analyze("n.md", 블록).links` 에 `"x/a.excalidraw.json"`. `lintVault` 에 `files` 가 그 경로를 빼면 `broken_link`(`target` 그 경로), 넣으면 없음. 알려진 한계를 시험 주석으로 남긴다: `files` 에 그 경로가 없고 `"y/x/a.excalidraw.json"` 이 있으면 `resolveLink` 의 끝 일치로 풀려 깨진 링크로 잡히지 않는다(이 경우를 단언하지 않는다 — 고정하면 나중의 정확 일치 개선을 막는다).
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
  부트스트랩 동작(이것만): 전체를 즉시 실행 함수로 감싸고 첫 줄에서 `if (window.parent === window) return;` — 해시가 앱 페이지 CSP 에도 들어가므로 HTML 주입으로 같은 글이 최상위에서 돌아도 아무것도 하지 않게(리뷰 M9). `message` 중 `e.source === parent` 이고 `{ kw: "kw1", type: "load", code: string }` 인 것을 `URL.createObjectURL(new Blob([code], { type: "text/javascript" }))` 의 `<script>` 로 `head` 에 붙인다(붙인 순서대로 실행 — `async = false`). 시작하자마자 `parent.postMessage({ kw: "kw1", type: "ready" }, "*")`. 다른 것은 하지 않는다 — 나머지는 런타임(Task 6)이 받는다.

- [ ] **Step 1: 실패하는 시험** — `bootstrap.test.ts`:
  - `"'sha256-" + base64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(FRAME_BOOTSTRAP))) + "'"` === `WIDGET_FRAME_SCRIPT_HASH`. 실패 메시지에 「부트스트랩이 바뀌었다 — 새 해시를 core widgetFrame.ts 와 tauri.conf.json 에 넣는다」 와 새 해시를 찍는다.
  - `import conf from "../../../../app/src-tauri/tauri.conf.json?raw"` → `JSON.parse(conf).app.security.csp` 의 `script-src` 지시어 낱말에 `'self'`·`WIDGET_FRAME_SCRIPT_HASH`·`blob:` 이 있다. 다른 지시어(`default-src`·`connect-src`·`img-src`·…)는 지금 값 그대로(문자열 비교).
  - `frameSrcdoc()` 가 `FRAME_META_CSP` 를 meta 로, `FRAME_BOOTSTRAP` 을 `<script>` 하나로 담고 다른 `<script>` 가 없다. `FRAME_META_CSP` 가 Global Constraints 의 글과 같다. `FRAME_BOOTSTRAP` 이 `(function` 으로 시작하고 `window.parent === window` 검사를 담는다.
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
    replace(path: string, bytes: Uint8Array, baseHash: string): Promise<{ hash: string | null }>; // 409 → "conflict", 404 → "missing", 그 밖 → "failed"
    create(path: string, bytes: Uint8Array): Promise<string>;                    // 만든 경로. 이미 있으면 "exists"
  }
  export class DataFileError extends Error { constructor(readonly code: "missing" | "conflict" | "exists" | "failed") }
  export interface DataFileStatus { saving: boolean; unsaved: boolean; stale: boolean; conflictCopy: string | null; error: "missing" | "failed" | null }
  export interface DataFileHandle {             // 위젯 하나가 쥐는 것
    /** 같은 writer 의 drain 중인 핸들이 모두 release 될 때까지 기다린 뒤(최대 READ_DRAIN_WAIT_MS = FRAME_DRAIN_MS + 250 — 이 파일의 상수. drain 창보다 조금 길게, 재재리뷰 R2), 받아들인 것 중 가장 새 바이트(쓰는 중·쓰지 않은 것 포함, 없으면 파일).
     *  hash 는 마지막으로 내려앉은 해시. 이 핸들의 판(rev)을 writer.rev 로, 계보(issued)를 {hash} 로 다시 잡고 stale 을 끈다 */
    read(): Promise<{ bytes: Uint8Array; hash: string }>;
    write(bytes: Uint8Array, baseHash: string): Promise<{ hash: string }>; // 모아 쓰고 그 바이트가 내려앉으면 풀린다
    onStatus(cb: (s: DataFileStatus) => void): () => void;
    onStale(cb: () => void): () => void;       // 다른 핸들의 쓰기가 받아들여졌다 — 한 번만(다시 read 할 때까지)
    onSettled(cb: () => void): () => void;     // 이 writer 에 쓰는 중·쓰지 않은 바이트가 없어졌다(내려앉음·버림) — stale 핸들이 다시 읽을 때
    drain(): void;                             // 위젯이 사라지는 중(iframe 이 이미 보낸 fileWrite 를 받는 동안). 쓰기는 계속 받는다
    release(): void;                           // 위젯이 사라짐: 자동 저장 켬이면 바로 비우기, 끔이면 바이트를 남긴다. 받아들이는 규칙에 주인은 없으므로 남은 바이트는 다음에 read 한 핸들이 이어 쓴다. release 뒤 이 핸들의 write 는 거절하고 그 바이트는 copies 로(조용히 버리지 않는다 — R1)
  }
  export interface DataFileOptions {
    autosave(): boolean; delay(): number; conflictLabel(): string;
    held(): boolean;                           // 닫기 묻는 중(closeHold) — 이 동안 타이머는 쓰지 않고 delay() 뒤로 다시 미룬다(Workspace 의 savesHeld 와 같은 규칙)
    now?(): Date; timers?: { set(fn: () => void, ms: number): unknown; clear(t: unknown): void };
  }
  /** owner: 이 위젯이 든 노트 경로 — 탭 닫기·노트 바꾸기에서 그 노트의 그림만 비우려고 */
  export function openDataFile(path: string, ext: string, owner: string, io: DataFileIO, opts: DataFileOptions): DataFileHandle;
  export function flushDataFiles(owner?: string): Promise<boolean>;  // 쓰지 않은 것과 사본 대기를 지금(자동 저장 설정 무관). owner 를 주면 그 노트가 연 것만. 남은 것이 없으면 true
  export function discardDataFiles(owner: string): void;             // 그 노트의 쓰지 않은 바이트·사본 대기를 버린다(탭 닫기에서 「버리기」). writer 의 owners 에 다른 노트가 남아 있으면(같은 그림을 다른 노트도 열고 있다) 이 노트만 owners 에서 빼고 바이트는 남긴다(재재리뷰 R4)
  export function renameDataFileOwner(from: string, to: string): void; // 노트 이동·이름 바꾸기(폴더 이동이면 from 이 앞머리인 owner 모두) — 리뷰 N6
  export function unsavedDataFiles(): string[];                      // 쓰지 않은 바이트(쓰는 중 포함)나 사본 대기가 남은 경로
  export function onDataFilesChange(cb: () => void): () => void;     // unsavedDataFiles() 가 바뀔 수 있을 때마다(받아들임·내려앉음·실패·버림·사본) — useSyncExternalStore 용
  export function createDataFile(io: DataFileIO, dir: string, stem: string, ext: string, initial: Uint8Array, rand?: () => string): Promise<string>;
  export function dataFileStem(name: string): string;  // uploadFiles 와 같은 글자 거르기([\\/:*?"<>|#^[\]] → 공백, trim)
  export function setDataFileOptions(o: DataFileOptions): void;   // Workspace 가 한 번 건다(Task 9)
  export function dataFileOptions(): DataFileOptions;              // 건 것, 없으면 기본(켬·1500·영어 "conflict copy"·held false)
  export function resetDataFilesForTest(): void;
  ```
  규칙(리뷰 C1·I4, 재리뷰 N1·N2·N4·N6):
  - 경로마다 writer 하나(모듈 표). writer 는 `head`(마지막으로 내려앉은 해시), **`rev`(받아들인 쓰기마다 1 씩 오르는 판)**, `latest`(받아들인 가장 새 바이트 — 쓰는 중이거나 쓰지 않은 것), `inflight`, `copies`(사본 대기 — 경로 없이 바이트만, 원본 경로에는 절대 쓰지 않는다), 노트 집합 `owners`(쓰지 않은 바이트·사본 대기를 만든 핸들들의 owner)를 가진다. 핸들이 없고 쓰는 중·쓰지 않은 것·사본 대기가 없으면 표에서 지운다.
  - 핸들마다 `rev`(자기가 마지막으로 read 했거나 받아들여진 때의 writer.rev)와 `issued`(자기에게 준 해시들 — read 결과와 자기 쓰기가 내려앉은 해시).
  - `write(bytes, baseHash)` 를 **받는** 조건은 둘: `handle.rev === writer.rev`(그 사이 다른 핸들의 쓰기가 받아들여지지 않았다), `issued` 에 `baseHash` 가 있다. **주인 핸들은 없다** — 놓아 버린(`release`) 핸들이 남긴 바이트는 그 뒤 `read()` 한 핸들이 그 바이트 위에서 이어 쓴다(N1). 받으면 `latest = bytes`, `writer.rev++`, `handle.rev = writer.rev`, **이 순간 다른 핸들 전부 stale**(처음 한 번 `onStale`, `status.stale`). 받지 못하면 그 바이트를 `copies` 에 넣어 사본 만들기를 하고 `DataFileError("conflict")` — `latest`·`inflight` 는 건드리지 않는다.
  - 자동 저장 켬이면 받을 때마다 타이머를 `delay()` 로 다시 걸고, 불릴 때 `held()` 면 쓰지 않고 다시 건다. 끔이면 걸지 않는다(`unsaved` true).
  - 한 번에 쓰기 하나 — 쓰는 중에 받아들인 것은 내려앉은 뒤 새 `head` 로 이어 쓴다. 내려앉으면 `head` 를 새 해시(`hash ?? sha256Hex(bytes)`)로, 그 바이트까지 기다리던 약속을 그 해시로 풀고 그 해시를 쓴 핸들의 `issued` 에 넣는다. 쓰는 중·쓰지 않은 것이 없어지면 `onSettled`(stale 핸들의 호스트는 이때 **한 번** 다시 그린다 — N4).
  - `replace` 가 409·404 → 그 바이트를 `copies` 로 옮겨 사본 만들기, 기다리던 약속은 `"conflict"`/`"missing"` 으로 거절, `latest` 비움, `rev++` 하고 모든 핸들 stale(다시 읽게).
  - 사본 만들기: `create(conflictCopyPath(path, conflictLabel(), 써 본 이름에 있음, now(), ext), 바이트)`(`exists` 면 다음 이름) → 성공이면 `copies` 에서 빼고 `status.conflictCopy`. **`exists` 말고 실패하면 `copies` 에 남겨** 다음 `flushDataFiles` 때 다시 시도한다(N2 — 거절된 바이트는 pending 으로 되돌리지 않는다. 되돌리면 다른 핸들의 바이트를 갈아 치워 C1 이 다시 열린다).
  - `replace` 가 `failed`(네트워크·오프라인·5xx) → **바이트를 지우지 않는다**: `latest` 로 남기고 `status.error = "failed"`, 기다리던 약속은 `"failed"` 로 거절, 다음 `write`·`flushDataFiles` 때 다시 시도(타이머로 혼자 되풀이하지 않는다). `rev` 는 그대로 — 같은 위젯이 이어 그리면 받는다.
  - `flushDataFiles()` 는 `latest` 를 쓰고 `copies` 를 다시 만들어 본다. 하나라도 남으면 false. `unsavedDataFiles()` 는 `latest`·`inflight`·`copies` 가 있는 경로.
  - `read()` 는 같은 writer 에 `drain()` 했지만 아직 `release()` 안 한 핸들이 있으면 그것들이 release 될 때까지(최대 `READ_DRAIN_WAIT_MS` = `FRAME_DRAIN_MS + 250` — mountFrame 의 release 타이머가 조금 늦어도 늦은 바이트가 read 보다 먼저 받아들여지게) 기다린다 — 사라지는 iframe 의 늦은 바이트가 먼저 받아들여져, 다시 붙는 위젯이 그 위에서 시작한다(미리보기 다시 그리기·화면 밖 스크롤에서 사본이 생기지 않게, N1). 전체 화면은 iframe 을 다시 만들지 않아 핸들이 그대로다.

- [ ] **Step 1: 실패하는 시험** — 가짜 `io`(호출을 적고, 해시는 `sha256Hex`), 가짜 타이머:
  - 자동 저장 켬, 지연 1500: `read` → `write(b1, h0)`·`write(b2, h0)` → 1499ms 에 `replace` 없음, 1500ms 에 `replace(path, b2, h0)` 한 번, 두 약속 모두 `{ hash: h(b2) }`. 그 뒤 `write(b3, h(b2))` 는 받는다, `write(b4, "f".repeat(64))`(준 적 없는 해시) 은 `"conflict"`(사본 `create`).
  - 쓰는 중(`replace` 가 아직 안 풀림)에 같은 핸들이 `write(b3, h0)` → 받고, 첫 쓰기가 끝난 뒤 `replace(path, b3, h(b2))`.
  - `held()` 가 true 인 동안 1500ms 가 지나도 `replace` 없음, false 가 된 뒤 다음 지연에 한 번.
  - 끔: `write` 뒤 아무리 지나도 `replace` 없음, `status.unsaved` true, `unsavedDataFiles()` 에 경로. `flushDataFiles()` → `replace` 한 번, true, `unsaved` false.
  - 켬: `release()` → 바로 `replace`(타이머를 기다리지 않음). 핸들이 없고 쓴 것이 끝나면 표에서 빠진다(`unsavedDataFiles()` 빈 배열).
  - owner: 노트 `n1.md`·`n2.md` 의 핸들이 각자 다른 경로에 쓰지 않은 바이트를 둠(끔) → `flushDataFiles("n1.md")` 는 n1 의 경로만 `replace`. `discardDataFiles("n2.md")` → n2 경로가 `unsavedDataFiles()` 에서 빠지고 `replace` 없음. 같은 경로를 n1·n2 가 함께 열고 n1 이 그린 것이 남았을 때 `discardDataFiles("n2.md")` → 바이트는 남고(`unsavedDataFiles()` 에 그대로) `flushDataFiles("n1.md")` 가 그것을 쓴다. `renameDataFileOwner("n1.md", "m/n1.md")` 뒤 `flushDataFiles("m/n1.md")` 가 n1 의 경로를 쓴다, `renameDataFileOwner("a", "b")` 는 `a/x.md` owner 를 `b/x.md` 로.
  - `onDataFilesChange`: 받아들임·내려앉음·`failed`·버림·사본마다 불린다.
  - `replace` 가 409: `create` 가 `"a/x (충돌 사본 20261109-0905).excalidraw.json"` 과 쓰지 않은 바이트로 불림, `status.conflictCopy` 그 경로, 약속 `"conflict"`. 첫 이름이 `"exists"` 면 ` 2)` 이름. 404 → 같은 사본, `"missing"`.
  - `replace` 가 `failed`: 약속 `"failed"`, `status.error` `"failed"`, `unsavedDataFiles()` 에 남음, 시간이 지나도 `replace` 다시 없음, 같은 핸들의 다음 `write` 는 받는다(사본 없음), `flushDataFiles()` → 다시 `replace`(이번엔 성공) → true.
  - **C1 — 두 핸들 A·B 가 같은 판에서 시작**: 둘 다 `read`(h0).
    - 내려앉기 전: A 가 `write(a1, h0)`(타이머 대기) → 그 순간 B 의 `onStale` 한 번. B 가 `write(b1, h0)` → `replace` 없이 B 바이트로 사본 `create`, `"conflict"`. 1500ms 뒤 `replace(path, a1, h0)` — A 의 바이트가 그대로 쓰인다.
    - 쓰는 중: A 의 `replace` 가 아직 안 풀린 동안 B 가 `write(b1, h0)` → 사본, `"conflict"`, A 의 쓰기는 그대로 끝난다.
    - 내려앉은 뒤: A 가 쓰고 내려앉음 → B 의 `onSettled` 한 번 → B 가 `write(bb, h0)` 하면 사본, `"conflict"`. B 가 `read()` 한 뒤의 `write(bb2, head)` 는 받는다.
  - **N2 — 거절된 쓰기의 사본이 실패**(오프라인): 위 「내려앉기 전」 에서 B 의 사본 `create` 가 `failed` → `copies` 에 남고 `unsavedDataFiles()` 에 경로, **A 의 `replace(path, a1, h0)` 는 그대로**(B 바이트는 원본 경로로 가지 않는다), `flushDataFiles()` → 사본 `create` 를 다시 해 성공하면 true. A 의 409 뒤 사본이 실패해도 같다(원본 경로에 다시 쓰지 않는다).
  - **N1 — 다시 붙는 위젯(사본이 생기지 않는다)**, 끔에서:
    - 화면 밖 스크롤: A `write(a1, h0)` → A `release()` → 같은 경로 C `openDataFile`·`read()` → 바이트 `a1`, 해시 h0 → C `write(c1, h0)` 받음(`create` 0회) → `flushDataFiles()` 가 `c1` 을 쓴다.
    - 미리보기 다시 그리기(drain): A `write(a1, h0)` → A `drain()` → C `read()` 시작(아직 안 풀림) → A 의 늦은 `write(a2, h0)` 받음 → A `release()` → C 의 `read()` 가 `a2` 로 풀림 → C `write(c1, h0)` 받음(`create` 0회). A 가 release 하지 않으면 `READ_DRAIN_WAIT_MS`(1250ms) 뒤 C 의 `read()` 가 풀리고, 1249ms 에는 아직 풀리지 않는다. release 한 A 의 `write(a3, h0)` → 거절, `copies` 에 들어가 사본 `create`, `"conflict"`(R1 — 조용히 버리지 않는다).
    - 전체 화면(핸들 그대로): A 가 `write` 를 연달아 다섯 번 → 모두 받음, `create` 0회.
    - 세 경우 모두 그 뒤 위 C1 세 시험을 같은 writer 로 다시 돌려도 통과한다(주인 없음이 C1 을 열지 않는다 — 다른 판에서 시작한 핸들은 여전히 거절).
  - **N4**: A 가 다섯 번 받아들여지는 동안 B 의 `onStale` 은 한 번, `onSettled` 는 내려앉은 뒤 한 번.
  - `read` 가 없는 파일 → `"missing"`.
  - `createDataFile(io, "회의록/_첨부", "스케치", ".excalidraw.json", init, 차례로 "3f9a","0001")` → 첫 `create` 가 `"exists"` 면 `"회의록/_첨부/스케치-0001.excalidraw.json"`. `dataFileStem("a/b:c")` → `"a b c"`.
- [ ] **Step 2: 실패 확인** — `cd web && pnpm exec vitest run src/widgets/dataFile.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `FRAME_DRAIN_MS`(1000)·`READ_DRAIN_WAIT_MS`(1250)는 Task 8 의 `layout.ts` 가 아니라 여기서 정의하고 Task 8 이 가져다 쓴다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS, web 전체·`pnpm typecheck`.
- [ ] **Step 5: 커밋** — `git add web/src/widgets/dataFile.ts web/src/widgets/dataFile.test.ts` → `feat(web): keyring-widget 데이터 파일 쓰기 — 모아 쓰기·비우기·충돌 사본`

> **── 검문 1 (Task 1–4): core 링크·경로, 앱 CSP, 데이터 파일 쓰기 규칙. 화면 변화 없음 — 시험과 코드 리뷰로 본다. 여기서 CSP 해시 강제(Task 3)와 덮어쓰지 않음(Task 4)을 특히 본다. ──**

### Task 5: web — 레지스트리를 iframe 위젯으로 넓힌다(코드 원천·제3자 글 자리)

**Files:**
- Modify: `web/src/widgets/types.ts`(`dataFile` 모양, `WidgetContext.fullscreen?`), `web/src/widgets/registry.ts`, `web/src/i18n.ts`(`messageChain()`), `packages/core/src/i18n.ts`(`lookup`·`interpolate`·`pluralOf` 를 옮기고 다시 내보냄 — `pluralOf` 는 지금 내부 함수라 `lookup.ts` 에서 함께 옮긴다), `packages/core/package.json`(`exports` 에 `"./lookup": { "keyring-source": "./src/lookup.ts", "types": "./dist/lookup.d.ts", "default": "./dist/lookup.js" }`)
- Create: `packages/core/src/lookup.ts`(메시지 JSON 을 import 하지 않는다), `web/src/widgets/widgetT.ts`(React·`web/src/i18n.ts` 를 부르지 않는다 — 런타임 묶음이 쓴다), `web/src/widgets/messages.ts`, `web/src/widgets/frame/protocol.ts`
- Test: `web/src/widgets/registry.test.ts`, `web/src/widgets/messages.test.ts`, `web/src/widgets/frame/protocol.test.ts`, core `packages/core/test/i18n.test.ts`(그대로 통과)

**Interfaces:**
- Consumes: 1단계 레지스트리, core `lookup`(`@keyring-notes/core/lookup`).
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
  // widgetT.ts — import 는 `@keyring-notes/core/lookup` 하나
  export type MessageChain = { messages: Record<string, string>; locale: string }[];
  export function widgetT(chain: MessageChain, key: string, vars?: object): string; // core lookup
  // messages.ts — 부모 쪽(web i18n 을 부른다)
  export function widgetMessages(entry: WidgetEntry, lang: string): MessageChain; // 앞머리: messageChain() 의 각 단계에서 `${prefix}.` 키만, 앞머리를 뗀다. 표: [표[lang], 표[lang 의 앞 낱말], 표.en] 중 있는 것
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
- [ ] **Step 4: 통과 확인** — core·web 전체·`pnpm typecheck`·`pnpm --filter @keyring-notes/core build`(dist 에 `lookup.js` — 서버가 dist 를 쓴다).
- [ ] **Step 5: 커밋** — `git add packages/core/src/lookup.ts packages/core/src/i18n.ts packages/core/package.json web/src/widgets/widgetT.ts web/src/widgets/types.ts web/src/widgets/registry.ts web/src/widgets/registry.test.ts web/src/widgets/messages.ts web/src/widgets/messages.test.ts web/src/widgets/frame/protocol.ts web/src/widgets/frame/protocol.test.ts web/src/widgets/mount.ts web/src/i18n.ts` → `feat(web): keyring-widget 레지스트리에 iframe 위젯 — 코드 원천과 위젯 글 자리`

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
    file: DataFileHandle | null; fullscreen: (() => void) | null }): WidgetApi; // api.t = widgetT(messages())
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
    navigated(): void;              // 두 번째 ready — 문서가 바뀌었다(C2). 호스트는 그 뒤 아무 메시지에도 답하지 않는다
    code: { runtime: string; widget: string; css: string; fonts: Record<string, ArrayBuffer> };
  }
  export class FrameHost {
    constructor(o: FrameHostOptions);
    receive(msg: FrameMsg): void;   // 순서: 첫 ready 에 load(runtime)·load(widget) 를 연달아 보낸다(부트스트랩이 async=false 로 붙여 그 순서로 돈다) → 위젯이 keyringWidgetRegister 를 불러 registered → init. 런타임은 registered 전에는 아무것도 보내지 않으므로 위젯 load 를 런타임 메시지를 기다려 보내면 교착이다(리뷰 I7)
    update(): void;                 // ctx·(언어가 바뀌었으면) messages 를 보낸다
  }
  ```
  런타임 규칙: `api.setState`·`requestEdit`·`exitEdit` 는 보내기만, 상태는 호스트 `update` 로 돌아온 `ctx` 로 `onUpdate`. `api.t` = `widgetT(받은 사슬)`. `init.file` 이면 `api.file`(req 번호로 짝, 바이트는 transfer), 아니면 없음. `init.fullscreen` 이면 `api.toggleFullscreen`. 키: `widgetKeyAction(e) === "escape"` 이고 `!defaultPrevented` → `{ key: "escape" }`. `mod && key` 가 `s`/`S` → `preventDefault()` 후 `{ key: "save" }`. 호스트 규칙: `setState` → `session.setState`, `requestEdit`·`exitEdit` 같은 이름, `fileRead`/`fileWrite` → `file` 핸들(없으면 `denied`), `key: "escape"` → 전체 화면이면 `exit()` 만, 아니면 `session.escape()`, `key: "save"` → `save()`, `height` → `height(px)`, `blur` → `blurred()`, `error` → `failed`.

- [ ] **Step 1: 실패하는 시험** —
  - `runtime.test.ts`(가짜 env): `init` 전 `register` → `registered` 한 번. `init` → `render(root, ctx, api)` 한 번, `setTheme(ctx.theme)`·`addCss`·`setFonts`. `api.t("a")` 가 받은 사슬로. `init.file: false` → `api.file` 없음. `api.file.read()` → `fileRead` req 0, `reply ok` → 풀림, `reply error "conflict"` → 거절(`.code === "conflict"`). Esc(`defaultPrevented: false`) → `{ key: "escape" }`, `defaultPrevented: true` → 없음, `isComposing: true`·`keyCode: 229` → 없음. `mod` + `"s"` → `preventDefault` 불림, `{ key: "save" }`. 높이 `observeHeight` 콜백 → `height`. 다른 `id` 의 `update` → 무시.
  - `host.test.ts`(가짜 post·세션 호스트): `ready` → `load`(runtime 글) 다음 `load`(위젯 글), `registered` → `init`(ctx·사슬·css·fonts, `file`·`fullscreen` 여부). 전체 화면 켬일 때 `key escape` → `exit` 만, 세션 수정 그대로. 끔 + 수정 중 → 초안 버림(`write` 없음). `fileWrite` 인데 `file` null → `reply ok:false error:"denied"`. `save` → `save()`. 두 번째 `ready` → `navigated()` 한 번, `load` 를 다시 보내지 않고, 그 뒤 `fileRead`·`registered` 에 `post` 가 하나도 없다(C2).
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
  빌드: `buildStart` 에서 진입마다 vite `build({ configFile: false, logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' }, oxc: { jsx: { runtime: "automatic", importSource: "react" } }(`configFile: false` 라 웹 설정의 `@vitejs/plugin-react` 가 없다 — `.tsx` 진입의 JSX 를 여기서 정한다, 리뷰 M8), resolve: { conditions: 웹과 같게, alias }, build: { write: false, minify: true, rollupOptions: { input: entry, output: { format: "iife", inlineDynamicImports: true } } } })`, `generateBundle` 에서 `this.emitFile({ type: "asset", fileName: frameAssetName(…), source })`(js·`inlineCssFonts` 한 css·글꼴 파일), 크기를 `this.info` 로 찍고 `frameSizeErrors` 가 있으면 `this.error`. `virtual:widget-frames` 는 주소 표. 개발 서버(`configureServer`)는 같은 빌드를 한 번 돌려 `/widget-frame/*` 를 메모리에서 낸다. `/widget-frame/` 은 `assets/` 밖이라 SW `LAZY`(설치 때 받아 두기)에 들지 않고 처음 쓸 때 SW 가 캐시한다.

- [ ] **Step 1: 실패하는 시험** — `widgetFrames.test.ts`: `frameAssetName("runtime", "abc", ".js")` → `widget-frame/runtime-ba7816bf.js`. `inlineCssFonts('@font-face{src:url(./fonts/Assistant/A-1.woff2) format("woff2")}', 읽기)` → `data:font/woff2;base64,` 로 바뀜, 못 읽으면 그대로. `frameSizeErrors([{ name: "runtime", gzip: 20481 }, { name: "excalidraw", gzip: 2_097_152 }])` → 하나(runtime). `sw.test.ts`: `/widget-frame/x.js` 에 HTML 응답 → 캐시하지 않음. server: dist 를 단 앱에 `GET /widget-frame/없음.js` → 404, `GET /widget-frame/있음.js` → 200(임시 dist).
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현** — 위 「빌드」. `licenseNotices` 는 `extraModules: () => string[]` 를 받아 `bundlePackages` 에 더한다(묶임 검사도 같이).
- [ ] **Step 4: 통과 확인** — 시험 PASS. `cd web && pnpm build` → 출력에 `widget-frame runtime: N B gzip`, `dist/widget-frame/runtime-*.js` 있음, `dist/sw.js` 의 LAZY 에 `widget-frame` 없음, `dist/licenses.txt` 가 바뀌지 않음(런타임은 제3자 모듈이 없다 — Task 10 에서 늘어난다). 런타임 gzip 이 20480 보다 작다(넘으면 `@keyring-notes/core` 본체나 `web/src/i18n.ts` 가 끌려온 것 — 런타임 쪽 import 는 `@keyring-notes/core/lookup`·`widgetT.ts`·`protocol.ts`·`session.ts` 의 `widgetKeyAction` 만이어야 한다). `FRAME_RUNTIME_GZIP_LIMIT` 를 잠시 `1` 로 → 빌드가 떨어지는지 보고 되돌린다(`git diff` 확인).
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
  /** iframe 문서가 srcdoc 하나뿐인지 지킨다(리뷰 C2): 첫 load·첫 ready 는 "ok", 두 번째부터 "kill". kill 뒤에는 무엇이든 "kill" */
  export function frameGuard(): { load(): "ok" | "kill"; ready(): "ok" | "kill"; killed(): boolean };
  /** 창 message 하나를 어떻게 볼까(재리뷰 N3): source 가 잡아 둔 win 이 아니면 ignore, 맞는데 origin 이 "null" 이 아니면 kill, 아니면 accept */
  export function frameEventAction(e: { sourceIsFrame: boolean; origin: string }): "accept" | "ignore" | "kill";
  // FRAME_DRAIN_MS(1000) 는 Task 4 dataFile.ts 의 것을 쓴다 — 지운 iframe 이 이미 보낸 fileWrite 를 받아 줄 시간(리뷰 I2)
  // source.ts
  export function resolveFrameCode(c: FrameCode, get: { text(url: string): Promise<string>; bytes(url: string): Promise<ArrayBuffer> }): Promise<{ js: string; css: string; fonts: Record<string, ArrayBuffer> }>;
  // mountFrame.ts — mount.ts 가 부른다(세션·ctx·listeners·뿌리는 mount 가 만든 것)
  export function mountFrame(content: HTMLElement, o: { root: HTMLElement; entry: FrameWidgetEntry; session: WidgetSession; ctx(): WidgetContext;
    file: DataFileHandle | null; display: "block" | "inline"; onUpdate(cb: () => void): void; failed(): void }): { destroy(): void };
  ```
  접착: `iframe.sandbox = "allow-scripts"`, `srcdoc = frameSrcdoc()`, 인스턴스 id = `crypto.randomUUID()`. iframe 을 붙인 직후 `const win = iframe.contentWindow` 를 잡아 두고, `window` `message` 는 `frameEventAction({ sourceIsFrame: e.source === win, origin: e.origin })` 가 accept 인 것만 `parseFrameMsg(e.data, id)` → `host.receive`(kill 이면 아래 자기 탐색과 같은 길)(DOM 에서 빠진 뒤 `iframe.contentWindow` 는 `null` 이라 그것과 비교하면 전송 중 메시지를 버린다 — 리뷰 I2). **자기 탐색(C2):** `iframe` 의 `load` 마다, 그리고 `ready` 마다 `frameGuard()` 에 묻고 `"kill"` 이면(FrameHost 의 `navigated()` 도 같은 길) 리스너를 떼고 iframe 을 지운 뒤 위젯 자리에 `kw.frameNavigated` + 원문 — 그 뒤 그 인스턴스에는 어떤 메시지에도 답하지 않는다(파일 핸들은 `release`). 코드는 `resolveFrameCode(virtual 표의 runtime)` + `resolveFrameCode(await entry.frame())`(실패 → `failed()` → mount 의 `kw.loadFailed` + 원문). 높이 `frameHeight(px, innerHeight, fullscreen)`, `resize` 에 다시 잰다. 포커스 아웃: 뿌리 `focusout`(마이크로태스크 뒤, 1단계와 같은 길)과 `blurred()` 둘 다 `focusOutAction({ rootConnected: root.isConnected, relatedInside: frameFocusInside(…) })` 가 `"apply"` 일 때 `session.focusOut()`. 테마·언어 바뀜은 mount 의 `onUpdate` 로 `host.update()`. 전체 화면(`display: "block"` 만): 위젯 머리에 단추, 감싸개 `popover="manual"`·`showPopover()`/`hidePopover()`, 켜고 끌 때 `host.update()`(ctx.fullscreen)·높이 다시 재기, 감싸개 `keydown` Esc → `exit`. `save()` → `window.dispatchEvent(new Event("keyring:save"))`(Task 9 가 받는다). `destroy` → 파일 핸들 `drain()`, iframe 을 지우고(핸들을 곧바로 놓지 않는다 — Task 9 의 `destroy` 와 같은 규칙: iframe 위젯은 `mountFrame` 이 drain·release, 인라인 위젯만 곧바로 release), `FRAME_DRAIN_MS` 동안은 `win` 에서 온 `fileWrite` **만** 받아 파일 핸들에 넘긴 뒤(답은 보내지 않는다) 리스너를 떼고 핸들을 `release`. 전체 화면: `popover` 속성은 들어갈 때 달고 나올 때 뗀다(달려 있으면 닫힌 동안 `display: none`), `"showPopover" in HTMLElement.prototype` 이 거짓이면 `.kw-frame-wrap.kw-fixed`(`position: fixed; inset: 0`) 로 대신한다(리뷰 M2).

- [ ] **Step 1: 실패하는 시험** — `frameEventAction({ sourceIsFrame: false, origin: "null" })` ignore, `({ sourceIsFrame: true, origin: "https://x" })` kill, `({ sourceIsFrame: true, origin: "null" })` accept. `frameGuard()`: `load()` "ok", `ready()` "ok", 다시 `load()` "kill", 그 뒤 `ready()` "kill"·`killed()` true. 새 guard 에서 `ready()` 두 번 → 둘째 "kill". `frameHeight(300, 1000, false)` 300, `(900, 1000, false)` 800, `(10, 1000, false)` 48, `(300.2, 1000, false)` 301, `(300, 1000, true)` 1000. `frameFocusInside` 넷. `resolveFrameCode({ kind: "text", js: "x" }, …)` → `{ js: "x", css: "", fonts: {} }`(받기 없음), `{ kind: "url", js: "/a.js", css: "/a.css", fonts: { "E/a.woff2": "/f/a.woff2" } }` → 세 번 받아 채움, 하나라도 실패 → 거절.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현** — 위 「접착」. messages 에 `kw.frameNavigated`("The widget tried to leave its page and was stopped"/"위젯이 다른 페이지로 이동하려 해 멈췄습니다").
- [ ] **Step 4: 통과 확인** — web 전체·`pnpm typecheck`·`cd packages/core && pnpm exec vitest run test/i18n.test.ts`.
- [ ] **Step 5: 브라우저 한 번(Chromium·Playwright webkit)** — 개발 서버에서 `keyring/dday-frame` 블록이 iframe 으로 그려지고 보기·수정·포커스 아웃 적용·Esc 버림이 인라인 D-day 와 **동작이** 같은지(iframe 안에는 앱 CSS 가 없어 모양은 다르다 — 견주지 않는다, 리뷰 M10). iframe 문맥에서 `location.href = "https://example.com"` → 위젯 자리가 `kw.frameNavigated` 로 바뀌고 iframe 이 DOM 에서 사라진다. 자세한 확인은 Task 11.
- [ ] **Step 6: 데스크톱 앱(WKWebView, `tauri://`) — 구조가 걸린 확인이라 여기서 한다(리뷰 I6)** — `pnpm app:dev` 로 `keyring/dday-frame` 블록 하나를 연다(`docs/guideline/base/08-shared-resources.md` 를 따라 띄우고 끈다). 넷을 본다: ① 개발자 도구 콘솔에 앱 CSP 위반(`Refused to …`)이 없고 위젯이 그려진다(Tauri 가 덧붙이는 해시·nonce 가 있어도 부트스트랩·`blob:` 이 돈다) ② iframe 문맥에서 `typeof window.__TAURI_INTERNALS__ === "undefined"` ③ iframe 문맥에서 `window.webkit?.messageHandlers` 로 앱 명령(예: `ipc` 핸들러에 `plugin:app|version` 형식의 요청)을 보내도 응답·부수 효과가 없다 ④ 부모가 받은 srcdoc iframe 메시지의 `e.origin` 이 실제로 `"null"` 이다(아니면 `frameEventAction` 이 모든 위젯을 kill 한다 — 재재리뷰). **하나라도 실패하면 이 Task 를 커밋하지 말고 그 자리에서 멈춰 escalation**(`orca orchestration send --type escalation`, 본 것과 콘솔 글을 붙여) — 부트스트랩 방식 자체를 다시 정해야 하는 일이다. 못 띄우면(빌드 실패 등) 못 본 것으로 escalation 한다(건너뛰지 않는다).
- [ ] **Step 7: 커밋** — `git add web/src/widgets/frame/mountFrame.ts web/src/widgets/frame/source.ts web/src/widgets/frame/layout.ts web/src/widgets/frame/layout.test.ts web/src/widgets/frame/source.test.ts web/src/widgets/mount.ts web/src/styles.css packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `feat(web): keyring-widget iframe 호스트 — 높이·포커스 아웃·테마·전체 화면`

> **── 검문 2 (Task 5–8): iframe 연결 전부(데이터 파일 연결 전). `keyring/dday-frame` 으로 두 연결이 같은지 시험(equivalence)과 개발 서버에서 본다. 메시지 출처 검사·자기 탐색(`frameGuard`)·Esc 순서·포커스 판정, 그리고 **Task 8 Step 6 의 데스크톱 앱 확인 결과(CSP 위반 없음·`__TAURI_INTERNALS__` 없음·IPC 못 부름)** 를 특히 본다 — 이것이 없으면 검문 2 를 통과시키지 않는다. ──**

### Task 9: web — 데이터 파일을 호스트에 잇는다(넣기·이력 보기·없음·충돌·비우기 시점)

**Files:**
- Modify: `web/src/widgets/mount.ts`(정의에 `dataFile` 이 있으면 `widgetDataPath` → `openDataFile` → `bindWidgetApi`/`mountFrame` 에 핸들, 머리에 상태), `web/src/widgets/PreviewKeyringWidget.tsx`·`web/src/DocPane.tsx`(`history: !!revision`, `owner: doc.path` 를 넘긴다), `web/src/Editor.tsx`·`web/src/widgets/liveWidget.ts`(편집기 prop `widgetOwner`(= `doc.path`)를 `Facet` `widgetOwnerFacet` 으로 두고 Live Preview 위젯이 읽는다), `web/src/widgets/registry.ts`(`widgetInsertText(def, state?)`), `web/src/Workspace.tsx`(아래 연결), `web/src/styles.css`, messages — 아래
- Create: `web/src/widgets/dataFileIo.ts`(`api` 위의 `DataFileIO`)
- Test: `web/src/widgets/registry.test.ts`, `web/src/widgets/dataFileIo.test.ts`, `web/src/closeWindow.test.ts`(닫기 지킴 판정을 떼어 낸 함수). `closeTab`·노트 바꾸기·`warn` 의 연결은 Node 시험이 없다 — 판단은 Task 4 의 `flushDataFiles(owner)`·`discardDataFiles` 가 지고 접착은 Task 11 브라우저 확인과 리뷰가 본다.

**Interfaces:**
- Consumes: Task 1 `widgetDataPath`, Task 4 전부, Task 8 `mountFrame`.
- Produces:
  ```ts
  // MountOptions 에 history?: boolean (이력 보기 — 데이터 파일 위젯은 그리지 않는다), owner: string (그 위젯이 든 노트 경로 — openDataFile 의 owner)
  export const widgetOwnerFacet: Facet<string, string>; // liveWidget.ts — 편집기의 노트 경로
  export function apiDataFileIO(a: Pick<VaultApi, "readBytes" | "replaceAttachment" | "uploadAttachment">): DataFileIO; // ApiError 409 → conflict/exists, 404·fileNotFound → missing
  export function widgetInsertText(def: WidgetDefinition, state?: unknown): string; // state 를 주면 그것으로
  // closeWindow.ts
  export function closeGuarded(o: { desktop: boolean; dirtyDocs: number; unsavedFiles: number }): boolean;
  // Workspace.tsx 안
  const unsavedFiles = useSyncExternalStore(onDataFilesChange, () => unsavedDataFiles().join("\0")); // 모듈 표가 바뀌면 다시 그려 지킴을 다시 계산(리뷰 I3)
  ```
  호스트 규칙: `dataFile` 위젯이면 — `history` → 위젯 대신 `kw.historyNoFile` + 경로(파일을 읽지 않는다). `widgetDataPath(state, ext)` null → `kw.badFile` + 원문. 첫 `read` 가 `missing` → `kw.fileMissing` + 경로(만들지 않는다). 머리: 끔이고 `unsaved` → `kw.unsavedDrawing`, `conflictCopy` → 알림 `kw.fileConflict`(경로, 「열기」 동작) 후 위젯을 다시 그린다(다시 읽기). `onStale` → 머리에 `kw.fileStale`, `ctx.readOnly` 를 true 로 `update`(Excalidraw 는 보기 전용 — 이 위젯이 쓰면 어차피 거절되므로 그리지 못하게), 다시 그리지 않는다. `onSettled` 이고 stale 이면 **한 번** 다시 그린다(다시 읽기 — 재리뷰 N4: 받아들임마다 iframe 을 새로 만들지 않는다). 블록의 `state.file` 이 바뀐 바깥 변경 → 다시 그린다. 포커스 아웃(수정 끝과 같은 판정) → 켬이면 그 핸들의 writer 를 비운다. `destroy` → **iframe 위젯은 핸들을 여기서 놓지 않는다 — `mountFrame` 이 `drain()` 하고 `FRAME_DRAIN_MS` 뒤 `release()` 한다(Task 8 「접착」 의 `destroy` 와 같은 규칙). 인라인 위젯만 곧바로 `release()`**(재재리뷰 R1). 어느 쪽이든 자동 저장 끔이면 바이트는 writer 에 남는다 — 화면 밖 스크롤·미리보기 다시 그리기로 곧 다시 붙는 경우. 탭 닫기·노트 바꾸기는 아래 Workspace 가 먼저 비운다.
  Workspace 연결(빠짐없이):
  - 「위젯 넣기」 의 `dataFile` 위젯 → `createDataFile(apiDataFileIO(api), attachmentDirFor(getVaultSettings(), wsOfPath(doc.path), uiLang), dataFileStem(name), ext, initial())` 성공 뒤 `widgetInsertText(def, { ...def.defaultState(), file })`(실패 → `toastError`, 넣지 않음), 그 뒤 `vaultChanged()`·`refreshTree()`.
  - `save()`(Mod+S·명령)와 `keyring:save` 이벤트 → 노트 저장 + `flushDataFiles()`.
  - **`closeTab`(코디네이터 결정, `Workspace.tsx:1239` 선례)**: 노트 `flush([path])` 다음에 다른 칸에 그 노트가 열려 있지 않으면 `await flushDataFiles(path)` — 자동 저장 설정과 상관없이. false 면 노트처럼 `confirmDialog(t("kw.discardDrawingClose", { name }), t("tab.discardCloseButton"))` → 취소면 닫지 않음, 버리기면 `discardDataFiles(path)` 후 닫는다. 노트 버림 물음과 같이 떠야 하면 한 번만 묻는다(둘 다 실패면 노트 문구 하나로).
  - **노트 바꾸기**(`open` 이 칸의 지금 탭을 다른 노트로 바꿀 때 — `Workspace.tsx` `open` 의 `replaced` 자리, 그 노트가 다른 칸에 없으면): 같은 `flushDataFiles(옛 경로)` → 실패면 같은 물음, 취소면 바꾸지 않는다. 노트 초안은 지금처럼 저장소에 남기므로 이것은 노트 선례가 아니라 코디네이터 결정의 새 규칙이다 — 코드 주석에 그렇게 적는다.
  - **노트 이동·이름 바꾸기**(Workspace 가 열린 문서의 경로를 바꾸는 자리 — `docsRef`·탭 경로를 옮기는 곳): `renameDataFileOwner(옛 경로, 새 경로)`(폴더 이동이면 폴더 경로로). 안 하면 `closeTab` 이 새 경로로 비우려 해 그 노트의 그림이 남는다(재리뷰 N6).
  - `visibilitychange` hidden → (켬일 때) `flushDataFiles()`.
  - 닫기 지킴: `guarded = closeGuarded({ desktop: canCloseWindow(), dirtyDocs: dirtyPaths(docs).length, unsavedFiles: unsavedFiles ? unsavedFiles.split("\0").length : 0 })`. `closeWindowSafely` 의 `dirty` 에 `unsavedDataFiles()`, `save` 에 `flushDataFiles()`.
  - **`reloadSafely`(PWA 「새로 고침」, 리뷰 I3)**: `dirty` 에 `unsavedDataFiles()`, `save` 에 `flushDataFiles()`.
  - **`beforeunload` `warn`**: 조건에 `unsavedDataFiles().length`, 켬이면 `void flushDataFiles()` 도 부른다.
  - `openDataFile` 옵션: `autosave`·`delay` 는 `getPrefs()`, `conflictLabel` 은 `vaultText(vaultLang()).conflictCopy`, **`held` 는 `() => savesHeld(closeHold.current)`**(리뷰 M11 — 닫기 묻는 동안 그림도 쓰지 않는다). 옵션 객체는 Workspace 가 `setDataFileOptions(o)` 로 한 번 걸고, 호스트는 `openDataFile(path, ext, owner, apiDataFileIO(api), dataFileOptions())` 로 연다 — 위젯 호스트는 Workspace 를 모른다.
  messages: `kw.historyNoFile`("Drawings are not shown in history view: {path}"/"이력 보기에서는 그림을 보이지 않습니다: {path}"), `kw.badFile`("The widget's data file path is invalid"/"위젯의 데이터 파일 경로가 올바르지 않습니다"), `kw.fileMissing`("File not found: {path}"/"파일을 찾을 수 없습니다: {path}"), `kw.unsavedDrawing`("Unsaved drawing"/"저장하지 않은 그림"), `kw.fileConflict`("This file was changed elsewhere. Your version was saved as {path}"/"다른 곳에서 이 파일이 바뀌었습니다. 고친 내용은 {path} 로 저장했습니다"), `kw.fileFailed`("Couldn't save the file"/"파일을 저장하지 못했습니다"), `kw.fileStale`("Being edited in another pane — it will reload when saved"/"다른 칸에서 고치는 중입니다 — 저장되면 다시 읽습니다"), `kw.discardDrawingClose`("Couldn't save the drawing in {name}. Close without saving it?"/"{name} 의 그림을 저장하지 못했습니다. 저장하지 않고 닫을까요?").

- [ ] **Step 1: 실패하는 시험** — `widgetInsertText(def, { file: "a/b.x.json" })` 의 본문 `state` 가 그것. `apiDataFileIO`: 가짜 api 의 `ApiError(409)` → `DataFileError("conflict")`(replace)·`("exists")`(create), `ApiError(404)` → `"missing"`, 그 밖 → `"failed"`; `replace` 는 `Blob` 으로 넘긴다. `closeGuarded({ desktop: true, dirtyDocs: 0, unsavedFiles: 1 })` true, `desktop: false` → false, 둘 다 0 → false. `closeWindow.test.ts` 의 `reloadAfterSaving`·`closeWindowSafely` 시험에 「노트는 깨끗하고 `dirty` 가 그림 경로만 줌」 → 묻고 `save` 가 불린다(지금 함수가 `dirty` 를 그대로 쓰는지 고정).
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현** — 위 규칙. 데이터 파일 경로와 이력 보기 판정은 `mount.ts` 한 곳에서(인라인·iframe 공통).
- [ ] **Step 4: 통과 확인** — web 전체·`pnpm typecheck`·i18n 시험. 개발 서버에서 시험용 데이터 파일 위젯(Task 10 전이면 `keyring/dday-frame` 에 잠시 `dataFile` 을 단 지역 변경 — 커밋하지 않는다) 으로 넣기·이력 보기·파일 지움을 한 번 본다.
- [ ] **Step 5: 커밋** — `git add web/src/widgets/mount.ts web/src/widgets/PreviewKeyringWidget.tsx web/src/DocPane.tsx web/src/widgets/registry.ts web/src/widgets/registry.test.ts web/src/widgets/dataFileIo.ts web/src/widgets/dataFileIo.test.ts web/src/widgets/dataFile.ts web/src/widgets/liveWidget.ts web/src/Editor.tsx web/src/Workspace.tsx web/src/closeWindow.ts web/src/closeWindow.test.ts web/src/styles.css packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `feat(web): keyring-widget 데이터 파일 — 넣기·이력 보기·파일 없음·충돌 사본·비우기 시점`

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
  /** 열기만 해서는 쓰지 않게(리뷰 I1): 처음 불러온 장면의 직렬화를 기준선으로 두고, onChange 마다 값싼 열쇠(장면 판 + files 키)로 먼저 거른 뒤에만 직렬화한다 */
  export function sceneKey(sceneVersion: number, fileIds: string[], appState: Record<string, unknown>): string; // `${sceneVersion}:${정렬한 fileIds.join(",")}:${JSON.stringify(내보내는 appState 값을 키 순서로)}` — 배경색·격자만 바꿔도 저장되게(재리뷰 N5)
  export class SceneGate {
    constructor(baselineKey: string, baselineText: string);
    /** 열쇠가 기준과 같으면 serialize 를 부르지 않고 null. 다르면 serialize() 하고 글이 기준과 같으면 열쇠만 옮기고 null, 다르면 그 글(기준을 그것으로 옮긴다) */
    next(key: string, serialize: () => string): string | null;
  }
  // fontShim.ts — frame.tsx 의 첫 import. window.FontFace 를 감싸 src 글에 "fonts/<rel>.woff2" 가 있고 setFonts 로 받은 표에 있으면 ArrayBuffer 로 만든다
  export function installFontShim(lookup: (rel: string) => ArrayBuffer | undefined): void;
  ```
  `frame.tsx`: `window.EXCALIDRAW_ASSET_PATH = "/"`(주소는 끝내 쓰지 않는다 — 글꼴은 shim 이 바이트로), `window.EXCALIDRAW_EXPORT_SOURCE = "keyring-notes"`(srcdoc 에서 `location.origin` 은 `"null"` 이라 이것이 없으면 `source` 가 파일마다 달라진다). `keyringWidgetRegister(render)`: `api.file.read()` → `parseScene`(null → 위젯 안 오류 한 줄, 쓰지 않음) → `<Excalidraw initialData …>`(`viewModeEnabled = !ctx.editable || ctx.readOnly`, 테마·언어는 ctx, `UIOptions` 로 불러오기·파일 저장 숨김). 기준선은 첫 `onChange` 가 아니라 **불러온 장면**으로 만든다(첫 onChange 가 사용자의 획이면 그 획이 기준선이 되어 쓰이지 않는다 — 재리뷰 N5): `restore(parseScene 결과, null, null)` 의 elements·appState·files 로 `new SceneGate(sceneKey(getSceneVersion(elements), Object.keys(files), 내보내는 appState), serializeAsJSON(elements, appState, files, "local"))`. 「내보내는 appState」 는 `serializeAsJSON(…, "local")` 이 싣는 appState 키(최소 `viewBackgroundColor`·`gridSize`·`gridStep`·`gridModeEnabled` — 구현자가 0.18.1 소스에서 목록을 확인해 상수로 둔다). 그 뒤 `onChange` 마다 `gate.next(sceneKey(…), () => serializeAsJSON(elements, appState, files, "local"))` 가 글을 주면 `api.file.write(utf8(글), base)` 하고 풀린 해시를 `base` 로(거절이면 그리기를 멈추고 호스트가 다시 그리기를 기다린다). 리뷰 M3: `UIOptions.canvasActions` 에서 이미지 내보내기(`saveAsImage`·`export`)를 끄고, `onLinkOpen` 은 `event.preventDefault()` 만(링크로 iframe 이 옮겨 가지 않게 — C2). 높이: `ctx.fullscreen ? "100vh" : "480px"`. 자체 실행 취소는 Excalidraw 것.
  라이선스: `@excalidraw/excalidraw` 는 패키지에 LICENSE·author 가 없다 → `HOLDERS` 에 원저장소 LICENSE 의 저작권자(github.com/excalidraw/excalidraw `LICENSE` 를 보고 적는다). 실은 글꼴 파일마다 `kind: "bundled"`, `via: "@excalidraw/excalidraw"`, 전문 `web/licenses/bundled/`(글꼴마다 라이선스를 원저장소에서 확인 — OFL-1.1 이 많다). `dist/prod/*.js` 에 소스맵이 없으므로 미리 묶인 남의 코드가 있는지 직접 본다(가이드 「묶임 검사」).

- [ ] **Step 1: 실패하는 시험** — `parseScene(utf8(EMPTY_SCENE))` → 빈 elements, `parseScene(utf8("{"))` null, `parseScene(utf8('{"type":"x"}'))` null(type 이 excalidraw 아님). `SceneGate`: `new SceneGate("1:", "T")` 에 `next("1:", f)` → null 이고 `f` 를 부르지 않는다(**열고 아무것도 안 하면 쓰기 0회**), `next("2:", () => "T")` → null(글이 같음 — 선택만 바뀐 경우), `next("3:", () => "U")` → `"U"`, 다시 `next("3:", f)` → null. `sceneKey(5, ["b", "a"], { viewBackgroundColor: "#fff" })` → `'5:a,b:{"viewBackgroundColor":"#fff"}'`, appState 만 다르면 키가 다르다. `excalidrawDef` 값이 위와 같고 `widgetInsertText(excalidrawDef, { file: "a/스케치-3f9a.excalidraw.json" })` 본문이 `parseWidgetBlock` ok, `widgetDataPath(그 state, ".excalidraw.json")` 가 그 경로.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현과 등록** — `registerBuiltins` 에 `{ def: excalidrawDef, builtIn: true, messages: "kw.excalidraw", frame: async () => ({ kind: "url", ...frames.excalidraw }) }`.
- [ ] **Step 4: 통과 확인** — web 전체·`pnpm typecheck`. `cd web && pnpm build` → `widget-frame excalidraw: N B gzip` 한 줄(2,097,152 보다 작다 — 실험 값 약 1.6MB), `dist/widget-frame/` 에 js·css·글꼴(Xiaolai 없음), `licenses.txt` 에 `@excalidraw/excalidraw`·`roughjs`·`jotai` 등과 글꼴 줄, 빌드가 고지 누락으로 멈추지 않는다. 인라인 크기 시험(1단계)은 그대로 D-day 만 잰다.
- [ ] **Step 5: 커밋** — `git add web/package.json pnpm-lock.yaml web/vite.config.ts web/src/widgets/excalidraw web/src/widgets/builtins.ts web/licenses/manual.ts web/licenses/bundled packages/core/src/messages/en.json packages/core/src/messages/ko.json` → `feat(web): 내장 위젯 Excalidraw(iframe, 데이터 파일)`

### Task 11: 사용자 문서·개발 문서와 전체 확인

**Files:**
- Modify: `docs/manual/en/how-to/use-widgets.md`(원본), `docs/manual/ko/how-to/use-widgets.md` — 「노트 안 위젯」 절에 Excalidraw: 넣으면 첨부 폴더에 그림 파일이 생기고 블록에는 경로만, 그리는 대로 저장(자동 저장 간격·끔이면 「저장하지 않은 그림」 과 `Mod+S`), 전체 화면·Esc, 다른 곳에서 바뀌면 충돌 사본, 같은 그림을 두 곳에서 열 때 한쪽에서 그리면 다른 쪽은 「다른 칸에서 고치는 중」 보기 전용이 되고 저장이 끝나야 다시 읽는다 — 자동 저장 끔이면 그쪽에서 `Mod+S`·탭 닫기를 할 때까지, 서버 볼트 오프라인이면 다시 연결될 때까지 보기 전용으로 남는다(재재리뷰 R3), 이력 보기에서는 그림이 보이지 않음(첨부 이력으로 본다), 첨부를 옮기면 블록 경로도 바뀜, 블록을 지워도 파일은 남음, 탭을 닫거나 노트를 바꾸면 자동 저장 설정과 상관없이 그림을 저장하고 못 하면 물음, 미리보기에서 다른 칸이 노트를 고치거나 긴 노트에서 그림을 화면 밖으로 스크롤하면 그림이 다시 열려 실행 취소 기록·보던 위치가 사라짐, iframe 안에서는 앱 단축키가 `Mod+S` 말고는 먹지 않음, 이미지 내보내기·클립보드 권한이 없음, 처음 쓸 때 내려받음(오프라인이면 한 번 연 뒤부터 — 앱이 두 번 업데이트되면 다시 받는다), 서버 볼트에서 오프라인이면 그림이 저장되지 않고 「저장하지 못함」 으로 남음(노트와 다름), 깨진 링크 점검은 끝 이름이 같은 다른 파일이 있으면 없는 그림 파일을 못 잡을 수 있음.
- Modify: `docs/manual/{en,ko}/reference.md` — `### keyring-widget blocks` 에 `state.file`(볼트 기준 경로, 정규형) 한 단락.
- Modify: `docs/guides/development.md` — 새 절 「위젯 iframe 과 CSP」: 위 「CSP 실험」 표 요약, 고른 방법과 근거, 부트스트랩을 고치면 `bootstrap.test.ts` 가 찍는 새 해시를 `packages/core/src/widgetFrame.ts` 와 `app/src-tauri/tauri.conf.json` 에 넣는다는 절차, `/widget-frame/` 묶음 빌드와 크기 한도, 자기 탐색 차단(`frameGuard`), 그리고 **알려진 한계**(리뷰 C2): 위젯이 이미 가진 상태·파일 바이트를 자기 iframe 탐색 URL 이나 WebRTC(`RTCPeerConnection` 의 STUN)로 내보내는 것은 CSP·sandbox 로 막을 수 없다 — 내장 위젯은 앱 코드라 믿고, 제3자 위젯은 마켓플레이스 설계에서 다룬다(검토·서명·권한 표시 등).
- Modify: `CHANGELOG.md` — `[Unreleased]` `### Added` 한 줄.

- [ ] **Step 1: 문서** — 쓰기 전에 `docs/guideline/public-docs/02-manual.md`·`03-i18n.md`·`04-style.md` 를 읽는다.
- [ ] **Step 2: 루트 검증** — `pnpm test`(core 256·web 799·server 239 보다 늘었는지), `pnpm typecheck`, `pnpm build`(크기 줄), `pnpm fmt:check`, `pnpm lint`.
- [ ] **Step 3: 브라우저 확인(Chromium·WebKit 둘 다)** — 시험 서버(임시 `KEYRING_DATA`, 다른 포트, `docs/guides/development.md`)를 Chromium(neo 또는 Playwright)과 Playwright webkit 으로. 하나씩: 「위젯 넣기」 → Excalidraw → 첨부 폴더에 `스케치-xxxx.excalidraw.json`, 그리기 → 1.5초 뒤 파일 한 번 바뀜(git 커밋 수), 계속 그리면 멈춘 뒤 한 번, 전체 화면 들어가고(그리던 것 그대로 — iframe 을 다시 만들지 않음) Esc 로 닫힘, 글 상자 편집 중 Esc 는 전체 화면을 닫지 않음, 한글 글 상자 조합 중 Esc·Enter, iframe 안 `Mod+S`(페이지 저장 대화상자 없음), 자동 저장 끔 → 「저장하지 않은 그림」 → `Mod+S`, 끔 상태로 탭 닫고 다시 열기(그린 것 남음), 같은 노트 두 칸에서 번갈아 그리기(충돌 사본 알림·덮어쓰지 않음), 다른 창에서 같은 파일을 첨부 「내용 바꾸기」 뒤 이 창에서 그리기 → 충돌 사본, 첨부 이동 → 블록 경로 바뀜·위젯 그대로, 첨부 삭제 확인창의 「가리키는 노트」, 파일을 지움 → 「파일을 찾을 수 없습니다」, 블록 `state.file` 을 `../x.excalidraw.json` 으로 → 오류 한 줄, 이력 보기 → 안내와 경로, 미리보기 칸에서 그리는 중 다른 칸이 노트를 고침(그린 것 남음), 테마·언어 바꾸기, 390px·터치 그리기, `?local`(기기 볼트), 서비스 워커 오프라인(처음 열기 전 → 불러오지 못함과 원문 / 연 뒤 → 열림), `keyring/dday-frame`(개발 서버)과 인라인 D-day 의 보기·수정·포커스 아웃 적용·Esc 버림·`Mod+Z` 한 번이 같음(동작만). 열고 아무것도 안 하고 닫기 → 파일·커밋 그대로. 자동 저장 끔에서 그린 뒤 탭 닫기 → 그림이 저장된다(실패를 흉내 낼 수 있으면 — 서버를 끈 서버 볼트 — 버림 물음이 뜬다). 노트는 깨끗하고 그림만 저장 안 됨(끔) → PWA 「새로 고침」 물음에 든다. 긴 노트에서 그림을 화면 밖으로 스크롤했다 돌아옴 → 그린 것 남음, 그 뒤 획을 그어도 충돌 사본이 생기지 않음(끔·켬 둘 다 — 첨부 폴더 파일 수). 미리보기 칸에서 그리는 중 다른 칸에서 한 글자 → 같은 확인. 같은 그림 두 칸: A 에서 그리는 동안 B 는 「다른 칸에서 고치는 중」·보기 전용, A 가 저장된 뒤 B 가 한 번만 다시 뜸(획마다 다시 뜨지 않음). 노트 이름을 바꾼 뒤 그 탭을 닫기(끔) → 그림이 저장된다. 같은 iframe 안 복사·붙여넣기, 요소 링크 누름(옮겨 가지 않음). iframe 격리: 개발자 도구에서 iframe 문맥으로 `parent.document`·`localStorage`·`document.cookie`·`fetch("/api/tree")`·`new Image().src = "https://example.com/x"` 가 모두 막히는지, **`location.href = "https://example.com"` → 부모가 iframe 을 지우고 「위젯이 다른 페이지로 이동하려 해 멈췄습니다」 를 보이며 더 답하지 않는지**(C2).
- [ ] **Step 4: 데스크톱 앱(WKWebView, Tauri 커스텀 스킴)** — 격리(CSP·`__TAURI_INTERNALS__`·IPC)는 Task 8 Step 6 에서 이미 봤다. 여기서는 Excalidraw 로: 뜨고 그리기·저장·전체 화면(Popover 또는 대체 겹침)이 되는지, 앱 CSP 위반 콘솔이 없는지, 창 닫기(`Mod+Q`)에 쓰지 않은 그림(끔)이 물음에 드는지, 노트는 깨끗하고 그림만 남았을 때도 지킴이 켜지는지. 못 보면 못 본 것으로 적는다.
- [ ] **Step 5: 띄운 서버·탭·앱을 끈다** — `띄운 것/끈 것` 줄을 보고에 적는다.
- [ ] **Step 6: 커밋** — `git add docs/manual/en/how-to/use-widgets.md docs/manual/ko/how-to/use-widgets.md docs/manual/en/reference.md docs/manual/ko/reference.md docs/guides/development.md CHANGELOG.md` → `문서: keyring-widget 2단계 — iframe 위젯·Excalidraw·데이터 파일`

> **── 검문 3 (Task 9–11): 데이터 파일 연결, Excalidraw, 문서와 엔진별 확인. Review Focus 1·2·3·6·7·9·10 을 실제 화면으로 본다. ──**

---

## 설계 항목별 대응

| 설계 항목(2단계·데이터 파일) | Task |
| --- | --- |
| iframe `sandbox="allow-scripts"`·srcdoc·iframe 안 CSP `default-src 'none'` + 해시 | 3, 8 |
| iframe 이 네트워크에 닿지 않음 — 자기 탐색 차단(리뷰 C2), 막지 못하는 길은 알려진 한계로 문서 | 8(`frameGuard`), 10(`onLinkOpen`), 11 |
| CSP — 데스크톱 `security.csp`·서버 앱 헤더, srcdoc 이 부모 CSP 를 물려받는 문제, 엔진별 확인과 문서 | 3(강제 시험), 8 Step 6(데스크톱 앱 — 검문 2), 11(문서), 위 「CSP 실험」 |
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
| 쓰는 시점(자동 저장 규칙, 포커스 아웃·탭 닫기·노트 바꾸기·`visibilitychange`·앱 닫기 전 비우기, 끔이면 「저장하지 않은 그림」 + `Mod+S`; 탭 닫기·노트 바꾸기는 설정 무관 비우기·실패면 물음 — 코디네이터) | 4(owner·held·onDataFilesChange·renameDataFileOwner), 9(closeTab·open·이동·reloadSafely·warn) |
| 두 위젯·다시 붙는 위젯에서 덮어쓰지 않고 사본도 남발하지 않음(판·drain·사본 대기·stale 보기 전용) | 4(C1·N1·N2·N4 시험), 9 |
| 열기만으로 파일이 바뀌지 않음(anti-goal) | 10(`SceneGate`) |
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
