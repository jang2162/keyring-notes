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

화면을 확인할 때는 사람의 데이터와 서버를 건드리지 않게 임시 `KEYRING_DATA` 와 다른 포트로 띄운다.

```bash
KEYRING_DATA=<임시 폴더> KEYRING_PORT=<빈 포트> pnpm start
```

## 검사

다 했다고 말하기 전에 루트에서 돌린다.

```bash
pnpm test        # core·server·web 의 vitest
pnpm typecheck
pnpm build
```

각 패키지의 시험은 `packages/core/test`, `server/test`, `web/src/*.test.ts` 에 있다. 출력에서 실행된 시험 수가 0 이 아닌지 본다. server·web 시험은 core 를 `dist` 가 아니라 원본(`keyring-source` 조건)으로 읽으므로, core 를 고친 뒤 core 를 먼저 빌드하지 않아도 새 코드로 돈다.

포맷과 린트는 `pnpm fmt`, `pnpm lint`. lefthook 이 커밋 전에는 stage 된 파일을, push 전에는 저장소 전체를 검사한다(`lefthook.yml`).

## 버전과 릴리스

제품 버전의 원천은 루트 `package.json` 이고, 서버와 앱이 같은 버전과 릴리스를 쓴다. 버전 올리기와 macOS 앱 릴리스 절차는 `docs/guides/release-macos.md` 에 있다. 사용자에게 보이는 변경은 릴리스마다 `CHANGELOG.md`(영어)에 적는다.

## 문서

- 사용자 문서는 `docs/manual/en/`(원본)과 `docs/manual/ko/`(번역)에 둔다. 둘은 파일 이름·구조·섹션 순서가 같다. 화면 동작이나 설정을 바꾸면 두 언어를 함께 고친다.
- README 는 `README.md`(영어 원본)와 `README.ko.md`(번역)다. 번역본마다 맨 위에 기준 원본과 판을 적는다 — `README.ko.md` 는 `<!-- source: README.md @ vX.Y.Z -->`, `docs/manual/ko/<경로>` 는 `<!-- source: docs/manual/en/<같은 경로> @ vX.Y.Z -->`, `examples/plugins/README.ko.md` 는 `<!-- source: examples/plugins/README.md @ vX.Y.Z -->`. 판은 그 번역을 맞춘 원본이 실린 릴리스 버전이다. 아직 릴리스하지 않은 원본에 맞췄으면 판을 그대로 두고, 릴리스할 때 한꺼번에 올린다(`docs/guides/release-macos.md` 「버전 올리고 릴리스하기」 절). 판을 미리 다음 버전으로 적지 않는다 — 릴리스 버전이 바뀌면 전부 틀린 값이 된다.
- 영어↔한국어 용어는 `docs/manual/glossary.md` 에 모은다. 한국어 문서의 화면 이름은 `packages/core/src/messages/ko.json` 의 실제 글을 쓴다.

## 의존성과 라이선스 고지

웹 빌드(`vite build`)가 빌드 결과에 제3자 라이선스 고지 `web/dist/licenses.txt` 를 함께 낸다. 서버는 그것을 `/licenses.txt` 로 내주고, 화면은 설정 「일반」 의 「오픈 소스 라이선스」 에서 모달로 연다. 웹은 서비스 워커가 지연 자산과 함께 받아 두어 오프라인에서도 열린다. 생성물이라 커밋하지 않는다. 개발 서버(`vite`)에는 없다. 서버는 `/licenses.txt` 를 인증 없이 내준다 — 로그인 전에도 서버 의존성의 이름과 판이 보인다.

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
