# Changelog

All notable user-facing changes to Keyring Notes are listed here. The server and the desktop app share one version.

## [Unreleased]

### Added

- Choose how each note sorts the notes directly under it: **Name**, **Last modified**, **Last opened** or **Custom**. Right-click a note and choose **Sort sub-notes**, or choose **Sort notes** in the tree's display options for the top of a workspace. With **Custom**, drag a note to the edge of another row, use **Move up** / **Move down**, or press `Alt+Shift+↑` / `Alt+Shift+↓`. The order is saved in the notes and shared by every device, except **Last opened**, which each device keeps on its own. Notes changed through Keyring Notes now get an `edited` time in their frontmatter.
- With line numbers on, clicking a line number selects that line without its line break. Dragging over line numbers selects whole lines, Shift-click extends the selection to a line, and clicking a folded line selects everything folded under it.
- Desktop app: `Ctrl/Cmd+Shift+W` closes the current window, like its close button. On macOS the **Close Window** menu item now uses the same shortcut, so `Cmd+W` always closes the tab.
- Desktop app: while a new version is waiting, `Cmd+Q` asks first: **Install and quit** installs it and quits without restarting, so the next start runs the new version. **Just quit** and **Cancel** are there too.
- **Settings** → **About** shows the version, app updates and open source licenses. Each Settings group has an icon in the side bar.

### Changed

- Desktop app: a new version found at startup no longer opens a dialog. An orange dot on the Settings gear and on **Settings** → **About** shows it instead, until the update is installed. Update settings moved from **This device & sync** to **About**.
- The web app installed to the home screen now keeps the whole vault on the device and syncs it with the server, so notes you never opened also open offline. While the device vault is empty and not connected, it opens sync settings with the server address filled in. A mode you chose with `?local` or `?local=0` still wins, and saves still waiting from the server mode are sent first.
- To keep using the server mode in the installed web app, open `https://<server>/?local=0` once in a tab of the same browser. Choosing `?local=0` before this release was not remembered.
- On a device vault in the browser, and when saving offline in the server mode, the app asks the browser to keep its storage. **This device & sync** says whether it does.
- The tabs now share the top row with the window buttons. In the macOS desktop app the separate title bar is gone, and the left part of that row holds the app name and the left panel button.
- The workspace switcher moved to the top of the left panel, where it fills the space beside the tree buttons. The workspace name no longer repeats at the top of the rail, in the tree header and at the start of the path above the note. With the left panel closed, a small switcher appears at the start of that path instead. With **All workspaces** on, the path still starts with the workspace.
- Workspace notes (`<workspace>.md` at the vault root) no longer open in the app. Links and addresses show a notice instead, and Quick open, search results and backlinks no longer list them. The file stays in the vault and still holds the workspace icon.

### Fixed

- Search in the server mode said "No results" without a connection. It now says it can't search without the server.
- Desktop app: on a slow connection, installing an update failed when the download took longer than 15 seconds.
- Desktop app on macOS: the first click on a window behind another app only brought the window forward, so you had to click again. That click now also reaches the button or field you clicked. Deleting a PDF annotation, deleting a property and **Reset this device** in Settings now ask you to confirm, since a single click can reach them.
- Desktop app: closing a window with its close button, quitting with `Cmd+Q`, or restarting after installing an update discarded unsaved changes without asking. Now, whenever a window with unsaved changes closes, you are asked to **Save and close**, **Close without saving** or cancel, even with autosave on. With several windows open, `Cmd+Q` and the update restart ask in each window in turn, and canceling stops them. If the window isn't responding, the app asks with a system dialog instead.

## [0.9.0] - 2026-10-26

### Added

- Trash: open **Trash** from the command palette or the link on Home to see deleted notes, grouped by delete, preview them and restore them. A restore never overwrites: if the path is taken, the note comes back with ` 2` added to its name. The server restores attachments too; the desktop app's local vault cannot. The REST API has `/api/trash`, `/api/trash/preview` and `/api/trash/restore` (owner only).
- Pin notes from the tree menu, the note menu (⋯) or the command palette. Pinned notes show above recent notes on Home and in a collapsible **Pinned** group above the tree. Pins are kept on this device only.
- Search can be narrowed to a folder and to tags. Tag chips combine, so a note must have every chosen tag. Each result shows up to three matching lines, and **N more lines** shows up to ten; clicking a line opens the note at that line. `/api/search` takes `tag` (repeatable) and `lines`.
- **Settings** → **General** → **Open source licenses** lists the third-party software included in the server and the app with its licenses. The server also serves it at `/licenses.txt`.

### Changed

- The icon picker offers the full emoji set (up to Emoji 14.0), grouped by category with tabs at the top, and finds emoji by English or Korean name.

### Fixed

- Recently used icons are no longer cut off at the top of the icon picker.
- A pasted emoji with a trailing variation selector, such as `⭐️`, is saved the same as `⭐`.
- Clicking a search result now selects the match even when the query has several words or a `#tag`.

## [0.8.6] - 2026-10-20

### Added

- Find inside a note with `Ctrl/Cmd+F` now opens a find bar above the editor. It shows the match count, has case, whole-word and regular-expression toggles, and opens replace with `Ctrl/Cmd+Alt+F`.

### Fixed

- Docker Compose now passes `KEYRING_EMBED_URL`, `KEYRING_EMBED_MODEL`, `KEYRING_EMBED_KEY`, `KEYRING_SCHEDULER`, `KEYRING_BACKUP_SCHEDULER`, `KEYRING_S3_ENCRYPTION_KEY_FILE`, `KEYRING_UPDATE_URL` and `KEYRING_LANG` from `.env` to the container.

## [0.8.5] - 2026-10-20

### Fixed

- Section headings in Settings no longer sit flush against the divider above them.

## [0.8.4] - 2026-10-19

### Added

- Delete a workspace from Settings → Workspaces. The confirmation shows how many notes and attachments go with it, and the notice right after offers **Undo**.
- Desktop app: drag a tab outside the window to open it in a new window.
- The Attachments panel has a drop area for adding files.

### Changed

- Empty states and hints are shorter, and hints that repeated another element on the screen are gone.

## [0.8.3] - 2026-10-19

### Fixed

- Desktop app: HTML drag and drop works again, so tabs can be dragged between panes.

## [0.8.2] - 2026-10-19

### Added

- Split the editor area left/right or top/bottom as many times as you like. Drag a tab to the edge of a pane to split there.
- Desktop app: open a tab in a new window.

### Fixed

- In the desktop app, a window no longer overwrites a note that another window saved first.

## [0.8.1] - 2026-10-18

### Fixed

- Dark theme: selected text in the editor is readable.
- The side bar scrolls instead of overflowing when the window is short.
- Spacing of labelled side bar buttons.

## [0.8.0] - 2026-10-18

### Added

- The macOS desktop app is signed, notarized and published on GitHub Releases.
- The desktop app checks for updates at startup and asks before installing. Turn the check off in Settings → This device & sync → App updates.
- `GET /llms.txt` serves a short guide for LLM agents without authentication.
- Open a note in a new tab from the tree, split by dragging a tab to a pane edge, and open a note in a new window.
- On narrow screens, a tab count button opens the list of open tabs.

### Changed

- Docker images are built from the repository on your server. There is no registry image.
- New daily notes get no icon. The daily folder shows the icon in the tree instead.

### Fixed

- Dark theme: the caret at the start of a line is no longer hidden.
- Creating several new notes in a row no longer renames the new note with the previous title.

## [0.7.0] - 2026-10-14

First tagged release.

### Added

- Plain Markdown vault with Git history, edited in the browser.
- Agent tokens with per-folder permissions, an MCP server and a REST API.
- Search, backlinks, tags, unlinked mentions and widgets (list, table, cards, kanban, tasks, chart, plugins).
- LLM Wiki topics: source collection from files, URLs and a web clipper, with an index and log kept up to date.
- Admin console, backup and restore, Docker deployment and HTTPS remote access.
- Change review queue, source links, structure check, webhooks and scheduled jobs.
- Graph view and semantic search.
- Offline editing as an installable web app.
- Desktop and mobile apps that work without a server, with optional sync.
- S3-compatible storage for remote backups and large attachments, with optional encryption.
- Three-way merge for concurrent edits, sync and offline saves.
- Links update automatically when you rename or move a note.
- Live Preview, quick switcher, command palette, outline, tabs, daily notes, templates, property editor, PDF annotations and passkey login.
- Notes and folders form one tree of nodes, grouped into workspaces.
- English and Korean interface.

[0.8.6]: https://github.com/jang2162/keyring-notes/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/jang2162/keyring-notes/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/jang2162/keyring-notes/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/jang2162/keyring-notes/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/jang2162/keyring-notes/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/jang2162/keyring-notes/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/jang2162/keyring-notes/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/jang2162/keyring-notes/tree/v0.7.0
