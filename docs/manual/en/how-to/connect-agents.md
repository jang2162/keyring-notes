# Connect agents

This guide issues a token for an agent, limits what it can see and change, and connects it over MCP or REST.

It is for people who let AI agents read or write their notes.

## Issue a token

In the browser, go to Settings → **Agents & permissions** and create an agent. The token and an MCP config example are shown once.

Or use the CLI:

```bash
pnpm keyring agent add wiki-work
```

With Docker, run `docker compose exec keyring keyring agent add wiki-work`. The token is shown only now. If you lose it, reissue it with `agent rotate`; the old token stops working immediately.

## Grant permissions

A new agent sees nothing. Grant a level per folder or note:

```bash
pnpm keyring agent grant wiki-work Work/raw append
pnpm keyring agent grant wiki-work Work/wiki delete
pnpm keyring agent grant wiki-work Work/SCHEMA.md read
pnpm keyring agent list
```

The levels, from least to most, are `hidden`, `read`, `append`, `write` and `delete`. The most specific rule wins, and paths without a rule are hidden. The full rules, including how node rules and history masking work, are in [Reference](../reference.md#permissions).

Changes to permissions apply from the next request. No restart is needed.

## Connect over MCP

Configure your MCP client with:

- URL: `http://127.0.0.1:8787/mcp` (use your server's address)
- Header: `Authorization: Bearer <YOUR_AGENT_TOKEN>`

The transport is Streamable HTTP (stateless, JSON responses). Tool descriptions and errors follow the server's **Agent language** setting.

The tool list is in [Reference](../reference.md#mcp-tools). Agents can also read `GET /llms.txt`, a short public guide to connecting and the main rules.

## Rules your agent must follow

- **Pass the last hash when writing.** Send the `hash` from the last read as `base_hash` (`null` for a new note). If the note changed since, the write returns `conflict` with `current_hash`, and nothing is written. Read again, merge and retry.
- **Read long notes in parts.** Call `read_outline` first, then `read_section` for the parts you need.
- **Change related notes together.** `batch_write` applies several operations in one commit, all or nothing.
- **Expect review.** Writes into a review-target folder return `pending` until a person approves them. See [Review agent changes](review-agent-changes.md).

Commits made by an agent are recorded with the agent's name as author.

## Use the REST API instead

The same vault is available under `/api/*` with the same token in `Authorization: Bearer <token>`. Every mutating request must be `Content-Type: application/json`. The endpoints are in [Reference](../reference.md#rest-api).

## Next steps

- [Review agent changes](review-agent-changes.md)
- [Build an LLM Wiki](build-an-llm-wiki.md)
