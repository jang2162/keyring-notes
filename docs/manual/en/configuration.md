# Configuration

This page lists every environment variable the server reads and every key the Docker Compose `.env` file takes.

It is for people who run the server. Settings that live in the vault (theme, vault language, daily notes and so on) are in [Customize settings](how-to/customize-settings.md).

## Server environment variables

Set these in the environment of `pnpm start`, or in `.env` when you use Docker Compose. With Docker, only the variables listed in [Which variables reach the container](#which-variables-reach-the-container) are passed in.

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `KEYRING_DATA` | path | (none; `/data` in Docker) | If set, the vault, config and backups go to `<DATA>/vault`, `<DATA>/config/keyring.json` and `<DATA>/backups` |
| `KEYRING_VAULT` | path | `./vault` | Vault folder |
| `KEYRING_CONFIG` | path | `./config/keyring.json` | Password hash, agent token hashes, permission tables and backup settings. Keep it outside the vault |
| `KEYRING_BACKUP_DIR` | path | `./backups` | Backup file folder |
| `KEYRING_INDEX` | path | `<vault>/.keyring/index.db` | Search index. It is a cache: delete it and it is rebuilt on the next start |
| `KEYRING_PLUGINS_DIR` | path | `./plugins` (`/data/plugins` in Docker) | Widget plugin folder |
| `KEYRING_HOST` | address | `127.0.0.1` | Bind address |
| `KEYRING_PORT` | number | `8787` | Port |
| `KEYRING_PUBLIC_URL` | URL | (none) | The https address you reach the server at. Only requests for this host name are accepted, and the login cookie gets `Secure` |
| `KEYRING_ALLOWED_HOSTS` | list | host of `KEYRING_PUBLIC_URL` | Host names to accept, comma-separated. When set, only this list is accepted, so include the host of `KEYRING_PUBLIC_URL` too. `localhost` is always accepted |
| `KEYRING_LANG` | `en` or `ko` | follows `LANG` | Server language: server error text, logs, the CLI, and vault text before a vault language is chosen. A value set in Settings → **Language** → **Server language** takes precedence |
| `KEYRING_UPDATE_URL` | URL | GitHub `releases/latest` | Update check URL. An empty value turns the check off |
| `KEYRING_BACKUP_SCHEDULER` | `0` or `1` | `1` | `0` turns off automatic backups |
| `KEYRING_SCHEDULER` | `0` or `1` | `1` | `0` turns off scheduled jobs (webhooks) |
| `KEYRING_FETCH_ALLOW_PRIVATE` | `0` or `1` | (none) | `1` lets URL collection reach private and loopback addresses, such as an internal wiki. Blocked by default to prevent server-side request forgery (SSRF) |
| `KEYRING_EMBED_URL` | URL | (none) | OpenAI-compatible `/embeddings` URL for semantic search. Needs `KEYRING_EMBED_MODEL` too |
| `KEYRING_EMBED_MODEL` | text | (none) | Embedding model name |
| `KEYRING_EMBED_KEY` | secret | (none) | Embedding API key, sent as `Authorization: Bearer` |
| `KEYRING_S3_BUCKET` | text | (none) | S3-compatible bucket. Setting it, with keys, turns on remote backups |
| `KEYRING_S3_ACCESS_KEY_ID` | secret | (none) | Access key ID. `AWS_ACCESS_KEY_ID` is read too |
| `KEYRING_S3_SECRET_ACCESS_KEY` | secret | (none) | Secret access key. `AWS_SECRET_ACCESS_KEY` is read too |
| `KEYRING_S3_REGION` | text | `us-east-1` | Region. Use `auto` for Cloudflare R2. `AWS_REGION` is read too |
| `KEYRING_S3_ENDPOINT` | URL | AWS S3 | Endpoint of another store such as R2 or MinIO. When set, path-style addressing is used |
| `KEYRING_S3_PATH_STYLE` | `0` or `1` | `1` when `KEYRING_S3_ENDPOINT` is set | Path-style addressing |
| `KEYRING_S3_PREFIX` | text | `keyring/` | Key prefix inside the bucket |
| `KEYRING_S3_BLOBS` | `0` or `1` | `0` | `1` stores large attachments in S3 instead of Git |
| `KEYRING_S3_BLOB_MIN_KB` | number | `256` | Size threshold for `KEYRING_S3_BLOBS`, in KB |
| `KEYRING_S3_ENCRYPTION_KEY` | secret | (none) | If set, backups and attachments are encrypted before upload. Lose it and the encrypted data cannot be opened |
| `KEYRING_S3_ENCRYPTION_KEY_FILE` | path | (none) | Read the encryption key from this file instead. With Docker this is a path inside the container, so put the file under `/data` |

`KEYRING_PASSWORD` is read by the CLI only.

## Docker Compose `.env` keys

`docker-compose.yml` reads these keys from `.env`. Copy `.env.example` to `.env` and edit it.

| Key | Default | Description | Example |
| --- | --- | --- | --- |
| `COMPOSE_FILE` | `docker-compose.yml` | Compose files to layer, joined with `:` | `docker-compose.yml:compose.override.yaml` |
| `KEYRING_BIND` | `127.0.0.1` | Host address the port is published on | `100.64.0.10` |
| `KEYRING_PORT` | `8787` | Host port. Inside the container the server always listens on `8787` | |
| `KEYRING_DATA_DIR` | named volume `keyring-data` | Host folder for the vault, config and backups. Create it first: `sudo install -d -o 1000 -g 1000 <path>` | `/srv/keyring-notes/data` |
| `PROXY_NETWORK` | (none) | External network shared with your reverse proxy, read by the example `compose.override.yaml` | |
| `TZ` | `Asia/Seoul` | Time zone for scheduled jobs and automatic backups | `Europe/Berlin` |
| `COMPOSE_PROFILES` | (none) | `s3` also starts the bundled SeaweedFS | `s3` |
| `SEAWEEDFS_DATA_DIR` | named volume `seaweedfs-data` | Host folder for SeaweedFS data | `/srv/keyring-notes/seaweedfs` |
| `SEAWEEDFS_IMAGE` | `chrislusf/seaweedfs` | SeaweedFS image, to pin a version | |

### Which variables reach the container

Only keys listed under `environment:` in `docker-compose.yml` reach the container:

- `KEYRING_PUBLIC_URL`, `KEYRING_ALLOWED_HOSTS`, `KEYRING_FETCH_ALLOW_PRIVATE`
- every `KEYRING_S3_*` variable in the table above
- `KEYRING_EMBED_URL`, `KEYRING_EMBED_MODEL`, `KEYRING_EMBED_KEY`
- `KEYRING_SCHEDULER`, `KEYRING_BACKUP_SCHEDULER`
- `KEYRING_UPDATE_URL`, `KEYRING_LANG` (passed only when they appear in `.env`, because an empty value means something different from no value)
- `TZ`

The image fixes `KEYRING_DATA`, `KEYRING_HOST` and `KEYRING_PORT`, and the vault, config, backup, plugin and index paths all sit under `/data`.

> [!NOTE]
> Inside the container, `localhost` is the container itself. A `KEYRING_EMBED_URL` that points to a model running on the host needs the host's address instead.

## Next steps

- [Deploy with Docker](how-to/deploy-with-docker.md): put these keys to use on a server.
- [Back up and restore](how-to/back-up-and-restore.md): S3 storage and encryption in detail.
