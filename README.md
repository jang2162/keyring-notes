# Keyring Notes

**English** · [한국어](README.ko.md)

A personal notes app that keeps plain Markdown files as the source of truth on a self-hosted server. People edit in the browser; agents get in only through per-topic permission tokens.

> Status: **Phase 6** — file storage, web editor, Git history (1); login, token × folder permissions, MCP, batch writes (2);
> SQLite index, autocomplete, widgets (3); LLM Wiki: source collection, topic templates, auto-generated index/log (4);
> admin console, backup/restore, Docker, HTTPS remote access (5, except note migration);
> change review queue, source links, structure check, webhooks/scheduled jobs, graph, semantic search, PWA offline editing, widget plugins (6);
> desktop and mobile apps: a local vault that works without a server + optional sync (7, in progress).

## Install (Docker, recommended)

```bash
git clone https://github.com/jang2162/keyring-notes && cd keyring-notes
docker compose up -d --build              # http://127.0.0.1:8787 (this computer only)
docker compose logs keyring               # "First-time setup: … setup code → XXXX-XXXX-XXXX"
```

Open it in a browser, enter the setup code and a new password, and you're done. All data (vault, config, backups) lives in `/data` on the `keyring-data` volume.
Admin CLI inside the container: `docker compose exec keyring keyring agent list`.

### Remote access

By default the app port is bound to `127.0.0.1` only. To use it from elsewhere, pick one:

- **HTTPS reverse proxy (Caddy, automatic certificates)**: point your domain's DNS at the server, open ports 80 and 443, then
  ```bash
  cp .env.example .env    # KEYRING_PUBLIC_URL=https://notes.example.com, KEYRING_DOMAIN=notes.example.com
  docker compose --profile https up -d
  ```
  For a private network or testing, set `CADDY_TLS=internal` in `.env` (Caddy's own CA).
- **VPN (Tailscale etc.)**: set `KEYRING_BIND=<VPN address>` and `KEYRING_ALLOWED_HOSTS=<that address/host name>` in `.env`. With Tailscale you can also add HTTPS inside the tailnet with `tailscale serve --bg 8787`.

When `KEYRING_PUBLIC_URL` is set, only requests for that host name are accepted (DNS rebinding protection; other Hosts get 421) and the login cookie gets `Secure`. Every page is sent with security headers such as CSP and `X-Frame-Options: DENY`.

### Updating

The admin console's "Updates" tab checks for the latest release. Make a backup before updating, then:

```bash
docker compose pull && docker compose up -d          # when using the GHCR image (.github/workflows/docker.yml publishes one for every v* tag)
git pull && docker compose up -d --build             # when building yourself
```

When building behind something that re-signs TLS, such as a corporate proxy: `docker build --secret id=extra_ca,src=<CA.pem> .` (it is not kept in the image).

## Running from source

The package manager is pnpm (`packageManager` in `package.json`). With [mise](https://mise.jdx.dev), `mise install` sets up the Node and pnpm versions in `mise.toml`; otherwise run `corepack enable`.

```bash
pnpm install
pnpm build                         # builds web/dist and server/dist
pnpm start                         # http://127.0.0.1:8787 — set a password on the web with the setup code from the log
                                   # (or pnpm keyring passwd)
```

Development mode (hot reload) in two terminals:

```bash
pnpm dev:server      # API: 127.0.0.1:8787
pnpm dev:web         # web: http://localhost:5173 (proxies the API)
```

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `KEYRING_DATA` | (none; `/data` in Docker) | If set, vault, config and backups all go to `<DATA>/vault`, `<DATA>/config/keyring.json`, `<DATA>/backups` |
| `KEYRING_VAULT` | `./vault` | Vault folder |
| `KEYRING_CONFIG` | `./config/keyring.json` | Password hash, agent token hashes, permission tables, backup settings. Keep it outside the vault |
| `KEYRING_BACKUP_DIR` | `./backups` | Backup file folder |
| `KEYRING_PUBLIC_URL` | (none) | Remote access URL (https). Used for allowed hosts and Secure cookies |
| `KEYRING_ALLOWED_HOSTS` | host of `PUBLIC_URL` | Host names to accept (comma-separated). localhost is always allowed |
| `KEYRING_UPDATE_URL` | GitHub releases/latest | Update check URL. Empty disables the check |
| `KEYRING_BACKUP_SCHEDULER` | `1` | `0` turns off the automatic backup scheduler |
| `KEYRING_FETCH_ALLOW_PRIVATE` | (none) | `1` lets URL collection reach private and loopback addresses (an internal wiki, etc.). Blocked by default to prevent SSRF |
| `KEYRING_INDEX` | `<vault>/.keyring/index.db` | Search index (a cache). Delete it and it is rebuilt on the next start |
| `KEYRING_EMBED_URL` · `KEYRING_EMBED_MODEL` | (none) | OpenAI-compatible `/embeddings` URL and model for semantic search. Both are required to turn it on |
| `KEYRING_EMBED_KEY` | (none) | Embedding API key (`Authorization: Bearer`) |
| `KEYRING_PLUGINS_DIR` | `./plugins` (Docker: `/data/plugins`) | Widget plugin folder |
| `KEYRING_SCHEDULER` | `1` | `0` turns off the scheduled job (webhook) scheduler |
| `KEYRING_S3_BUCKET` | (none) | S3-compatible storage bucket. Setting it turns on remote backups (see "S3 storage" below) |
| `KEYRING_S3_ACCESS_KEY_ID` · `KEYRING_S3_SECRET_ACCESS_KEY` | (none) | Access keys (`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are read too) |
| `KEYRING_S3_REGION` | `us-east-1` | Region (`auto` for R2) |
| `KEYRING_S3_ENDPOINT` | AWS S3 | Endpoint of another store such as R2 or MinIO. When set, path-style addressing is used (change with `KEYRING_S3_PATH_STYLE`) |
| `KEYRING_S3_PREFIX` | `keyring/` | Key prefix inside the bucket |
| `KEYRING_S3_BLOBS` · `KEYRING_S3_BLOB_MIN_KB` | `0` · `256` | `1` stores attachments at or above this size in S3 instead of Git |
| `KEYRING_S3_ENCRYPTION_KEY` · `KEYRING_S3_ENCRYPTION_KEY_FILE` | (none) | If set, backups and attachments are encrypted before upload to S3 (the key, or a file containing it). Lose it and the encrypted data cannot be opened |
| `KEYRING_LANG` | follows `LANG` | Server language (`en`, `ko`): server error text, logs, CLI, and vault text before a vault language is chosen. A value set in the admin UI (Settings → Language → Server language) takes precedence |
| `KEYRING_HOST` | `127.0.0.1` | Bind address |
| `KEYRING_PORT` | `8787` | Port |

### Trying it with an Obsidian vault

Make a **copy** so the original vault is untouched.

```bash
cp -R ~/ObsidianVault /tmp/vault-copy
KEYRING_VAULT=/tmp/vault-copy pnpm start
```

On startup, the server absorbs the existing files in the vault into a single commit by the `system` author. Changes made outside the server later are recorded the same way on the next start.

## Admin console

The "Server" group in the Settings modal (Server status, Agents, Permissions, Apps, Devices, Backup, Restore, Automation, Updates, Security; or the "Server administration" command). Only the owner can use it (agent tokens get 403). There is no such group in local mode (app or `?local`).
On screens that show an agent token or webhook secret only once, or with an unsaved permission table or webhook form, you are asked before closing Settings or switching groups, and Settings cannot be closed during a restore or upload.

- **Server status**: version and uptime, note/file counts and size, commit count and last change, free disk space, backup status, last access per agent. Warns about no HTTPS, no allowed hosts, no backups, or low disk.
- **Agents & permissions**: create an agent (shows the token and an MCP config example once), edit per-folder permission tables, reissue tokens, delete.
- **Backup & restore**: back up now, download, upload a backup file from another server, restore, automatic backup settings (interval, how many to keep, whether to include config).
- **Updates**: current and latest version, and how to update.
- **Security**: change password (logs out every other device), register/delete passkeys, remote access guide.
  - **Passkeys**: log in without a password using a fingerprint, face recognition, device lock or security key (WebAuthn). Click "Register a passkey for this address" on the Security tab, and the login screen then shows "Log in with a passkey". Password login stays available (your fallback if you lose the passkey).
  - A passkey is bound to the address (host name) it was registered on. A passkey registered on `notes.example.com` cannot be used via an IP address or another name. Browsers only allow passkeys on https addresses (or `localhost`).
  - The server stores only public keys (`config/keyring.json`) and verifies a signature over a one-time challenge (5 minutes) on each login. Requests whose Origin differs from the accepted host (or `KEYRING_PUBLIC_URL`) are rejected. A signature counter that goes backwards (a possibly cloned authenticator) is rejected. Repeated failures slow responses down, just like passwords.

### S3 storage (optional)

The source of truth stays on the server's disk (vault folder + Git). S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2 …) is used for two things. It talks SigV4 directly, without an SDK.

- **Remote backups**: on as soon as `KEYRING_S3_BUCKET` and keys are set. Every backup (automatic or manual) is uploaded to `<prefix>backups/`, and automatic backups are trimmed to the configured count. If an upload fails, the local backup is still made and the admin console shows a warning. If you lose the server: start a new one with the same S3 settings, then in the admin console go to Backup & restore → S3 remote backups, "Fetch" → "Restore".
- **Large attachment storage** (`KEYRING_S3_BLOBS=1`): attachments (non-Markdown files) at or above the size threshold are uploaded to `<prefix>blobs/<sha256>` by content hash and left out of Git. Git keeps only a path → hash list (`.keyring-blobs.json`), the same approach as Git LFS. The files stay in the vault folder, so the UI, API, app sync and other editors see no difference, while Git history and backup files get smaller.
  - When you turn it on, large attachments already in Git are dropped from history too (copies inside past commits remain).
  - If an S3 upload fails, the write still succeeds and the file stays "waiting to upload", retried every 5 minutes. Attachments that are waiting are not included in backups (the admin console warns).
  - A restore downloads attachments from S3 according to that backup's list and removes attachments created after it.
  - S3 objects are named by content hash, so they are never overwritten, and never deleted either (past backups may point to them). If you add versioning or lifecycle rules to the bucket, it is safest to exclude `blobs/`.
  - Attachment history (which version, when) is in the Git history of `.keyring-blobs.json`, not in the note history view.
- The bucket is never public. Attachments are still served by the server after it checks permissions (never directly via signed URLs).
- **Encryption before upload** (`KEYRING_S3_ENCRYPTION_KEY`): backup files and attachments are encrypted on the server with AES-256-GCM before upload. The S3 side (the storage operator, a leaked access key) cannot see the contents.
  - Use a long random string as the key (e.g. `openssl rand -base64 32`). It is stretched with scrypt; the salt and a key check value are kept in `<prefix>encryption.json` (not secret). Starting with a different key logs a message and stops uploads (so data under different keys never mixes).
  - **If you lose the key, encrypted backups and attachments cannot be recovered.** Write it down outside the server (a password manager, etc.). Key rotation is not supported yet.
  - Attachments go to `<prefix>blobs-enc/` under HMAC names instead of content hashes, so nobody can tell which files you have by matching hashes. Sizes, upload times and backup names are not hidden.
  - Backups and attachments uploaded (unencrypted) before turning this on are still readable. Downloaded attachments are checked against their content hash.
  - Local backups on the server's disk are not encrypted (leave disk encryption to the OS).

### Backup format

A single `keyring-<timestamp>-<auto|manual|pre-restore>.tar.gz` contains `manifest.json`, `vault.bundle` (`git bundle --all`: every note and attachment with full history) and optionally `config.json` (password and token hashes, permission tables). The search index and wiki index/log can be regenerated, so they are not included.

- Changes made outside the server right before a backup are committed and included.
- Automatic backups are made only when the interval (default 24 hours) has passed and something changed since the last automatic backup; only automatic backups are pruned beyond the count (default 14).
- A **restore** first saves the current state as a `pre-restore` backup and keeps the current HEAD at `refs/keyring/before-restore-<timestamp>`, then switches vault files and history to the backup point. So a restore can be undone too. Config is restored only if you choose to.
- Moving to another server: download a backup, upload it in the new server's admin console, then "Restore" (restore config too and passwords and agents carry over as well).

## Desktop and mobile apps

The app works **without a server**. Notes are Markdown files in a folder on the device, and editing, search, tags, backlinks, widgets, wiki index, structure check, graph and change history all run on the device.
Connecting to a server is optional; when connected, notes are synced with that server. The UI is the same code as the web (`web`), the local vault and sync live in `packages/core`, and the app shell is Tauri 2 (`app`).

| | Vault location | Notes |
| --- | --- | --- |
| Windows · macOS · Linux | `Documents/Keyring Notes` (you can also open an Obsidian vault folder via ⇅ → "Open another folder") | Files changed in other editors are re-read when you return to the window |
| iOS | App documents folder (visible in the Files app) | |
| Android | App data folder | |
| Browser | This browser's IndexedDB (`https://server/?local`, turn off with `?local=0`) | Server-less PWA, for testing |

App metadata lives in `.keyring-app/` inside the vault (a dot folder, so the server and Obsidian ignore it): the change journal (`journal.jsonl`), content snapshots (`objects/`, stored by hash, no duplicates) and the sync baseline (`sync.json`).

### Syncing with a server (optional)

The sync button at the bottom of the app rail (or Settings → This device & sync) → server address, device name, server password → "Connect and sync". The server issues a token for this device (`kd_…`), and you can disconnect each device in the admin console → Devices.
Automatic sync runs when the app opens, 10 seconds after saving, when you return to the window, and every 5 minutes (on mobile, only while the app is open).

- Each note is compared with the "last version both sides agreed on" (the baseline); if only one side changed, that side wins.
- If both sides changed, a **three-way merge** is done against the baseline. If different parts (separate lines) were edited, the merged result is saved on both sides (it shows up in history as an automatic merge and can be undone).
- If the same line (or adjacent lines) was edited differently, **nothing is overwritten**: the original path keeps the server version, and this device's content is kept on both sides as `<name> (sync conflict copy date-time).md`. No conflict markers (`<<<<<<<`) are inserted into notes. If one side deleted a note and the other edited it, the edit wins.
- Markdown syncs both ways. Attachments (images, PDFs) go server → device; in addition, attachments newly created on the device are uploaded, and attachments deleted on the device are deleted on the server only if the server still has the baseline version (if the server changed it in the meantime, the server's copy is downloaded again). So if you move a folder with attachments in the app, the next sync uploads the attachments at the new location and deletes them from the old location on the server too (two commits on the server: upload and delete). Edits to existing attachments on the device are not sent. Each side builds its own wiki index/log.
- The settings file shared by all devices (`keyring-settings.md`) is Markdown too, so it syncs along.
- Commits the app writes to the server are authored as `owner (device name)`, and device tokens cannot use the admin console. Agents (MCP) still connect only to the server.
- Of the features available without a server, source collection (web page and PDF conversion), semantic search, change review and widget plugin rendering are used from the web UI connected to a server.

### Building

```bash
pnpm install --frozen-lockfile
pnpm app:dev                          # run the desktop app in dev mode (web dev server + app window)
pnpm app:build                        # installers (Windows .msi/.exe, macOS .dmg, Linux .deb/.rpm/.AppImage)
pnpm -F @keyring-notes/app android:init && pnpm -F @keyring-notes/app android:build   # requires the Android SDK and NDK
pnpm -F @keyring-notes/app ios:init && pnpm -F @keyring-notes/app ios:build           # requires macOS + Xcode
```

Requirements: Rust (stable), Node 22, and the platform-specific [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (`libwebkit2gtk-4.1-dev` etc. on Linux). Regenerate icons with `pnpm -F @keyring-notes/app icons`.

## Writing notes

**Layout**: the icon rail on the left (workspace switcher at the top; Files, Search, Tags, Today's note, Graph, Collect, Review, Structure check; Shortcuts, Settings and Log out at the bottom — Settings → General "Icons and labels on the side bar" also shows names) + the left panel, tabs and the note in the middle, the right panel (Outline, Links, Properties, History), and the status bar at the bottom (save state, offline, changes to send, waiting reviews, character count). Icon-only buttons show a tooltip with their name and shortcut on hover (after about 0.3 s), or the reason when they are unavailable (immediately on keyboard focus, long-press on touch). The left and right panels can be resized by dragging their edge (double-click for the default width) and collapsed; width and collapsed state are remembered on this device. On narrow screens both panels become drawers.

- **Autosave**: saves 1.5 seconds after you stop typing, and when you switch tabs or the window loses focus (turn it off or change the delay in Settings → Editor). The server groups consecutive autosaves of the same note by the same person into one commit for 10 minutes (amending the previous commit). Another commit or a backup in between starts a new commit, and agent writes are never grouped. `Ctrl/Cmd+S` saves right now (as a separate commit). On a same-line conflict, autosave pauses and a banner asks what to do.
- **Title = file name**: edit the big title field at the top of the note and press Enter (or click elsewhere) to rename the file and update links. Characters not allowed in file names (`/ \ : * ? " < > |`, a leading `.`, and `# ^ [ ]`, which clash with links) are flagged while you type. Edit the frontmatter `title` in the Properties tab.
- **Node = note and folder**: note `A` is `A.md`, and its children live in the sibling folder `A/` (the sibling layout, the same shape as Obsidian's "folder notes", so other editors show it as is). The tree shows them as one node; a folder without a note appears as an "Empty node" (click to open a blank note; typing creates `A.md`). Non-Markdown files (images, PDFs…) in a node folder are collapsed into one "N attachments" row under the node.
- **New note**: `Alt+N` (`Cmd/Ctrl+N` in the app), ＋ on the tab bar, or "New child note" in the tree menu. Creates an "Untitled" note right under the current node and puts the cursor in the title field. Notes cannot be created at the top of the vault (the top level is workspaces).
- **Note tree**: node icons (frontmatter `icon`), indent guides, highlighting of the current note and its ancestors. Right-click menu (New child note, Rename, Move to another note, Duplicate, Open in new tab / on the side, Copy path / Copy link, Change icon, Delete (with children)), drag and drop to move (hovering over a collapsed node expands it), keyboard (↑↓ move, ←→ collapse/expand, Enter open, F2 rename, Delete delete). Toolbar on top: New note, Reveal current note, Collapse all, display options (show/hide the "N attachments" rows). Renaming, moving or deleting a node handles `A.md` and the notes and attachments in `A/` in one go (one commit on the server, one journal entry in the app) and updates links (including attachment embeds and relative paths). The workspace's attachment folder (default `_attachments`, or `_첨부` when the vault language is Korean) is hidden from the tree. Sorting is by name; inside the daily folder, newest first (configurable).
- **Undo delete**: "Undo" on the notification shown after a delete brings the content (including child notes and attachments) back at the same path (history continues unbroken). Moves and renames can be undone from the notification too.
- **Workspaces**: the top nodes of the vault are workspaces (e.g. `Work`, `Personal`). Switching with the button at the top of the rail narrows the tree, quick open, search, tags, graph, home and Today's note to that workspace (widen with "All workspaces"), and open tabs, tree expansion and the last note are remembered per workspace. Opening a note in another workspace switches to it. Creating workspaces, names, icons, order, and the per-workspace daily, template and attachment folders are set in Settings → Workspaces (shared by all devices). A link `[[name]]` looks in the same workspace first, and searches the whole vault only if nothing is found there.
- **Side pane**: `Ctrl/Cmd+\` (or the ⋯ menu) shows the current note read-only in a pane on the right, and `Ctrl/Cmd+click` on a link opens that note there. Links inside the side pane are followed in the side pane, and "Edit in the center" opens it in a tab.
- **Shortcuts**: `Ctrl/Cmd+/` lists them; change them in Settings → Shortcuts. Keys the browser grabs (`Ctrl/Cmd+N·W·T·Tab·digits`) use `Alt` combinations on the web (`Alt+N` new note, `Alt+W` close tab, `Alt+Shift+T` reopen closed tab, `Alt+[`·`Alt+]` previous/next tab, `Alt+1~9` Nth tab); the desktop app uses the original keys. Others: `Ctrl/Cmd+Shift+F` search, `Ctrl/Cmd+E` edit ↔ preview, `Ctrl/Cmd+Alt+←/→` back/forward, `Ctrl/Cmd+Shift+E`·`Ctrl/Cmd+Alt+B` left/right panel, folding uses CodeMirror's default keys (`Ctrl+Shift+[`·`]` fold/unfold here — `Cmd+Alt+[`·`]` on macOS; `Ctrl+Alt+[`·`]` fold/unfold all), `Ctrl/Cmd+Shift+D` Today's note, `Ctrl/Cmd+,` settings, F2 rename. Editor: `Ctrl/Cmd+B` bold, `+I` italic, `+K` link, `+Shift+H` highlight, `+Enter` toggle task. Shortcuts are ignored during Korean IME composition.
- **Settings** (`#/:settings/<group>`, the gear at the bottom of the rail, `Ctrl/Cmd+,`): a modal over the note. General (theme, show icons, side bar labels, reset), Language (Display language, Vault language, language packs; in server mode also Agent language and Server language), Editor (autosave, Live Preview, font and size, readable width, line numbers, show properties above the document), Files & links (new link format, attachments in the tree, backlinks at the end of the document, daily display), Workspaces, Shortcuts (desktop and web only), This device & sync (app) or Server (admin console). Find settings with the search box at the top left (in the current language and in English, including server items like "backup" and "token"). Close with X, Esc, clicking the backdrop or going back; the first Esc inside an input just leaves the field.
  - **Display settings that follow you** (marked "All devices"): theme, display language, editor font and size, line numbers, Live Preview, readable width, autosave, show icons, attachments in the tree, daily display, sorting, properties above the document, backlinks at the end of the document, side bar labels, shortcuts. Stored in the `ui` group of the shared settings file and used by every device (web and app). Turning on "Different on this device only" for an item keeps that value on this device only, and it no longer follows changes to the shared value (the shared value is shown dimmed next to it). Resolution order: this device's override → shared value → default. The last received values are cached on this device so there's no flicker on startup (including the login screen), and changes from other tabs or sync apply immediately. Values that change continuously, like sliders, are written once after you stop.
  - **This device only**: panel widths and open state, left view and right tab, folded state, open tabs, tree expansion, last note, recent emoji, unofficial language packs (`localStorage`).
  - **Settings file shared by all devices**: the frontmatter of `keyring-settings.md` at the top of the vault. It's Markdown, so app sync keeps it in step, and the server also uses it for `[[date]]` links and daily-note detection. It doesn't appear in the tree, quick open, search, graph, widgets or property autocomplete, and doesn't count as a workspace (Settings → General → "Open source"). Edits re-read and rewrite only the one value being changed, so values changed by other devices aren't overwritten. App sync merges this file key by key without conflict copies; if both sides changed the same key differently, the server value wins and you're notified (for display settings you can choose "Keep this device's value here only"). Agents can only read this file, regardless of permission rules. Example:

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
- **Language**: the official languages are English (the base) and Korean. Display language is a following setting (initially the system/browser language) and switches without a reload. Text saved into the vault ("Untitled", conflict copies, default folder names, wiki index/log/SCHEMA, month and weekday names in daily formats, commit messages) follows the **Vault language** in the shared settings, separately from the display language. Server errors arrive as a `code` plus values to interpolate, and the UI renders them in its own language. Agents (MCP) follow the server's **Agent language** setting (English by default), and the CLI follows the **Server language** (or `KEYRING_LANG`/`LANG`).
  - **Unofficial language packs**: in Settings → Language, download an official language as a language pack JSON (`meta` + `messages`), translate the values, and add it with "Import language pack". On import you see a check report (unknown keys, number of missing keys, messages whose `{name}` placeholders differ, non-string values, values that look like HTML); problem messages are dropped and missing keys fall back to the base language (values are always rendered as plain text; up to 1 MB). Language packs stay on this device only, and support "Download missing keys only", "Import update…" (merge), export and delete. If another device chose a language whose pack isn't on this device, the base language is shown with a notice.
- **Modals**: Settings, Graph (go full screen with "Maximize" in the header), Review changes, Structure check, Collect sources, the command palette and Shortcuts all share the same frame. On narrow screens they become full-screen sheets.
**Concurrent edits**: if the note was changed elsewhere (another tab, an agent, app sync) before you save, a three-way merge against the version you started editing from combines different parts automatically and saves. Only when the same line was changed differently are you asked: "Save my changes as a copy / Load server version". The same applies when changes saved offline are sent after reconnecting. Agents (MCP, REST) still get 409 and re-read before writing.

- **Wikilinks**: `[[Note]]`, `[[Folder/Note]]`, `[[Note#Heading|alias]]`, `![[image.png|300]]`. Typing `[[` autocompletes note and attachment names (paths disambiguate duplicates).
- **Quick switching, commands, tabs, outline**: `Ctrl/Cmd+O` opens a note by name (partial match, open tabs and recent notes first, `Ctrl+Enter` for a new tab, shows icons and daily dates); `Ctrl/Cmd+P` is the command palette (every command with its shortcut). Opening a note that's already in a tab jumps to that tab; `Ctrl/Cmd+click` or middle-click opens a new tab; a plain open replaces the current tab. The tab bar is always visible, and the list of open tabs is remembered on this device. The "Outline" in the right panel lists headings — click to jump there in the editor and preview, and use ▸/▾ on the left to fold and unfold that heading in the text. With no note open, Home (New note, Today's note, Quick open, Search, recent notes) is shown.
- **Daily notes**: separate per workspace. The calendar on the rail (`Ctrl/Cmd+Shift+D`) opens Today's note for the current workspace (workspaces with daily notes off have no calendar button). If a note starting with today's date exists, it opens that one (even with a title after the date); if there are several, you pick; if none, a new note named with just the date is created and the cursor is put in the title field. ◀ date ▶ in the note header and the "Previous/Next daily note" commands skip missing days and go to existing notes; "yesterday's/tomorrow's note" opens or creates the note for that day.
  - **Format** (Settings → Workspaces, shared by all devices): the folder inside the workspace (default `Daily`, or `일기` when the vault language is Korean) and the grouping — none `YYYY-MM-DD`, by year `YYYY/YYYY-MM-DD`, by year/month `YYYY/MM/YYYY-MM-DD`, by year/week `GGGG/[W]WW/YYYY-MM-DD`, or custom. Tokens: `YYYY YY M MM MMMM(October) D DD W WW(week) GGGG(week-based year) ddd(Wed) dddd(Wednesday) H HH m mm s ss [text]` — month and weekday names follow the vault language, `/` makes a subfolder. Weeks start on Monday by default (ISO 8601); Sunday is also available (not ISO). Below the setting, the paths for today, yesterday, tomorrow and the year-end boundary are previewed — with ISO weeks, 2026-12-31 and 2027-01-01 are both `2026/W53`, and `2027/W01` starts on 2027-01-04, so week grouping uses `GGGG` for the year. Formats that produce characters not allowed in file names, empty segments, `..` or dot folders are not saved.
  - **Detection** (by name only; shared by server, app and web in `packages/core/src/daily.ts`): a note is a daily note if it's under the daily folder, matches the folder part of the format, and its name **starts** with a date in the format. After the date there must be the end of the name or a separator (space, ` - `, `_`, `·`) (`2026-10-071.md` doesn't count), and the path rebuilt from the parsed date must match the actual folder (`2026-10-20` in `2026/W41/` doesn't count). So `Daily/2026-10-07 Quarterly planning meeting.md` is that day's note too.
  - **Display**: the title field pins the date as a dimmed prefix and you edit only the title after it (click the date for the full name; deleting the date warns that it will no longer be a daily note). The tree, tabs and quick open show the date dimmed and the title in bold, or `Wed, Oct 7` when there's no title (configurable).
  - **`[[2026-10-07]]` links** point to that day's daily note (a note with exactly that name takes precedence). Backlinks, graph, structure check and automatic link updates on the server and in the app follow the same rule, and for agents it resolves only among notes they can see. Moving a daily note out of the daily folder rewrites those links to the full name.
  - **Automatic tags**: on creation, `tags: [daily/2026/10/07, 10-07, 2026-W41, Wednesday]` and `icon` (the default daily icon from settings) are added to the frontmatter. The leading word and the weekday name follow the vault language. Other tags from the template stay after the automatic ones (for `icon`, the template wins), and changing the date in the name updates the automatic tags that are present. If someone changes them so they no longer match the name, Structure check reports "Daily tags differ from the name's date". Finding notes: `#daily` (all), `#daily/2026/10` (that month, sub-tags included), `#10-07` (this day every year), `#2026-W41` (that week). Widget examples: `from: "#10-07"`, `from: "#daily/2026/10"`, `where: tags = 2026-W41`.
  - **Migrating formats**: the command "Move existing daily notes to the new format" (or the button in settings) reads the date at the start of note names in the daily folder (`YYYY-MM-DD`, `YYYY.MM.DD`, `YYYYMMDD`, etc.), shows a list of moves to their place in the current format, and moves them all at once on confirmation (one commit, the title after the date is kept, links updated). Files whose date can't be read are skipped and listed.
- **Templates**: the "Insert template" command inserts a note from the current workspace's template folder at the cursor; "New note from template" asks only for a title and creates a new note under the current node. Variables: `{{title}}` `{{date}}` `{{time}}` `{{date:MMMM D, YYYY dddd}}` `{{yesterday}}` `{{tomorrow}}`.
- **Rendering while editing** (Live Preview, on by default — turn it off from the status bar or settings): lines without the cursor hide `#`, `**`, `~~`, `==`, backticks, `[text](url)` and `[[target|alias]]` syntax and show only heading sizes, emphasis and link styling. Image and note embeds (lines containing only `![[…]]`), callouts, math (`$…$`, `$$…$$`), Mermaid and footnotes are drawn with the same renderer as the preview; comments `%%…%%` and block IDs `^id` are hidden. Moving the cursor to that line (block) or clicking a rendered block shows the source. Code blocks and tables are left as is. Body text uses a proportional font; only code blocks and inline code are monospace. Leading frontmatter is folded into one line: "N properties — see the right panel · Show source" (click the first part for the Properties tab; "Show source" expands it).
- **Folding**: fold headings (up to the next heading of the same or higher level), list items with children, callouts, long code blocks (6+ lines) and tables. In the editor use ▸/▾ to the left of the line (visible on hover) and the `…` at a fold; in the preview, the button left of the block; in the Outline panel, the button next to the heading — all share the same state, so folding in one place folds the others. Commands (registered in the shortcut system, changeable in settings): Fold here / Unfold here, Fold all / Unfold all, Show only headings of this level. Folded state is remembered per note on this device (file contents are unchanged), and is re-found by the line's text even if lines shift. Jumping via search results or `#heading`/`#^block` links unfolds the target.
- **Icons**: the spot left of the title field (shown on hover when there's no icon) or "Change icon…" in the tree menu opens an emoji picker (search, recent, clear, or paste your own). The icon is the node note's frontmatter `icon: 📘` (other editors and agents can read it, and it moves with the node). Giving an icon to an empty node creates its note. A workspace's icon is its note's `icon` too. Icons show in the tree, tabs, note header, quick open, search results and widget lists.
- **Pasting and dropping attachments**: paste or drop images and files into the editor to upload them to the current workspace's attachment folder (Settings → Workspaces; default `_attachments`/`_첨부`) and insert `![[image]]` there (`[[file]]` for other files, or a path when the link format is "Full path"). Clipboard images are named `Pasted image date-time.png`, with ` 2`… appended on name clashes. It works in the app (local vault) too, and attachments newly created on the device are uploaded on sync (attachments deleted on the device are deleted on the server only if the server still has the same version, and edits to attachments on the device are not sent).
- **Tasks**: `- [ ] task`. Clicking a checkbox in the preview changes the source (autosaved). In the editor, `Ctrl/Cmd+Enter`.
- **Moving and renaming**: links pointing to the note are updated in the same commit, with a "Fixed N links." notice. Updated are body wikilinks (`[[…]]`, `![[…]]`), `[[…]]` and path values in frontmatter `sources`/`source`, and relative Markdown links and images (`[x](../a.md)`, including the moved note's own relative links, recomputed from its new location). `#heading`, `#^block` and `|alias` are kept; links that used the full path get the full path, and links that used just the name get the shortest name that still resolves correctly. If the moved note would become a shallower note with the same name and capture other links, those are rewritten to their original targets too. Code blocks and inline code are left untouched. When an agent moves a note, links are resolved only with paths that agent can see and only notes it can write are updated, always with full paths (if this touches a review-target path, it's included in the proposal preview).
- **Extended syntax** (same as Obsidian, preview only):
  - Callouts `> [!note] Title` — colors per type (note, tip, warning, danger, question, example, quote, etc.); `[!tip]-` starts folded, `[!tip]+` expanded
  - `==highlight==`, footnotes `text[^1]` … `[^1]: content`
  - Math `$E=mc^2$`, `$$ … $$` (KaTeX). If `$` is directly followed by a space, as in `$5 and $6`, it isn't math
  - Diagrams: ` ```mermaid ` code blocks
  - Note embeds `![[Note]]`, `![[Note#Heading]]`, `![[Note#^block]]` — inlines the content (when the paragraph contains only the embed). Up to 3 levels deep; embedding itself again is shown as a link. Missing or inaccessible notes are broken links
  - Block IDs: ` ^id` at the end of a paragraph or list item (for tables etc., `^id` alone on the next line). The marker is hidden, and `[[Note#^id]]` jumps to that spot
  - Comments `%%…%%` (can span lines) — hidden in the preview, and links, tags and tasks inside comments are not indexed
  - Relative Markdown links `[x](Folder/Note.md#Heading)` open as notes too
  - KaTeX and Mermaid load only when used (bundled from the same origin, no CDN); the installed app (PWA) fetches them in the background after the first open, so they work offline too
- **Search**: the magnifier on the rail (`Ctrl/Cmd+Shift+F`). Clicking a result jumps to that line and selects the search term. Finds notes containing all space-separated words; `#tag` words become tag filters (including subtags). Searches body, title, path and frontmatter.
- **Paragraph-level sources**: writing `"[[Source#^p3|paragraph]]"` (a block ID) or `"[[Source#Heading]]"` in frontmatter `sources` points to that part of the source. The source list in the right panel's "Links" tab shows a short quote of that paragraph; clicking it jumps to that spot in the source. Structure check reports "Broken sources" when the block or heading no longer exists in the source. Agents read just that block with `read_section` and `heading: "^p3"`.
- **Backlinks and unlinked mentions**: the right panel's "Links" tab (with the count in the tab name) gathers sources, citations and backlinks, and is visible in edit mode too (Settings → Files & links can also show them at the end of the note). Expanding "Unlinked mentions" shows places in other notes where this note's name (file name, `title`, `aliases`) appears without a link, with context. Code, links, comments and frontmatter are excluded, and English names are checked at word boundaries (Korean isn't, since particles attach directly to words). Clicking "Link" replaces that spot with `[[name]]` (or `[[name|text]]` if written differently) and saves. If that note changed after the search, nothing is overwritten and you're asked to search again.
- **Property editor**: the right panel's "Properties" tab (with the count in the tab name; also opened by the properties button in the note header or the folded frontmatter line) shows frontmatter fields as inputs matching their type (text, number, checkbox, date, date & time, list). You can rename, change type (values are converted), delete and add fields, and names and values are autocompleted from those used in the vault. Edits go into the draft being edited (they apply on save and can be undone), and other fields' order, comments and `[a, b]` style are preserved. If the YAML is broken, you're only told to fix it in the source. Properties aren't drawn above the body (Settings → Editor "Show properties above the document" can show a source box in the preview).
- **PDF annotations → wiki sources**: clicking a PDF (in the tree, or `[[x.pdf]]`/`[[x.pdf#page=3]]` links) opens it inside the app. Select text and click "Add annotation" to create a `## PDF annotations` section (its title and page labels follow the vault language) in the PDF's companion note and add a line like `- [[x.pdf#page=3|Page 3]] “selected text” — memo ^pdf-3-k2x9` (in page order). The companion note is the collected source note (`raw/x.md` ↔ `raw/assets/x.pdf`), otherwise the note the PDF was opened from, otherwise a new note created next to the PDF. If you opened the PDF from a wiki page, "Cite in this note" on each annotation adds `[[companion note#^pdf-3-k2x9]]` to `sources`, and the source list shows it as "p. 3 “selected text” — memo". Reopening the PDF highlights the annotated spots. Annotations are just Markdown lines, so agents read them with `read_section` (`heading: "PDF annotations"` or `"^pdf-3-k2x9"`).
- **Sources, citations, backlinks**: below the preview — the sources pointed to by frontmatter `sources` (missing or inaccessible ones in red), pages that cite this note as a source, and notes that link to it in their body (backlinks).
- **Semantic search**: with embeddings configured, "Semantic" next to the search box finds notes close in meaning even with different words.
- **Graph** (◎): notes with links (solid lines) and sources (dashed lines). Only the 3 topics with the most notes get colors; the rest are gray "other". Zoom and pan, hover to highlight neighbors, click to open, show only the area around the current note.
- **Offline and mobile**: can be installed to the home screen as an app (PWA). Notes opened once can be opened without a connection, and saves made offline are kept on this device and sent when reconnected. Notes changed on the server in the meantime aren't overwritten; your version is kept as an "offline conflict copy". On narrow screens the note list becomes a drawer (☰).

### Widgets

Write YAML in a code block with the language name `widget`. Other editors show it as a plain code block.

````markdown
```widget
type: query          # query (list) | table | cards | kanban | tasks | chart
from: Work/ProjectA  # a folder, "#tag", or a list. Omit for the whole vault
where: status != done # one condition or a list (all must match)
show: [title, due]
sort: due            # -due or "due desc" for descending; a list for multiple keys
limit: 50
```
````

| Item | Description |
| --- | --- |
| Fields | Frontmatter keys + built-in fields `path`, `title` (frontmatter title → first `#` heading → file name), `folder`, `name`, `tags`, `modified` |
| Conditions | `=` `!=` `>` `>=` `<` `<=` `contains` `!contains`, `field` (has a value), `!field` (no value). The value `today` is today's date (YYYY-MM-DD) |
| `tasks` | `status: open` (default) / `done` / `all`. Checking a task in the widget saves it straight to the source note |
| `chart` | `chart: bar` (default) / `line`, `x: field to group by`, `y: numeric field`, `agg: sum` (default when y is set) / `count` / `avg`. Or enter data directly with `data: [{label, value}]`. Offers "Show as table" |
| `group` | `group: status` — groups query, table and cards by that field's value |
| `cards` | A card per note (title, summary, `show` fields) |
| `kanban` | Values of `group` (default `status`) are the columns. `lanes: [To do, Doing, Done]` sets column order. Dragging a card to another column, or moving it with the card's select box, changes that field |
| Editing | In table, cards and kanban, click a frontmatter field cell to edit it in place (Enter saves, Esc cancels, empty deletes the field). If the note changed after the widget was drawn, nothing is overwritten and you're asked to retry. Other fields, comments and the body are untouched. Built-in fields (title, tags, etc.) can't be edited |
| `plugin` | `plugin: <name>` + the same `from`, `where`, `show`, `sort` as above; `options:` is passed to the plugin as is. For writing plugins, see [examples/plugins](examples/plugins/README.md) (e.g. kanban) |

Widgets also go through the permission layer, so when an agent runs the same query (MCP `query`), only notes it can see are returned.

## LLM Wiki

A topic run in three layers: raw sources → a wiki maintained by agents → a schema. A node directly under a workspace (`<workspace>/<topic>`, two levels) becomes a wiki topic when it contains `SCHEMA.md`. `SCHEMA.md`, index and log are created in the vault language.

```
Work/Economy/
├── SCHEMA.md            Wiki structure and procedures (ingest, query, maintenance). Edited only by people — agents can only read it, whatever the rules
├── raw/                 Collected sources (converted to Markdown). Recommended agent permission: append
│   └── assets/          Original files (PDF, images, HTML)
└── wiki/                Pages maintained by agents. Recommended permission: delete
    ├── index.md         [auto] Page list (category, summary, source count) + unprocessed/processed sources
    └── log.md           [auto] Activity log built from Git history: ## [date time] author | message
```

1. **Create a topic**: Collect on the web rail (inbox icon) → "New wiki topic" (created in the current workspace). A `SCHEMA.md` template is created; fill in the purpose and rules.
2. **Agent permissions**: `agent grant <name> Work/Economy/raw append`, `Work/Economy/wiki delete`, `Work/Economy/SCHEMA.md read`.
3. **Collect sources** (Collect on the rail, or MCP):
   - Files: PDF (text extraction, per page), images, HTML, Markdown and text. 50 MB per file.
   - URL: the server fetches it and keeps only the main content as Markdown (Readability + Turndown). PDF links are handled as PDFs.
   - Web clipper: drag "📎 Keyring clip" from the URL tab to your bookmarks bar and click it on the page you want to save. Pages that need a login are saved too, since the browser sends the HTML it already has, and you can save just a selection.
   - Paste: text or Markdown as is.
   - Saved to `<topic>/raw/<date> <title>.md`, with `source_type`, `source_url`, `original`, `ingested_at`, `ingested_by` in the frontmatter.
4. **index and log**: regenerated by the server whenever anything inside the wiki topic changes. They can't be edited directly and aren't added to Git or the search index. They are generated per reader's permissions, so agents that can't see a source don't see its name. A source turns "processed" once a wiki page cites it in a body link or in `sources`.

## Working with agents

### Change review queue

✔ (Review) → list folders under "Review targets" (`/` for everything), and changes **agents** write under them aren't applied right away but queue up as proposals. Permission and conflict checks run at that point; when a person reviews the diff and clicks "Approve", it's committed under the agent's name (with the approver in the body). If the note changed in the meantime, it's marked "Document changed since" and approval is rejected as a conflict. Agents see rejection reasons with MCP `my_proposals`. Writes by people always apply immediately.

### Structure check

Structure check on the rail (broom) or MCP `lint`: broken links and sources, orphan wiki pages, pages without `sources`, missing `title`/`summary`, stale pages (default 180 days; frontmatter `updated` takes precedence), sources not yet cited.

### Webhooks and scheduled jobs

Admin console → Automation. Webhooks POST events as JSON.

| Event | When | data |
| --- | --- | --- |
| `raw.added` | New source in a wiki topic's `raw/` (via collection, agent write or approval), immediately | `topic, path, rev, author, message` |
| `doc.changed` | Once after a note changes and things go quiet: for the same note, once 90 seconds pass after the last save with no further saves, the commits up to then are sent as one batch (even if autosave amends commits every few seconds, the webhook doesn't fire every few seconds). Created then edited is `A`; created then deleted is not sent. Pending events are sent right away when the server shuts down | `rev, author, message` (last commit), `commits` (number of batched commits), `files[{status, path}]` |
| `proposal.created` | New proposal in the review queue | `id, agent, message, topic, files` |
| `schedule` | Scheduled job run | `job, topic, instructions, lint?{counts, issues, total}` |

The body is `{event, id, time, data}`, with the header `X-Keyring-Signature: sha256=<HMAC-SHA256(secret, body)>`. Verification example on the receiving side (Node):

```js
const ok = req.headers["x-keyring-signature"] === "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
```

5xx responses and connection failures are retried after 1, 5 and 25 seconds. Scheduled jobs send `schedule` to the webhook on each cron tick (`minute hour day month weekday`, server time zone); with "Include lint check", the check results and instructions are sent together so an agent can do the cleanup. Example: `0 9 * * 1` (every Monday at 9:00).

### Enabling semantic search

Any OpenAI-compatible embedding endpoint works.

```bash
# Local (Ollama): ollama pull nomic-embed-text
KEYRING_EMBED_URL=http://localhost:11434/v1/embeddings KEYRING_EMBED_MODEL=nomic-embed-text pnpm start
# OpenAI
KEYRING_EMBED_URL=https://api.openai.com/v1/embeddings KEYRING_EMBED_MODEL=text-embedding-3-small KEYRING_EMBED_KEY=sk-... pnpm start
```

Notes are split into sections and their vectors stored in the index file; only changed notes are recomputed (with an external API, note contents are sent to that service). Status: `GET /api/semantic/status`.

## Connecting agents

### 1. Issuing tokens and granting permissions

```bash
pnpm keyring agent add wiki-work                          # the token is shown only now
pnpm keyring agent grant wiki-work Work/raw append
pnpm keyring agent grant wiki-work Work/wiki delete
pnpm keyring agent grant wiki-work Work/SCHEMA.md read
pnpm keyring agent list
```

Other commands: `agent rotate <name>` (reissue the token; the old one is invalid immediately), `agent revoke <name> <path>`, `agent remove <name>`.
The server re-reads the config file from the next request after it changes, so no restart is needed.
A wiki topic's `SCHEMA.md` and the vault's shared settings file `keyring-settings.md` (which changes how the server resolves links and detects daily notes) are read-only for agents, whatever the rules.

| Permission | What it allows |
| --- | --- |
| `hidden` | Nothing. Also excluded from lists, search and link resolution; reads fail with the same error as "no such note" |
| `read` | Read, search, view history |
| `append` | + create new notes, **append to the end** of existing notes (no editing, deleting or moving existing content) |
| `write` | + edit existing content, roll back |
| `delete` | + delete, move elsewhere |

- Paths without a rule are `hidden`. A rule for the whole vault uses the path `/`.
- When several rules apply to a note, the most specific (longest) path wins.
- **Node rules**: the rule `Work/Project` covers both the subfolder `Work/Project/…` and the node's note `Work/Project.md` (unless a more specific `Work/Project.md` rule exists). So with `Work/Secret: hidden`, the note `Work/Secret.md` also never shows up in lists, search, backlinks, link resolution, tags, graph, widgets, wiki index/log or history.
- **History masking**: any commit containing even one path the agent can't see has its message replaced with "(change involving hidden paths)". This is decided by the commit's actual list of changes (including the old and new paths of moved nodes), not by the commit message.
- Commits made by an agent are recorded with the agent's name as author.

### 2. MCP client setup

Streamable HTTP (stateless, JSON responses). Tool descriptions and error text follow the server's "Agent language" setting (Settings → Language, English by default). Errors also carry a language-independent `code`.

- URL: `http://127.0.0.1:8787/mcp`
- Header: `Authorization: Bearer <token>`

| Tool | Description |
| --- | --- |
| `whoami` | My name and permission table |
| `list_children` | A node's children (notes, child nodes, attachment count). Empty for the list of workspaces |
| `list_topics` | List of topics (`<workspace>/<topic>`). `wiki: true` for LLM Wiki topics |
| `ingest_url` | Fetch a URL (web page or PDF) and save it to `<topic>/raw/` |
| `ingest_text` | Save text you have as a source in `<topic>/raw/` |
| `list_documents` | Readable notes and the permission for each |
| `read_outline` | Hash, line count, frontmatter, headings (line ranges), wikilinks. No body |
| `read_section` | Read part of a note by heading (`Parent > Child`) or line range |
| `read_document` | Read the whole note |
| `list_frontmatter` | Frontmatter of the notes in a folder, all at once |
| `search` | Full-text search (`#tag` words become tag filters) |
| `backlinks` | Notes that link to this note |
| `unlinked_mentions` | Notes where this note's name appears without a link, and where (line, position, context) |
| `list_tags` | Tags and note counts |
| `query` | The same YAML query as widgets (query, table, tasks, chart, plugin) |
| `sources` | Sources (frontmatter sources), pages citing this note, body backlinks |
| `lint` | Structure check |
| `semantic_search` | Semantic search (when configured) |
| `my_proposals` | Results of the change proposals I submitted |
| `write_document` / `append_document` | Write / append to the end |
| `move_document` / `delete_document` | Move / delete. Moving updates links pointing to the note in the same commit by default (turn off with `update_links: false`; results include `linksUpdated` and `linkCount`) |
| `batch_write` | Several write, append, delete and move operations in one commit. If any fails, all are rolled back. Moves update links too (`update_links`) |

For writes, pass the last read `hash` as `base_hash` (`null` for a new note). If it differs from the server version, `conflict` and `current_hash` are returned and nothing is written. Writes into a review-target folder return `pending` (the vault is unchanged), and the returned `content` and `hash` reflect the state after approval.

## Storage layout

- `vault/**.md` — the source of truth. Plain Markdown + YAML frontmatter. Top-level folders and notes are workspaces, and node `A` is note `A.md` plus subfolder `A/` (e.g. `Work.md`, `Work/Project.md`, `Work/Project/Meeting.md`, `Work/_attachments/diagram.png`). Only workspace notes and the settings file live at the top of the vault.
- `vault/keyring-settings.md` — settings shared by all devices (vault language, link format, workspace order, per-workspace daily, template and attachment folders, the following display settings `ui`, in frontmatter). Created and edited by the Settings screen. Goes through app sync and Git history like any note.
- `vault/.history/` — the Git repository (`--git-dir`). The work tree is the vault itself, so no `.git` shows up when you open it in another editor.
- Folders starting with a dot (`.obsidian`, `.trash`, `.history`) are hidden from the tree and inaccessible through the API.
- `vault/.keyring/index.db` — SQLite index (FTS5 trigram over the body, tags, links, tasks, frontmatter). On server start only changed files are re-read to catch up, and changes made through the server are reflected right after commit. Excluded from Git.
- `config/keyring.json` — mode 0600. Passwords are stored as scrypt hashes, tokens as sha256 hashes, and passkeys as public keys only.

## Architecture

```
Web (cookie login) ──┐
App devices (token) ─┼─ REST /api/*  ─┐
Agents (token) ──────┤                ├─ ScopedVault (permission layer) ─ Vault (files, batch writes) ─ Git
                     └─ MCP /mcp ─────┘

App (Tauri) = same web UI + LocalVault (device folder, in-memory index, snapshot history) ⇄ SyncEngine ⇄ REST
packages/core = Markdown parsing, widget queries, wiki index/log, structure check, graph (shared by server and app)
```

Both REST and MCP reach the vault and the index only through `ScopedVault` in `server/src/scoped.ts`. The index knows nothing about permissions; search, backlink, tag and widget results are all filtered by permission in `ScopedVault`. Every change goes through the single `Vault.batch()`, which first checks all permissions and conflicts against a virtual state, then applies to disk and records one commit. If applying or committing fails, the original content is restored.

## REST API

Authentication: the web uses the cookie from `POST /api/auth/login` (HttpOnly, SameSite=Strict); agents and app devices use `Authorization: Bearer <token>`. Every mutating request must be `Content-Type: application/json`. For cross-origin apps, CORS responses are enabled only for requests that come with an `Authorization` header (and device registration).

| Method | Path | Body / query | Description |
| --- | --- | --- | --- |
| GET | `/api/auth/status` | | Login status |
| POST | `/api/auth/login` · `/api/auth/logout` | `{password}` | Owner login / logout |
| GET | `/api/whoami` | | Name and permission table |
| GET | `/api/tree` · `/api/documents` | `?folder=` | Tree / flat list |
| GET | `/api/file?path=` | | Note content and `hash` (sha256) |
| GET | `/api/outline?path=` | | Note outline |
| GET | `/api/section?path=` | `&heading=` or `&start=&end=` | Read a section |
| GET | `/api/frontmatter` | `?folder=&fields=a,b` | Frontmatter list |
| GET | `/api/search?q=` | `&folder=&limit=` | Search |
| GET | `/api/health` | | Health check (no auth) |
| POST | `/api/auth/device` | `{password, name}` | Register an app device → `{id, name, token}` (token shown once) |
| POST | `/api/auth/passkey/options` · `/api/auth/passkey/login` | `{}` · `{id, response}` | Passkey login (get a challenge → send the signature; on success, a login cookie) |
| GET·POST·DELETE | `/api/admin/passkeys` · `/api/admin/passkeys/options` · `/api/admin/passkeys/:id` | | List, register (`{id, response, name}`) and delete passkeys (owner web login only) |
| GET | `/api/sync/manifest` | | File list for sync `{files: [{path, hash, size}]}` (owner and devices; excludes the server-generated wiki index/log) |
| POST | `/api/auth/setup` | `{code, password}` | First-time setup (only when no password is set; setup code from the log) |
| * | `/api/admin/…` | | Admin console API (owner only): `status`, `update`, `devices` (and `DELETE devices/:id`), `agents`, `agents/:name/rules`, `rotate`, `password`, `backups`, `backups/settings`, `backups/upload`, `backups/:name/restore`, `automation`, `automation/webhooks`, `jobs`, `automation/webhooks/:id/test`, `automation/jobs/:id/run` |
| GET · POST | `/api/topics` | `{name}` | List topics / create a wiki topic (owner) |
| POST | `/api/ingest` | `{kind: url\|html\|text, topic, ...}` | Collect a source |
| POST | `/api/attachment?path=` | file bytes, header `x-keyring-upload: 1` | Create a new attachment (409 if it exists, up to 50 MB) |
| POST | `/api/ingest/file?topic=&name=` | file bytes, header `x-keyring-upload: 1` | Collect an uploaded file |
| GET | `/api/backlinks?path=` | | Backlinks |
| GET | `/api/mentions?path=` | | Unlinked mentions (visible notes only) |
| GET | `/api/properties` | | Property names, types, note counts and frequent values across visible notes |
| GET | `/api/sources?path=` | | Sources, citations, backlinks |
| GET | `/api/lint` | `?folder=&staleDays=` | Structure check |
| GET | `/api/graph` | `?folder=` | Graph (nodes and links) |
| GET | `/api/semantic` · `/api/semantic/status` | `?q=&folder=&limit=` | Semantic search / status |
| GET · PUT | `/api/review/settings` | `{reviewPaths}` | Review target folders (owner) |
| GET | `/api/review` · `/api/review/:id` | `?status=pending` | Proposal list / details with diff (owner) |
| POST | `/api/review/:id/approve` · `/reject` | `{reason?}` | Approve / reject (owner) |
| GET | `/api/plugins` · `/plugins/<name>.js` | | Widget plugin list / module (owner login) |
| GET | `/api/tags` | `?folder=` | Tags and note counts (folder/node scope) |
| POST | `/api/widget` | `{source}` | Run widget YAML |
| POST | `/api/task` | `{path, line, done, baseHash}` | Toggle a task |
| PUT | `/api/file` | `{path, content, baseHash, coalesce?}` | Write. `baseHash: null` for a new note. With `coalesce: true` (web autosave, owner only), consecutive saves of the same note are grouped into one commit for 10 minutes |
| POST | `/api/append` | `{path, content, baseHash?}` | Append to the end |
| DELETE | `/api/file` | `{path, baseHash}` | Delete (attachments too; `baseHash` is the sha256 of the bytes) |
| POST | `/api/move` | `{from, to, baseHash, updateLinks?}` | Move/rename (note → note, attachment → attachment). Automatic link updates (on by default) → `linksUpdated` (updated notes), `linkCount` |
| POST | `/api/move` | `{from, to, node: true, updateLinks?}` | Move/rename a node: `A.md` and the notes and attachments in `A/` in one commit → `moved[[from, to]]`, `linksUpdated`, `linkCount` |
| POST | `/api/node/delete` | `{path, files[{path, baseHash}]}` | Delete a node (with children, one commit). 409 if it differs from the file list and hashes the UI saw |
| GET | `/api/children` | `?path=` | A node's children (empty for workspaces) |
| POST | `/api/batch` | `{message?, operations: [{op, ...}], updateLinks?}` | Batch write. Chained moves (A→B→C) within one batch are combined for link updates. `files` lists only files that actually changed |
| GET | `/api/raw?path=` | | Raw attachment file (images, etc.) |
| GET | `/api/history?path=` | | A note's commit list (with authors) |
| GET | `/api/revision?path=&rev=` | | Content at a specific revision |
| POST | `/api/rollback` | `{path, rev, baseHash}` | Roll back to a past revision (as a new commit) |

Errors: `401` not authenticated, `403` forbidden, `404` not found (including hidden), `409` conflict (includes `currentHash`). The body is `{error, code, params, message}` — `code` is a language-independent message key (`error.<code>`), `params` are the values to interpolate, and `message` is the text in the server language.

## Tests

```bash
pnpm test        # path validation, conflicts, history/rollback, batch write atomicity, permissions (hidden, read, append-only), auth, MCP,
                 # Korean search, tags, backlinks, index sync, widgets, task toggling,
                 # wiki topics, collection (URL, PDF, image, clip), SSRF blocking, index/log generation and per-permission content,
                 # review queue, sources/structure check, webhook signing/retries/cron, graph, semantic search (fake embedding server), plugins,
                 # backup/restore (undo, moving to another server)/automatic backups, admin API permissions, first-time setup, allowed hosts/security headers,
                 # local vault (server-less writes, search, widgets, snapshot history, external changes, wiki index), sync (three-way, conflict copies, deletes, 409, offline),
                 # device tokens/CORS/sync manifest, app ↔ server sync through the real server API,
                 # daily detection, weeks (year-end boundary), automatic properties, [[date]] links, format migration, shared settings file (agent read-only, excluded from search etc.),
                 # folder moves in one commit (including attachments and S3-stored attachments), app folder moves and attachment deletion sync, webhook doc.changed batching
pnpm typecheck
```
