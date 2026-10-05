import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Ingestor } from "./ingest.js";
import type { ScopedVault } from "./scoped.js";
import { ConflictError, ForbiddenError, NotFoundError, type Op } from "./vault.js";
import { PathError } from "./paths.js";

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

const INSTRUCTIONS = `Keyring Notes 볼트(마크다운 노트)에 접근하는 도구입니다.
- 이 토큰이 볼 수 있는 경로만 보입니다. whoami로 권한 표를 확인하세요.
- 권한: read < append(새 문서·끝에 덧붙이기) < write(수정) < delete(삭제·이동).
- LLM Wiki 토픽(list_topics의 wiki=true)에서는 먼저 <토픽>/SCHEMA.md를 읽고 그 절차를 따르세요. 시작점은 <토픽>/wiki/index.md(목차·미반영 원본)입니다.
- 긴 문서는 read_outline으로 구조를 본 뒤 read_section으로 필요한 부분만 읽으세요.
- 쓰기에는 마지막으로 읽은 hash를 base_hash로 넘깁니다. 다르면 conflict가 나며, 다시 읽고 재시도하세요.
- search는 3글자 이상 단어를 색인으로 찾고, '#태그' 단어는 태그 조건이 됩니다.
- 검토 대상 폴더에 쓰면 결과에 pending이 붙고 사람이 승인할 때까지 반영되지 않습니다. my_proposals로 결과를 확인하세요.
- 여러 문서를 함께 고칠 때는 batch_write로 한 커밋에 묶으세요. 하나라도 실패하면 전부 취소됩니다.`;

export function createMcpServer(scoped: ScopedVault, ingestor: Ingestor): McpServer {
  const server = new McpServer({ name: "keyring-notes", version: "0.6.0" }, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "whoami",
    { description: "이 토큰의 에이전트 이름과 폴더별 권한 표", annotations: ro },
    () => run(async () => scoped.whoami()),
  );

  server.registerTool(
    "list_topics",
    {
      description: "최상위 폴더(토픽) 목록. wiki=true면 LLM Wiki 토픽(raw/·wiki/·SCHEMA.md)이며 작업 전에 SCHEMA.md를 읽는다",
      annotations: ro,
    },
    () => run(() => scoped.topics()),
  );

  server.registerTool(
    "list_documents",
    {
      description: "읽을 수 있는 마크다운 문서 목록과 각 문서에 대한 권한",
      inputSchema: { folder: z.string().optional().describe("이 폴더 아래만 (예: 업무/wiki)") },
      annotations: ro,
    },
    ({ folder }) => run(() => scoped.documents(folder)),
  );

  server.registerTool(
    "read_outline",
    {
      description: "문서 개요: 해시, 줄 수, 프런트매터, 제목 목록(줄 범위), 위키링크 대상. 본문은 돌려주지 않는다.",
      inputSchema: { path: z.string() },
      annotations: ro,
    },
    ({ path }) => run(() => scoped.outline(path)),
  );

  server.registerTool(
    "read_section",
    {
      description: "문서 일부 읽기. heading(예: '설치 > 요구사항') 또는 start_line/end_line(1부터, 포함)",
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
    { description: "문서 전체 내용과 hash", inputSchema: { path: z.string() }, annotations: ro },
    ({ path }) => run(() => scoped.read(path)),
  );

  server.registerTool(
    "list_frontmatter",
    {
      description: "폴더 안 문서들의 프런트매터를 한 번에 조회(본문 없이)",
      inputSchema: {
        folder: z.string().optional(),
        fields: z.array(z.string()).optional().describe("이 키만 돌려준다"),
      },
      annotations: ro,
    },
    ({ folder, fields }) => run(() => scoped.frontmatterList(folder, fields)),
  );

  server.registerTool(
    "search",
    {
      description: "전체 텍스트 검색. 공백으로 나눈 모든 단어를 포함한 문서와 첫 일치 줄",
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
    { description: "이 문서를 위키링크로 가리키는 문서 목록", inputSchema: { path: z.string() }, annotations: ro },
    ({ path }) => run(() => scoped.backlinks(path)),
  );

  server.registerTool(
    "lint",
    {
      description:
        "구조적 정리 점검: 깨진 링크·출처, 고아 위키 페이지, 출처(sources) 없는 페이지, 프런트매터 누락(title·summary), 오래된 페이지, 인용되지 않은 원본",
      inputSchema: {
        folder: z.string().optional().describe("이 폴더만 (예: 경제)"),
        stale_days: z.number().int().min(1).max(3650).optional().describe("이 일수보다 오래 갱신 안 된 위키 페이지(기본 180)"),
      },
      annotations: ro,
    },
    ({ folder, stale_days }) => run(() => scoped.lint({ folder, staleDays: stale_days })),
  );

  server.registerTool(
    "sources",
    {
      description: "출처 연결: 이 문서의 프런트매터 sources가 가리키는 원본(없거나 볼 수 없으면 path=null), 이 문서를 출처로 인용한 페이지, 본문에서 링크한 페이지",
      inputSchema: { path: z.string() },
      annotations: ro,
    },
    ({ path }) => run(() => scoped.sources(path)),
  );

  server.registerTool(
    "semantic_search",
    {
      description: "의미 검색(임베딩): 단어가 달라도 뜻이 가까운 문서·절. 서버에 임베딩 모델이 설정됐을 때만 쓸 수 있다",
      inputSchema: { query: z.string(), folder: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
      annotations: ro,
    },
    ({ query, folder, limit }) => run(() => scoped.semantic(query, { folder, limit })),
  );

  server.registerTool(
    "list_tags",
    { description: "태그(프런트매터 tags + 본문 #태그)와 문서 수", annotations: ro },
    () => run(() => scoped.tags()),
  );

  server.registerTool(
    "query",
    {
      description:
        "위젯과 같은 YAML 쿼리로 문서를 고른다. 예: \"type: table\\nfrom: 업무\\nwhere: status != done\\nshow: [title, due]\\nsort: due\". type: query|table|tasks|chart",
      inputSchema: { spec: z.string().describe("YAML") },
      annotations: ro,
    },
    ({ spec }) => run(() => scoped.widget(spec)),
  );

  server.registerTool(
    "ingest_url",
    {
      description: "웹 페이지·PDF를 가져와 마크다운으로 바꿔 <topic>/raw/에 원본으로 저장한다(PDF는 raw/assets/에 원본도). raw에 append 권한 필요",
      inputSchema: { topic: z.string(), url: z.string().url(), title: z.string().optional() },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    ({ topic, url, title }) => run(() => ingestor.ingest(scoped, { kind: "url", topic, url, title })),
  );

  server.registerTool(
    "ingest_text",
    {
      description: "이미 가진 텍스트(대화 기록, 메모, 다른 도구로 얻은 문서)를 <topic>/raw/에 원본으로 저장한다",
      inputSchema: { topic: z.string(), title: z.string(), text: z.string(), source_url: z.string().optional() },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ topic, title, text, source_url }) => run(() => ingestor.ingest(scoped, { kind: "text", topic, title, text, url: source_url })),
  );

  server.registerTool(
    "my_proposals",
    {
      description: "내가 올린 변경 제안(검토 대기열)과 처리 결과(pending/approved/rejected, 거절 사유)",
      annotations: ro,
    },
    () => run(() => scoped.myProposals()),
  );

  server.registerTool(
    "write_document",
    {
      description: "문서 전체를 쓴다. 새 문서는 base_hash=null. 기존 문서는 마지막으로 읽은 hash가 필요하다.",
      inputSchema: { path: z.string(), content: z.string(), base_hash: hash.nullable() },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ path, content, base_hash }) => run(() => scoped.write(path, content, base_hash).then(stripContent)),
  );

  server.registerTool(
    "append_document",
    {
      description: "문서 끝에 덧붙인다(없으면 만든다). 추가 전용 권한으로도 쓸 수 있다. base_hash는 선택.",
      inputSchema: { path: z.string(), content: z.string(), base_hash: hash.nullable().optional() },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ path, content, base_hash }) => run(() => scoped.append(path, content, base_hash).then(stripContent)),
  );

  server.registerTool(
    "move_document",
    {
      description: "문서 이동·이름 변경. 원래 위치에 delete 권한이 필요하다.",
      inputSchema: { from: z.string(), to: z.string(), base_hash: hash },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    ({ from, to, base_hash }) => run(() => scoped.move(from, to, base_hash).then(stripContent)),
  );

  server.registerTool(
    "delete_document",
    {
      description: "문서 삭제(이력에는 남는다)",
      inputSchema: { path: z.string(), base_hash: hash },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    ({ path, base_hash }) => run(() => scoped.delete(path, base_hash)),
  );

  server.registerTool(
    "batch_write",
    {
      description:
        "여러 연산(write/append/delete/move)을 하나의 커밋으로. 앞 연산 결과 위에서 차례로 검사되며, 하나라도 실패하면 아무것도 바뀌지 않는다.",
      inputSchema: {
        message: z.string().optional().describe("커밋 메시지"),
        operations: z.array(opSchema).min(1).max(500),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    ({ message, operations }) => run(() => scoped.batch(operations.map(toOp), message)),
  );

  return server;
}

function stripContent<T extends object>(doc: T): Omit<T, "content"> {
  const { content: _content, ...rest } = doc as T & { content?: unknown };
  return rest as Omit<T, "content">;
}

/** 요청마다 서버를 새로 만드는 무상태 Streamable HTTP 처리. */
export async function handleMcpRequest(req: Request, scoped: ScopedVault, ingestor: Ingestor): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createMcpServer(scoped, ingestor);
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // JSON 응답 모드라 handleRequest가 끝나면 응답 본문이 이미 만들어져 있다.
    void server.close();
  }
}
