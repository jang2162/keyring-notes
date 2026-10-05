import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Principal } from "./access.js";
import { SESSION_COOKIE, type ConfigStore } from "./config.js";
import { handleMcpRequest } from "./mcp.js";
import type { Ingestor } from "./ingest.js";
import type { NoteIndex } from "./noteindex.js";
import type { Wiki } from "./wiki.js";
import { PathError } from "./paths.js";
import { ScopedVault } from "./scoped.js";
import { ConflictError, ForbiddenError, NotFoundError, type Op, type Vault } from "./vault.js";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
};

export interface AppOptions {
  vault: Vault;
  index: NoteIndex;
  config: ConfigStore;
  wiki: Wiki;
  ingestor: Ingestor;
}

type Env = { Variables: { scoped: ScopedVault } };

function requirePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new PathError("path가 필요합니다");
  return value;
}

function optionalHash(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new PathError("baseHash 형식이 잘못되었습니다");
  return value;
}

function requireHash(value: unknown): string {
  const h = optionalHash(value);
  if (h === null) throw new PathError("baseHash가 필요합니다");
  return h;
}

function bearer(c: Context): string | undefined {
  const h = c.req.header("authorization");
  const m = h && /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : undefined;
}

function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
}

/** 로그인 실패가 이어지면 응답을 늦춰 비밀번호 대입을 어렵게 한다. */
class LoginThrottle {
  private failures = 0;
  private last = 0;
  delayMs(now = Date.now()): number {
    if (now - this.last > 15 * 60_000) this.failures = 0;
    return Math.min(30_000, this.failures === 0 ? 0 : 500 * 2 ** (this.failures - 1));
  }
  fail() {
    this.failures++;
    this.last = Date.now();
  }
  reset() {
    this.failures = 0;
  }
}

export function createApp({ vault, index, config, wiki, ingestor }: AppOptions) {
  const app = new Hono<Env>();
  const throttle = new LoginThrottle();

  app.onError((err, c) => {
    if (err instanceof ConflictError) {
      return c.json({ error: "conflict", message: err.message, currentHash: err.currentHash }, 409);
    }
    if (err instanceof NotFoundError) return c.json({ error: "not_found", message: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: "forbidden", message: err.message }, 403);
    if (err instanceof PathError) return c.json({ error: "bad_request", message: err.message }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "bad_request", message: "JSON 본문이 잘못되었습니다" }, 400);
    console.error(err);
    return c.json({ error: "internal", message: "서버 오류" }, 500);
  });

  /** 요청한 쪽: 에이전트 토큰(Authorization: Bearer) 또는 소유자 로그인 쿠키. */
  const principalOf = (c: Context): Principal | null => {
    const token = bearer(c);
    if (token !== undefined) return config.agentByToken(token);
    if (config.verifySession(getCookie(c, SESSION_COOKIE))) return config.ownerPrincipal();
    return null;
  };

  // ── MCP: 에이전트 토큰만 받는다 ──
  app.all("/mcp", async (c) => {
    const principal = config.agentByToken(bearer(c));
    if (!principal) {
      return c.json({ error: "unauthorized", message: "에이전트 토큰이 필요합니다" }, 401, {
        "www-authenticate": 'Bearer realm="keyring-notes"',
      });
    }
    return handleMcpRequest(c.req.raw, new ScopedVault(vault, principal, index, wiki), ingestor);
  });

  const api = new Hono<Env>();

  // 변경 요청은 JSON만 받는다. 다른 사이트의 단순 폼 전송(CSRF)이 preflight 없이 닿는 것을 막는다.
  // 파일 업로드는 원본 바이트를 받되, 사용자 정의 헤더(x-keyring-upload)를 요구해 같은 효과를 낸다.
  api.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const ct = c.req.header("content-type") ?? "";
      const upload = c.req.path === "/api/ingest/file" && c.req.header("x-keyring-upload") === "1";
      if (!upload && !ct.toLowerCase().startsWith("application/json")) {
        return c.json({ error: "bad_request", message: "Content-Type: application/json 이 필요합니다" }, 415);
      }
    }
    await next();
  });
  api.use("*", async (c, next) => {
    // 업로드·웹 클립(페이지 HTML 전체)은 크게, 나머지는 10MB까지
    const max = c.req.path === "/api/ingest/file" ? 50 : c.req.path === "/api/ingest" ? 25 : 10;
    return bodyLimit({ maxSize: max * 1024 * 1024 })(c, next);
  });

  // ── 로그인 ──
  api.get("/auth/status", (c) => {
    const p = principalOf(c);
    return c.json({
      authenticated: p !== null,
      principal: p ? { name: p.name, kind: p.kind } : null,
      passwordSet: config.get().owner.passwordHash !== null,
    });
  });

  api.post("/auth/login", async (c) => {
    const { password } = await c.req.json();
    const wait = throttle.delayMs();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (typeof password !== "string" || !config.checkPassword(password)) {
      throttle.fail();
      return c.json({ error: "unauthorized", message: "비밀번호가 맞지 않습니다" }, 401);
    }
    throttle.reset();
    const s = config.issueSession();
    setCookie(c, SESSION_COOKIE, s.value, {
      httpOnly: true,
      sameSite: "Strict",
      secure: isHttps(c),
      path: "/",
      maxAge: s.maxAge,
    });
    return c.json({ ok: true });
  });

  api.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // ── 여기부터는 인증 필요. 모든 경로가 ScopedVault(권한 계층)를 지난다 ──
  api.use("*", async (c, next) => {
    const p = principalOf(c);
    if (!p) return c.json({ error: "unauthorized", message: "로그인이 필요합니다" }, 401);
    c.set("scoped", new ScopedVault(vault, p, index, wiki));
    await next();
  });

  api.get("/whoami", (c) => c.json(c.var.scoped.whoami()));

  api.get("/tree", async (c) => c.json({ tree: await c.var.scoped.tree(c.req.query("folder")) }));

  api.get("/documents", async (c) => c.json({ documents: await c.var.scoped.documents(c.req.query("folder")) }));

  api.get("/file", async (c) => c.json(await c.var.scoped.read(requirePath(c.req.query("path")))));

  api.get("/outline", async (c) => c.json(await c.var.scoped.outline(requirePath(c.req.query("path")))));

  api.get("/section", async (c) => {
    const num = (v: string | undefined) => (v === undefined ? undefined : Number.parseInt(v, 10) || undefined);
    return c.json(
      await c.var.scoped.section(requirePath(c.req.query("path")), {
        heading: c.req.query("heading"),
        startLine: num(c.req.query("start")),
        endLine: num(c.req.query("end")),
      }),
    );
  });

  api.get("/frontmatter", async (c) => {
    const fields = c.req.query("fields")?.split(",").map((s) => s.trim()).filter(Boolean);
    return c.json({ documents: await c.var.scoped.frontmatterList(c.req.query("folder"), fields) });
  });

  api.get("/search", async (c) => {
    const limit = Number.parseInt(c.req.query("limit") ?? "", 10);
    const hits = await c.var.scoped.search(c.req.query("q") ?? "", {
      folder: c.req.query("folder"),
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return c.json({ hits });
  });

  api.get("/topics", async (c) => c.json({ topics: await c.var.scoped.topics() }));

  api.post("/topics", async (c) => {
    const body = await c.req.json();
    if (typeof body.name !== "string") throw new PathError("name이 필요합니다");
    return c.json(await c.var.scoped.createTopic(body.name));
  });

  api.post("/ingest", async (c) => {
    const b = await c.req.json();
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    if (typeof b.topic !== "string") throw new PathError("topic이 필요합니다");
    switch (b.kind) {
      case "url":
        if (typeof b.url !== "string") throw new PathError("url이 필요합니다");
        return c.json(await ingestor.ingest(c.var.scoped, { kind: "url", topic: b.topic, url: b.url, title: str(b.title) }));
      case "html":
        if (typeof b.html !== "string") throw new PathError("html이 필요합니다");
        return c.json(
          await ingestor.ingest(c.var.scoped, {
            kind: "html",
            topic: b.topic,
            html: b.html,
            url: str(b.url),
            selectionHtml: str(b.selectionHtml),
            title: str(b.title),
          }),
        );
      case "text":
        if (typeof b.text !== "string" || typeof b.title !== "string") throw new PathError("text, title이 필요합니다");
        return c.json(await ingestor.ingest(c.var.scoped, { kind: "text", topic: b.topic, text: b.text, title: b.title, url: str(b.url) }));
      default:
        throw new PathError("kind는 url, html, text 중 하나입니다");
    }
  });

  api.post("/ingest/file", async (c) => {
    const topic = c.req.query("topic");
    const name = c.req.query("name");
    if (!topic || !name) throw new PathError("topic, name이 필요합니다");
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength === 0) throw new PathError("빈 파일입니다");
    return c.json(await ingestor.ingest(c.var.scoped, { kind: "file", topic, filename: name, data, title: c.req.query("title") }));
  });

  api.get("/backlinks", async (c) => c.json({ backlinks: await c.var.scoped.backlinks(requirePath(c.req.query("path"))) }));

  api.get("/tags", async (c) => c.json({ tags: await c.var.scoped.tags() }));

  // 위젯은 읽기 전용이지만 YAML 본문이 길 수 있어 POST로 받는다.
  api.post("/widget", async (c) => {
    const body = await c.req.json();
    if (typeof body.source !== "string") throw new PathError("source가 필요합니다");
    return c.json(await c.var.scoped.widget(body.source));
  });

  api.post("/task", async (c) => {
    const body = await c.req.json();
    if (!Number.isInteger(body.line) || typeof body.done !== "boolean") throw new PathError("line, done이 필요합니다");
    return c.json(await c.var.scoped.setTask(requirePath(body.path), body.line, body.done, requireHash(body.baseHash)));
  });

  api.put("/file", async (c) => {
    const body = await c.req.json();
    if (typeof body.content !== "string") throw new PathError("content가 필요합니다");
    return c.json(await c.var.scoped.write(requirePath(body.path), body.content, optionalHash(body.baseHash)));
  });

  api.post("/append", async (c) => {
    const body = await c.req.json();
    if (typeof body.content !== "string") throw new PathError("content가 필요합니다");
    const base = body.baseHash === undefined ? undefined : optionalHash(body.baseHash);
    return c.json(await c.var.scoped.append(requirePath(body.path), body.content, base));
  });

  api.delete("/file", async (c) => {
    const body = await c.req.json();
    return c.json(await c.var.scoped.delete(requirePath(body.path), requireHash(body.baseHash)));
  });

  api.post("/move", async (c) => {
    const body = await c.req.json();
    return c.json(await c.var.scoped.move(requirePath(body.from), requirePath(body.to), requireHash(body.baseHash)));
  });

  api.post("/batch", async (c) => {
    const body = await c.req.json();
    if (!Array.isArray(body.operations)) throw new PathError("operations 배열이 필요합니다");
    const ops: Op[] = body.operations.map((o: Record<string, unknown>): Op => {
      switch (o?.op) {
        case "write":
          if (typeof o.content !== "string") throw new PathError("content가 필요합니다");
          return { op: "write", path: requirePath(o.path), content: o.content, baseHash: optionalHash(o.baseHash) };
        case "append":
          if (typeof o.content !== "string") throw new PathError("content가 필요합니다");
          return {
            op: "append",
            path: requirePath(o.path),
            content: o.content,
            baseHash: o.baseHash === undefined ? undefined : optionalHash(o.baseHash),
          };
        case "delete":
          return { op: "delete", path: requirePath(o.path), baseHash: requireHash(o.baseHash) };
        case "move":
          return { op: "move", from: requirePath(o.from), to: requirePath(o.to), baseHash: requireHash(o.baseHash) };
        default:
          throw new PathError(`알 수 없는 연산입니다: ${String(o?.op)}`);
      }
    });
    const message = typeof body.message === "string" ? body.message : undefined;
    return c.json(await c.var.scoped.batch(ops, message));
  });

  api.get("/raw", async (c) => {
    const { path, data } = await c.var.scoped.readRaw(requirePath(c.req.query("path")));
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const type = MIME[ext] ?? "application/octet-stream";
    return c.body(new Uint8Array(data), 200, {
      "content-type": type,
      // SVG 등에 섞인 스크립트가 앱 출처로 실행되지 않게 한다.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    });
  });

  api.get("/history", async (c) => c.json({ commits: await c.var.scoped.history(requirePath(c.req.query("path"))) }));

  api.get("/revision", async (c) => {
    const rev = c.req.query("rev");
    if (!rev) throw new PathError("rev가 필요합니다");
    return c.json(await c.var.scoped.revision(requirePath(c.req.query("path")), rev));
  });

  api.post("/rollback", async (c) => {
    const body = await c.req.json();
    if (typeof body.rev !== "string") throw new PathError("rev가 필요합니다");
    return c.json(await c.var.scoped.rollback(requirePath(body.path), body.rev, optionalHash(body.baseHash)));
  });

  app.route("/api", api);
  return app;
}
