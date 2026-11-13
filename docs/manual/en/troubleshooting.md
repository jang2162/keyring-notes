# Troubleshooting

This page lists problems people have run into, with the cause and the fix for each.

It is for people installing or running the server, and for people writing notes in the app.

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

## A note shows "This note could not be displayed" instead of its preview

**Symptom.** In **Preview** or **Side by side**, the preview of one note is replaced by this message, a **Try again** button, and the text of the note as you wrote it:

```text
This note could not be displayed. Its text is shown below as written.
```

The editor, the other tabs, and the sidebar keep working. The same message can appear when you preview a deleted note in **Trash**. In **Edit** with Live Preview on, a block that cannot be drawn stays as plain text.

**Cause.** Something in the text of the note made the preview fail while it was being drawn. The note is not damaged, and your unsaved changes are kept.

**Fix.**

1. Switch the note to **Edit**.
2. Change or remove the part you added last, or a part that looks unusual, such as a broken link or raw HTML. The preview is drawn again when the text changes.
3. If the text looks correct, select **Try again**. If it still fails, open the browser console and copy the line that starts with `keyring: note render failed`. Include that line and the text of the note when you report the problem.

## Next steps

- [Getting started](getting-started.md)
- [Deploy with Docker](how-to/deploy-with-docker.md)
