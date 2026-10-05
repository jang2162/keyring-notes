import { timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PLUGIN_NAME_RE } from "./query.js";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Principal } from "./access.js";
import { SESSION_COOKIE, type ConfigStore } from "./config.js";
import { adminRoutes, type AdminDeps } from "./admin.js";
import { handleMcpRequest } from "./mcp.js";
import type { Ingestor } from "./ingest.js";
import type { NoteIndex } from "./noteindex.js";
import type { ReviewQueue } from "./review.js";
import type { SemanticIndex } from "./embeddings.js";
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
  /** 관리 콘솔(백업·업데이트·보안 설정). vault·index·wiki·config는 위와 같은 것을 쓴다. */
  admin: Omit<AdminDeps, "vault" | "index" | "wiki" | "config">;
  /**
   * 위젯 플러그인 폴더(<이름>.js). 볼트 밖에 두며 API·에이전트로는 쓸 수 없다.
   * 플러그인은 브라우저에서 소유자 권한으로 돌아가므로 믿을 수 있는 코드만 넣는다.
   */
  pluginsDir?: string;
  /** 의미 검색(설정했을 때만) */
  semantic?: SemanticIndex;
  /** 변경 검토 대기열(없으면 모든 변경을 바로 반영) */
  review?: ReviewQueue;
  /** 비밀번호가 없을 때 웹에서 처음 설정하는 데 쓰는 일회용 코드(서버 로그에만 나온다). */
  setupCode?: () => string | null;
}

/** 앱 페이지에 거는 보안 헤더. 첨부 파일(/api/raw)은 자기 CSP(sandbox)를 따로 건다. */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // CodeMirror가 <style>을 넣고, 차트 툴팁이 style 속성을 쓴다
  "style-src 'self' 'unsafe-inline'",
  // 클립한 문서의 원격 이미지
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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

export function createApp({ vault, index, config, wiki, ingestor, admin, setupCode, review, semantic, pluginsDir }: AppOptions) {
  const app = new Hono<Env>();
  const throttle = new LoginThrottle();
  const secureCookies = (c: Context) => isHttps(c) || (admin.publicUrl ?? "").startsWith("https:");
  const allowedHosts = admin.allowedHosts?.map((h) => h.toLowerCase());

  // DNS 리바인딩 방지: 허용한 호스트 이름으로 온 요청만 받는다(설정했을 때). 컨테이너 헬스체크용 localhost는 늘 허용.
  app.use("*", async (c, next) => {
    if (allowedHosts && allowedHosts.length > 0) {
      // node 서버는 Host 헤더로 요청 URL을 만들므로 URL의 호스트 이름이 곧 Host 헤더다
      const host = new URL(c.req.url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (!allowedHosts.includes(host) && !["localhost", "127.0.0.1", "::1"].includes(host)) {
        return c.text("허용되지 않은 호스트입니다 (KEYRING_ALLOWED_HOSTS)", 421);
      }
    }
    await next();
    const h = c.res.headers;
    if (!h.has("content-security-policy")) h.set("content-security-policy", APP_CSP);
    h.set("x-content-type-options", "nosniff");
    h.set("x-frame-options", "DENY");
    h.set("referrer-policy", "same-origin");
    h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (c.req.path.startsWith("/api/")) h.set("cache-control", h.get("cache-control") ?? "no-store");
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

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

  // ── 위젯 플러그인 모듈: 소유자 로그인 필요 ──
  app.get("/plugins/:file", async (c) => {
    if (!config.verifySession(getCookie(c, SESSION_COOKIE))) return c.text("로그인이 필요합니다", 401);
    const m = /^(.+)\.js$/.exec(c.req.param("file"));
    if (!pluginsDir || !m || !PLUGIN_NAME_RE.test(m[1])) return c.text("플러그인이 없습니다", 404);
    try {
      const code = await readFile(path.join(pluginsDir, `${m[1]}.js`), "utf8");
      return c.body(code, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
    } catch {
      return c.text("플러그인이 없습니다", 404);
    }
  });

  // ── MCP: 에이전트 토큰만 받는다 ──
  app.all("/mcp", async (c) => {
    const principal = config.agentByToken(bearer(c));
    if (!principal) {
      return c.json({ error: "unauthorized", message: "에이전트 토큰이 필요합니다" }, 401, {
        "www-authenticate": 'Bearer realm="keyring-notes"',
      });
    }
    return handleMcpRequest(c.req.raw, new ScopedVault(vault, principal, index, wiki, review, semantic), ingestor);
  });

  const api = new Hono<Env>();

  // 변경 요청은 JSON만 받는다. 다른 사이트의 단순 폼 전송(CSRF)이 preflight 없이 닿는 것을 막는다.
  // 파일 업로드는 원본 바이트를 받되, 사용자 정의 헤더(x-keyring-upload)를 요구해 같은 효과를 낸다.
  api.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const ct = c.req.header("content-type") ?? "";
      const rawBody = c.req.path === "/api/ingest/file" || c.req.path === "/api/admin/backups/upload";
      const upload = rawBody && c.req.header("x-keyring-upload") === "1";
      if (!upload && !ct.toLowerCase().startsWith("application/json")) {
        return c.json({ error: "bad_request", message: "Content-Type: application/json 이 필요합니다" }, 415);
      }
    }
    await next();
  });
  api.use("*", async (c, next) => {
    // 백업 업로드는 디스크로 바로 흘려 쓰며 크기를 따로 센다
    if (c.req.path === "/api/admin/backups/upload") return next();
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
      secure: secureCookies(c),
      path: "/",
      maxAge: s.maxAge,
    });
    return c.json({ ok: true });
  });

  // 처음 설치: 비밀번호가 아직 없을 때만, 서버 로그에 찍힌 일회용 코드로 웹에서 비밀번호를 정한다.
  api.post("/auth/setup", async (c) => {
    const { code, password } = await c.req.json();
    const expected = setupCode?.() ?? null;
    if (config.get().owner.passwordHash !== null || !expected) {
      return c.json({ error: "forbidden", message: "이미 설정되었습니다" }, 403);
    }
    const wait = throttle.delayMs();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const norm = (v: string) => v.replace(/[^0-9a-z]/gi, "").toUpperCase();
    const given = Buffer.from(typeof code === "string" ? norm(code) : "");
    const want = Buffer.from(norm(expected));
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throttle.fail();
      return c.json({ error: "unauthorized", message: "설정 코드가 맞지 않습니다(서버 로그를 확인하세요)" }, 401);
    }
    if (typeof password !== "string" || password.length < 8) throw new PathError("비밀번호는 8자 이상이어야 합니다");
    config.setPassword(password);
    const s = config.issueSession();
    setCookie(c, SESSION_COOKIE, s.value, { httpOnly: true, sameSite: "Strict", secure: secureCookies(c), path: "/", maxAge: s.maxAge });
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
    c.set("scoped", new ScopedVault(vault, p, index, wiki, review, semantic));
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

  api.get("/plugins", async (c) => {
    const files = pluginsDir ? await readdir(pluginsDir).catch(() => [] as string[]) : [];
    const names = files.map((f) => /^(.+)\.js$/.exec(f)?.[1]).filter((n): n is string => !!n && PLUGIN_NAME_RE.test(n));
    return c.json({ plugins: names.sort() });
  });

  api.get("/semantic/status", (c) => c.json(semantic ? semantic.status() : { enabled: false }));
  api.get("/semantic", async (c) => {
    const limit = Number.parseInt(c.req.query("limit") ?? "", 10);
    return c.json({ hits: await c.var.scoped.semantic(c.req.query("q") ?? "", { folder: c.req.query("folder"), limit: Number.isFinite(limit) ? limit : undefined }) });
  });

  api.get("/graph", async (c) => c.json(await c.var.scoped.graph(c.req.query("folder"))));

  api.get("/lint", async (c) => {
    const days = Number.parseInt(c.req.query("staleDays") ?? "", 10);
    return c.json(await c.var.scoped.lint({ folder: c.req.query("folder"), staleDays: Number.isFinite(days) && days > 0 ? days : undefined }));
  });

  api.get("/sources", async (c) => c.json(await c.var.scoped.sources(requirePath(c.req.query("path")))));

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

  // ── 변경 검토 대기열(소유자만) ──
  const ownerOnly = (c: Context<Env>) => {
    if (c.var.scoped.principal.kind !== "owner") throw new ForbiddenError("검토는 소유자만 할 수 있습니다");
    if (!review) throw new PathError("검토 대기열이 꺼져 있습니다");
    return review;
  };
  api.get("/review/settings", (c) => {
    ownerOnly(c);
    return c.json({ reviewPaths: config.get().reviewPaths });
  });
  api.put("/review/settings", async (c) => {
    ownerOnly(c);
    const { reviewPaths } = await c.req.json();
    if (!Array.isArray(reviewPaths) || reviewPaths.some((p) => typeof p !== "string")) throw new PathError("reviewPaths는 경로 문자열 목록입니다");
    try {
      config.update((cfg) => {
        cfg.reviewPaths = reviewPaths;
      });
    } catch (e) {
      throw new PathError(e instanceof Error ? e.message : String(e));
    }
    return c.json({ reviewPaths: config.get().reviewPaths });
  });
  api.get("/review", async (c) => {
    const q = ownerOnly(c);
    const status = c.req.query("status");
    return c.json({ proposals: await q.list(status === "pending" || status === "approved" || status === "rejected" ? { status } : {}) });
  });
  api.get("/review/:id", async (c) => c.json(await ownerOnly(c).get(c.req.param("id"))));
  api.post("/review/:id/approve", async (c) => {
    const q = ownerOnly(c);
    return c.json(await q.summarize(await q.approve(c.req.param("id"), c.var.scoped.principal.name)));
  });
  api.post("/review/:id/reject", async (c) => {
    const q = ownerOnly(c);
    const body = await c.req.json().catch(() => ({}));
    return c.json(await q.summarize(await q.reject(c.req.param("id"), c.var.scoped.principal.name, typeof body.reason === "string" ? body.reason : undefined)));
  });

  api.route("/admin", adminRoutes({ vault, index, wiki, config, ...admin }));

  app.route("/api", api);
  return app;
}
