# macOS 앱 릴리스하기

데스크톱 앱(`app/`)을 Developer ID 로 서명하고 Apple 공증을 받아 GitHub 릴리스로 내보내는 방법이다. **태그 하나를 올리면 나머지는 GitHub Actions(`.github/workflows/release-macos.yml`)가 한다.** 사람이 할 일은 처음 한 번의 준비(1~4)와 릴리스마다의 버전·태그(5)다.

| 한 번만 | 릴리스마다 |
| --- | --- |
| 1. Developer ID 인증서 → `.p12` | 5. 버전 올리기 → 커밋 → 태그 푸시 |
| 2. App Store Connect API 키(공증용) | 6. 결과 확인 |
| 3. 업데이트 서명 키 → 공개 키를 커밋 | |
| 4. GitHub 비밀 7개 등록 | |

서버와 앱은 **버전과 릴리스를 함께 쓴다.** `v0.8.0` 태그 하나가 앱 릴리스이자 서버의 새 버전이다(서버 관리 화면 「업데이트」 도 같은 `releases/latest` 를 본다).

> ⚠ 비밀 파일(`.p12`, `.p8`, 업데이트 키)과 비밀번호를 저장소 폴더 안에 두지 않는다. 아래 명령은 모두 `~/keyring-release/` 처럼 저장소 밖 폴더에서 한다.
>
> ```bash
> mkdir -p ~/keyring-release && chmod 700 ~/keyring-release && cd ~/keyring-release
> ```

## 1. Developer ID 인증서

Apple Developer Program 의 **Account Holder** 만 만들 수 있다.

1. **인증서 요청 파일(CSR) 만들기** — 키체인 접근(Keychain Access) → 메뉴 「키체인 접근 → 인증서 지원 → 인증 기관에서 인증서 요청」 → 이메일·이름을 넣고 「디스크에 저장됨」 → `CertificateSigningRequest.certSigningRequest` 저장.
2. **인증서 만들기** — <https://developer.apple.com/account/resources/certificates/add> → **Developer ID Application** 을 고른다(「Apple Development」·「Apple Distribution」 이 아니다) → 프로필 종류는 기본값(G2 Sub-CA) → 1의 CSR 올리기 → `.cer` 내려받기.
3. **설치** — 받은 `.cer` 를 두 번 눌러 로그인 키체인에 넣는다. 확인:
   ```bash
   security find-identity -v -p codesigning
   # 1) ABCDEF… "Developer ID Application: 이름 (TEAMID1234)"  ← 이 줄이 있어야 한다
   ```
4. **`.p12` 내보내기** — 키체인 접근 → 로그인 → 「내 인증서」 탭 → `Developer ID Application: …` 를 오른쪽 클릭 → 「내보내기」 → 형식 `.p12`, 이름 `DeveloperID.p12`, `~/keyring-release/` 에 저장 → **내보내기 비밀번호**를 정한다(이것이 `APPLE_CERTIFICATE_PASSWORD`). 「내 인증서」 탭에서 내보내야 개인 키가 함께 들어간다.
5. **한 줄 base64 로 바꾸기**:
   ```bash
   openssl base64 -A -in DeveloperID.p12 -out DeveloperID.p12.base64.txt
   ```
   이 파일 내용이 `APPLE_CERTIFICATE` 다.

## 2. App Store Connect API 키 (공증용)

Apple ID 비밀번호 대신 API 키로 공증한다(2단계 인증·앱 암호에 묶이지 않는다).

1. <https://appstoreconnect.apple.com/access/integrations/api> (사용자 및 액세스 → 통합 → App Store Connect API → **팀 키**). 처음이면 Account Holder 가 「액세스 요청」 을 한 번 한다.
2. 「API 키 생성」(+) → 이름 `keyring-notes-notary`, 액세스 **Developer** → 생성.
3. 표의 **키 ID** → `APPLE_API_KEY`. 표 위의 **Issuer ID** → `APPLE_API_ISSUER`.
4. **「API 키 다운로드」** → `AuthKey_<키ID>.p8`. **한 번만 받을 수 있다** — 바로 `~/keyring-release/` 로 옮긴다. 잃으면 그 키를 폐기하고 새로 만든다.
5. 한 줄 base64 로 바꾸기:
   ```bash
   openssl base64 -A -in AuthKey_<키ID>.p8 -out AuthKey.p8.base64.txt
   ```
   이 파일 내용이 `APPLE_API_PRIVATE_KEY_BASE64` 다.
6. (선택) 자격이 맞는지 맥에서 먼저 본다 — 오류 없이 목록(처음엔 비어 있음)이 나오면 된다:
   ```bash
   xcrun notarytool history --key AuthKey_<키ID>.p8 --key-id <키ID> --issuer <Issuer ID>
   ```

## 3. 업데이트 서명 키

설치된 앱은 새 버전 파일이 이 키로 서명됐는지 확인하고 나서야 설치한다(Tauri 업데이터).

> ⚠ **이 비밀 키(또는 그 비밀번호)를 잃으면, 이미 설치된 모든 앱이 다시는 업데이트를 받지 못한다.** 새 키로 서명한 업데이트는 옛 공개 키를 가진 앱이 거절한다. 그때는 사람들이 새 DMG 를 직접 받아 다시 설치하는 수밖에 없다. 한 번 릴리스한 뒤에는 **키를 새로 만들지 않는다.**

1. 키 만들기(비밀번호를 묻는다 — 반드시 정한다):
   ```bash
   cd /path/to/keyring-notes
   pnpm --filter @keyring-notes/app exec tauri signer generate -w ~/keyring-release/keyring-notes-updater.key
   ```
   `keyring-notes-updater.key`(비밀 키, 한 줄)와 `keyring-notes-updater.key.pub`(공개 키)가 생긴다.
2. **보관** — 아래 둘을 **모두** 한다. GitHub 비밀은 다시 읽을 수 없으므로 보관처가 아니다.
   - 비밀번호 관리자(1Password·Bitwarden 등)에 「keyring-notes 업데이트 서명 키」 항목을 만들고 `keyring-notes-updater.key` 파일 내용과 비밀번호를 함께 넣는다.
   - 오프라인 사본: 암호화한 USB·외장 디스크(디스크 유틸리티에서 「APFS(암호화)」)에 `.key`·`.key.pub` 파일을 둔다. 비밀번호는 같은 곳에 적지 않는다.
   - 저장소·클라우드 드라이브 일반 폴더·메신저·메일에 두지 않는다.
3. **공개 키를 앱에 넣고 커밋** — `app/src-tauri/tauri.conf.json` 의 `plugins.updater.pubkey` 가 `.pub` 파일 내용(한 줄)이다. 지금 쓰는 키의 공개 키는 이미 커밋돼 있으므로, 이 단계는 키를 처음 만들 때만 한다. 공개 키는 비밀이 아니다.
   ```bash
   cat ~/keyring-release/keyring-notes-updater.key.pub   # 이 한 줄을 pubkey 값으로
   git add app/src-tauri/tauri.conf.json && git commit -m "앱: 업데이트 서명 공개 키" && git push
   ```
   자리 표시 값이 남아 있거나 비밀 키와 짝이 안 맞으면 릴리스 워크플로가 실패한다(짝이 안 맞는 릴리스는 기존 사용자의 업데이트를 조용히 깨기 때문이다).

## 4. GitHub 비밀 등록

저장소 → Settings → Secrets and variables → Actions → **New repository secret**. 또는 `gh` 로 파일에서 바로 넣는다(값이 셸 기록에 남지 않는다). 값은 전부 **한 줄**이어야 한다 — 여러 줄 값은 로그 가림이 줄 단위로 어긋날 수 있다.

| 이름 | 값 | `gh` 로 넣기 |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | `DeveloperID.p12.base64.txt` 내용 | `gh secret set APPLE_CERTIFICATE < DeveloperID.p12.base64.txt` |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` 내보내기 비밀번호 | `gh secret set APPLE_CERTIFICATE_PASSWORD` (입력을 묻는다) |
| `APPLE_API_ISSUER` | Issuer ID | `gh secret set APPLE_API_ISSUER` |
| `APPLE_API_KEY` | 키 ID | `gh secret set APPLE_API_KEY` |
| `APPLE_API_PRIVATE_KEY_BASE64` | `AuthKey.p8.base64.txt` 내용 | `gh secret set APPLE_API_PRIVATE_KEY_BASE64 < AuthKey.p8.base64.txt` |
| `TAURI_SIGNING_PRIVATE_KEY` | `keyring-notes-updater.key` 내용 | `gh secret set TAURI_SIGNING_PRIVATE_KEY < keyring-notes-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 3의 비밀번호 | `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |

`gh` 명령은 `~/keyring-release/` 에서 `-R jang2162/keyring-notes` 를 붙여 돌린다. 등록이 끝나면 `~/keyring-release/` 의 `*.base64.txt` 는 지워도 된다(원본 `.p12`·`.p8` 와 업데이트 키는 3의 보관처에 둔다).

## 5. 버전 올리고 릴리스하기

버전의 원천은 **루트 `package.json`** 이고, 아래 명령이 나머지 네 곳(`tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `packages/core/src/i18n.ts`)을 맞춘다. 손으로 고치지 않는다.

릴리스 커밋 전에 번역본 맨 위의 판(`<!-- source: … @ vX.Y.Z -->`)을 새 버전으로 올린다. 원본에 맞춘 번역만 올린다 — 지난 릴리스 뒤로 원본(`README.md`, `docs/manual/en/`, `examples/plugins/README.md`)이 바뀌었는데 번역이 따라가지 않았으면 그 문서는 판을 그대로 둔다. 어느 원본이 바뀌었는지는 `git diff --name-only v<지난 버전> -- README.md docs/manual/en examples/plugins/README.md` 로 본다. 바꾼 번역본도 릴리스 커밋에 함께 stage 한다. 판 규칙은 `docs/guides/development.md` 「문서」 절.

```bash
pnpm version:set <버전>       # 앞에 v 없이. 예: 0.8.6
pnpm version:check            # 다섯 곳이 같은지
git add package.json app/src-tauri/tauri.conf.json app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock packages/core/src/i18n.ts
git commit -m "릴리스 <버전>"
git push
git tag v<버전>               # 태그는 v + 버전과 정확히 같아야 한다
git push origin v<버전>
```

태그가 올라가면 Actions 의 **release-macos** 가 돈다(20~40분, 공증 대기 포함). 순서와 각 단계에서 멈추는 조건은 워크플로 파일 맨 위 주석에 있다. 성공하면 릴리스가 **바로 공개**되고 파일 넷이 붙는다: `Keyring-Notes_<버전>_universal.dmg`, `….app.tar.gz`, `….app.tar.gz.sig`, `latest.json`.

## 6. 결과 확인

- 릴리스 페이지에 위 파일 넷이 있고 「Latest」 표시가 붙었는지.
- 다른 맥(또는 다른 사용자 계정)에서 DMG 를 브라우저로 받아 열고 앱을 「응용 프로그램」 으로 끌어 실행 — **경고 없이** 열려야 한다. 터미널로도 본다:
  ```bash
  spctl --assess --type open --context context:primary-signature -v ~/Downloads/Keyring-Notes_<버전>_universal.dmg
  # … accepted  source=Notarized Developer ID
  ```
- 옛 버전이 설치된 맥에서 앱을 실행하면 몇 초 뒤 레일의 설정 단추와 설정 「정보」 에 주황 점이 찍힌다. 설정 → 정보 → 「설치…」(또는 「업데이트 확인」) → 「업데이트하고 다시 시작」 → 새 버전으로 다시 뜬다. Cmd+Q 를 누르면 「설치하고 종료」·「그냥 종료」·「취소」 를 묻는다 — 「설치하고 종료」 뒤 다시 열면 새 버전이다.

## 비밀 없이 흐름만 시험하기

Actions → release-macos → **Run workflow**(수동 실행). 서명·공증·릴리스 없이 universal DMG 를 만들어 실행 결과의 Artifacts 에 올린다. 서명이 없으므로 받은 DMG 는 Gatekeeper 가 경고한다 — 빌드가 되는지만 보는 용도다.

로컬에서도 같은 빌드를 할 수 있다(서명 없음):

```bash
pnpm --filter @keyring-notes/app build:mac
# app/src-tauri/target/universal-apple-darwin/release/bundle/dmg/Keyring Notes_<버전>_universal.dmg
```

`build:mac` 은 `CI=true` 로 돌아 DMG 창 꾸미기(Finder AppleScript)를 건너뛴다. `pnpm app:build` 는 그 단계를 돌리므로, Finder 자동화가 막힌 셸(에이전트 샌드박스 등)에서는 `bundle_dmg.sh` 가 `Failed running AppleScript`(exit 64)로 실패하고 `bundle/macos/rw.*.dmg` 중간 파일이 남는다. 그 단계가 돌면 Finder 창이 잠깐 열린다.

## 실패했을 때

먼저 Actions 의 실패한 실행 → 빨간 단계를 연다. 단계 이름으로 찾는다.

| 단계 / 메시지 | 원인과 할 일 |
| --- | --- |
| 버전 확인 / `버전이 맞지 않는다` | 태그와 `package.json` 이 다르거나 다섯 곳이 어긋났다. `pnpm version:set <버전>` → 커밋·푸시 → 태그를 지우고 다시 붙인다: `git tag -d v<버전> && git push origin :refs/tags/v<버전> && git tag v<버전> && git push origin v<버전>` |
| 비밀·공개 키 확인 / `GitHub 비밀이 없다: …` | 적힌 이름의 비밀을 4대로 등록하고 실행 화면에서 「Re-run all jobs」. |
| 비밀·공개 키 확인 / `pubkey 가 자리 표시 값이다` | 3의 3을 한다(공개 키 커밋). 코드가 바뀌었으므로 태그를 다시 붙인다. |
| Apple 중간 인증서(Developer ID G2) / 내려받기·`shasum` 실패 | Apple 서버에서 받지 못했거나 Apple 이 인증서를 바꿨다. 「Re-run all jobs」 로 다시 해 보고, 해시가 계속 다르면 <https://www.apple.com/certificateauthority/> 의 G2 인증서 SHA-256 을 확인해 워크플로의 값을 고친다. |
| 빌드·서명·앱 공증 / `failed to import keychain certificate` 류 | `.p12` base64 나 비밀번호가 틀렸다. 1의 4~5를 다시 하고 두 비밀을 다시 넣는다. |
| 서명·공증 검사(앱) / `Developer ID 로 서명되지 않았다` | 인증서가 Developer ID Application 이 아니다(Apple Development 등). 1을 다시 한다. |
| 서명·공증 검사(앱) / `공증되지 않았다` | 빌드 로그에서 `skipping app notarization` 을 찾는다 — 공증 자격(`APPLE_API_*`)이 빠졌거나 틀렸다. 2의 6으로 맥에서 자격을 확인한다. |
| 업데이트 묶음 검사 / `키 ID 가 다르다` | `TAURI_SIGNING_PRIVATE_KEY` 와 `tauri.conf.json` 의 `pubkey` 가 짝이 아니다. 보관해 둔 짝을 쓴다. **이미 릴리스한 적이 있으면 공개 키를 바꾸지 않는다**(3의 경고). |
| DMG 공증·스테이플 / `DMG 공증 결과: Invalid` | 바로 위에 Apple 의 공증 로그(JSON)가 찍힌다. `issues` 의 `message` 를 본다. 맥에서 `xcrun notarytool history …`(2의 6)로 기록도 볼 수 있다. |
| 릴리스 공개 / `올라간 파일이 다르다` · 업로드 오류 | 릴리스는 **드래프트로 남는다**(공개되지 않음). 릴리스 페이지에서 그 드래프트를 지우고 「Re-run all jobs」. 같은 태그의 릴리스가 있으면 만들기 단계가 실패하므로 지우는 것이 먼저다. |

공개되기 전에 실패한 실행은 사용자에게 아무 영향이 없다 — 드래프트는 `releases/latest` 가 아니라서 앱과 서버가 보지 않는다.

## 바꾸면 안 되는 것

- **앱 식별자 `com.develma.keyringnotes`**(`tauri.conf.json` 의 `identifier`). 바꾸면 업데이트가 다른 앱으로 보이고 앱 데이터 위치가 갈린다.
- **업데이트 서명 키**(3).
- **릴리스 파일 이름 모양과 `latest.json` 위치**. 설치된 앱은 `https://github.com/jang2162/keyring-notes/releases/latest/download/latest.json` 을 본다(`tauri.conf.json` 의 `plugins.updater.endpoints`). 저장소 이름·소유자를 바꾸면 이 주소도 함께 바뀌어야 하고, 옛 앱은 옛 주소를 계속 본다.

## 참고

- Tauri: [macOS 코드 서명](https://v2.tauri.app/distribute/sign/macos/), [업데이터](https://v2.tauri.app/plugin/updater/)
- Apple: [Developer ID](https://developer.apple.com/developer-id/), [공증](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
