# Troubleshooting

This page lists problems people have run into, with the cause and the fix for each.

It is for people installing or running the server.

## `docker compose up --build` fails with "the --mount option requires BuildKit"

**Symptom.** The build stops at a `RUN --mount=type=secret,…` step:

```text
the --mount option requires BuildKit. Refer to https://docs.docker.com/go/buildkit/ to learn how to build images with BuildKit enabled
```

**Cause.** The Dockerfile uses BuildKit features, and your Docker CLI has no buildx plugin, so it falls back to the legacy builder. Setting `DOCKER_BUILDKIT=1` does not help without the plugin. This happens, for example, with the Homebrew `docker` CLI and Colima, which do not install buildx.

**Fix.**

1. Install the Docker buildx plugin for your platform. Docker Desktop already includes it.
2. Check that the plugin is found:

   ```bash
   docker buildx version
   ```

   The command prints a version such as `github.com/docker/buildx v0.38.0`. If it says `unknown command`, the plugin is not in a folder the Docker CLI searches.

3. Run `docker compose up -d --build` again.

## Next steps

- [Getting started](getting-started.md)
- [Deploy with Docker](how-to/deploy-with-docker.md)
