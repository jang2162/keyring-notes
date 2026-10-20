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

## Add your own widget type

A widget plugin is one ES module in the server's plugin folder (`KEYRING_PLUGINS_DIR`). See [examples/plugins](../../../../examples/plugins/README.md) for the format and a kanban example.

> [!WARNING]
> Plugins run in the browser with the owner's permissions. Install only code you trust.

## Next steps

- [Use daily notes](use-daily-notes.md): filter widgets by date tags.
- [Connect agents](connect-agents.md): agents run the same queries with MCP `query`.
