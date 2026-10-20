# Build an LLM Wiki

This guide sets up a wiki topic that agents maintain from sources you collect, and shows how to cite and check it.

It is for people who let an agent turn articles, PDFs and notes into a maintained wiki.

## How a wiki topic is laid out

A topic runs in three layers: raw sources, a wiki maintained by agents, and a schema written by people. A node directly under a workspace (`<workspace>/<topic>`) becomes a wiki topic when it contains `SCHEMA.md`.

```text
Work/Economy/
├── SCHEMA.md            Wiki structure and procedures (ingest, query, maintenance). Edited by people only
├── raw/                 Collected sources, converted to Markdown. Recommended agent permission: append
│   └── assets/          Original files (PDF, images, HTML)
└── wiki/                Pages maintained by agents. Recommended permission: delete
    ├── index.md         [auto] Page list (category, summary, source count) and unprocessed/processed sources
    └── log.md           [auto] Activity log built from Git history: ## [date time] author | message
```

`SCHEMA.md`, the index and the log are written in the vault language.

## Create a topic

Click **Import** on the rail (the inbox icon), then **New wiki topic**. The topic is created in the current workspace with a `SCHEMA.md` template. Fill in the purpose and rules.

## Give the agent permissions

```bash
pnpm keyring agent grant <name> Work/Economy/raw append
pnpm keyring agent grant <name> Work/Economy/wiki delete
pnpm keyring agent grant <name> Work/Economy/SCHEMA.md read
```

Agents can only read `SCHEMA.md`, whatever the rules. See [Connect agents](connect-agents.md).

## Import sources

Use **Import** on the rail, or the MCP tools `ingest_url` and `ingest_text`.

- **Files**: PDF (text extracted page by page), images, HTML, Markdown and text. Up to 50 MB per file.
- **URL**: the server fetches the page and keeps only the main content as Markdown. PDF links are handled as PDFs.
- **Web clipper**: drag **📎 Keyring clip** from the URL tab to your bookmarks bar, then click it on the page you want to save. Pages behind a login are saved too, because the browser sends the HTML it already has. You can also save only a selection.
- **Paste**: text or Markdown as is.

Sources are saved as `<topic>/raw/<date> <title>.md`, with `source_type`, `source_url`, `original`, `ingested_at` and `ingested_by` in the frontmatter.

URL collection cannot reach private or loopback addresses unless `KEYRING_FETCH_ALLOW_PRIVATE=1` is set.

## Let the index and log update themselves

The server rebuilds `wiki/index.md` and `wiki/log.md` whenever anything in the topic changes. You cannot edit them, and they are kept out of Git and the search index.

They are generated for each reader's permissions, so an agent that cannot see a source does not see its name. A source becomes "processed" once a wiki page cites it in a body link or in `sources`.

## Cite a paragraph

In the frontmatter `sources`, point to part of a source with a block ID or a heading:

```yaml
sources: ["[[Source#^p3|paragraph]]", "[[Source#Heading]]"]
```

The source list in the right panel's **Links** tab shows a short quote of that paragraph, and clicking it jumps there. Agents read only that block with `read_section` and `heading: "^p3"`.

## Annotate a PDF

Click a PDF in the tree, or a `[[x.pdf]]` or `[[x.pdf#page=3]]` link, to open it in the app.

1. Select text and click **Add annotation**.
2. A line like `- [[x.pdf#page=3|Page 3]] “selected text” — memo ^pdf-3-k2x9` is added, in page order, to a `## PDF annotations` section in the PDF's companion note. The section title and page labels follow the vault language.
3. If you opened the PDF from a wiki page, **Cite in this note** on an annotation adds `[[companion note#^pdf-3-k2x9]]` to that page's `sources`.

The companion note is the collected source note (`raw/x.md` for `raw/assets/x.pdf`), otherwise the note the PDF was opened from, otherwise a new note next to the PDF. Reopening the PDF highlights the annotated spots. Agents read annotations with `read_section`.

## Check the wiki's structure

Click **Structure check** on the rail (the broom), or use MCP `lint`. It reports:

- broken links and broken sources (a cited block or heading that no longer exists),
- orphan wiki pages and pages without `sources`,
- missing `title` or `summary`,
- stale pages (180 days by default; the frontmatter `updated` takes precedence),
- sources not cited yet,
- daily tags that do not match the note's date.

## Next steps

- [Review agent changes](review-agent-changes.md)
- [Automate with webhooks](automate-with-webhooks.md): send the check results to an agent on a schedule.
