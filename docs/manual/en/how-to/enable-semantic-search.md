# Enable semantic search

This guide turns on semantic search, which finds notes close in meaning even when they use different words.

It is for people who run the server and have an embedding model, local or hosted.

## Choose an embedding endpoint

Any OpenAI-compatible `/embeddings` endpoint works. Set `KEYRING_EMBED_URL` and `KEYRING_EMBED_MODEL`; semantic search turns on only when both are set.

Local, with Ollama (first run `ollama pull nomic-embed-text`):

```bash
KEYRING_EMBED_URL=http://localhost:11434/v1/embeddings KEYRING_EMBED_MODEL=nomic-embed-text pnpm start
```

OpenAI:

```bash
KEYRING_EMBED_URL=https://api.openai.com/v1/embeddings KEYRING_EMBED_MODEL=text-embedding-3-small KEYRING_EMBED_KEY=<YOUR_API_KEY> pnpm start
```

With Docker, put the same keys in `.env`. Inside the container, `localhost` is the container itself, so use the host's address for a model running on the host.

> [!NOTE]
> With a hosted API, note contents are sent to that service.

## How it works

Notes are split into sections, and their vectors are stored in the index file. Only changed notes are recomputed.

Check the status with `GET /api/semantic/status`. Once it is on, **Semantic** appears next to the search box, and agents can use the MCP tool `semantic_search`.

## Next steps

- [Find notes](find-notes.md)
- [Configuration](../configuration.md)
