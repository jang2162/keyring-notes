# Customize settings

This guide explains the Settings window, which settings follow you across devices, and how languages work.

It is for everyone who wants Keyring Notes to look and behave their way.

## Open Settings

Click the gear at the bottom of the rail, press `Ctrl/Cmd+,`, or go to `#/:settings/<group>`. Settings opens over the note.

| Group | What it holds |
| --- | --- |
| **General** | Theme, show icons, labels on the side bar, reset |
| **Language** | Display language, vault language, language packs. On a server also agent language and server language |
| **Editor** | Autosave, Live Preview, font and size, readable width, line numbers, properties above the document |
| **Files & links** | New link format, attachments in the tree, backlinks at the end of the document, daily display |
| **Workspaces** | Workspaces and their daily, template and attachment folders |
| **Shortcuts** | Keyboard shortcuts (desktop and web only) |
| **This device & sync** | Sync and app updates (app only) |
| Server group | The admin console (server only, owner only), see [Manage the server](manage-the-server.md) |

Search settings with the box at the top left, in the current language or in English. Server items such as "backup" and "token" are found too. Close Settings with X, Esc, a click on the backdrop or the browser's back button. The first Esc inside an input only leaves the field.

## Settings that follow you

Settings marked **All devices** are stored in the vault's shared settings file and used by every device, web and app: theme, display language, editor font and size, line numbers, Live Preview, readable width, autosave, show icons, attachments in the tree, daily display, sorting, properties above the document, backlinks at the end of the document, side bar labels and shortcuts.

- Turn on **Different on this device only** for an item to keep its value on this device only. It then stops following the shared value, which is shown dimmed next to it.
- The value used is: this device's override, then the shared value, then the default.
- Changes from other tabs or sync apply right away.

These stay on this device only: panel widths and open state, the left view and right tab, folded sections, open tabs, tree expansion, the last note, recent emoji and unofficial language packs.

## The shared settings file

Shared settings live in the frontmatter of `keyring-settings.md` at the top of the vault. It is Markdown, so app sync keeps it in step, and the server also uses it to resolve `[[date]]` links and recognize daily notes.

- It does not appear in the tree, quick open, search, graph, widgets or property suggestions, and it is not a workspace. Open it from Settings → **General**.
- Each edit re-reads the file and rewrites only the value that changed, so values changed by other devices are kept.
- Agents can only read this file, whatever their permissions.

The file format is in [Reference](../reference.md#shared-settings-file).

## Languages

The official languages are English (the base) and Korean.

- **Display language** follows you across devices. It starts as your system or browser language and switches without a reload.
- **Vault language** decides the text saved into the vault: "Untitled", conflict copies, default folder names, the wiki index, log and `SCHEMA.md`, month and weekday names in daily formats, and commit messages. It is separate from the display language.
- **Agent language** (server only) decides the language of MCP tool descriptions and errors. English by default.
- **Server language** (server only) decides server errors, logs and the CLI. `KEYRING_LANG` or `LANG` is used until you set it.

### Add an unofficial language

1. In Settings → **Language**, download an official language as a language pack JSON (`meta` and `messages`).
2. Translate the values.
3. Add it with **Import language pack**.

On import you see a check report: unknown keys, the number of missing keys, messages whose `{name}` placeholders differ, non-string values, and values that look like HTML. Problem messages are dropped, and missing keys fall back to the base language. Values are always shown as plain text, and a pack can be up to 1 MB.

Language packs stay on this device. You can also download only the missing keys, import an update (merge), export and delete. If another device chose a language whose pack is not on this device, the base language is shown with a notice.

## Shortcuts

Press `Ctrl/Cmd+/` for the list of shortcuts, and change them in Settings → **Shortcuts**. The defaults are in [Reference](../reference.md#keyboard-shortcuts).

## Next steps

- [Organize notes](organize-notes.md)
- [Manage the server](manage-the-server.md)
