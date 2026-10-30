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

- Switch workspaces with the switcher at the top of the left panel. When the left panel is collapsed, the switcher sits at the start of the path above the note. The tree, quick open, search, tags, graph, home and today's note then cover that workspace only. Choose **All workspaces** to widen them again.
- The path above a note starts below the workspace, because the switcher already shows it. In **All workspaces** the path starts with the workspace.
- Open tabs, tree expansion and the last note are remembered per workspace.
- Opening a note in another workspace switches to that workspace.
- The app doesn't open a workspace's own note, such as `Work.md`. The file marks that the workspace exists and holds its icon. Change the icon in Settings → **Workspaces**. A link or address that points to the file shows a notice instead.
- A link `[[name]]` looks in the same workspace first, and searches the whole vault only if nothing is found there.

Manage workspaces in Settings → **Workspaces**: create, rename, set icons and order, and choose each workspace's daily, template and attachment folders. These settings are shared by all devices. Deleting a workspace removes its notes and attachments, its settings and its place in the order. The notice right after offers **Undo**.

## Create a note

Press `Alt+N` (`Ctrl/Cmd+N` in the desktop app), click ＋ on the tab bar, or choose **New child note** in the tree menu. An "Untitled" note is created under the current node, with the cursor in the title field.

The big title field at the top of a note is the file name. Edit it and press Enter, or click elsewhere, to rename the file and update links. Characters that file names cannot hold are flagged while you type: `/ \ : * ? " < > |`, a leading `.`, and `# ^ [ ]`, which clash with links. The frontmatter `title` is edited in the Properties tab instead.

## Use the note tree

- Click a note to open it in a new tab, or go to its tab if it is already open.
- Drag and drop to move. Hovering over a collapsed node expands it.
- Keyboard: ↑↓ move, ←→ collapse and expand, Enter open, F2 rename, Delete delete.
- The right-click menu has **New child note**, rename, move to another note, duplicate, open in a new tab or the other pane, copy path or link, change icon, **Sort sub-notes**, **Move up** and **Move down**, pin, and delete (with children).
- The toolbar above the tree has **New note**, **Reveal current note**, **Collapse all** and display options (show or hide the "N attachments" rows, **Sort notes**).
- The workspace's attachment folder is hidden from the tree.
- Notes sort by name unless you choose another order (see [Sort child notes](#sort-child-notes)). Inside the daily folder, the newest comes first (configurable) until you choose an order for it.

Renaming, moving or deleting a node handles `A.md` and everything in `A/` in one go: one commit on the server, one journal entry in the app.

## Sort child notes

Each note chooses the order of the notes directly under it. Right-click a note in the tree, choose **Sort sub-notes**, and pick one:

- **Name**: alphabetical order. This is the default.
- **Last modified**: the most recently changed note comes first. Editing, renaming, moving and changing properties such as the icon all count as changes.
- **Last opened**: the note you opened most recently on this device comes first. Notes you never opened follow, by name.
- **Custom**: the order you set by hand.

To sort the notes at the top of a workspace, click the display options (⋯) above the tree and choose **Sort notes**. With **All workspaces** on, a workspace row's menu has **Sort sub-notes** too.

The order applies only to the notes directly under that note. Their own child notes keep their own order. Choosing an order on a folder without a note creates the note.

The choice is saved in the note, so every device that uses the vault shows the same order. **Last opened** is the exception. Each device remembers what you opened on it, and opening a note never changes the vault.

### Set a custom order

When a note uses **Custom**, change the order of its child notes in one of these ways:

- Drag a note to the top or bottom edge of another child note. A line shows where it goes. Dropping it on the middle of a note still moves it into that note. On an expanded note, the bottom edge counts as the middle.
- Right-click a note and choose **Move up** or **Move down**.
- Select a note in the tree and press `Alt+Shift+↑` or `Alt+Shift+↓`. When the tree doesn't have focus, these keys move the current note. They don't work while the cursor is in the editor or a text field.

The first time you choose **Custom**, the order you see is kept. If you switch to another order later, the custom order is kept and returns when you choose **Custom** again.

When you move a note into another note in the app, it goes to the end of that note's custom order. Dragging a note from another parent to the edge of a row works the same way: the parent is highlighted instead of a line. A note moved by an agent or through the REST API keeps its old position key, so it can land anywhere in the new order.

The index and log notes of a wiki topic are generated, so they can't be reordered. They stay after the notes you ordered.

Usually only the moved note changes, so two devices can reorder different notes at the same time without conflicts.

### Fields the app writes

The app keeps the sort in these frontmatter fields. The Properties tab hides them.

- `edited`: when the note last changed through Keyring Notes, in UTC. The app writes it when it saves, renames or moves a note, and when an agent writes through MCP or the REST API. Changes made in another editor don't update it.
- `sort`: how the note sorts its child notes: `modified`, `viewed` or `custom`. Choosing **Name** removes the field.
- `rank`: the note's place in its parent's custom order.

A note without `edited` sorts by its file time. In the desktop and mobile app, that time can differ between devices until the note changes in the app.

## Pin notes

Pin the notes you open often to keep them at hand.

- Choose **Pin** in the tree's right-click menu, in the **Note menu** (⋯) at the top of a note, or in the command palette. **Unpin** in the same places removes it.
- Pinned notes appear under **Pinned** at the top of the left panel and on the home screen, above recent notes. The list is hidden when nothing is pinned.
- Click the **Pinned** heading in the left panel to collapse the list. The button next to a pinned note unpins it.
- New pins go to the end of the list.
- Each workspace has its own pins. With **All workspaces** on, you see every pin. Workspace notes themselves can't be pinned.
- A pin follows its note when you rename or move the note, or rename its workspace, on this device.
- A deleted note disappears from the list. It comes back if you undo the delete, or restore it from the trash at its original path.
- Deleting a workspace removes its pins. **Undo** on the notice brings them back.

Pins are saved on this device only and are not written to the vault, so agents never see them. Another browser or device keeps its own list. If a note is moved or renamed on another device and synced, it disappears from this device's list. Pin it again at its new path.

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
- In the app, a deleted note is not listed if a new file with the same content, such as a copy of a template, appeared at the same time. That means in the same sync, or in the same check for changes made in another program. The content is still in the new file.
- The trash shows the current workspace, or every workspace when **All workspaces** is on. Load older deletes with **Load more**.
- On a server, attachments deleted with a node come back too, including attachments kept in S3. The desktop and mobile app does not keep attachment content in its history. There, the line says how many attachments can't be restored, and only the notes come back.
- There is no permanent delete. Agents can't use the trash.

## Give a note an icon

Click the spot left of the title field (it appears on hover when there is no icon), or choose **Change icon…** in the tree menu. Pick an emoji, search, clear it or paste your own.

The picker lists Unicode emoji up to Emoji 14.0, grouped into smileys and emotion, people and body, animals and nature, food, travel and places, activities, objects, symbols and flags. Your recent emoji come first. Click a category button at the top to jump to that group.

Search matches English and Korean names and keywords. Results show without groups, and **Enter** picks the first one. Skin tone variants and newer emoji are not listed. Paste one into the search field and press **Enter** to use it.

The icon is stored as the note's frontmatter `icon: 📘`, so other editors and agents can read it and it moves with the node. A workspace's icon is its note's `icon` too. Icons show in the tree, tabs, note header, quick open, search results and widget lists.

## Add attachments

Paste or drop images and files into the editor. They are uploaded to the current workspace's attachment folder (`_attachments` by default, `_첨부` when the vault language is Korean), and a link is inserted: `![[image]]` for images, `[[file]]` for other files, or a path when the link format is **Full path**. Pasted images are named `Pasted image <date-time>.png`. If a name is taken, ` 2`, ` 3` and so on is appended.

The Attachments panel on the rail also has a drop area for adding files.

## Next steps

- [Edit notes](edit-notes.md)
- [Arrange tabs and panes](arrange-tabs-and-panes.md)
- [Use daily notes](use-daily-notes.md)
