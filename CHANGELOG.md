# Changelog

All notable user-facing changes to Keyring Notes are listed here. The server and the desktop app share one version.

## [Unreleased]

### Added

- With line numbers on, clicking a line number selects that line without its line break. Dragging over line numbers selects whole lines, Shift-click extends the selection to a line, and clicking a folded line selects everything folded under it.
- Desktop app: `Ctrl/Cmd+Shift+W` closes the current window, like its close button. Unsaved changes are saved first; if some can't be saved, you are asked before they are discarded.

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
