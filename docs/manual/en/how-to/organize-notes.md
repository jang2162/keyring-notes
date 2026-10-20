# Organize notes

This guide explains how notes, folders and workspaces fit together, and how to create, move, rename and delete them.

It is for everyone who writes in Keyring Notes.

## Nodes: a note and its folder

A note `A` is the file `A.md`, and its children live in the sibling folder `A/`. This is the same shape as Obsidian's "folder notes", so other editors show the files as they are.

- The tree shows `A.md` and `A/` as one node.
- A folder without a note shows as an **Empty node**. Click it to open a blank note. Typing creates `A.md`.
- Non-Markdown files (images, PDFs and so on) in a node's folder collapse into one "N attachments" row under the node.

## Workspaces

The top-level nodes of the vault are workspaces, for example `Work` and `Personal`. Notes cannot be created at the top of the vault.

- Switch workspaces with the button at the top of the rail. The tree, quick open, search, tags, graph, home and today's note then cover that workspace only. Choose **All workspaces** to widen them again.
- Open tabs, tree expansion and the last note are remembered per workspace.
- Opening a note in another workspace switches to that workspace.
- A link `[[name]]` looks in the same workspace first, and searches the whole vault only if nothing is found there.

Manage workspaces in Settings → **Workspaces**: create, rename, set icons and order, and choose each workspace's daily, template and attachment folders. These settings are shared by all devices. Deleting a workspace removes its notes and attachments, its settings and its place in the order. The notice right after offers **Undo**.

## Create a note

Press `Alt+N` (`Ctrl/Cmd+N` in the desktop app), click ＋ on the tab bar, or choose **New child note** in the tree menu. An "Untitled" note is created under the current node, with the cursor in the title field.

The big title field at the top of a note is the file name. Edit it and press Enter, or click elsewhere, to rename the file and update links. Characters that file names cannot hold are flagged while you type: `/ \ : * ? " < > |`, a leading `.`, and `# ^ [ ]`, which clash with links. The frontmatter `title` is edited in the Properties tab instead.

## Use the note tree

- Click a note to open it in a new tab, or go to its tab if it is already open.
- Drag and drop to move. Hovering over a collapsed node expands it.
- Keyboard: ↑↓ move, ←→ collapse and expand, Enter open, F2 rename, Delete delete.
- The right-click menu has **New child note**, rename, move to another note, duplicate, open in a new tab or the other pane, copy path or link, change icon, and delete (with children).
- The toolbar above the tree has **New note**, **Reveal current note**, **Collapse all** and display options (show or hide the "N attachments" rows).
- The workspace's attachment folder is hidden from the tree.
- Notes sort by name. Inside the daily folder, the newest comes first (configurable).

Renaming, moving or deleting a node handles `A.md` and everything in `A/` in one go: one commit on the server, one journal entry in the app.

## Move and rename without breaking links

When you move or rename a note, links pointing to it are updated in the same commit, and a notice says how many were fixed. These are updated:

- Body wikilinks and embeds (`[[…]]`, `![[…]]`).
- `[[…]]` and path values in the frontmatter `sources` and `source`.
- Relative Markdown links and images (`[x](../a.md)`), including the moved note's own relative links.

`#heading`, `#^block` and `|alias` are kept. Links that used the full path keep the full path; links that used only the name get the shortest name that still resolves. Code blocks and inline code are left untouched. If the moved note becomes a shallower note with the same name and would capture other links, those links are rewritten to keep their original targets.

When an agent moves a note, only paths the agent can see are used, only notes it can write are updated, and links are written with full paths.

## Undo a delete or move

After a delete, **Undo** on the notice brings the content back at the same path, with child notes and attachments, and history continues unbroken. Moves and renames can be undone from the notice too.

## Restore deleted notes

Deleted notes stay in history, so you can restore them after the notice is gone. Choose **Trash** in the command palette, or the **Trash** link on the home screen.

Each line is one delete, newest first. It shows the note or node name, where it was, when it was deleted and, on a server, who deleted it. A deleted node is one line with the number of its child notes. Click a line to read the content as it was just before the delete.

**Restore** recreates the note at its original path, with its child notes, in one commit. **Open** on the notice opens it.

- If a file appeared at that path in the meantime, it is not overwritten. The restored note gets ` 2` appended, and a node is renamed as a whole.
- A note you move or rename is not in the trash where you made the change, because it still exists at its new path. That is the server for the web screen and agents, and the app for the desktop and mobile app. A deleted note is not listed while another note uses its path.
- A move made somewhere else can arrive as a delete and a new file. Then the old path shows up in the trash. Restoring it only makes a copy, and nothing is lost. This happens in these cases:
  - On a server: moves and renames made in the app and synced.
  - In the app: renames received by sync or made in another program (Finder, another editor), when the content changed at the same time or the note is empty.
  - On a server: renames made in another program, when more than half of the content changed at the same time.
- On a server, a node deleted in the app shows up after sync as one line per file. Restore each line on its own.
- The trash shows the current workspace, or every workspace when **All workspaces** is on. Load older deletes with **Load more**.
- On a server, attachments deleted with a node come back too, including attachments kept in S3. The desktop and mobile app does not keep attachment content in its history. There, the line says how many attachments can't be restored, and only the notes come back.
- There is no permanent delete. Agents can't use the trash.

## Give a note an icon

Click the spot left of the title field (it appears on hover when there is no icon), or choose **Change icon…** in the tree menu. Pick an emoji, search, clear it or paste your own.

The icon is stored as the note's frontmatter `icon: 📘`, so other editors and agents can read it and it moves with the node. A workspace's icon is its note's `icon` too. Icons show in the tree, tabs, note header, quick open, search results and widget lists.

## Add attachments

Paste or drop images and files into the editor. They are uploaded to the current workspace's attachment folder (`_attachments` by default, `_첨부` when the vault language is Korean), and a link is inserted: `![[image]]` for images, `[[file]]` for other files, or a path when the link format is **Full path**. Pasted images are named `Pasted image <date-time>.png`. If a name is taken, ` 2`, ` 3` and so on is appended.

The Attachments panel on the rail also has a drop area for adding files.

## Next steps

- [Edit notes](edit-notes.md)
- [Arrange tabs and panes](arrange-tabs-and-panes.md)
- [Use daily notes](use-daily-notes.md)
