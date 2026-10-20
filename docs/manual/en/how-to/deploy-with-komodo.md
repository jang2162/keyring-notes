# Deploy with Komodo

This guide deploys setup A of [Deploy with Docker](deploy-with-docker.md) (behind a reverse proxy) as a Komodo **Git Repo Stack**.

It is for people who already run Komodo and a reverse proxy. The Stack contains no proxy; the app only joins the proxy's external network.

## 1. Create the Stack

| Setting | Value |
| --- | --- |
| Name | Your choice. It becomes the Compose project name, so the named volume is `<Stack name>_keyring-data` |
| Source | Git Repo: `git_provider` `github.com`, `repo` `jang2162/keyring-notes`, `branch` `main`. For a private fork, the `git_account` registered in Komodo |
| File Paths | One per line, in this order: `docker-compose.yml`, `compose.override.yaml`. Do not set `COMPOSE_FILE` |
| Environment | See the next section |
| Webhook | Off. Each push would rebuild on the server and recreate the container, which interrupts open web sessions, app sync and agent batch writes. Deploy by hand |

The Compose file sets no `container_name`, so names do not clash with other Stacks on the same server. Each **Deploy** builds the image from the cloned code.

## 2. Fill in Environment

Komodo writes Environment to `.env`, which fills the `${VAR}` values in the Compose file. All keys are in [Configuration](../configuration.md), with examples in `.env.example`.

| Key | Required | Notes |
| --- | --- | --- |
| `KEYRING_PUBLIC_URL` | yes | The https address people use |
| `PROXY_NETWORK` | yes | Read by `compose.override.yaml`. The external network shared with your proxy |
| `KEYRING_DATA_DIR` | recommended | Host folder for the vault, config and backups. Create it first: `sudo install -d -o 1000 -g 1000 <path>`. Empty means a named volume |
| `KEYRING_ALLOWED_HOSTS`, `KEYRING_FETCH_ALLOW_PRIVATE`, `TZ` | no | |
| `KEYRING_S3_*` | no | Use your own S3, or add `COMPOSE_PROFILES=s3` to run the bundled SeaweedFS (see [Deploy with Docker](deploy-with-docker.md#3-choose-s3-storage-optional)). If `seaweedfs` does not start, check the profile and service selection in the Stack settings |
| `SEAWEEDFS_DATA_DIR` | no | Host folder for SeaweedFS data. Create it first. Empty means the named volume `<Stack name>_seaweedfs-data` |
| `KEYRING_S3_ACCESS_KEY_ID`, `KEYRING_S3_SECRET_ACCESS_KEY`, `KEYRING_S3_ENCRYPTION_KEY` | no (secret) | Register them as secret Komodo **Variables** and reference them, for example `KEYRING_S3_SECRET_ACCESS_KEY=[[KEYRING_S3_SECRET_ACCESS_KEY]]` |

After you change Environment, deploy again. A running container keeps the environment it was started with.

## 3. Write the override file on the server

Komodo has no UI for override files. Write `compose.override.yaml` on the host, in the folder where Periphery cloned the Stack (`{stack_dir}/{Stack name}/`). Find the host path by checking where Periphery's `root_directory` (default `/etc/komodo`) is bind-mounted in the Periphery container definition. If it is not bind-mounted, ask your server administrator.

The content is the same as in [Setup A](deploy-with-docker.md#setup-a-behind-a-reverse-proxy): it closes the host port with `ports: !reset []` and joins the proxy network as `external: true`.

1. Write the file, then check the result on the server:

   ```bash
   docker compose -f docker-compose.yml -f compose.override.yaml config
   ```

2. Click **Deploy** in Komodo.

> [!WARNING]
> A new clone deletes the file. Deleting and recreating the Stack, or changing its name, repository or branch, removes `compose.override.yaml`, and the deploy fails because a File Paths entry is missing. After such a change, write the file again first.

- The repository ignores `/compose.override.yaml`. Do not commit a file with that name.
- The proxy's external network must exist before you deploy, or `up` fails.

## Next steps

- [Manage the server](manage-the-server.md)
- [Back up and restore](back-up-and-restore.md)
