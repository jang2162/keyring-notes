# Run from source

This guide runs the server straight from a source checkout, without Docker.

It is for people who want to try Keyring Notes on their own computer or open an existing Obsidian vault.

## Requirements

- Node.js 22.13 or later. `mise.toml` pins Node 24.
- pnpm, at the version in the `packageManager` field of `package.json`.

With [mise](https://mise.jdx.dev), `mise install` sets up both versions from `mise.toml`. Without mise, run `corepack enable`.

## Build and start

```bash
pnpm install
pnpm build
pnpm start
```

`pnpm build` builds `packages/core/dist`, `web/dist` and `server/dist`. `pnpm start` serves `http://127.0.0.1:8787` and prints a setup code on the first run:

```text
First run: set a password in the web app with this setup code → 5A85-1933-717B
(or `pnpm keyring passwd`; with Docker, `docker compose exec keyring keyring passwd`)
```

Open the address, enter the code and choose a password. To set the password from the terminal instead, run `pnpm keyring passwd`.

By default the vault, config and backups go to `./vault`, `./config/keyring.json` and `./backups`. Set `KEYRING_DATA` to put all three under one folder. Other variables are in [Configuration](../configuration.md).

## Try it with an Obsidian vault

Make a **copy** so the original vault is untouched.

```bash
cp -R ~/ObsidianVault /tmp/vault-copy
KEYRING_VAULT=/tmp/vault-copy pnpm start
```

On startup, the server records the files already in the vault as one commit by the `system` author. Changes made outside the server later are recorded the same way on the next start.

## Next steps

- [Getting started](../getting-started.md): the first workspace and note.
- [Organize notes](organize-notes.md)
