# Use daily notes

This guide sets up daily notes for a workspace and explains how Keyring Notes recognizes, names and tags them.

It is for people who keep a journal or a daily log.

## Open today's note

Daily notes are separate per workspace. Click the calendar on the rail, or press `Ctrl/Cmd+Shift+D`, to open today's note for the current workspace. Workspaces with daily notes turned off have no calendar button.

- If a note whose name starts with today's date exists, it opens, even with a title after the date. If there are several, you pick one.
- If none exists, a note named with only the date is created, and the cursor goes to the title field.
- ◀ date ▶ in the note header, and the **Previous daily note** and **Next daily note** commands, skip missing days. The yesterday's and tomorrow's note commands open or create the note for that day.

## Choose the folder and format

Set these in Settings → **Workspaces**, per workspace. They are shared by all devices.

- **Daily note folder**: `Daily` by default, or `데일리 노트` when the vault language is Korean.
- **Grouping**:

  | Grouping | Format |
  | --- | --- |
  | None | `YYYY-MM-DD` |
  | By year | `YYYY/YYYY-MM-DD` |
  | By year and month | `YYYY/MM/YYYY-MM-DD` |
  | By year and week | `GGGG/[W]WW/YYYY-MM-DD` |
  | Custom | your own tokens, see [Reference](../reference.md#daily-note-format-tokens) |

- **First day of the week**: Monday by default (ISO 8601). Sunday is also available, but it is not ISO.

Below the setting, the paths for today, yesterday, tomorrow and the year-end boundary are previewed. With ISO weeks, 2026-12-31 and 2027-01-01 are both in `2026/W53`, and `2027/W01` starts on 2027-01-04. That is why week grouping uses `GGGG`, the week-based year. Formats that produce characters not allowed in file names, empty segments, `..` or dot folders are not saved.

## How a note counts as a daily note

Keyring Notes decides by the name and path only. A note is a daily note when:

1. It is under the daily folder, and its folder path matches the folder part of the format.
2. Its name **starts** with a date in the format.
3. After the date comes the end of the name or a separator: a space, ` - `, `_` or `·`. So `2026-10-071.md` does not count.
4. The path rebuilt from the date matches the actual folder. So `2026-10-20` inside `2026/W41/` does not count.

`Daily/2026-10-07 Quarterly planning meeting.md` is the note for 2026-10-07.

## How daily notes look

The title field shows the date as a dimmed prefix, and you edit only the title after it. Click the date to edit the full name. Deleting the date warns you that the note will no longer be a daily note. The tree, tabs and quick open show the date dimmed and the title in bold, or `Wed, Oct 7` when there is no title (configurable).

## Link to a day

`[[2026-10-07]]` points to that day's daily note. A note with exactly that name takes precedence. Backlinks, graph, structure check and link updates follow the same rule. Moving a daily note out of the daily folder rewrites those links to the full name.

## Automatic tags

A new daily note gets tags in its frontmatter, for example `tags: [daily/2026/10/07, 10-07, 2026-W41, Wednesday]`. The leading word and the weekday follow the vault language. Other tags from the template stay after them.

| Search | Finds |
| --- | --- |
| `#daily` | all daily notes |
| `#daily/2026/10` | that month (sub-tags included) |
| `#10-07` | this day in every year |
| `#2026-W41` | that week |

In widgets, use `from: "#10-07"`, `from: "#daily/2026/10"` or `where: tags = 2026-W41`.

Changing the date in the name updates the automatic tags that are present. If someone changes them so they no longer match the name, Structure check reports it.

The daily folder shows an icon in the tree (📅 by default, set in Settings → **Workspaces**). Daily notes themselves get no icon.

## Move existing notes to a new format

The command **Move existing daily notes to the new format** (also a button in the settings) reads the date at the start of note names in the daily folder (`YYYY-MM-DD`, `YYYY.MM.DD`, `YYYYMMDD` and similar). It shows the list of moves into the current format and, when you confirm, moves them all in one commit. The title after the date is kept and links are updated. Files whose date cannot be read are skipped and listed.

## Next steps

- [Use widgets](use-widgets.md)
- [Find notes](find-notes.md)
