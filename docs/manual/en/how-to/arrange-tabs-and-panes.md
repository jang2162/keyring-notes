# Arrange tabs and panes

This guide explains the screen layout, tabs, split panes and opening a note in its own window.

It is for everyone who works with several notes at once.

## The screen

- **Top row**: the app name and the left panel button (`Ctrl/Cmd+Shift+E`) on the left, then the tabs. In the macOS app the window buttons sit at the start of this row, and you drag the row's empty space to move the window.
- **Rail** on the left: Files, Search, Tags, Attachments, Today's note, Graph, Import, Review and Structure check. At the bottom are Sync (app), Shortcuts, Settings and Log out (server). Settings → **General** can show names next to the icons.
- **Left panel** next to the rail. At the top of the left panel are the workspace switcher and the tree buttons.
- **Tabs and the note** in the middle, and the **right panel** with Outline, Links, Properties and History.
- **Status bar** at the bottom: save state, offline, changes waiting to be sent, waiting reviews and character count.

Icon-only buttons show their name and shortcut on hover, or the reason when they are unavailable. Drag a panel's edge to resize it (double-click for the default width), or collapse it. Collapsing the left panel keeps the rail, and the workspace switcher moves to the start of the path above the note. On narrow screens both panels become drawers. If docking both panels would leave the middle narrower than 440px, the right panel floats over the note instead and closes when you click outside it.

## Open notes quickly

- `Ctrl/Cmd+O` opens a note by name. Partial matches work, and open tabs and recent notes come first. `Ctrl+Enter` opens the result in a new tab.
- `Ctrl/Cmd+P` opens the command palette, with every command and its shortcut.
- With no note open, the home screen offers New note, Today's note, Quick open, Search, pinned notes and recent notes.

## Tabs

- Opening a note that is already in a tab jumps to that tab. A plain open replaces the current tab. `Ctrl/Cmd+click` or a middle click opens a new tab.
- The tab bar is always visible, and the list of open tabs is remembered on this device.
- On narrow screens (800px or less) a tab count button replaces the row of tabs. It opens the list of open tabs, where you can switch, close tabs or create a note.

## Split panes

Split the middle area left/right or top/bottom, and split the new panes again as often as you like. Each pane has its own tabs, title, editor and view mode (Edit, Side by side, Preview).

- `Ctrl/Cmd+\` splits to the right and `Ctrl/Cmd+Shift+\` splits down. The current note opens in the new pane too.
- Drag a tab to the top, bottom, left or right edge of a pane to split there, or onto the middle of a pane (or its tab bar) to move it into that pane. A split that would make a pane narrower than 280px or lower than 240px is not offered.
- `Ctrl/Cmd+click` on a link opens it in another pane.
- Drag the border between panes to resize them. Double-click it for equal halves.
- Closing a pane's last tab removes the pane. **Merge all panes** in the command palette joins them back.
- The layout and sizes are remembered per workspace on this device.

The same note open in several panes has one draft. What you type in one pane shows in the others right away, and the note is saved once.

On narrow screens (800px or less) only the focused pane shows, and the layout comes back when the window is wider. **Side by side** is not offered there.

Keyboard shortcuts for moving between panes are in [Reference](../reference.md#keyboard-shortcuts).

## Open a note in its own window

Choose **Open in new window** in a tab's right-click menu to edit that note alone in a new window: a browser window on the web, an app window in the desktop app. In the desktop app you can also drag a tab outside the window.

If two windows save the same note in local mode, changes to different parts are merged and changes to the same part show a conflict.

## Next steps

- [Find notes](find-notes.md)
- [Customize settings](customize-settings.md)
