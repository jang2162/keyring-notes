# Edit notes

This guide covers writing in the editor: saving, links, formatting, properties, templates and offline editing.

It is for everyone who writes in Keyring Notes.

## Saving

- Notes save 1.5 seconds after you stop typing, and when you switch tabs or the window loses focus. Turn autosave off or change the delay in Settings → **Editor**.
- `Ctrl/Cmd+S` saves right away, as a separate commit.
- On the server, consecutive autosaves of the same note by the same person are grouped into one commit for 10 minutes. Another commit or a backup in between starts a new commit. Agent writes are never grouped.

## When someone else changed the note

If the note changed elsewhere (another tab, an agent, app sync) before you save, Keyring Notes merges your changes with theirs against the version you started from. Changes to different parts are combined and saved automatically.

Only when the same line was changed differently are you asked to **Save my changes as a copy** or **Load server version**. Autosave pauses until you choose. The same applies when saves made offline are sent after reconnecting.

## Live Preview

Live Preview is on by default. Turn it off from the status bar or in Settings → **Editor**.

- Lines without the cursor hide Markdown markup (`#`, `**`, `~~`, `==`, backticks, `[text](url)`, `[[target|alias]]`) and show only the formatting.
- Horizontal rules, quotes, bullets and to-dos are drawn. `---` becomes a line, `>` becomes a bar on the left, `-`, `*` and `+` become a dot, and `- [ ]` becomes a checkbox.
- Click a checkbox to check or uncheck the to-do. The cursor stays where it was. In a read-only note the checkbox can't be clicked.
- Code blocks hide their fence lines and show the language and a **Copy** button. **Copy** copies only the code inside. The code stays as text, so you edit it in place. Move the cursor into the block to see the fences.
- Code is colored by language, with the same colors in the editor and the preview. Short names such as ` ```py `, ` ```sh `, and ` ```yml ` work too.
- Embeds, callouts, math, Mermaid diagrams, footnotes, images between words (`![text](url)`) and HTML blocks are drawn as in the preview. Comments `%%…%%` and block IDs `^id` are hidden.
- Move the cursor to a line, or click a drawn block, to see its source. Tables stay drawn and are edited in place. See [Edit tables](#edit-tables).
- Leading frontmatter folds into one line, "N properties — see the right panel · Show source". `Ctrl/Cmd+A` selects the body only, in the source editor too and in the preview. To select the frontmatter as well, click **Show source** first.

`Ctrl/Cmd+E` switches between editing and preview. The supported syntax is listed in [Reference](../reference.md#markdown-syntax).

## Edit tables

In Live Preview, tables are drawn even when the cursor is in them, and you edit them in place. Tables inside quotes, lists and callouts stay as source.

- Click a cell to edit it. The cell you edit shows its Markdown source, such as `**bold**` or `[[target|alias]]`, with the same `[[` autocomplete and formatting shortcuts as the rest of the note. Other cells stay drawn.
- In a cell, type `|` as it is (typing `\|` also works). Either way it's saved as `\|`, and the cell isn't split. A cell can't hold a line break, so `Shift+Enter` inserts `<br>`, and pasted lines are joined with `<br>`.
- Typing in an empty cell at the end of a short row adds the missing cells to that row.
- Undo and redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`) work across cells and the rest of the note in one history.
- Only the cells and rows you change are rewritten in the file. The spacing between `|` is left as it was.

| Key | In a cell |
| --- | --- |
| `Tab` / `Shift+Tab` | Next / previous cell. `Tab` in the last cell adds a row |
| `Enter` | Cell below. In the last row, adds a row |
| `←` `→` | At the start or end of the cell's text, the cell to the left or right |
| `↑` `↓` | Cell above or below. Past the first or last row, the line before or after the table |
| `Esc` | Stop editing and move to the line after the table |

From the line just above or below a table, `↓` or `↑` moves into the table. `→` at the end of the line above moves into the first cell, and `←` at the start of the line below moves into the last cell. Clicking the empty space beside a table opens the nearest cell in that row. While an input method (IME) is composing text, `Tab` and `Enter` only finish the text. Press them again to move.

Point at a row or column to show its handle, to the left of the row or above the column. On a touch screen, the handles of the cell you edit stay shown.

- Click a row handle to insert a row above or below, move the row up or down, or delete it. The header row can only get a row below.
- Click a column handle to insert, move or delete the column, set its alignment, or sort the rows by it. Sorting compares numbers as numbers (`1,000`, `2%`) and puts them before text. Empty cells go last. It changes the order of rows in the file.
- Drag a handle to move the row or column. A line shows where it lands. Press Esc to cancel.
- Each change is undone with one `Ctrl/Cmd+Z`.

The **⋯** button at the table's top right has **Edit as Markdown**. It shows that table as source until the cursor leaves it, so you can fix a table whose shape is broken.

When the find bar or a search result goes to text in a table, that cell opens with the text selected. Matches in other cells aren't highlighted until you go to them.

## Links and embeds

Type `[[` to autocomplete note and attachment names. When names repeat, paths tell them apart. Write `[[Note#Heading|alias]]` to link to a heading with your own text, and `![[image.png|300]]` to embed an image 300 pixels wide.

A note embed such as `![[Note]]` shows the note's content only when it is alone in its paragraph. An embed of the note itself, or one nested more than 3 levels deep, is shown as a link, and a missing or inaccessible note is shown as a broken link.

## Find and replace in a note

Press `Ctrl/Cmd+F` to open the find bar above the editor. It searches as you type and shows the match count, such as `3/12`.

- Toggle **Match case**, **Match whole word** and **Use regular expression**.
- Go to the next or previous match with Enter and Shift+Enter, or `Ctrl/Cmd+G` and `Ctrl/Cmd+Shift+G`.
- Press `Ctrl/Cmd+Alt+F` to show the replace row.
- Press Esc to close the bar and return to the editor.

## Fold sections

You can fold headings (up to the next heading of the same or higher level), list items with children, callouts, code blocks of 6 or more lines, and tables.

- In the editor, use ▸/▾ left of the line (shown on hover). In the preview, use the button left of the block. In the Outline panel, use the button next to the heading. All three share the same state.
- Commands: fold or unfold here, fold or unfold all, and show only headings of this level. Change their shortcuts in Settings → **Shortcuts**.
- Folded state is remembered per note on this device. The file is unchanged.
- Jumping to a heading or block from search or a link unfolds it.

## Tasks

Write `- [ ] task`. Click a checkbox in the preview to tick it in the source, or press `Ctrl/Cmd+Enter` in the editor.

## Properties

The right panel's **Properties** tab shows frontmatter fields as inputs that match their type: text, number, checkbox, date, date and time, list. Open it from the properties button in the note header or the folded frontmatter line.

- Rename, change type (values are converted), delete and add fields. Names and values are suggested from the ones used in the vault.
- Deleting a field with its **×** button asks you to confirm first.
- Edits go into the draft, so they apply when you save and can be undone. Other fields keep their order, comments and `[a, b]` style.
- If the YAML is broken, you are asked to fix it in the source.

## Templates

- **Insert template** inserts a note from the current workspace's template folder at the cursor.
- **New note from template** asks for a title and creates a new note under the current node.

Template variables are listed in [Reference](../reference.md#template-variables).

## Edit offline

The web app can be installed to your home screen. The installed app keeps the whole vault on the device and syncs it with the server, so every note opens and search works without a connection. On its first launch it opens **Settings** → **This device & sync** with the server address filled in, and keeps opening there while the vault on the device is empty and not connected. Enter the server password to download the vault. If the app started at a note, closing Settings opens that note. The **Vault on this device** section says whether the browser keeps this storage. If it doesn't, the browser may delete the notes on this device when space runs low, including changes not yet synced.

The installed app starts this way unless you chose a mode yourself. To keep it in the server mode below, open `https://<server>/?local=0` once in a tab of the same browser; open `https://<server>/?local` to use the device vault in browser tabs too. A note opened in a new window uses the same mode as the window that opened it. If saves made offline in the server mode are still waiting, the installed app starts in the server mode once more so they are sent first.

In the server mode (a browser tab, or after `?local=0`), notes you opened once open without a connection, and saves made offline are kept on the device and sent when you reconnect. Notes changed on the server in the meantime are not overwritten; your version is kept as an offline conflict copy. Search needs the server; without a connection the search panel says so.

When the server is updated while the web app is open, a notice says **A new version is available.** Press **Reload** to switch to it. Unsaved notes are saved first, and if a save fails the app does not reload. With autosave off, the app asks whether to save before it reloads. The app checks for a new version when you come back to it, if 30 minutes have passed since the last check.

Math (KaTeX) and Mermaid diagrams load from the server only when a note uses them, never from a CDN. The installed web app downloads them in the background after the first open, so they render offline too.

## Next steps

- [Find notes](find-notes.md)
- [Use widgets](use-widgets.md)
