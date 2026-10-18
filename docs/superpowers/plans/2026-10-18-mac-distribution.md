# macOS 앱 배포 구현 계획

Oct 18, 2026 · 설계: `docs/superpowers/specs/2026-10-18-mac-distribution-design.md`. 이 문서는 설계의 「빌더에게 맡기는 것」 을 정하고 구현 순서를 적는다.

## 빌더로서 정한 것

### 1. DMG 실패: Finder 꾸미기(AppleScript)를 건너뛴다

- **관찰**: 최상위 체크아웃의 옛 빌드에 `bundle/macos/rw.23747.Keyring Notes_0.7.0_aarch64.dmg`(37,789,184 바이트)가 남아 있다. `bundle_dmg.sh` 가 중간 이미지를 만들고 그 뒤에서 멈춘 흔적이다.
- **재현**: 같은 `.app` 과 `bundle_dmg.sh` 를 Apple 이벤트를 막은 seatbelt 샌드박스(`sandbox-exec -p '(version 1)(allow default)(deny appleevent-send)'`)에서 돌리면 `osascript` 가 `Finder에 오류 발생: 응용 프로그램이 실행 중이 아닙니다. (-600)` 으로 실패하고 스크립트가 `exit 64` 로 끝난다. 남는 중간 이미지가 **37,789,184 바이트로 옛 잔해와 같다.** Apple 이벤트가 허용된 터미널에서는 같은 빌드가 성공한다.
- **원인**: `bundle_dmg.sh`(create-dmg)가 DMG 창 모양을 Finder AppleScript 로 꾸미는데, 에이전트 샌드박스·Finder 자동화 권한이 없는 셸·GUI 세션이 없는 CI 에서는 Finder 를 부를 수 없다.
- **수정**: Tauri 번들러는 `CI=true` 이면 `--skip-jenkins` 를 넘겨 이 단계를 건너뛴다(`crates/tauri-bundler/src/bundle/macos/dmg/mod.rs`). GitHub Actions 는 `CI=true` 를 넣으므로 CI 는 그대로 되고, 로컬 시험 빌드 스크립트(`app` 의 `build:mac`)도 `CI=true` 로 돈다. 대가: DMG 창의 아이콘 위치·배경이 Finder 기본값이 된다(앱과 `Applications` 바로 가기는 그대로 들어간다).

### 2. 릴리스는 tauri-action 대신 Tauri CLI + `gh` 로 직접 한다

tauri-action(`tauri-apps/tauri-action@v1`)은 공식이지만 이 저장소의 요구 셋을 문서로 보장하지 못한다.

- **공증이 조용히 빠질 수 있다.** 번들러는 공증 자격이 없거나 불완전하면 `skipping app notarization` 경고만 남기고 빌드를 성공시킨다(`bundle/macos/app.rs` 의 `notarize_auth()` 분기). 그래서 빌드 뒤에 공증·스테이플을 **직접 검사**하는 단계가 따로 있어야 한다.
- **DMG 는 공증·스테이플하지 않는다.** 번들러는 DMG 에 서명만 한다(`dmg/mod.rs`). DMG 자체를 `notarytool` 로 공증하고 `stapler` 로 붙이는 단계를 둔다.
- **universal 빌드의 업데이트 정보 파일 키, 릴리스를 만드는 시점이 README 에 없다.** 앱 쪽 업데이터는 `darwin-aarch64`·`darwin-x86_64`(그리고 `-app` 이 붙은 키)를 찾는다(`tauri-plugin-updater` `updater.rs` 의 `get_urls`). 그래서 업데이트 정보 파일은 저장소 스크립트(`scripts/updater-json.mjs`)가 만들고 두 키에 같은 universal 파일을 적는다. 로컬에서도 같은 스크립트로 시험할 수 있다.
- **공개 순서**: 모든 검사를 통과한 뒤 `gh release create --draft` 로 파일을 전부 올리고, 올라간 파일 목록을 확인한 다음 `gh release edit --draft=false` 로 공개한다. 그 전에 어느 단계가 실패하면 릴리스는 없거나 드래프트로 남는다. 드래프트는 `releases/latest` 에 잡히지 않으므로 업데이트 정보 파일 없는 릴리스가 최신이 되지 않는다.

### 3. 서명·공증 자격과 비밀

- 인증서는 번들러가 직접 가져온다: `APPLE_CERTIFICATE`(.p12 base64)·`APPLE_CERTIFICATE_PASSWORD` 가 있으면 무작위 이름·비밀번호의 임시 키체인을 만들고 끝나면 지운다(`tauri-macos-sign` `keychain.rs`). 워크플로가 키체인을 따로 만들지 않는다. `APPLE_SIGNING_IDENTITY` 는 넣지 않는다 — 가져온 인증서에서 정해진다.
- 공증은 App Store Connect API 키: `APPLE_API_ISSUER`, `APPLE_API_KEY`(키 ID), `APPLE_API_KEY_PATH`(.p8 파일 경로). .p8 내용은 비밀 `APPLE_API_PRIVATE_KEY_BASE64` 로 받아 `$RUNNER_TEMP` 에 권한 600 으로 풀고 끝나면 지운다.
- 업데이트 서명: `TAURI_SIGNING_PRIVATE_KEY`(키 파일 내용), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- 로그 보호: 비밀은 그것이 필요한 단계의 `env` 에만 넣는다. 여러 줄 값은 GitHub 가림이 줄 단위로 어긋날 수 있어 **전부 한 줄(base64)** 로 등록한다. `set -x` 를 쓰지 않는다. 비밀이 비었는지 검사하는 단계는 **이름만** 찍는다.
- hardened runtime 은 설정 기본값이 켜짐(`MacConfig.hardened_runtime`, `default_true`)이지만 `tauri.conf.json` 에 `"hardenedRuntime": true` 로 밝혀 둔다. entitlements 는 두지 않는다 — 샌드박스가 아닌 앱의 파일·네트워크 접근은 entitlement 가 필요 없고, WebKit 의 JIT 는 WebContent 프로세스가 따로 갖는다. CI 의 검사 단계가 서명에 `runtime` 플래그가 있는지 본다.

### 4. 버전의 단일 원천은 루트 `package.json`

- 서버가 이미 루트 `package.json` 을 읽는다(`server/src/version.ts`). 그래서 이것을 원천으로 두고 나머지를 스크립트가 맞춘다: `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`, `app/src-tauri/Cargo.lock` 의 `keyring-notes` 항목, `packages/core/src/i18n.ts` 의 `APP_VERSION`.
- `tauri.conf.json` 의 `version` 에 package.json 경로를 적는 방법도 있지만 쓰지 않는다. 경로를 프로세스의 현재 디렉터리 기준으로 해석해서(`tauri-utils` `version_deserializer`) 호출하는 곳에 따라 깨진다.
- `pnpm version:set 0.8.0` 이 다섯 곳을 쓰고, `pnpm version:check [태그]` 가 다섯 곳과 태그를 비교해 다르면 실패한다. CI 는 태그 푸시 때 맨 먼저 이것을 돌린다.
- `server/src/mcp.ts` 의 MCP 서버 버전(`0.7.0` 하드코딩)은 `APP_VERSION` 을 쓰게 한다 — 여섯째 자리를 없앤다.

### 5. 업데이터

- `tauri-plugin-updater`·`tauri-plugin-process` 를 데스크톱 대상에만 넣는다(Cargo `cfg(not(android|ios))`, 등록은 `#[cfg(desktop)]`).
- 권한은 데스크톱 전용 capability `capabilities/desktop.json`(`platforms: macOS·windows·linux`)에 `updater:default`, `process:allow-restart`. 모바일 빌드에 없는 플러그인 권한이 섞이지 않게 기존 `default.json` 과 나눈다.
- `plugins.updater.endpoints`: `https://github.com/jang2162/keyring-notes/releases/latest/download/latest.json`. `pubkey` 는 사용자가 만든 공개 키를 넣는다. 아직 키가 없으므로 자리 표시 값을 두고, CI 가 업데이트 서명을 그 공개 키로 검증(`scripts/verify-updater-sig.mjs`)하므로 **자리 표시 값이 남아 있거나 비밀 키와 짝이 안 맞으면 릴리스가 실패한다.** 짝이 안 맞는 릴리스는 기존 사용자 업데이트를 조용히 깨기 때문에 이 검사를 둔다.
- `bundle.createUpdaterArtifacts` 는 설정 파일에서 끄고 CI 가 `--config` 로 켠다. 켜 두면 업데이트 키가 없는 사람의 로컬 빌드가 실패한다.
- 업데이트 정보 파일 이름은 `latest.json`, 릴리스 파일 이름은 공백 없는 고정형(`Keyring-Notes_<버전>_universal.dmg`, `Keyring-Notes_<버전>_universal.app.tar.gz`)으로 바꿔 올린다. GitHub 는 파일 이름의 공백을 바꿔 버리므로 URL 을 예측할 수 없게 된다.

### 6. 업데이트 확인 화면과 설정

- **확인 시점**: 실행 때 한 번(창이 뜨고 몇 초 뒤) + 설정의 「지금 확인」 단추. 실행 때 확인은 「업데이트 자동 확인」 이 켜졌을 때만.
- **묻기**: 새 버전이 있으면 기존 `Modal`(작은 창)으로 「새 버전 X 이 있습니다」 와 릴리스 글을 보이고 「나중에」·「업데이트하고 다시 시작」 을 둔다. 받기·설치는 **누른 뒤에만** `downloadAndInstall` 을 부르고, 끝나면 `relaunch`. `check()` 는 정보 파일만 읽는다.
- **설정 자리**: 설정 「이 기기·동기화」 묶음에 「앱 업데이트」 절. 데스크톱 앱(Tauri, 모바일 아님)에서만 그린다. 값은 기기별 화면 설정(`keyring:prefs`)의 `updateCheck`(기본 `true`). 따라가는 설정(`SYNCED_KEYS`)에 넣지 않는다 — 기기마다 정할 일이다.
- 실행 때 확인의 판정은 순수 함수로 떼어 단위 테스트로 「꺼져 있으면 확인 함수를 부르지 않는다」 를 실증한다.

### 7. 비밀 없이 흐름을 검증하는 법

- 워크플로에 `workflow_dispatch`(수동 실행)를 둔다. 이때는 서명·공증·릴리스 단계를 건너뛰고 서명 없는 universal DMG 를 만들어 워크플로 산출물로만 올린다.
- 태그 푸시인데 비밀이 없으면 「비밀 확인」 단계에서 빠진 비밀의 **이름**을 찍고 실패한다. 빌드·릴리스까지 가지 않는다.

## 구현 순서

1. 버전 스크립트(`scripts/version.mjs`)와 루트 스크립트, `mcp.ts` 정리, 0.8.0 으로 올리기.
2. 식별자 `com.develma.keyringnotes`, `hardenedRuntime`, 업데이터 설정, 플러그인·capability.
3. 화면: `web/src/update.tsx`(확인·대화상자·설정 절), `prefs.ts` 의 `updateCheck`, 메시지(en·ko), 단위 테스트.
4. 업데이트 정보 파일 생성·서명 검증 스크립트.
5. `.github/workflows/release.yml`.
6. `docs/guides/release-macos.md`, README 영·한, `docs/ops/ux.md`, 지침 색인(`.ruler/project.md` → `ruler apply`).
7. 검증: 서명 없는 universal 빌드·DMG, 임시 키로 업데이트 산출물·정보 파일·서명 검증, actionlint, 버전 불일치 실패, 테스트·타입체크·빌드·포맷·린트, 시험 서버(포트 8804)에서 설정 화면.

## 확인하는 방법

| 무엇 | 어떻게 |
| --- | --- |
| DMG | `CI=true` universal 빌드 → 파일 경로·크기, `lipo -info` 로 x86_64·arm64 |
| 업데이트 산출물 | 임시 키로 빌드 → `.app.tar.gz`·`.sig` 생성, `verify-updater-sig.mjs` 로 공개 키 검증, 다른 키로는 실패 |
| 정보 파일 | `updater-json.mjs` 결과의 키·서명·URL·`pub_date` |
| 워크플로 | `actionlint` |
| 버전 검사 | 한 곳을 일부러 바꿔 `version:check` 가 실패하는지 보고 되돌림 |
| 자동 확인 끄기 | 단위 테스트(꺼짐 → 확인 함수 0회 호출), 화면은 웹에서 이 절이 안 보이는지 |
