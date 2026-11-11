# Run your own marketplace

This guide runs a marketplace repository with Docker and adds it to Keyring Notes.

It is for people who share their own widgets, themes or languages, publicly or on a home network.

> [!NOTE]
> To install packages from your repository in the app, see [Install packages](install-packages.md).

To make the packages themselves, see [Publish marketplace packages](publish-packages.md).

## Choose how to host

A repository is a folder of static files, so you have two choices:

- **Any static host.** Run `pkg index` on your folder and upload it. See [Host the repository](publish-packages.md#host-the-repository).
- **The marketplace server image.** It rebuilds `index.json` by itself and serves the files with the right headers. The rest of this guide uses it.

## Requirements

- Docker with Compose v2 and BuildKit (`docker buildx`), the same as for [Deploy with Docker](deploy-with-docker.md).
- A clone of this repository. The image is built from the source.

## Start the server

1. Put your packages in a folder laid out as `packages/<scope>/<name>/<version>/`.

2. Copy the example settings and open the file:

   ```bash
   cp marketplace/.env.example marketplace/.env
   ```

3. Create `marketplace/compose.override.yaml` and mount your folder over the built-in packages:

   ```yaml
   services:
     market:
       volumes:
         - /srv/my-market/packages:/srv/market/packages:ro
   ```

4. Start the server:

   ```bash
   docker compose -f marketplace/compose.yaml up -d --build
   ```

5. Open `http://127.0.0.1:8080/index.json`. It lists your packages.

The server rebuilds `index.json` when it starts and every `MARKET_REBUILD_SECONDS` seconds, so new versions appear without a restart. If a package is invalid, the server keeps the last good `index.json` and prints the reason in `docker compose -f marketplace/compose.yaml logs market`.

The repository ignores `marketplace/.env` and `marketplace/compose.override.yaml`.

## Put it behind HTTPS

Keyring Notes downloads only from `https:` repositories. Plain `http:` and private network addresses work only when the Keyring Notes server operator allows them with `KEYRING_MARKET_ALLOW_HTTP` and `KEYRING_MARKET_ALLOW_PRIVATE` (see [Configuration](../configuration.md)), or on a desktop app that allows them on that device.

Put the marketplace server behind the same kind of reverse proxy as Keyring Notes itself, as in [Setup A](deploy-with-docker.md#setup-a-behind-a-reverse-proxy). In `marketplace/compose.override.yaml`, close the host port and join the proxy network:

```yaml
services:
  market:
    ports: !reset []
    networks: [proxy]
networks:
  proxy:
    external: true
    name: your-proxy-network
```

Point a host name at the `market` service on port `8080`. Do not let the proxy compress responses: Keyring Notes refuses compressed packages.

## Add it in Keyring Notes

Add the repository address to `marketplace.repos` in the [shared settings file](../reference.md#shared-settings-file). Keep the official repository first if you still want it:

```yaml
marketplace:
  repos:
    - url: https://keyring-notes-marketplace.develma.com/
    - url: https://market.example.com/
```

Repositories higher in the list win when two have the same package id.

## Next steps

- [Publish marketplace packages](publish-packages.md)
- [Configuration](../configuration.md#marketplace-server)
