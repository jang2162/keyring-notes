# Use widgets

This guide turns notes into live lists, tables, boards and charts with widget blocks.

It is for people who track projects, tasks or reading lists in their notes.

## Add a widget

Write a fenced code block with the language `widget` and YAML inside. Other editors show it as a plain code block.

````markdown
```widget
type: kanban
from: Work/Projects
group: status
lanes: [todo, doing, done]
show: [owner, due]
```
````

This board shows every note under `Work/Projects` as a card, in a column for its `status` value.

<img src="../../images/projects-kanban-board.png" width="700" alt="A Projects note in preview mode showing a kanban widget with todo, doing and done columns of project cards">

Every option is listed in [Reference](../reference.md#widget-syntax).

## Choose a widget type

| Type | Shows |
| --- | --- |
| `query` | A list of notes |
| `table` | A table with the `show` fields as columns |
| `cards` | A card per note with title, summary and the `show` fields |
| `kanban` | Cards in columns by the value of `group` |
| `tasks` | Tasks from the matching notes. `status: open` (default), `done` or `all` |
| `chart` | A bar or line chart. **Show as table** shows the numbers |
| `plugin` | A widget type you add yourself |

## Edit from the widget

- In `table`, `cards` and `kanban`, click a frontmatter field to edit it in place. Enter saves, Esc cancels, and an empty value deletes the field. Built-in fields such as `title` and `tags` cannot be edited.
- In `kanban`, drag a card to another column, or use the card's select box, to change its `group` field.
- In `tasks`, tick a task to save it in the source note.

If the note changed after the widget was drawn, nothing is overwritten and you are asked to try again. Other fields, comments and the body are left untouched.

## Add a note widget (D-day)

A note widget is a small app inside a note, such as a D-day counter. It keeps its own state in the note, in a `keyring-widget` block. Unlike a `widget` block, it does not look up other notes.

1. Place the cursor where the widget should go.
2. Open the command palette and run **Insert widget**.
3. Choose **D-day**.

The widget appears in place. It shows the name and `D-3`, `D-day` or `D+2` for a date that is three days away, today or two days ago.

To change it, click the widget. Edit the date and the name, then click outside the widget to apply. Press `Esc` to discard your edits. One `Mod+Z` undoes the change, and the file is not rewritten if nothing changed.

To edit the block as Markdown, click **Edit as Markdown** above the widget. Moving the cursor out of the block shows the widget again.

When the block can't be drawn, the source and a one-line message are shown instead. This happens when the JSON is invalid, the widget is not found, or the block needs a newer version of the widget. In the editor, click the message to fix the source.

- A block with `"editable": false` cannot be changed from the widget.
- A block inside a list or a quote, or without a closing fence, stays a plain code block.

The block format is in [Reference](../reference.md#keyring-widget-blocks).

## Add your own widget type

A widget plugin is one ES module in the server's plugin folder (`KEYRING_PLUGINS_DIR`). See [examples/plugins](../../../../examples/plugins/README.md) for the format and a kanban example.

> [!WARNING]
> Plugins run in the browser with the owner's permissions. Install only code you trust.

## Next steps

- [Use daily notes](use-daily-notes.md): filter widgets by date tags.
- [Connect agents](connect-agents.md): agents run the same queries with MCP `query`.
