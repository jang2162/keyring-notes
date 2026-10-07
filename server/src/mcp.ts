import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Ingestor } from "./ingest.js";
import type { ScopedVault } from "./scoped.js";
import { ConflictError, ForbiddenError, NotFoundError, type Op } from "./vault.js";
import { PathError } from "./paths.js";
import { agentText, type AgentLang } from "./agentText.js";

const hash = z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex");

const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("write"), path: z.string(), content: z.string(), base_hash: hash.nullable() }),
  z.object({ op: z.literal("append"), path: z.string(), content: z.string(), base_hash: hash.nullable().optional() }),
  z.object({ op: z.literal("delete"), path: z.string(), base_hash: hash }),
  z.object({ op: z.literal("move"), from: z.string(), to: z.string(), base_hash: hash }),
]);

function toOp(o: z.infer<typeof opSchema>): Op {
  switch (o.op) {
    case "write":
      return { op: "write", path: o.path, content: o.content, baseHash: o.base_hash };
    case "append":
      return { op: "append", path: o.path, content: o.content, baseHash: o.base_hash };
    case "delete":
      return { op: "delete", path: o.path, baseHash: o.base_hash };
    case "move":
      return { op: "move", from: o.from, to: o.to, baseHash: o.base_hash };
  }
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
  } catch (e) {
    let code = "error";
    let extra: Record<string, unknown> = {};
    if (e instanceof ConflictError) {
      code = "conflict";
      extra = { current_hash: e.currentHash };
    } else if (e instanceof NotFoundError) code = "not_found";
    else if (e instanceof ForbiddenError) code = "forbidden";
    else if (e instanceof PathError) code = "bad_request";
    else console.error(e);
    const message = e instanceof Error && code !== "error" ? e.message : "서버 오류";
    return { content: [{ type: "text", text: JSON.stringify({ error: code, message, ...extra }) }], isError: true };
  }
}

/** 에이전트 언어(서버 설정, 기본 영어)로 안내·도구 설명을 쓴다 */
export function createMcpServer(scoped: ScopedVault, ingestor: Ingestor, lang: AgentLang = "en"): McpServer {
  const T = agentText(lang);
  const server = new McpServer({ name: "keyring-notes", version: "0.7.0" }, { instructions: T.instructions });
  const ro = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "whoami",
    { description: T.tools.whoami, annotations: ro },
    () => run(async () => scoped.whoami()),
  );

  server.registerTool(
    "list_topics",
    {
      description: T.tools.list_topics,
      annotations: ro,
    },
    () => run(() => scoped.topics()),
  );

  server.registerTool(
    "list_children",
    {
      description: T.tools.list_children,
      inputSchema: { path: z.string().optional().describe(T.params.childrenPath) },
      annotations: ro,
    },
    ({ path }) => run(() => scoped.children(path || undefined)),
  );

  server.registerTool(
    "list_documents",
    {
      description: T.tools.list_documents,
      inputSchema: { folder: z.string().optional().describe(T.params.folder) },
      annotations: ro,
    },
    ({ folder }) => run(() => scoped.documents(folder)),
  );

  server.registerTool(
    "read_outline",
    {
      description: T.tools.read_outline,
      inputSchema: { path: z.string() },
      annotations: ro,
    },
    ({ path }) => run(() => scoped.outline(path)),
  );

  server.registerTool(
    "read_section",
    {
      description: T.tools.read_section,
      inputSchema: {
        path: z.string(),
        heading: z.string().optional(),
        start_line: z.number().int().positive().optional(),
        end_line: z.number().int().positive().optional(),
      },
      annotations: ro,
    },
    ({ path, heading, start_line, end_line }) =>
      run(() => scoped.section(path, { heading, startLine: start_line, endLine: end_line })),
  );

  server.registerTool(
    "read_document",
    { description: T.tools.read_document, inputSchema: { path: z.string() }, annotations: ro },
    ({ path }) => run(() => scoped.read(path)),
  );

  server.registerTool(
    "list_frontmatter",
    {
      description: T.tools.list_frontmatter,
      inputSchema: {
        folder: z.string().optional(),
        fields: z.array(z.string()).optional().describe(T.params.fields),
      },
      annotations: ro,
    },
    ({ folder, fields }) => run(() => scoped.frontmatterList(folder, fields)),
  );

  server.registerTool(
    "search",
    {
      description: T.tools.search,
      inputSchema: {
        query: z.string(),
        folder: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: ro,
    },
    ({ query, folder, limit }) => run(() => scoped.search(query, { folder, limit })),
  );

  server.registerTool(
    "backlinks",
    { description: T.tools.backlinks, inputSchema: { path: z.string() }, annotations: ro },
    ({ path }) => run(() => scoped.backlinks(path)),
  );

  server.registerTool(
    "unlinked_mentions",
    {
      description: T.tools.unlinked_mentions,
      inputSchema: { path: z.string() },
      annotations: ro,
    },
    ({ path }) => run(() => scoped.mentions(path)),
  );

  server.registerTool(
    "lint",
    {
      description: T.tools.lint,
      inputSchema: {
        folder: z.string().optional().describe(T.params.lintFolder),
        stale_days: z.number().int().min(1).max(3650).optional().describe(T.params.staleDays),
      },
      annotations: ro,
    },
    // 정리 점검 설명(detail)은 에이전트 언어로 붙인다
    ({ folder, stale_days }) => run(async () => {
      const r = await scoped.lint({ folder, staleDays: stale_days });
      return { ...r, issues: r.issues.map((i) => ({ ...i, detail: T.lint(i) })) };
    }),
  );

  server.registerTool(
    "sources",
    {
      description: T.tools.sources,
      inputSchema: { path: z.string() },
      annotations: ro,
    },
    ({ path }) => run(() => scoped.sources(path)),
  );

  server.registerTool(
    "semantic_search",
    {
      description: T.tools.semantic_search,
      inputSchema: { query: z.string(), folder: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
      annotations: ro,
    },
    ({ query, folder, limit }) => run(() => scoped.semantic(query, { folder, limit })),
  );

  server.registerTool(
    "list_tags",
    { description: T.tools.list_tags, annotations: ro },
    () => run(() => scoped.tags()),
  );

  server.registerTool(
    "query",
    {
      description: T.tools.query,
      inputSchema: { spec: z.string().describe(T.params.spec) },
      annotations: ro,
    },
    ({ spec }) => run(() => scoped.widget(spec)),
  );

  server.registerTool(
    "ingest_url",
    {
      description: T.tools.ingest_url,
      inputSchema: { topic: z.string(), url: z.string().url(), title: z.string().optional() },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    ({ topic, url, title }) => run(() => ingestor.ingest(scoped, { kind: "url", topic, url, title })),
  );

  server.registerTool(
    "ingest_text",
    {
      description: T.tools.ingest_text,
      inputSchema: { topic: z.string(), title: z.string(), text: z.string(), source_url: z.string().optional() },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ topic, title, text, source_url }) => run(() => ingestor.ingest(scoped, { kind: "text", topic, title, text, url: source_url })),
  );

  server.registerTool(
    "my_proposals",
    {
      description: T.tools.my_proposals,
      annotations: ro,
    },
    () => run(() => scoped.myProposals()),
  );

  server.registerTool(
    "write_document",
    {
      description: T.tools.write_document,
      inputSchema: { path: z.string(), content: z.string(), base_hash: hash.nullable() },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ path, content, base_hash }) => run(() => scoped.write(path, content, base_hash).then(stripContent)),
  );

  server.registerTool(
    "append_document",
    {
      description: T.tools.append_document,
      inputSchema: { path: z.string(), content: z.string(), base_hash: hash.nullable().optional() },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ path, content, base_hash }) => run(() => scoped.append(path, content, base_hash).then(stripContent)),
  );

  server.registerTool(
    "move_document",
    {
      description: T.tools.move_document,
      inputSchema: { from: z.string(), to: z.string(), base_hash: hash, update_links: z.boolean().optional().describe(T.params.updateLinks) },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    ({ from, to, base_hash, update_links }) => run(() => scoped.move(from, to, base_hash, { updateLinks: update_links }).then(stripContent)),
  );

  server.registerTool(
    "delete_document",
    {
      description: T.tools.delete_document,
      inputSchema: { path: z.string(), base_hash: hash },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    ({ path, base_hash }) => run(() => scoped.delete(path, base_hash)),
  );

  server.registerTool(
    "batch_write",
    {
      description: T.tools.batch_write,
      inputSchema: {
        message: z.string().optional().describe(T.params.message),
        operations: z.array(opSchema).min(1).max(500),
        update_links: z.boolean().optional().describe(T.params.updateLinks),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    ({ message, operations, update_links }) => run(() => scoped.batch(operations.map(toOp), message, { updateLinks: update_links })),
  );

  return server;
}

function stripContent<T extends object>(doc: T): Omit<T, "content"> {
  const { content: _content, ...rest } = doc as T & { content?: unknown };
  return rest as Omit<T, "content">;
}

/** 요청마다 서버를 새로 만드는 무상태 Streamable HTTP 처리. */
export async function handleMcpRequest(req: Request, scoped: ScopedVault, ingestor: Ingestor, lang: AgentLang = "en"): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createMcpServer(scoped, ingestor, lang);
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // JSON 응답 모드라 handleRequest가 끝나면 응답 본문이 이미 만들어져 있다.
    void server.close();
  }
}
