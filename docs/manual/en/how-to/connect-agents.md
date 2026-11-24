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

The levels, from least to most, are `hidden`, `read`, `append`, `write`, `delete` and `issue`. The most specific rule wins, and paths without a rule are hidden. The full rules, including how node rules and history masking work, are in [Reference](../reference.md#permissions).

Changes to permissions apply from the next request. No restart is needed.

## Let an agent issue tokens

An agent with `issue` on a folder can create tokens for other agents under that folder, so it can hand work to them without you. Grant it the level:

```bash
pnpm keyring agent grant lead Work issue
```

In the admin console, pick **Write, delete & issue** for the rule.

The agent then calls MCP `issue_token` (or REST `POST /api/tokens`) with a name and rules:

```json
{ "name": "drafts", "rules": { "Work/Drafts": "write" } }
```

This creates the agent `lead-drafts` and returns its token and an MCP config once. The limits:

- Rule paths must be under a path where the issuer has `issue`.
- Levels must be `delete` or lower, and no higher than the issuer's own level on that path.
- An issued token cannot have `issue` itself.
- An existing agent with the same name is never replaced.

The issued token stays tied to its issuer:

- Its real permission is capped on every request by the issuer's current permission (at most `delete`). If you narrow the issuer, its issued tokens narrow too.
- If you delete the issuer, its issued tokens are deleted with it. The admin console lists them in the confirmation before you delete. `agent remove` prints their names after the delete.
- `whoami` for an issued token shows its own rules and `issuedBy`. Its real permission is narrowed again by the issuer's current permission.

The issuer can list (`list_issued_tokens`), reissue (`rotate_issued_token`) and delete (`revoke_issued_token`) only the tokens it issued. It cannot change their rules. You can see and delete issued tokens in **Agents & permissions**, where they are grouped under their issuer, and with `agent list` and `agent remove`. The full rules are in [Reference](../reference.md#issued-tokens).

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
