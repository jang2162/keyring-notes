# Deploy with Docker

This guide runs Keyring Notes on a server with Docker Compose and makes it reachable from your other devices.

It is for people who host the server. For a first local try, [Getting started](../getting-started.md) is shorter.

## How the Compose setup works

- `docker-compose.yml` has the app (`keyring`) and an optional SeaweedFS service under the `s3` profile. The SeaweedFS service is off by default.
- The image is built on your server from the repository code (`pull_policy: build`). There is no registry image.
- The repository ships no web server or reverse proxy. Bring your own (nginx, Traefik, Caddy and so on).
- Settings go in `.env`. Server-only changes to the Compose file go in `compose.override.yaml`, which Git ignores.

Requirements: Docker with Compose v2 and BuildKit. The override example below uses `!reset`, which needs Docker Compose 2.24.4 or later (`docker compose version`).

## 1. Choose how you reach the server

By default the port is published on `127.0.0.1` only. Pick one setup.

| Setup | Compose files, in this order | Required keys |
| --- | --- | --- |
| **A. Behind an HTTPS reverse proxy** | `docker-compose.yml`, `compose.override.yaml` | `KEYRING_PUBLIC_URL` |
| **B. This machine or a VPN only** | `docker-compose.yml` | none (on a VPN: `KEYRING_BIND`, `KEYRING_ALLOWED_HOSTS`) |

### Setup A: behind a reverse proxy

Write `compose.override.yaml` on the server. It closes the host port and joins the proxy's network. `ports` and `networks` are merged with the base file, so the example replaces them with `!reset` and `!override`.

```yaml
services:
  keyring:
    ports: !reset []            # close the host port; reach the app through the proxy only
    networks: !override
      - default
      - proxy

networks:
  proxy:
    name: ${PROXY_NETWORK:?PROXY_NETWORK is required}
    external: true              # the proxy's network; it must already exist on the server
```

Then:

1. Check that the proxy's network exists with `docker network ls`.
2. Set the file order in `.env`, so `docker compose up -d` reads both files without `-f`:

   ```bash
   COMPOSE_FILE=docker-compose.yml:compose.override.yaml
   ```

3. Check the merged result with `docker compose config`. The `keyring` service must have no `ports` and two networks, `default` and the proxy's.
4. In your proxy, forward to `keyring:8787` and pass `Host` through unchanged. The server rejects host names it does not accept with 421. Also send `X-Forwarded-Proto: https`, because the login cookie's `Secure` flag and passkey checks depend on it.

### Setup B: this machine or a VPN

Keep the default port binding. For a VPN such as Tailscale, set these in `.env`:

```bash
KEYRING_BIND=<VPN address>
KEYRING_ALLOWED_HOSTS=<VPN address or host name>
```

With Tailscale you can also add HTTPS inside the tailnet with `tailscale serve --bg 8787`.

## 2. Fill in `.env`

```bash
cp .env.example .env
```

Edit `.env`. Do not commit it. Every key is listed in [Configuration](../configuration.md). The ones most servers set:

- `KEYRING_PUBLIC_URL`: the https address people use. Only this host name is accepted (DNS rebinding protection), and the login cookie gets `Secure`.
- `KEYRING_DATA_DIR`: a host folder for the vault, config and backups. Without it, a named volume is used. Create the folder first, or Docker creates it owned by root and the app cannot write to it:

  ```bash
  sudo install -d -o 1000 -g 1000 /srv/keyring-notes/data
  ```

- `TZ`: the time zone for scheduled jobs and automatic backups.

Every page is served with security headers such as a Content Security Policy and `X-Frame-Options: DENY`.

## 3. Choose S3 storage (optional)

S3-compatible storage keeps backups off the server and can hold large attachments. See [Back up and restore](back-up-and-restore.md) for what it does. Pick one way to provide it.

| Way | What to do |
| --- | --- |
| **Use an S3 you already have** | Set `KEYRING_S3_BUCKET`, `KEYRING_S3_ACCESS_KEY_ID` and `KEYRING_S3_SECRET_ACCESS_KEY`. For AWS, add `KEYRING_S3_REGION`. For R2, MinIO and others, add `KEYRING_S3_ENDPOINT` too |
| **Run the bundled SeaweedFS** | Set `COMPOSE_PROFILES=s3`, `KEYRING_S3_ENDPOINT=http://seaweedfs:8333`, `KEYRING_S3_PATH_STYLE=1`, a bucket name, and a key ID and secret (long random values). They become the SeaweedFS S3 account, and SeaweedFS creates the bucket. Its port is not published on the host |

With the `s3` profile on, if the key ID, secret or bucket name is empty, the `seaweedfs` container logs the reason and exits. Without that check SeaweedFS would start with no authentication. Do not turn the profile on when you use your own S3.

## 4. Start the server

```bash
docker compose config            # the merged result of the files you chose
docker compose up -d             # build the image from the repository and start it
docker compose logs keyring      # shows the setup code on the first run
```

Open the server in a browser, then enter the setup code and a new password. The admin CLI runs inside the container, for example `docker compose exec keyring keyring agent list`.

## 5. Update

Settings → **Updates** tells you when a new release is out. Make a backup in Settings → **Backup & restore** first, then:

```bash
git pull && docker compose up -d --build
```

While the container restarts, saves from open web sessions, app sync and agent batch writes are interrupted. Update when nobody is writing.

When you build behind a proxy that re-signs TLS, such as a corporate proxy, pass its CA certificate as a build secret. It is not kept in the image.

```bash
docker build --secret id=extra_ca,src=<CA.pem> .
```

## Where the data lives

The vault, config and backups are all in `/data` inside the container: the named volume `<project>_keyring-data` by default, or the `KEYRING_DATA_DIR` folder. To move from the named volume to a host folder, download a backup, set `KEYRING_DATA_DIR`, start again and restore the backup in Settings → **Backup & restore**.

## Next steps

- [Deploy with Komodo](deploy-with-komodo.md): the same setup as a Komodo Stack.
- [Manage the server](manage-the-server.md): the admin console, passwords and passkeys.
- [Troubleshooting](../troubleshooting.md)
