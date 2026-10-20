# Find notes

This guide covers search, tags, the outline, backlinks, unlinked mentions and the graph.

It is for everyone looking for something in their vault.

## Search

Click the magnifier on the rail, or press `Ctrl/Cmd+Shift+F`.

- Search finds notes that contain all the space-separated words. It looks in the body, title, path and frontmatter.
- A `#tag` word becomes a tag filter, sub-tags included.
- Clicking a result jumps to that line and selects the search term.

With semantic search set up, **Semantic** next to the search box finds notes close in meaning even when they use different words. See [Enable semantic search](enable-semantic-search.md).

To find text inside the open note, use the find bar (`Ctrl/Cmd+F`), see [Edit notes](edit-notes.md#find-and-replace-in-a-note).

## Outline

The **Outline** in the right panel lists the note's headings. Click one to jump there in the editor and the preview. Use ▸/▾ on the left to fold and unfold that section.

## Backlinks and unlinked mentions

The right panel's **Links** tab gathers sources, citations and backlinks, with the count in the tab name. It is visible while editing too, and Settings → **Files & links** can also show backlinks at the end of the note.

- **Sources** are the notes listed in the frontmatter `sources`. Missing or inaccessible ones are shown in red.
- **Citations** are pages that list this note as a source.
- **Backlinks** are notes that link to this note in their body.

Expand **Unlinked mentions** to see places in other notes where this note's name (file name, `title` or `aliases`) appears without a link, with context. Code, links, comments and frontmatter are skipped. English names are matched at word boundaries; Korean names are not, because particles attach directly to words. Click **Link** to turn that spot into `[[name]]` (or `[[name|text]]` when written differently). If that note changed since the search, nothing is overwritten and you are asked to search again.

## Graph

Click the graph icon on the rail to see notes connected by links (solid lines) and sources (dashed lines).

- The 3 topics with the most notes get colors; the rest are gray "other".
- Zoom and pan, hover to highlight neighbours, and click to open a note.
- Show only the area around the current note.
- Maximize the window from its header to fill the screen.

## Next steps

- [Use widgets](use-widgets.md): list notes by their properties.
- [Build an LLM Wiki](build-an-llm-wiki.md)
