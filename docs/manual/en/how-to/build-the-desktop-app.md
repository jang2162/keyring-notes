# Build the desktop and mobile apps

This guide builds the Keyring Notes app from source for Windows, macOS, Linux, Android or iOS.

It is for people on a platform without a published app, or who want to run a development build. The app shell is Tauri 2.

## Requirements

- Rust (stable).
- Node.js 22.13 or later (`mise.toml` pins Node 24) and pnpm.
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform, for example `libwebkit2gtk-4.1-dev` on Linux.
- Android: the Android SDK and NDK. iOS: macOS with Xcode.

## Build

Install the dependencies first.

```bash
pnpm install --frozen-lockfile
```

Then run the command for what you need.

| Goal | Command |
| --- | --- |
| Run the desktop app in development mode (web dev server and app window) | `pnpm app:dev` |
| Installers for this platform (Windows `.msi`/`.exe`, macOS `.dmg`, Linux `.deb`/`.rpm`/`.AppImage`) | `pnpm app:build` |
| macOS universal (Apple silicon and Intel) `.app` and `.dmg`, unsigned | `pnpm -F @keyring-notes/app build:mac` |
| Android | `pnpm -F @keyring-notes/app android:init && pnpm -F @keyring-notes/app android:build` |
| iOS | `pnpm -F @keyring-notes/app ios:init && pnpm -F @keyring-notes/app ios:build` |

To regenerate the app icons, run `pnpm -F @keyring-notes/app icons`.

> [!NOTE]
> `pnpm app:build` on macOS decorates the DMG window through a Finder AppleScript step. In a shell where Finder automation is blocked, that step fails with `Failed running AppleScript`. `build:mac` skips it.

An unsigned macOS build triggers a Gatekeeper warning when someone else opens it. The signed app is on [GitHub Releases](https://github.com/jang2162/keyring-notes/releases/latest).

## Next steps

- [Use the desktop and mobile apps](use-the-desktop-app.md)
