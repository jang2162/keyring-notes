# 개발하기

이 저장소의 코드를 고치는 사람을 위한 문서다. 사용자가 설치하고 쓰는 법은 사용자 문서(`docs/manual/`)에 있다.

## 패키지

| 디렉터리 | 패키지 | 하는 일 |
| --- | --- | --- |
| `packages/core` | `@keyring-notes/core` | 마크다운 분석, 위젯 쿼리, 위키 index·log, 정리 점검, 그래프, 데일리 판정, 로컬 볼트와 동기화 엔진, 화면 글(`src/messages/`)·볼트 글(`src/vaultText.ts`). 서버와 앱이 같이 쓴다 |
| `server` | `@keyring-notes/server` | REST API, MCP, 권한 계층, Git 볼트, 백업, 자동화, 관리 CLI |
| `web` | `@keyring-notes/web` | 웹 화면. 앱도 같은 화면을 쓴다 |
| `app` | `@keyring-notes/app` | Tauri 2 앱 셸(데스크톱·모바일) |

## 구조

```text
웹(쿠키 로그인) ─┐
앱 기기(토큰) ───┼─ REST /api/*  ─┐
에이전트(토큰) ──┤                ├─ ScopedVault(권한 계층) ─ Vault(파일·일괄 쓰기) ─ Git
                 └─ MCP /mcp ─────┘

앱(Tauri) = 같은 웹 화면 + LocalVault(기기 폴더, 메모리 색인, 스냅샷 이력) ⇄ SyncEngine ⇄ REST
```

- REST 와 MCP 는 모두 `server/src/scoped.ts` 의 `ScopedVault` 를 거쳐서만 볼트와 인덱스에 닿는다. 인덱스는 권한을 모르고, 검색·백링크·태그·위젯 결과는 모두 `ScopedVault` 에서 권한으로 거른다. 권한 검사를 이 층 밖에 두면 한 경로만 빠져도 숨김 경로가 새어 나간다.
- 모든 변경은 `Vault.batch()` 하나를 지난다. 가상의 상태에서 권한·충돌을 먼저 모두 검사한 뒤 디스크에 적용하고 한 커밋으로 남긴다. 적용이나 커밋 중에 실패하면 원래 내용으로 되돌린다.

## 개발 모드

터미널 두 개에서 띄운다(핫 리로드).

```bash
pnpm dev:server      # API: 127.0.0.1:8787
pnpm dev:web         # 웹: http://localhost:5173 (API 는 프록시)
```

데스크톱 앱 개발 실행은 `pnpm app:dev`. 플랫폼별 준비물은 사용자 문서 `docs/manual/ko/how-to/build-the-desktop-app.md` 에 있다.

`pnpm app:dev` 는 배포 앱과 같은 identifier 를 쓴다. 개발 실행(번들이 아닌 것)의 웹뷰 저장소(localStorage·IndexedDB — 동기화 서버 주소와 기기 토큰 `keyring:sync` 포함)는 `HOME` 을 바꿔도 실제 `~/Library/WebKit/keyring-notes` 에 간다 — macOS Foundation 은 `HOME` 을 따르지 않고, identifier 를 바꿔도 번들이 아니면 프로세스 이름으로 정해진다. 그 저장소에 동기화가 설정돼 있으면 시험으로 띄운 앱이 사람의 서버에 동기화하고 잠금 쓰기(마켓 설치)를 퍼뜨린다. 시험으로 띄우려면 identifier·`HOME`·devUrl 포트를 바꾸는 것에 더해 웹뷰 저장소를 따로 두어야 한다(Tauri `data_store_identifier`, macOS 14 이상). 그 장치가 없으면 띄우지 않는다. 배포 앱은 `~/Library/WebKit/com.develma.keyringnotes` 를 따로 쓴다.

화면을 확인할 때는 사람의 데이터와 서버를 건드리지 않게 임시 `KEYRING_DATA` 와 다른 포트로 띄운다. 로그인 비밀번호는 띄우기 전에 `KEYRING_DATA=<임시 폴더> KEYRING_PASSWORD=<비밀번호> pnpm --filter @keyring-notes/server keyring passwd` 로 넣는다.

```bash
KEYRING_DATA=<임시 폴더> KEYRING_PORT=<빈 포트> pnpm start
```

- `pnpm dev:web` 은 8787 의 API 에만 붙는다(`web/vite.config.ts` 의 프록시가 고정). 다른 포트로 띄운 시험 서버로 화면을 볼 때는 `pnpm --filter @keyring-notes/web build` 뒤 서버가 내주는 화면을 쓴다(웹을 다시 빌드하면 새로고침으로 반영된다).
- 시험 서버를 여럿 띄워 브라우저로 볼 때는 포트마다 다른 호스트 이름으로 연다(예: `http://r<포트>.localhost:<포트>/`). 쿠키는 포트를 가리지 않으므로 `localhost` 나 `127.0.0.1` 을 같이 쓰면 다른 시험 서버에 로그인할 때 세션 쿠키를 덮어 로그아웃된다.
- 시험 호스트에 `?local` 로 들어간 적이 있으면 그 선택이 남아 기기 볼트가 열린다. 서버 볼트를 보려면 `?local=0` 으로 연다.
- `pnpm --filter @keyring-notes/web build` 가 실패하면 `web/dist` 가 비고, 열려 있던 탭은 서비스 워커 캐시의 옛 화면을 계속 받는다. 실패하는 빌드를 돌렸으면 다시 빌드하고 그 탭의 서비스 워커를 지운 뒤 본다.
- 시험 볼트에 노트를 직접 넣을 때는 `<KEYRING_DATA>/vault/<워크스페이스>/` 아래에 둔다. 볼트 맨 위 항목은 워크스페이스로 읽혀 노트로 열리지 않는다.

## 안드로이드 에뮬레이터로 웹 앱 보기

설치한 웹 앱(PWA)·오프라인 동작은 에뮬레이터의 Chrome 에서 본다. 시험 서버는 위처럼 임시 `KEYRING_DATA` 와 빈 포트로 띄우고, 비밀번호는 `KEYRING_DATA=<임시 폴더> KEYRING_PASSWORD=<비밀번호> pnpm --filter @keyring-notes/server keyring passwd` 로 넣는다. AVD 이름(`Medium_Phone`)은 이 머신의 예시다 — `emulator -list-avds` 로 본다.

```bash
SDK=~/Library/Android/sdk; A=$SDK/platform-tools/adb
$SDK/emulator/emulator -avd Medium_Phone -no-window -no-audio -no-boot-anim -no-snapshot-save &
$A wait-for-device; until [ "$($A shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
$A reverse tcp:<포트> tcp:<포트>       # 폰의 localhost:<포트> = 시험 서버(localhost 라 서비스 워커가 HTTPS 없이 돈다)
$A shell am start -a android.intent.action.VIEW -n com.android.chrome/com.google.android.apps.chrome.Main -d http://localhost:<포트>/
$A forward tcp:9333 localabstract:chrome_devtools_remote   # Chrome 이 뜬 뒤. Chrome 을 다시 띄우면 다시 건다
```

- 조작은 저장소 밖 scratch 폴더에 `playwright-core` 를 깔아 `chromium.connectOverCDP("http://localhost:9333")` 로 붙는다. 화면 좌표로 누르는 `adb shell input tap` 보다 locator 가 안정적이다. **스크립트 끝은 `browser.close()` 가 아니라 `process.exit(0)`** — close 는 폰의 Chrome 을 닫는다.
- 오프라인은 시험 서버 프로세스를 죽여 만든다(`adb reverse` 는 비행기 모드와 상관없이 adb 로 간다). 콜드 스타트는 `$A shell am force-stop com.android.chrome` 뒤 다시 연다.
- **설치 상태(`display-mode: standalone`)**: CDP `Emulation.setEmulatedMedia` 는 Chrome 149 에서 `display-mode` 를 바꾸지 못한다(`prefers-color-scheme` 은 바뀐다). `page.addInitScript` 로 `matchMedia` 를 문서 시작 전에 덮거나(스크립트가 끝나면 풀린다), Chrome 메뉴 「홈 화면에 추가 → 앱 설치」 로 실제로 설치한다. 에뮬레이터의 설치는 WebAPK 가 아니라 `WebappActivity` 로 열렸고, 아이콘은 설치할 때 열려 있던 주소로 처음 시작했다.
- **사이트 데이터 지우기**: 앱이 떠 있지 않은 같은 출처 페이지(예: `/licenses.txt`)로 옮겨 localStorage·IndexedDB·서비스 워커·캐시를 지운다. 앱이 떠 있는 동안 지우면 앱이 `keyring:sync` 등을 다시 써 넣는다. 브라우저 세션의 `Storage.clearDataForOrigin` 은 Internal error 였다.
- `navigator.storage.persisted()` 는 브라우저 탭·설치한 앱 모두 false 였다(`persist()` 를 부른 뒤에도). 실제 기기는 다를 수 있다.
- 휴대폰 세로 화면(웹 화면 폭 약 411px)은 800px 아래라 탭 줄이 숨어, 설치 앱의 탭 메뉴(「새 창으로 열기」 등)에 닿지 않았다. 가로(약 914px)로 돌려서 봤다: `$A shell cmd window user-rotation lock 1`(되돌리기 `lock 0`). `settings put system user_rotation 1` 은 한 번은 돌았고 다음 부팅에서는 돌지 않았다. 홈 화면(런처)은 가로로 돌지 않으므로 아이콘을 누를 때는 세로로 둔다.
- 끝나면 `$A emu kill` 로 에뮬레이터를 끄고 시험 서버를 내린다.

## 검사

다 했다고 말하기 전에 루트에서 돌린다.

```bash
pnpm test        # core·server·web 의 vitest
pnpm typecheck
pnpm build
```

각 패키지의 시험은 `packages/core/test`, `server/test`, `web/src/**/*.test.{ts,tsx}` 에 있다. 출력에서 실행된 시험 수가 0 이 아닌지 본다. server·web 시험은 core 를 `dist` 가 아니라 원본(`keyring-source` 조건)으로 읽으므로, core 를 고친 뒤 core 를 먼저 빌드하지 않아도 새 코드로 돈다.

루트 `pnpm test` 는 첫 실패 패키지에서 멈춘다. 떨어진 패키지 뒤의 패키지는 실행되지 않은 것이니 `pnpm --filter <패키지> test` 로 따로 돌려 개수를 확인한다. 머신 부하가 높으면 server 시험이 5초 timeout 으로 떨어질 수 있다.

포맷과 린트는 `pnpm fmt`, `pnpm lint`. lefthook 이 커밋 전에는 stage 된 파일을, push 전에는 저장소 전체를 검사한다(`lefthook.yml`).

## 버전과 릴리스

제품 버전의 원천은 루트 `package.json` 이고, 서버와 앱이 같은 버전과 릴리스를 쓴다. 버전 올리기와 macOS 앱 릴리스 절차는 `docs/guides/release-macos.md` 에 있다. 사용자에게 보이는 변경은 릴리스마다 `CHANGELOG.md`(영어)에 적는다.

## 문서

- 사용자 문서는 `docs/manual/en/`(원본)과 `docs/manual/ko/`(번역)에 둔다. 둘은 파일 이름·구조·섹션 순서가 같다. 화면 동작이나 설정을 바꾸면 두 언어를 함께 고친다.
- README 는 `README.md`(영어 원본)와 `README.ko.md`(번역)다. 번역본마다 맨 위에 기준 원본과 판을 적는다 — `README.ko.md` 는 `<!-- source: README.md @ vX.Y.Z -->`, `docs/manual/ko/<경로>` 는 `<!-- source: docs/manual/en/<같은 경로> @ vX.Y.Z -->`, `examples/plugins/README.ko.md` 는 `<!-- source: examples/plugins/README.md @ vX.Y.Z -->`. 판은 그 번역을 맞춘 원본이 실린 릴리스 버전이다. 아직 릴리스하지 않은 원본에 맞췄으면 판을 그대로 두고, 릴리스할 때 한꺼번에 올린다(`docs/guides/release-macos.md` 「버전 올리고 릴리스하기」 절). 판을 미리 다음 버전으로 적지 않는다 — 릴리스 버전이 바뀌면 전부 틀린 값이 된다.
- 영어↔한국어 용어는 `docs/manual/glossary.md` 에 모은다. 한국어 문서의 화면 이름은 `packages/core/src/messages/ko.json` 의 실제 글을 쓴다.

## 위젯 iframe 과 CSP

keyring-widget 중 앱 코드가 아니거나 인라인 기준을 넘는 위젯(내장 Excalidraw, 앞으로의 제3자 위젯)은 `sandbox="allow-scripts"` + `srcdoc` iframe 하나에서 돈다(`allow-same-origin`·`allow-popups`·`allow-forms`·`allow`·`src` 없음). 설계는 `docs/superpowers/specs/2026-11-09-keyring-widget-design.md` 「iframe」·「제약」, 구현 계획은 `docs/superpowers/plans/2026-11-09-keyring-widget-phase2.md`.

**고른 방법과 근거.** srcdoc iframe 은 부모 CSP 를 물려받는다. 그래서 서버 앱 페이지 CSP(`server/src/app.ts` 의 `APP_CSP`)와 데스크톱 앱 CSP(`app/src-tauri/tauri.conf.json` 의 `security.csp`)의 `script-src` 에 부트스트랩 해시와 `blob:` 을 더하고, srcdoc 안 meta CSP 가 `default-src 'none'; script-src <해시> blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:` 로 다시 좁힌다. 부트스트랩(`web/src/widgets/frame/bootstrap.ts`)은 부모가 `postMessage` 로 건넨 코드 글(런타임 → 위젯)을 iframe 안 `blob:` 스크립트로 붙일 뿐이다. iframe 은 URL 로 아무것도 받지 않는다 — 코드·CSS·글꼴 바이트는 부모가 `/widget-frame/` 에서 받아 건넨다. 별도 `frame.html`(`src`) 방식은 버렸다: 샌드박스(불투명 출처) iframe 의 요청은 Chromium·WebKit 모두 서비스 워커를 타지 않아 오프라인 PWA·기기 볼트에서 열리지 않고, 데스크톱 앱은 Tauri 가 HTML 응답마다 앱 CSP 를 붙여 iframe 문서의 자체 CSP 를 쓸 수 없다. 실험 표(srcdoc+인라인·해시·`blob:`·`src`·SW·Excalidraw 글꼴)는 계획 문서 「CSP 실험」.

**부트스트랩을 고칠 때.** 글자 하나라도 바꾸면 `web/src/widgets/frame/bootstrap.test.ts` 가 새 해시를 찍으며 떨어진다. 그 값을 `packages/core/src/widgetFrame.ts` 의 `WIDGET_FRAME_SCRIPT_HASH` 와 `app/src-tauri/tauri.conf.json` 의 `security.csp` 에 넣는다(서버 `APP_CSP` 는 core 상수를 쓴다). 같은 해시가 앱 페이지에도 허용되므로 부트스트랩은 최상위 창에서 돌면 아무것도 하지 않는다.

**묶음 빌드.** `web/frameBuild.ts`(vite 플러그인)가 진입마다 중첩 `build()` 로 IIFE 한 파일을 만들어 `dist/widget-frame/` 에 내고, 주소 표는 `virtual:widget-frames` 다. 중첩 빌드는 늘 배포판이다(`mode: "production"`, JSX `development: false`) — 바깥이 개발 모드여도 React 배포판과 `jsxDEV` 가 어긋나지 않게. 크기 한도는 `web/src/widgetFrames.ts`: 런타임 gzip 20,480 B, 위젯 묶음 gzip 2,097,152 B(넘으면 빌드 실패). 런타임이 커지면 core 본체나 `web/src/i18n.ts` 가 끌려온 것이다 — 런타임 쪽 import 는 `@keyring-notes/core/lookup`·`widgetT.ts`·`protocol.ts`·`session.ts` 의 `widgetKeyAction` 뿐이어야 한다. `dev: true` 진입(개발용 `keyring/dday-frame`)은 개발 서버와 `NODE_ENV=development` 빌드에만 실린다. `/widget-frame/` 의 없는 주소는 서버가 404 로 답하고 서비스 워커는 HTML 응답을 캐시하지 않는다. 묶음은 처음 쓸 때 서비스 워커가 캐시한다(설치 때 받기 목록에는 없다).

**메시지 다리와 차단.** 부모는 만들 때 잡아 둔 그 iframe 의 WindowProxy 에서 온 것만, 출처가 `"null"` 인 것만, 인스턴스 id 가 맞고 `parseFrameMsg` 를 지난 것만 받는다(`web/src/widgets/frame/layout.ts` 의 `routeFrameMessage`). 같은 창인데 출처가 `"null"` 이 아니거나, 두 번째 `load`·`ready` 가 오면(`frameGuard` — 위젯이 자기 iframe 을 다른 주소로 옮김) iframe 을 지우고 「위젯이 다른 페이지로 이동하려 해 멈췄습니다」 를 보이며 그 인스턴스에 더 답하지 않는다. iframe 이 부모로 넘기는 키는 `Esc`(위젯이 처리하지 않은 것)와 `Mod+S` 둘뿐이다.

**알려진 한계.** 위젯이 이미 가진 상태·파일 바이트를 자기 iframe 의 탐색 URL(탐색이 시작되는 순간 주소에 실어)이나 WebRTC(`RTCPeerConnection` 의 STUN)로 밖에 내보내는 것은 CSP·sandbox 로 막을 수 없다. 내장 위젯은 앱 코드라 믿는다. 받은 위젯(마켓 3단계, 계획 `docs/superpowers/plans/2026-11-10-marketplace-phase3.md`)은 늘 이 iframe 에서 돌고, 그 위에 이렇게 지킨다:
설치(업데이트·동기화 아님) 때 WebRTC 알림을 확인받는다(`MARKET_KINDS[type].installNotice`), 등록 시한 20초(`FRAME_REGISTER_TIMEOUT_MS` — 넘으면 「불러오지 못했습니다」), 위젯에서 오는 상태(`setState`·수정 중 초안·`migrated`)의 `file` 은 늘 블록 값으로 고정(`session.ts` `pinFile`), `migrate` 는 iframe 안에서 돌고 호스트는 마지막 보냄의 `seq` 의 답만 받는다, 잠금의 `@keyring/…` 은 공식 저장소일 때만 쓴다(core `parseMarketplace`). 검토·서명·권한 표시는 없다. 데스크톱 앱(WKWebView)에서는 iframe 에도 `webkit.messageHandlers.ipc` 가 보이지만, 호출 키가 없는 요청은 답도 부수 효과도 없었다(Task 8 확인 — 키는 부모 창의 `__TAURI_INTERNALS__` 에만 있다).

## 마켓 받기와 나가는 요청

마켓플레이스 1단계(설계 `docs/superpowers/specs/2026-11-10-marketplace-design.md`, 계획 `docs/superpowers/plans/2026-11-10-marketplace-phase1.md`)가 서버·앱에서 저장소로 나가는 요청을 어떻게 지키는지 적는다. 형식·검사의 단일 원본은 core `marketFormat.ts`·`marketLock.ts` 다.

**누가 받는가.** 화면은 저장소에 직접 요청하지 않는다(CSP `connect-src 'self'` 그대로). 서버 모드는 서버(`server/src/marketCache.ts`)가 받고 화면은 `/api/market/*` 에서 가져온다. 데스크톱·모바일 앱 기기 볼트는 앱 명령 `market_fetch`(`app/src-tauri/src/market.rs`)로 받는다. 앱 + 동기화는 서버를 먼저 쓰고 길의 문제(닿지 못함·사설 거부·`http:` 거부·시간·리다이렉트·401)일 때만 네이티브로 대신 받는다. 브라우저 기기 볼트에 동기화가 없으면 받지 않는다(`web/src/market/source.ts` `pickSource`).

**이름 풀이를 접속에 고정한다.** 판정한 뒤 접속이 이름을 다시 풀면 둘째 풀이가 사설 주소를 줄 수 있다(DNS 재바인딩). 서버는 `http.request` 의 `lookup` 옵션(`netGuard.ts` `guardedLookup`), Rust 는 reqwest 의 `dns_resolver`(`GuardResolver`)로 접속에 쓰는 풀이 결과 자체를 판정한다. Node 의 함정 셋:

- IP 글자 주소(`https://127.0.0.1/`, `https://[::1]/`)는 `lookup` 을 타지 않는다. 그래서 접속 전에 따로 판정한다(`checkUrl`). IPv6 글자의 `URL.hostname` 은 대괄호를 품어(`"[::1]"`) `net.isIP` 가 0 이 되므로 벗긴 뒤 본다. 10진·16진 IPv4 꼴은 WHATWG URL 이 점 꼴로 바꿔 둔다.
- `autoSelectFamily` 가 켜져 있으면 `lookup(host, { all: true }, cb)` 꼴로 불린다. 두 꼴 다 받는다.
- 전역 agent 는 `NODE_USE_ENV_PROXY=1` 이면 프록시를 타고, 그때 `lookup` 이 불리지 않는다. 그래서 요청마다 `agent: false` 다. Rust 는 `no_proxy()`.

리다이렉트는 손으로 따라가며 홉마다 다시 판정한다. 접속한 소켓 주소도 한 번 더 본다(둘째 줄). 시간 상한은 요청 하나 전체(리다이렉트 포함)에 하나다. 크기는 받는 동안 세고 넘으면 끊는다. `accept-encoding: identity` 를 보내고, 압축된 응답은 거부한다(압축 폭탄 면이 없다).

**URL 수집도 같은 지킴을 탄다.** 위키의 URL 수집(`server/src/convert.ts` `fetchUrl`, `ingest.ts` 가 부름)은 `guardedLookup`·`isPrivateAddress`·IP 글자 판정·리다이렉트마다 다시·소켓 주소 둘째 줄·`agent: false` 를 마켓과 같이 쓴다. 시험은 `server/test/clipFetch.test.ts`. 마켓과 다른 것은 URL 수집의 원래 동작이다: `http:` 도 받는다, 2xx 면 받는다, gzip·deflate·br 은 풀고 **풀린 크기**로 상한(기본 20MB)을 잰다, 시간 상한(기본 20초)은 홉마다다, 리다이렉트는 다섯 번까지다. 사설 허용은 `KEYRING_FETCH_ALLOW_PRIVATE` 하나다. 웹 클리퍼(북마클릿)는 브라우저가 가진 HTML 을 보내므로 서버가 그 페이지에 요청하지 않는다.

**주소 판정 표**(서버 `netGuard.ts`·Rust `market.rs` 가 같다. 시험 벡터는 둘 다 `server/test/fixtures/address-vectors.json` 하나를 읽는다 — 한쪽만 고치지 않는다):

- 판정 방법: 주소를 바이트로 파싱해 CIDR 로 본다. 앞뒤 `[`·`]` 와 zone id(`%en0`·`%25en0`)는 벗긴다. 파싱하지 못하면 막는다(fail-closed). IPv4 의 앞자리 0(`01.1.1.1`)도 파싱 실패다.
- IPv4: `0/8`·`10/8`·`100.64/10`·`127/8`·`169.254/16`·`172.16/12`·`192.0.0/24`·`192.0.2/24`·`192.88.99/24`·`192.168/16`·`198.18/15`·`198.51.100/24`·`203.0.113/24`·`224/4` 이상.
- IPv6: `::/96` 전체, `fc00::/7`·`fe80::/10`·`fec0::/10`·`ff00::/8`, `64:ff9b:1::/48`, `2001::/32`(Teredo)·`2001:db8::/32`·`2001:2::/48`·`100::/64`.
- IPv4 를 품은 꼴은 품은 IPv4 로 다시 판정한다: `::ffff:0:0/96`(사상)·`::ffff:0:0:0/96`(SIIT)·`64:ff9b::/96`(NAT64)·`2002::/16`(6to4).

**`http:`·사설 주소는 운영자·그 기기만.** 서버는 `KEYRING_MARKET_ALLOW_HTTP`·`KEYRING_MARKET_ALLOW_PRIVATE`(URL 수집의 `KEYRING_FETCH_ALLOW_PRIVATE` 와 따로), 앱은 이 기기의 `localStorage` `keyring:market:device`. 볼트의 공통 설정에 두지 않는다 — 볼트를 고칠 수 있는 기기·사람이 서버를 내부망으로 보내는 통로가 된다.

**패키지 파일은 실행할 수 없는 꼴로만 낸다.** `/api/market/file` 은 `application/octet-stream` + `content-disposition: attachment` + `content-security-policy: default-src 'none'; sandbox` 다. 앱 페이지 CSP 가 `script-src 'self'` 라, 같은 출처에서 JS 타입으로 내면 HTML 주입 하나로 제3자 `frame.js` 가 앱 권한으로 돈다. 화면은 바이트로 받아 iframe 에 글로 건넨다.

**서버 캐시**(`<KEYRING_DATA>/packages/@scope/name/<version>/` + `.keyring-cache.json`):

- 받기는 `.tmp-*` 에 다 쓰고 sha256·크기·매니페스트를 지난 뒤 메타를 쓴다.
- 놓는 순서는 ① 판 → `.old-*` ② `.tmp-*` → 판 ③ `.old-*` 삭제다. 비지 않은 폴더 위로의 `rename` 은 `ENOTEMPTY` 라 덮어 놓을 수 없다.
- 시작 정리는 바이트가 메타 sha 와 맞는 `.tmp` 만 살리고, 판 폴더가 비면 `.old` 를 되돌린다.
- 캐시를 「있다」 고 보는 모든 길(빠른 길·시작 정리·맞추기)이 바이트를 다시 잰다. 상한 판은 다시 받는다.
- 잠금에 없는 판은 마지막으로 받은 지 24시간 뒤에 지운다. 기기 볼트 + 동기화 기기가 받게 한 뒤 잠금이 동기화로 오기 전에 지우지 않게 하려는 것이다.
- 공통 설정이 깨져 읽지 못하면 정리하지 않는다.

**기기 캐시와 적용 자리**(`web/src/market/`):

- 화면 쪽 캐시는 브라우저 IndexedDB(`keyring-market`) 또는 앱 데이터 폴더(`$APPDATA/packages/`)다.
- 잠금이 바뀔 때마다 맞추고(`state.ts`), 잠금을 읽은 뒤에만 잠금에 없는 판을 바로 지운다.
- 2·3단계는 `registerPackageKind(type, { apply })` 로 종류별 적용자를 걸고 `readPackageFile` 로 바이트를 읽는다. 읽을 때마다 잠금 sha 로 다시 잰다.
- 위젯 적용자(`web/src/widgets/marketWidgets.ts`)는 패키지마다 그 순간의 잠금 항목을 붙잡아 `readPackageFileAt` 으로 읽는다 — 잠금이 바뀌었으면 `market_stale` 로 거절해, 그려진 판의 정의에 다른 판의 코드가 붙지 않는다. 서버 모드의 열린 화면은 다른 기기의 잠금 바뀜을 저장·새로고침 때만 다시 읽는다(실시간 전달이 없다).
- 개발 빌드(`import.meta.env.DEV`)에서만 `globalThis.keyringMarket` 이 있다.

**알려진 한계.**

- identity 요청을 따르지 않고 압축해 보내는 호스팅은 쓸 수 없다(서버·앱 둘 다 거부).
- HTTP 프록시 뒤에서만 바깥에 나갈 수 있는 서버는 받지 못한다(`agent: false`). URL 수집도 같다.
- 공식 저장소 주소는 `https://keyring-notes-marketplace.develma.com/`(core `OFFICIAL_REPO_URL`)다. 마켓 서버를 배포하기 전까지는 이 주소가 저장소를 내주지 않는다.
- 공식 마켓 배포는 `docs/guides/deploy-marketplace.md`.

## 의존성과 라이선스 고지

웹 빌드(`vite build`)가 빌드 결과에 제3자 라이선스 고지 `web/dist/licenses.txt` 를 함께 낸다. 서버는 그것을 `/licenses.txt` 로 내주고, 화면은 설정 「정보」 의 「오픈 소스 라이선스」 에서 모달로 연다. 웹은 서비스 워커가 지연 자산과 함께 받아 두어 오프라인에서도 열린다. 생성물이라 커밋하지 않는다. 개발 서버(`vite`)에는 없다. 서버는 `/licenses.txt` 를 인증 없이 내준다 — 로그인 전에도 서버 의존성의 이름과 판이 보인다.

| 조각 | 덮는 배포물 | 모으는 방법 |
| --- | --- | --- |
| `web` | 브라우저·앱 창으로 가는 번들 | 번들러가 내보내는 청크의 모듈과 자산의 원본 파일(글꼴, `?url` 로 싣는 pdf.js 워커)이 든 `node_modules` 패키지 |
| `server` | Docker 이미지의 Node 실행 의존성 | `server` 에서 `dependencies`·`optionalDependencies`·필수 peer 를 따라간다 — Dockerfile 의 `pnpm install --prod --filter "@keyring-notes/server..."` 와 같은 범위 |
| `app` | 앱 실행 파일의 Rust 크레이트 | `cargo metadata --filter-platform <대상>` 에서 일반 의존성만(빌드·개발 의존성과 경로 의존성은 뺀다). cargo 만 있으면 되고 따로 설치할 도구가 없다. 기능 합침·proc-macro 때문에 실제로 링크되는 것보다 넉넉하게 잡힌다(빠지지는 않는다) |

Tauri 가 부른 빌드(`beforeBuildCommand` — 환경 변수 `TAURI_ENV_TARGET_TRIPLE` 이 있다)면 `server` 대신 `app` 을 싣는다. 앱에는 서버의 `node_modules` 가 들어가지 않고 Docker 이미지에는 Rust 가 들어가지 않는다. universal 빌드는 두 아키텍처를 함께 거른다.

전문은 패키지 폴더 맨 위의 `LICENSE`·`LICENCE`·`COPYING`·`NOTICE`·`UNLICENSE` 류 파일을 그대로 싣고, 전문이 같은 패키지끼리 묶어 한 번만 싣는다. 코드는 `web/licenses/plugin.ts`(파일·cargo 읽기)와 `web/src/licenseNotices.ts`(순수 함수, 시험 `licenseNotices.test.ts`)다.

- **라이선스 파일이 없는 패키지**에는 `web/licenses/spdx/<SPDX id>.txt`(SPDX License List 의 `text/<id>.txt` 를 그대로 받은 것)를 SPDX 식의 id 마다 붙이고, 저작권 자리에 패키지 메타데이터의 `author`·`authors` 를 넣는다. 저작권자가 없으면 그렇다고 적고 소스 주소를 남긴다. 그 id 의 파일이 없으면 빌드가 멈춘다 — `https://raw.githubusercontent.com/spdx/license-list-data/main/text/<id>.txt` 를 받아 그 폴더에 더한다.
- **MPL-2.0 구성요소**는 줄에 소스 주소를 적고 머리에 그 사실을 한 줄 밝힌다. 실행 형태로 배포할 때 소스를 얻는 법을 알려야 한다(MPL-2.0 §3.2).
- **여러 라이선스 중 고르는 패키지**는 `web/licenses/manual.ts` 의 `LICENSE_CHOICES` 에 고른 id 와 조각을 적는다(`dompurify` 는 `(MPL-2.0 OR Apache-2.0)` 중 Apache-2.0, 라이선스 파일·저작권자가 없는 objc2 계열 `Zlib OR Apache-2.0 OR MIT` 크레이트는 저작권 줄이 조건이 아닌 Apache-2.0). 그 조각을 싣는 빌드에서 패키지가 빠지거나 고른 id 가 식에 없으면 빌드가 멈춘다.
- **라이선스 파일도 저작권자도 없는 MIT·BSD 패키지**는 원저장소의 LICENSE 에서 저작권자를 찾아 `HOLDERS` 에 적는다(`objc2-foundation`). 그 조각을 싣는 빌드에서 패키지가 빠지거나 패키지가 라이선스 파일을 싣게 되면 빌드가 멈춘다.

### 손 목록에 넣는 것

`web/licenses/manual.ts` 의 `MANUAL_NOTICES` 에는 **배포물에 들어가지만 자동 수집이 보지 못하는 것**만 넣고, 항목마다 `why` 에 이유를 적는다.

- 빌드 플러그인이 fs 로 직접 읽어 번들에 싣는 데이터 — import 그래프에 없다. 예: `emojibase-data`(`vite.config.ts` 의 `emojiData` 가 읽는다).
- 패키지가 아닌 데이터의 원래 라이선스 — 그 데이터를 싣고 오는 패키지(`via`)의 판을 함께 적는다. 예: 이모지 이름·낱말의 출처인 Unicode CLDR(Unicode License V3, 전문 `web/licenses/unicode-license-v3.txt`).
- `web/public/` 처럼 번들러를 거치지 않고 그대로 복사되는 제3자 파일.
- **다른 패키지 안에 묶여 실린 것**(`kind: "bundled"`) — 패키지가 자기 배포 파일 안에 미리 묶어 싣는 남의 코드와 네이티브 바이너리에 정적으로 링크된 라이브러리. 싣고 오는 패키지를 `via` 에 적고(줄에는 「bundled in <via> <판>」), 전문은 원래 패키지에서 받아 `web/licenses/bundled/` 에 둔다. 지금 든 것은 아래 「자동 수집이 보지 않는 것」 의 예와 `unpdf` 안의 pdf.js(서버)다.

손 목록이 실제와 어긋나면 빌드가 이유를 적고 멈춘다 — 패키지가 그 조각(web·server)의 의존성에 없을 때, 그 패키지가 자동 수집에도 잡힐 때(그래프에 들어왔으니 손 목록에서 지운다), `bundled` 의 `via` 가 이 빌드의 그 조각에 없을 때.

**묶임 검사**: 빌드가 출력에 쓰인 `node_modules` 파일마다 동봉 소스맵(끝의 `sourceMappingURL` 이나 옆의 `.map`)을 읽어, `sources` 에 다른 패키지(`…/node_modules/<이름>/…`)가 있는데 고지에도 손 목록에도 없으면 「<이름>(<via> 안에 묶여 있다) 가 고지에 없다」 로 멈춘다. 그 이름을 `bundled` 로 넣는다.

자동 수집이 보지 않는 것: 실행 중에 네트워크에서 받는 것(플러그인 등), 저장소 코드에 옮겨 붙인 남의 코드, OS 가 주는 라이브러리(WebKit 등). 패키지가 자기 배포 파일 안에 미리 묶어 싣는 남의 코드(예: `@mermaid-js/parser` 안의 langium·chevrotain, `mermaid` 안의 js-yaml, `pdfjs-dist` legacy 빌드 안의 core-js, `roughjs` 의 `bundled/` 안 하위 패키지)와 네이티브 바이너리에 정적으로 링크된 라이브러리(`@napi-rs/canvas` 의 Skia)도 자동 수집이 보지 못한다 — 패키지 이름 단위로만 모으기 때문이다. 묶임 검사는 이 중 **web 번들의, 소스맵을 동봉한 파일만** 잡는다. 소스맵이 없는 묶음(`roughjs`·`unpdf`), 네이티브 바이너리(Skia), 서버·앱 조각은 검사하지 않으므로, 의존성을 더하거나 올릴 때 그 패키지의 배포 파일에 `.map` 이 있으면 `sources` 에 다른 패키지가 있는지, 없으면 배포 파일이 import 없이 큰 코드를 싣는지 직접 본다. 이것들은 손 목록에 넣거나 따로 판단한다. 새 의존성의 라이선스가 GPL·LGPL·AGPL·MPL 처럼 소스 제공 의무가 따르거나 출처가 불분명하면 넣기 전에 정한다.

### 확인

```bash
pnpm --filter @keyring-notes/web build
# 끝에 「licenses.txt: web N, server M, 표준 전문 K(저작권자 없음 …), … KB」 한 줄
TAURI_ENV_TARGET_TRIPLE=universal-apple-darwin pnpm --filter @keyring-notes/web exec vite build
# 앱 빌드와 같은 고지(web + app). cargo 가 필요하다
pnpm licenses list --prod --json --filter "@keyring-notes/server..."
# server 조각과 같은 범위 — 패키지 이름·판을 licenses.txt 의 [server] 줄과 대조한다
```

앱 조각은 `cargo metadata --locked` 로 모은다 — lock 이 크레이트 판의 원천이다. `app/src-tauri/Cargo.toml` 을 고쳤으면 `Cargo.lock` 을 갱신해야(`cargo update -p <크레이트>` 나 `cargo build`) 앱 빌드의 고지 수집이 돈다. 갱신하지 않으면 `beforeBuildCommand` 단계에서 「lock file needs to be updated」 로 멈춘다.
