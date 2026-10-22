# Reference

This page lists the exact commands, APIs and file formats of Keyring Notes.

It is for people who script the server, connect agents or edit vault files by hand. For step-by-step tasks, start from the how-to guides.

## Command-line interface

Run the admin CLI with `pnpm keyring <command>` from a source checkout, or `docker compose exec keyring keyring <command>` with Docker.

| Command | Description |
| --- | --- |
| `passwd` | Set the owner (web login) password |
| `agent list` | List agents and their permissions |
| `agent add <name>` | Create an agent and issue a token. The token is shown only once |
| `agent rotate <name>` | Reissue the token. The old token stops working immediately |
| `agent remove <name>` | Delete an agent |
| `agent grant <name> <path> <level>` | Set access to a folder or note. The path `/` means the whole vault |
| `agent revoke <name> <path>` | Remove a rule. The parent rule, or `hidden`, applies again |

The server re-reads the config file on the next request after it changes, so no restart is needed.

## Permissions

| Level | What it allows |
| --- | --- |
| `hidden` | Nothing. The path is also left out of lists, search and link resolution, and reads fail with the same error as a missing note |
| `read` | Read, search, view history |
| `append` | `read`, plus create new notes and append to the end of existing notes. No editing, deleting or moving existing content |
| `write` | `append`, plus edit existing content and roll back |
| `delete` | `write`, plus delete and move elsewhere |

Rules:

- Paths without a rule are `hidden`. A rule for the whole vault uses the path `/`.
- When several rules match a note, the most specific (longest) path wins.
- A rule on a node covers both its folder and its note. `Work/Project` covers `Work/Project/…` and `Work/Project.md`, unless a more specific `Work/Project.md` rule exists. With `Work/Secret: hidden`, the note `Work/Secret.md` never shows up in lists, search, backlinks, link resolution, tags, graph, widgets, wiki index and log, or history.
- A commit that touches even one path the agent cannot see has its message replaced with "(change involving hidden paths)". This is decided by the commit's actual list of changed paths, including the old and new paths of moved nodes.
- A wiki topic's `SCHEMA.md` and the vault's `keyring-settings.md` are read-only for agents, whatever the rules.
- Commits made by an agent are recorded with the agent's name as author.

## MCP tools

The MCP endpoint is `http://<server>/mcp` over Streamable HTTP (stateless, JSON responses). Send `Authorization: Bearer <token>`.

Tool descriptions and error text follow the server's **Agent language** setting (English by default). Errors also carry a language-independent `code`.

| Tool | Description |
| --- | --- |
| `whoami` | Your name and permission table |
| `list_children` | A node's children (notes, child nodes, attachment count). Empty path lists the workspaces |
| `list_topics` | Topics (`<workspace>/<topic>`). `wiki: true` marks LLM Wiki topics |
| `ingest_url` | Fetch a URL (web page or PDF) and save it to `<topic>/raw/` |
| `ingest_text` | Save text you have as a source in `<topic>/raw/` |
| `list_documents` | Readable notes and the permission for each |
| `read_outline` | Hash, line count, frontmatter, headings (with line ranges) and wikilinks. No body |
| `read_section` | Read part of a note by heading (`Parent > Child`, or a block ID like `^p3`) or by line range |
| `read_document` | Read the whole note |
| `list_frontmatter` | Frontmatter of every note in a folder |
| `search` | Full-text search. `#tag` words become tag filters |
| `backlinks` | Notes that link to this note |
| `unlinked_mentions` | Notes where this note's name appears without a link, with line, position and context |
| `list_tags` | Tags and note counts |
| `query` | The same YAML query as widgets (`query`, `table`, `cards`, `kanban`, `tasks`, `chart`, `plugin`) |
| `sources` | Sources (frontmatter `sources`), pages citing this note, body backlinks |
| `lint` | Structure check |
| `semantic_search` | Semantic search, when the server has an embedding model |
| `my_proposals` | Results of the change proposals you submitted |
| `write_document` / `append_document` | Write / append to the end |
| `move_document` / `delete_document` | Move / delete. Moving updates links to the note in the same commit (turn off with `update_links: false`). Results include `linksUpdated` and `linkCount` |
| `batch_write` | Several write, append, delete and move operations in one commit. If any fails, none is applied. Moves update links too (`update_links`) |

For writes, pass the last read `hash` as `base_hash` (`null` for a new note). If it differs from the server version, the result is `conflict` with `current_hash`, and nothing is written. A write into a review-target folder returns `pending`. The vault stays unchanged, and the returned `hash` is the hash after approval.

## REST API

### Authentication

- The web app uses the cookie from `POST /api/auth/login` (HttpOnly, SameSite=Strict).
- Agents and app devices send `Authorization: Bearer <token>`.
- Every mutating request must be `Content-Type: application/json`. File uploads send raw bytes with the header `x-keyring-upload: 1` instead.
- CORS responses are sent only for requests with an `Authorization` header, device registration and `/api/health`.

`GET /llms.txt` needs no authentication. It returns a short static guide for LLM agents in Markdown: how to connect, the permission levels, the main tasks and the `baseHash` conflict rule. It contains nothing from your vault or config. Links are absolute when `KEYRING_PUBLIC_URL` is set, relative otherwise.

### Endpoints

| Method | Path | Body / query | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | | Health check (no authentication) |
| GET | `/api/auth/status` | | Login status |
| POST | `/api/auth/setup` | `{code, password}` | First-time setup, only while no password is set. The setup code is in the server log |
| POST | `/api/auth/login` · `/api/auth/logout` | `{password}` | Owner login / logout |
| POST | `/api/auth/passkey/options` · `/api/auth/passkey/login` | `{}` · `{id, response}` | Passkey login: get a challenge, then send the signature. Success sets the login cookie |
| POST | `/api/auth/device` | `{password, name}` | Register an app device → `{id, name, token}`. The token is shown once |
| GET·POST·DELETE | `/api/admin/passkeys` · `/api/admin/passkeys/options` · `/api/admin/passkeys/:id` | | List, register (`{id, response, name}`) and delete passkeys. Owner web login only |
| * | `/api/admin/…` | | Admin console API, owner only: `status`, `update`, `language`, `devices` (and `DELETE devices/:id`), `agents` (and `DELETE agents/:name`), `agents/:name/rules`, `agents/:name/rotate`, `password`, `backups` (and `GET`/`DELETE backups/:name`), `backups/settings`, `backups/upload`, `backups/:name/restore`, `backups/:name/push`, `backups/remote`, `backups/remote/:name/fetch`, `automation`, `automation/webhooks`, `automation/jobs`, `automation/webhooks/:id/test`, `automation/jobs/:id/run` |
| GET | `/api/whoami` | | Name and permission table |
| GET | `/api/tree` · `/api/documents` | `?folder=` | Tree / flat list |
| GET | `/api/children` | `?path=` | A node's children. Empty path lists the workspaces |
| GET | `/api/file?path=` | | Note content and `hash` (sha256) |
| GET | `/api/outline?path=` | | Note outline |
| GET | `/api/section?path=` | `&heading=` or `&start=&end=` | Read a section |
| GET | `/api/frontmatter` | `?folder=&fields=a,b` | Frontmatter list |
| GET | `/api/properties` | | Property names, types, note counts and frequent values across visible notes |
| GET | `/api/search?q=` | `&folder=&tag=&lines=&limit=` | Search. Repeat `tag` to require several tags. `lines` adds up to that many matching lines per note (a whole number, at most 50) |
| GET | `/api/semantic` · `/api/semantic/status` | `?q=&folder=&limit=` | Semantic search / status |
| GET | `/api/tags` | `?folder=` | Tags and note counts, within a folder or node |
| GET | `/api/backlinks?path=` | | Backlinks |
| GET | `/api/mentions?path=` | | Unlinked mentions, visible notes only |
| GET | `/api/sources?path=` | | Sources, citations, backlinks |
| GET | `/api/graph` | `?folder=` | Graph (nodes and links) |
| GET | `/api/lint` | `?folder=&staleDays=` | Structure check |
| POST | `/api/widget` | `{source}` | Run widget YAML |
| POST | `/api/task` | `{path, line, done, baseHash}` | Toggle a task |
| PUT | `/api/file` | `{path, content, baseHash, coalesce?}` | Write. `baseHash: null` for a new note. With `coalesce: true` (web autosave, owner only), consecutive saves of the same note are grouped into one commit for 10 minutes |
| POST | `/api/append` | `{path, content, baseHash?}` | Append to the end |
| DELETE | `/api/file` | `{path, baseHash}` | Delete, attachments included. For attachments `baseHash` is the sha256 of the bytes |
| POST | `/api/move` | `{from, to, baseHash, updateLinks?}` | Move or rename a note or attachment. Links update by default → `linksUpdated` (updated notes), `linkCount` |
| POST | `/api/move` | `{from, to, node: true, updateLinks?}` | Move or rename a node: `A.md` and everything in `A/` in one commit → `moved[[from, to]]`, `linksUpdated`, `linkCount` |
| POST | `/api/node/delete` | `{path, files[{path, baseHash}]}` | Delete a node with its children in one commit. 409 if the files differ from the list and hashes the client saw |
| POST | `/api/batch` | `{message?, operations: [{op, ...}], updateLinks?}` | Batch write. `op` is `write`, `append`, `delete`, `move` or `put`. Chained moves (A→B→C) in one batch are combined for link updates. `files` lists only files that changed |
| POST | `/api/attachment?path=` | file bytes, header `x-keyring-upload: 1` | Create a new attachment, up to 50 MB. 409 if it exists |
| GET | `/api/raw?path=` | | Raw attachment file |
| GET | `/api/history?path=` | | A note's commits, with authors |
| GET | `/api/revision?path=&rev=` | | Content at a revision |
| POST | `/api/rollback` | `{path, rev, baseHash}` | Roll back to a past revision, as a new commit |
| GET | `/api/trash` | `?folder=&cursor=` | Trash, owner only: deletes newest first → `items[{id, date, author, node, notes, attachments, lost}]`, `next` (the last commit read; pass it as `cursor` for older deletes, `null` when done). Moves made on the server and paths in use are left out |
| GET | `/api/trash/preview?id=&path=` | | A deleted note's content just before the delete. Owner only |
| POST | `/api/trash/restore` | `{id, paths?}` | Restore one delete in one commit. A taken path gets ` 2` instead of being overwritten → `restored[[from, to]]`, `lost` (attachments that could not be restored). Owner only |
| GET · POST | `/api/topics` | `{name}` | List topics / create a wiki topic (owner) |
| POST | `/api/ingest` | `{kind: url\|html\|text, topic, ...}` | Collect a source |
| POST | `/api/ingest/file?topic=&name=` | file bytes, header `x-keyring-upload: 1` | Collect an uploaded file |
| GET · PUT | `/api/review/settings` | `{reviewPaths}` | Review target folders (owner) |
| GET | `/api/review` · `/api/review/:id` | `?status=pending` | Proposal list / details with diff (owner) |
| POST | `/api/review/:id/approve` · `/api/review/:id/reject` | `{reason?}` | Approve / reject (owner) |
| GET | `/api/sync/manifest` | | File list for sync, `{files: [{path, hash, size}]}`. Owner and devices. Leaves out the server-generated wiki index and log |
| GET | `/api/plugins` · `/plugins/<name>.js` | | Widget plugin list / module (owner login) |

### Errors

| Status | Meaning |
| --- | --- |
| `401` | Not authenticated |
| `403` | Forbidden |
| `404` | Not found, hidden paths included |
| `409` | Conflict. The body includes `currentHash` |
| `421` | The request's host name is not accepted (see `KEYRING_PUBLIC_URL` and `KEYRING_ALLOWED_HOSTS`) |

The error body is `{error, code, params, message}`. A `421` response is plain text, not this JSON body. `code` is a language-independent message key (`error.<code>`), `params` are the values to interpolate, and `message` is the text in the server language.

## Widget syntax

A widget is a fenced code block with the language `widget` and YAML inside.

````markdown
```widget
type: query          # query | table | cards | kanban | tasks | chart | plugin
from: Work/ProjectA  # a folder, "#tag", or a list. Omit for the whole vault
where: status != done # one condition or a list (all must match)
show: [title, due]
sort: due            # -due or "due desc" for descending; a list for several keys
limit: 50
```
````

| Item | Description |
| --- | --- |
| Fields | Frontmatter keys, plus the built-in fields `path`, `title` (frontmatter `title`, then the first `#` heading, then the file name), `folder`, `name`, `tags`, `modified` |
| Conditions | `=` `!=` `>` `>=` `<` `<=` `contains` `!contains`, `field` (has a value), `!field` (no value). The value `today` is today's date (`YYYY-MM-DD`) |
| `group` | `group: status` groups `query`, `table` and `cards` by that field |
| `tasks` | `status: open` (default), `done` or `all` |
| `chart` | `chart: bar` (default) or `line`, `x: <field to group by>`, `y: <numeric field>`, `agg: sum` (default when `y` is set), `count` or `avg`. Or give data directly with `data: [{label, value}]` |
| `cards` | One card per note: title, summary and the `show` fields |
| `kanban` | The values of `group` (default `status`) are the columns. `lanes: [To do, Doing, Done]` sets the column order |
| `plugin` | `plugin: <name>` with the same `from`, `where`, `show` and `sort`. `options:` is passed to the plugin as is. See [examples/plugins](../../../examples/plugins/README.md) |

Widgets go through the permission layer, so an agent running the same query (MCP `query`) sees only notes it can read.

## Webhook events

Webhooks POST JSON `{event, id, time, data}` with the header `X-Keyring-Signature: sha256=<HMAC-SHA256(secret, body)>`.

| Event | When | `data` |
| --- | --- | --- |
| `raw.added` | Right after a new source lands in a wiki topic's `raw/` (collection, agent write or approval) | `topic, path, rev, author, message` |
| `doc.changed` | Once a note has been quiet for 90 seconds after its last save. The commits up to then are sent as one batch. A note created then edited is `A`. A note created then deleted is not sent. Pending events are sent when the server shuts down | `rev, author, message` (last commit), `commits` (number of batched commits), `files[{status, path}]` |
| `proposal.created` | New proposal in the review queue | `id, agent, message, topic, files` |
| `schedule` | A scheduled job runs | `job, topic, instructions, lint?{counts, issues, total}` |
| `ping` | The test button in Settings → **Automation** | `message` |

Responses `5xx` and `429`, and connection failures, are retried after 1, 5 and 25 seconds. Scheduled jobs use cron syntax (`minute hour day month weekday`) in the server time zone.

## Markdown syntax

Keyring Notes reads the same syntax as Obsidian.

| Syntax | Example |
| --- | --- |
| Wikilink | `[[Note]]`, `[[Folder/Note]]`, `[[Note#Heading\|alias]]` |
| Embed | `![[image.png\|300]]`, `![[Note]]`, `![[Note#Heading]]`, `![[Note#^block]]` (note embeds go up to 3 levels deep) |
| Block ID | ` ^id` at the end of a paragraph or list item (`^id` alone on the next line for tables), linked as `[[Note#^id]]` |
| Daily link | `[[2026-10-07]]` points to that day's daily note. A note with exactly that name takes precedence |
| Callout | `> [!note] Title`. Types include note, tip, warning, danger, question, example and quote. `[!tip]-` starts folded, `[!tip]+` expanded |
| Highlight | `==text==` |
| Footnote | `text[^1]` … `[^1]: content` |
| Math | `$E=mc^2$`, `$$ … $$` (KaTeX). A `$` followed by a space, as in `$5 and $6`, is not math |
| Diagram | A fenced code block with the language `mermaid` |
| Comment | `%%…%%`, across lines too. Links, tags and tasks inside are not indexed |
| Task | `- [ ] task`, `- [x] done` |
| Relative link | `[x](Folder/Note.md#Heading)` opens the note |

## Template variables

| Variable | Value |
| --- | --- |
| `{{title}}` | Note title |
| `{{date}}` | Today's date |
| `{{time}}` | Current time |
| `{{date:<format>}}` | Today's date in a format, for example `{{date:MMMM D, YYYY dddd}}` |
| `{{yesterday}}` · `{{tomorrow}}` | The day before / after |

## Daily note format tokens

`YYYY YY M MM MMMM D DD W WW GGGG ddd dddd H HH m mm s ss [text]`

- `MMMM` is the month name, `ddd` and `dddd` are the short and long weekday names. They follow the vault language.
- `W` and `WW` are the week number, and `GGGG` is the week-based year.
- `[text]` is literal text, and `/` makes a subfolder.

## Keyboard shortcuts

Press `Ctrl/Cmd+/` to see the full list, and change shortcuts in Settings → **Shortcuts**. In the web app, keys the browser reserves use `Alt` instead. The desktop app uses the original keys.

| Action | Shortcut |
| --- | --- |
| New note | `Alt+N` (desktop app: `Ctrl/Cmd+N`) |
| Close tab | `Alt+W` (desktop app: `Ctrl/Cmd+W`) |
| Reopen closed tab | `Alt+Shift+T` (desktop app: `Ctrl/Cmd+Shift+T`) |
| Previous / next tab | `Alt+[` / `Alt+]` (desktop app: `Ctrl+Shift+Tab` / `Ctrl+Tab`) |
| Nth tab | `Alt+1` … `Alt+9` (desktop app: `Ctrl/Cmd+1` … `Ctrl/Cmd+9`) |
| Quick open | `Ctrl/Cmd+O` |
| Command palette | `Ctrl/Cmd+P` |
| Search | `Ctrl/Cmd+Shift+F` |
| Find in note | `Ctrl/Cmd+F`. Next / previous match: Enter / Shift+Enter or `Ctrl/Cmd+G` / `Ctrl/Cmd+Shift+G`. Replace: `Ctrl/Cmd+Alt+F` |
| Save now | `Ctrl/Cmd+S` |
| Edit ↔ preview | `Ctrl/Cmd+E` |
| Back / forward | `Ctrl/Cmd+Alt+←` / `Ctrl/Cmd+Alt+→` |
| Left / right panel | `Ctrl/Cmd+Shift+E` / `Ctrl/Cmd+Alt+B` |
| Today's note | `Ctrl/Cmd+Shift+D` |
| Settings | `Ctrl/Cmd+,` |
| Rename | F2 |
| Split right / down | `Ctrl/Cmd+\` / `Ctrl/Cmd+Shift+\` |
| Focus neighbouring pane / next pane | `Ctrl/Cmd+Alt+Shift+arrow` / `Ctrl/Cmd+Shift+,` |
| Move tab to neighbouring pane / next pane | `Cmd+Ctrl+arrow` (macOS) / `Ctrl/Cmd+Shift+.` |
| Fold / unfold here | `Ctrl+Shift+[` / `Ctrl+Shift+]` (macOS: `Cmd+Alt+[` / `Cmd+Alt+]`) |
| Fold / unfold all | `Ctrl+Alt+[` / `Ctrl+Alt+]` |
| Bold, italic, link, highlight | `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+K`, `Ctrl/Cmd+Shift+H` |
| Toggle task | `Ctrl/Cmd+Enter` |

Shortcuts are ignored while an input method (IME) is composing text.

## Shared settings file

`keyring-settings.md` at the top of the vault holds the settings every device shares, in its frontmatter. The Settings screen creates and edits it.

```yaml
---
vault:
  language: en            # vault language (text saved into the vault: Untitled, conflict copies, default folders, wiki index/log/SCHEMA, commit messages)
  linkFormat: shortest    # shortest | full
  workspaceOrder: [Work, Personal]
workspaces:
  Work:
    daily: { enabled: true, folder: Daily, format: "GGGG/[W]WW/YYYY-MM-DD", template: Templates/Daily.md, weekStart: monday, icon: "📅" }
    templateFolder: Templates
    attachmentFolder: _attachments
  Personal:
    daily: { enabled: false }
ui:
  theme: dark
  language: en
  editorSize: 17
  keys: { daily: "Mod+Shift+J" }
---
```

## Backup file format

A backup is one file, `keyring-<timestamp>-<auto|manual|pre-restore>.tar.gz`, containing:

- `manifest.json`
- `vault.bundle`: `git bundle --all`, every note and attachment with full history
- `config.json` (optional): password and token hashes, permission tables

The search index and the wiki index and log are not included, because the server rebuilds them.

## Storage layout

| Path | Contents |
| --- | --- |
| `vault/**.md` | The source of truth: plain Markdown with YAML frontmatter. Top-level folders and notes are workspaces. Node `A` is the note `A.md` plus the folder `A/`, for example `Work.md`, `Work/Project.md`, `Work/Project/Meeting.md`, `Work/_attachments/diagram.png` |
| `vault/keyring-settings.md` | Settings shared by all devices (see [Shared settings file](#shared-settings-file)) |
| `vault/.history/` | The Git repository (`--git-dir`). The work tree is the vault itself, so no `.git` shows up in other editors |
| `vault/.keyring/index.db` | SQLite index: body full-text search (FTS5 trigram), tags, links, tasks, frontmatter. Not tracked by Git |
| `vault/.keyring-app/` | Desktop and mobile app metadata: change journal (`journal.jsonl`), content snapshots (`objects/`) and sync baseline (`sync.json`) |
| `config/keyring.json` | File mode 0600. Passwords as scrypt hashes, tokens as sha256 hashes, passkeys as public keys only |

Folders whose names start with a dot (`.obsidian`, `.trash`, `.history`) are hidden from the tree and cannot be reached through the API.

## Next steps

- [Connect agents](how-to/connect-agents.md)
- [Configuration](configuration.md)
