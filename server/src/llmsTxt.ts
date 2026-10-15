/**
 * GET /llms.txt: 이 앱을 쓰려는 LLM 에이전트에게 주는 정적 안내(llms.txt 관례).
 * 인증 없이 열리므로 볼트 내용·설정·토큰 등 이 서버의 상태는 절대 넣지 않는다. 바뀌는 것은 주소 접두(base)뿐이다.
 * 사람이 읽는 언어와 무관하게 영어로 쓴다(에이전트 글의 기본 언어와 같다).
 */
const DOCS = "https://github.com/jang2162/keyring-notes#readme";

/** base: KEYRING_PUBLIC_URL(끝 슬래시 없음). 없으면 상대 경로로 적는다. */
export function llmsTxt(base = ""): string {
  return `# Keyring Notes

> A self-hosted notes app whose source of truth is plain Markdown files in a Git-backed vault. People edit in the browser; agents (you) get in through per-folder permission tokens over MCP or a REST API.

Notes form a tree of nodes: a node "A" is the note \`A.md\` plus its children under \`A/\`. Top-level nodes are workspaces. A workspace child that contains \`SCHEMA.md\` is an LLM Wiki topic (\`raw/\` sources, \`wiki/\` pages maintained by agents).

## Connect

- [MCP endpoint](${base}/mcp): Streamable HTTP (stateless, JSON responses). Send \`Authorization: Bearer <agent token>\`.
- [REST API](${base}/api/whoami): the same vault over HTTP under \`/api/*\`. Send \`Authorization: Bearer <agent token>\` and, for every POST/PUT/DELETE, \`Content-Type: application/json\`.
- [Health check](${base}/api/health): no authentication.

Agent tokens are issued by the vault owner (admin console, or \`keyring agent add <name>\` on the server). The token is shown once. This page is public and static; it holds no vault data.

## Permissions

Each token has a per-path permission table: \`hidden\` < \`read\` < \`append\` < \`write\` < \`delete\`.

- \`read\`: read, search, view history. \`append\`: also create new notes and append to the end of existing ones. \`write\`: also edit and roll back. \`delete\`: also delete and move.
- Paths without a rule are \`hidden\`: they do not show up in lists, search, links or history, and reads fail as "not found".
- The most specific (longest) path rule wins. A rule on \`Work/Project\` covers \`Work/Project/…\` and the node note \`Work/Project.md\`.
- A wiki topic's \`SCHEMA.md\` and the vault's \`keyring-settings.md\` are read-only for agents.
- Call \`whoami\` (MCP) or \`GET /api/whoami\` first to see your table.

## Main tasks

- Read: \`list_children\`, \`list_topics\`, \`list_documents\`, \`read_outline\`, \`read_section\`, \`read_document\`, \`list_frontmatter\` (REST: \`GET /api/tree\`, \`/api/file?path=\`, \`/api/outline\`, \`/api/section\`, \`/api/frontmatter\`).
- Search and relations: \`search\` (words of 3+ characters; a \`#tag\` word is a tag filter), \`semantic_search\` (only when the server has an embedding model), \`backlinks\`, \`unlinked_mentions\`, \`list_tags\`, \`sources\`, \`query\` (YAML queries, as in widgets).
- Write: \`write_document\`, \`append_document\`, \`move_document\` (updates links to the note in the same commit), \`delete_document\`, \`batch_write\` (several operations in one commit; all or nothing). REST: \`PUT /api/file\`, \`POST /api/append\`, \`POST /api/move\`, \`DELETE /api/file\`, \`POST /api/batch\`.
- Collect sources: \`ingest_url\` (web page or PDF) and \`ingest_text\` save a source under \`<topic>/raw/\` (needs \`append\` there). REST: \`POST /api/ingest\`.
- Check structure: \`lint\` (broken links, orphan wiki pages, pages without sources, stale pages).
- Review queue: writes under folders the owner marked for review return \`pending\` and the vault is unchanged until a person approves. Check the outcome with \`my_proposals\`.

## Rules to follow

- Optimistic concurrency: pass the \`hash\` you last read as \`base_hash\` (REST: \`baseHash\`) when you write; use \`null\` for a new note. On a mismatch you get 409 / \`conflict\` with the current hash (\`current_hash\` in MCP, \`currentHash\` in REST) and nothing is written. Read again, merge, retry.
- For long notes, read \`read_outline\` first and then only the sections you need.
- In a wiki topic, read \`<topic>/SCHEMA.md\` first and follow it; start from \`<topic>/wiki/index.md\`.
- Prefer \`batch_write\` when several notes must change together.
- Errors carry a language-independent \`code\`: 401 not authenticated, 403 forbidden, 404 not found (also for hidden paths), 409 conflict.
- Your commits are recorded with your agent name as author. Commits that touch paths you cannot see have their messages masked in history.

## Docs

- [README](${DOCS}): installation, permission model, the full MCP tool list and REST API table, LLM Wiki layout, review queue, webhooks.
`;
}
