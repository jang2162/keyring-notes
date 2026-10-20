<!-- source: docs/manual/en/how-to/build-the-desktop-app.md @ v0.8.5 -->
# 데스크톱·모바일 앱 빌드하기

Windows, macOS, Linux, Android, iOS 용 Keyring Notes 앱을 소스에서 빌드합니다.

배포하는 앱이 없는 플랫폼을 쓰거나 개발 빌드를 돌리려는 분을 위한 문서입니다. 앱 셸은 Tauri 2 입니다.

## 요구 사항

- Rust(stable)
- Node.js 22.13 이상(`mise.toml` 은 Node 24)과 pnpm
- 플랫폼별 [Tauri 사전 요구 사항](https://v2.tauri.app/start/prerequisites/). 예: Linux 의 `libwebkit2gtk-4.1-dev`
- Android: Android SDK 와 NDK. iOS: Xcode 가 있는 macOS

## 빌드

먼저 의존성을 설치하세요.

```bash
pnpm install --frozen-lockfile
```

그다음 필요한 것의 명령을 실행하세요.

| 목적 | 명령 |
| --- | --- |
| 데스크톱 앱을 개발 모드로 실행(웹 개발 서버와 앱 창) | `pnpm app:dev` |
| 이 플랫폼의 설치 파일(Windows `.msi`/`.exe`, macOS `.dmg`, Linux `.deb`/`.rpm`/`.AppImage`) | `pnpm app:build` |
| macOS universal(Apple silicon 과 Intel) `.app`·`.dmg`, 서명 없음 | `pnpm -F @keyring-notes/app build:mac` |
| Android | `pnpm -F @keyring-notes/app android:init && pnpm -F @keyring-notes/app android:build` |
| iOS | `pnpm -F @keyring-notes/app ios:init && pnpm -F @keyring-notes/app ios:build` |

앱 아이콘을 다시 만들려면 `pnpm -F @keyring-notes/app icons` 를 실행하세요.

> [!NOTE]
> macOS 에서 `pnpm app:build` 는 Finder AppleScript 단계로 DMG 창을 꾸밉니다. Finder 자동화가 막힌 셸에서는 이 단계가 `Failed running AppleScript` 로 실패합니다. `build:mac` 은 이 단계를 건너뜁니다.

서명하지 않은 macOS 빌드는 다른 사람이 열면 Gatekeeper 가 경고합니다. 서명된 앱은 [GitHub Releases](https://github.com/jang2162/keyring-notes/releases/latest)에 있습니다.

## 다음 단계

- [데스크톱·모바일 앱 쓰기](use-the-desktop-app.md)
