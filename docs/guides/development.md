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

각 패키지의 시험은 `packages/core/test`, `server/test`, `web/src/*.test.ts` 에 있다. 출력에서 실행된 시험 수가 0 이 아닌지 본다.

포맷과 린트는 `pnpm fmt`, `pnpm lint`. lefthook 이 커밋 전에는 stage 된 파일을, push 전에는 저장소 전체를 검사한다(`lefthook.yml`).

## 버전과 릴리스

제품 버전의 원천은 루트 `package.json` 이고, 서버와 앱이 같은 버전과 릴리스를 쓴다. 버전 올리기와 macOS 앱 릴리스 절차는 `docs/guides/release-macos.md` 에 있다. 사용자에게 보이는 변경은 릴리스마다 `CHANGELOG.md`(영어)에 적는다.

## 문서

- 사용자 문서는 `docs/manual/en/`(원본)과 `docs/manual/ko/`(번역)에 둔다. 둘은 파일 이름·구조·섹션 순서가 같다. 화면 동작이나 설정을 바꾸면 두 언어를 함께 고친다.
- README 는 `README.md`(영어 원본)와 `README.ko.md`(번역)다. 번역본마다 맨 위에 기준 원본과 판을 적는다 — `README.ko.md` 는 `<!-- source: README.md @ vX.Y.Z -->`, `docs/manual/ko/<경로>` 는 `<!-- source: docs/manual/en/<같은 경로> @ vX.Y.Z -->`, `examples/plugins/README.ko.md` 는 `<!-- source: examples/plugins/README.md @ vX.Y.Z -->`. 판은 그 번역을 맞춘 원본이 실린 릴리스 버전이다. 아직 릴리스하지 않은 원본에 맞췄으면 판을 그대로 두고, 릴리스할 때 한꺼번에 올린다(`docs/guides/release-macos.md` 「버전 올리고 릴리스하기」 절). 판을 미리 다음 버전으로 적지 않는다 — 릴리스 버전이 바뀌면 전부 틀린 값이 된다.
- 영어↔한국어 용어는 `docs/manual/glossary.md` 에 모은다. 한국어 문서의 화면 이름은 `packages/core/src/messages/ko.json` 의 실제 글을 쓴다.
