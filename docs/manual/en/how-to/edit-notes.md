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
- Embeds, callouts, math, Mermaid diagrams and footnotes are drawn as in the preview. Comments `%%…%%` and block IDs `^id` are hidden.
- Move the cursor to a line, or click a drawn block, to see its source. Code blocks and tables are shown as source.
- Leading frontmatter folds into one line, "N properties — see the right panel · Show source".

`Ctrl/Cmd+E` switches between editing and preview. The supported syntax is listed in [Reference](../reference.md#markdown-syntax).

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
- Edits go into the draft, so they apply when you save and can be undone. Other fields keep their order, comments and `[a, b]` style.
- If the YAML is broken, you are asked to fix it in the source.

## Templates

- **Insert template** inserts a note from the current workspace's template folder at the cursor.
- **New note from template** asks for a title and creates a new note under the current node.

Template variables are listed in [Reference](../reference.md#template-variables).

## Edit offline

The web app can be installed to your home screen. Notes you opened once open without a connection, and saves made offline are kept on the device and sent when you reconnect. Notes changed on the server in the meantime are not overwritten; your version is kept as an offline conflict copy.

Math (KaTeX) and Mermaid diagrams load from the server only when a note uses them, never from a CDN. The installed web app downloads them in the background after the first open, so they render offline too.

## Next steps

- [Find notes](find-notes.md)
- [Use widgets](use-widgets.md)
