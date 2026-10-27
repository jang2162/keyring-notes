# Use the desktop and mobile apps

This guide installs the app, explains where it keeps your notes, and connects it to a server for sync.

It is for people who want their notes on a device, with or without a server.

The app works **without a server**. Notes are Markdown files in a folder on the device. Editing, search, tags, backlinks, widgets, the wiki index, structure check, graph and change history all run on the device. Connecting to a server is optional.

## Install

- **macOS**: download `Keyring-Notes_<version>_universal.dmg` from [GitHub Releases](https://github.com/jang2162/keyring-notes/releases/latest), open it and drag the app to Applications. The app is signed and notarized, and runs on Apple silicon and Intel.
- **Windows, Linux, iOS and Android**: no prebuilt app is published. Build it yourself, see [Build the desktop and mobile apps](build-the-desktop-app.md).

## Where your notes live

| Platform | Vault location | Notes |
| --- | --- | --- |
| Windows, macOS, Linux | `Documents/Keyring Notes` | Open another folder, an Obsidian vault for example, with ⇅ → **Open another folder**. Files changed in other editors are re-read when you return to the window |
| iOS | The app's documents folder, visible in the Files app | |
| Android | The app's data folder | |
| Browser | This browser's IndexedDB, at `https://<server>/?local` (turn off with `?local=0`) | A server-less web app, for testing |

The app keeps its own metadata in `.keyring-app/` inside the vault. It is a dot folder, so the server and Obsidian ignore it.

## Close windows and quit

When you close a window that has unsaved changes, the app asks first: **Save and close** (the default, `Enter`), **Close without saving**, or **Cancel**. It asks even with autosave on, whichever way you close: the close button, `Ctrl/Cmd+Shift+W`, the **Close Window** menu item or `Cmd+Q`. **Save and close** closes the window only after every note is saved. If a note can't be saved, the window stays open and the app tells you which note.

With several windows open, `Cmd+Q` asks in each window that has unsaved changes, starting with the current one. Each window comes to the front when its turn comes. Canceling in any window stops the quit, and the windows not closed yet stay open.

If a window with unsaved changes stops responding, the app asks with a system dialog instead, a few seconds after you close it: **Cancel** or **Close without saving**.

On macOS, quitting from the Dock, logging out or shutting down does not ask yet. Close your windows or use `Cmd+Q` first.

## Update the desktop app

A few seconds after start, the app asks GitHub Releases whether a new version is out. If there is one, it asks you first. Only after you choose **Update and restart** does it download the update, verify its signature, install it and restart. Before restarting, it asks in each window with unsaved changes, as `Cmd+Q` does. If you cancel, the app doesn't restart; the update is already installed and is used the next time you open the app.

To turn the startup check off, go to Settings → **This device & sync** → **App updates**. With the check off, no request is sent at startup. **Check for updates** in the same place checks on demand.

## Sync with a server

1. Click the sync button at the bottom of the app rail, or open Settings → **This device & sync**.
2. Enter the server address, a device name and the server password.
3. Click **Connect and sync**.

The server issues a token for this device (`kd_…`). You can disconnect each device in Settings → **Devices** on the server.

Sync runs when the app opens, 10 seconds after a save, when you return to the window, and every 5 minutes. On mobile it runs only while the app is open.

### How sync merges changes

- Each note is compared with the last version both sides agreed on (the baseline). If only one side changed, that side wins.
- If both sides changed different parts, a three-way merge saves the combined result on both sides. It shows in history as an automatic merge and can be undone.
- If both sides changed the same line, or adjacent lines, nothing is overwritten. The original path keeps the server version, and this device's content is kept on both sides as `<name> (sync conflict copy <date-time>).md`. No conflict markers are inserted into notes.
- If one side deleted a note and the other edited it, the edit wins.
- Markdown syncs both ways. Attachments are downloaded from the server. New attachments created on the device are uploaded. An attachment deleted on the device is deleted on the server only if the server still has the baseline version; otherwise the server's copy is downloaded again. Edits to existing attachments on the device are not sent.
- If you move a folder with attachments in the app, the next sync uploads the attachments at the new place and deletes them from the old place on the server.
- The shared settings file (`keyring-settings.md`) syncs key by key. If both sides changed the same key, the server's value wins, and for display settings the app offers to keep this device's value as a device-only override.
- Each side builds its own wiki index and log.
- Commits the app writes to the server are authored as `owner (<device name>)`. Device tokens cannot use the admin console.

### What needs a server

Source collection (web page and PDF conversion), semantic search, change review and widget plugin rendering work in the web app connected to a server. Agents (MCP) also connect only to the server.

## Next steps

- [Organize notes](organize-notes.md)
- [Build the desktop and mobile apps](build-the-desktop-app.md)
