import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
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
- 긴 문서는 read_outline으로 구조를 본 뒤 read_section으로 필요한 부분만 읽으세요.
- 쓰기에는 마지막으로 읽은 hash를 base_hash로 넘깁니다. 다르면 conflict가 나며, 다시 읽고 재시도하세요.
- 여러 문서를 함께 고칠 때는 batch_write로 한 커밋에 묶으세요. 하나라도 실패하면 전부 취소됩니다.`;

export function createMcpServer(scoped: ScopedVault): McpServer {
  const server = new McpServer({ name: "keyring-notes", version: "0.2.0" }, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "whoami",
    { description: "이 토큰의 에이전트 이름과 폴더별 권한 표", annotations: ro },
    () => run(async () => scoped.whoami()),
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

function stripContent<T extends { content: string }>(doc: T): Omit<T, "content"> {
  const { content: _content, ...rest } = doc;
  return rest;
}

/** 요청마다 서버를 새로 만드는 무상태 Streamable HTTP 처리. */
export async function handleMcpRequest(req: Request, scoped: ScopedVault): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createMcpServer(scoped);
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // JSON 응답 모드라 handleRequest가 끝나면 응답 본문이 이미 만들어져 있다.
    void server.close();
  }
}
