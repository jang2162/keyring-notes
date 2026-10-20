# Getting started

This guide takes you from an empty machine to your first note in Keyring Notes, then shows how to let an agent in.

It is for people who run the server themselves with Docker.

## Before you begin

You need:

- Git.
- Docker with Docker Compose v2 and BuildKit (the `docker buildx` plugin). Docker Desktop includes both.

## 1. Start the server

Clone the repository and start the container.

```bash
git clone https://github.com/jang2162/keyring-notes && cd keyring-notes
docker compose up -d --build
```

The command builds the image from the repository code. There is no prebuilt image to pull.

Check that the server answers:

```bash
curl http://127.0.0.1:8787/api/health
```

```text
{"ok":true}
```

The port is open on `127.0.0.1` only, so the server is reachable from this computer only. To use it from other devices, see [Deploy with Docker](how-to/deploy-with-docker.md).

## 2. Get the setup code

The server prints a one-time setup code in its log the first time it starts.

```bash
docker compose logs keyring
```

```text
keyring-1  | Index synced: 0 updated, 0 removed, 0 wiki topics (20ms)
keyring-1  | keyring-notes: http://0.0.0.0:8787  (vault: /data/vault, config: /data/config/keyring.json)
keyring-1  | MCP: http://0.0.0.0:8787/mcp  (Authorization: Bearer <agent token>)
keyring-1  | Backups: /data/backups
keyring-1  |
keyring-1  | First run: set a password in the web app with this setup code → 4248-441D-E87C
keyring-1  | (or `pnpm keyring passwd`; with Docker, `docker compose exec keyring keyring passwd`)
```

Your code is different. The log is in English unless `KEYRING_LANG` or `LANG` says otherwise, until you choose a server language.

## 3. Set your password

1. Open `http://127.0.0.1:8787` in a browser.
2. Enter the setup code, then a new password of 8 or more characters twice.
3. Click **Set password and start**.

You are logged in, and the home screen says **Create a workspace first.**

## 4. Create a workspace

Notes live inside workspaces, the top-level nodes of the vault (for example `Work` and `Personal`).

1. Click **New workspace** on the home screen. Settings opens at **Workspaces**.
2. Click **+ New workspace**, type `Work` and press Enter.
3. Press Esc to close Settings.

## 5. Write your first note

1. Click **New note** (or press `Alt+N`). A note named "Untitled" opens with the cursor in the title field.
2. Type `My first note` and press Enter. The note is renamed and the cursor moves to the body.
3. Type some text. The status bar shows **Saved** about 1.5 seconds after you stop typing.

The note is now the file `Work/My first note.md` in the vault, with its first version in the vault's Git history.

## 6. Connect an agent (optional)

Agents reach the vault only through a token with per-folder permissions.

1. Issue a token.

   ```bash
   docker compose exec keyring keyring agent add my-agent
   ```

   ```text
   Token for my-agent (save it now; it cannot be shown again):

     <token>

   No permissions yet. Example: pnpm keyring agent grant my-agent work/wiki write
   ```

2. Give the agent access to a folder.

   ```bash
   docker compose exec keyring keyring agent grant my-agent Work read
   ```

   ```text
   my-agent  (created: 2026-10-20)
       read    Work
   ```

3. Point your MCP client at `http://127.0.0.1:8787/mcp` with the header `Authorization: Bearer <YOUR_AGENT_TOKEN>`.

You can do the same in the browser under Settings → **Agents & permissions**.

## Next steps

- [Organize notes](how-to/organize-notes.md): nodes, workspaces and the note tree.
- [Connect agents](how-to/connect-agents.md): permission levels and MCP setup.
- [Back up and restore](how-to/back-up-and-restore.md): protect your vault before you rely on it.
