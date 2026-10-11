import { timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PLUGIN_NAME_RE } from "@keyring-notes/core";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Principal } from "./access.js";
import { SESSION_COOKIE, validDeviceName, type ConfigStore } from "./config.js";
import { adminRoutes, type AdminDeps } from "./admin.js";
import { PasskeyError, PasskeyService } from "./passkeys.js";
import { handleMcpRequest } from "./mcp.js";
import type { Ingestor } from "./ingest.js";
import type { NoteIndex } from "./noteindex.js";
import type { ReviewQueue } from "./review.js";
import type { SemanticIndex } from "./embeddings.js";
import type { Wiki } from "./wiki.js";
import { PathError } from "./paths.js";
import { ScopedVault } from "./scoped.js";
import { SyncManifest } from "./sync.js";
import { ConflictError, ForbiddenError, KeyedError, NotFoundError, type Op, type Vault } from "./vault.js";
import { serverText } from "./lang.js";

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
  if (typeof value !== "string" || value.length === 0) throw new PathError("field_required", { field: "path" });
  return value;
}

function optionalHash(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new PathError("base_hash_invalid");
  return value;
}

/** 켜고 끄는 옵션(없으면 기본값) */
function optionalBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new PathError("boolean_required");
  return value;
}

function requireHash(value: unknown): string {
  const h = optionalHash(value);
  if (h === null) throw new PathError("field_required", { field: "baseHash" });
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
  const passkeys = new PasskeyService(config, admin.publicUrl);
  const secureCookies = (c: Context) => isHttps(c) || (admin.publicUrl ?? "").startsWith("https:");
  const allowedHosts = admin.allowedHosts?.map((h) => h.toLowerCase());

  // DNS 리바인딩 방지: 허용한 호스트 이름으로 온 요청만 받는다(설정했을 때). 컨테이너 헬스체크용 localhost는 늘 허용.
  app.use("*", async (c, next) => {
    if (allowedHosts && allowedHosts.length > 0) {
      // node 서버는 Host 헤더로 요청 URL을 만들므로 URL의 호스트 이름이 곧 Host 헤더다
      const host = new URL(c.req.url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (!allowedHosts.includes(host) && !["localhost", "127.0.0.1", "::1"].includes(host)) {
        return c.text(serverText("error.host_not_allowed"), 421);
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

  // 데스크톱·모바일 앱은 출처(origin)가 달라 CORS가 필요하다. 쿠키가 아니라 Authorization 헤더(기기 토큰)로
  // 인증하는 요청과 기기 등록에만 응답을 열어 준다. 쿠키 로그인 응답은 다른 출처에서 읽을 수 없다.
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && c.req.method === "OPTIONS") {
      return c.body(null, 204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PUT, DELETE",
        "access-control-allow-headers": "authorization, content-type, x-keyring-upload",
        "access-control-max-age": "600",
      });
    }
    await next();
    if (origin && (bearer(c) !== undefined || c.req.path === "/api/auth/device" || c.req.path === "/api/health")) {
      c.res.headers.set("access-control-allow-origin", "*");
    }
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  /** 오류 응답: error(종류)·code(메시지 키 error.<code>)·params(끼워 넣을 값)·message(서버 언어의 글). 화면은 code로 번역한다 */
  const fail = (
    c: Context,
    status: 400 | 401 | 403 | 404 | 409 | 415 | 500,
    error: string,
    code: string,
    params: Record<string, string | number> = {},
    extra: Record<string, unknown> = {},
  ) => c.json({ error, code, params, message: serverText(`error.${code}`, params), ...extra }, status);
  const keyed = (err: KeyedError) => ({ code: err.code, params: err.params as Record<string, string | number> });

  app.onError((err, c) => {
    if (err instanceof ConflictError) return fail(c, 409, "conflict", err.code, keyed(err).params, { currentHash: err.currentHash });
    if (err instanceof NotFoundError) return fail(c, 404, "not_found", err.code, keyed(err).params);
    if (err instanceof ForbiddenError) return fail(c, 403, "forbidden", err.code, keyed(err).params);
    if (err instanceof PathError) return fail(c, 400, "bad_request", err.code, keyed(err).params);
    if (err instanceof PasskeyError) return fail(c, 400, "passkey", err.code, keyed(err).params);
    if (err instanceof KeyedError) return fail(c, 400, "bad_request", err.code, keyed(err).params);
    if (err instanceof SyntaxError) return fail(c, 400, "bad_request", "bad_json");
    console.error(err);
    return fail(c, 500, "internal", "internal");
  });

  /** 요청한 쪽: 에이전트·기기 토큰(Authorization: Bearer) 또는 소유자 로그인 쿠키. */
  const principalOf = (c: Context): Principal | null => {
    const token = bearer(c);
    if (token !== undefined) return config.deviceByToken(token) ?? config.agentByToken(token);
    if (config.verifySession(getCookie(c, SESSION_COOKIE))) return config.ownerPrincipal();
    return null;
  };

  // ── 위젯 플러그인 모듈: 소유자 로그인 필요 ──
  app.get("/plugins/:file", async (c) => {
    if (!config.verifySession(getCookie(c, SESSION_COOKIE))) return c.text(serverText("error.login_required"), 401);
    const m = /^(.+)\.js$/.exec(c.req.param("file"));
    if (!pluginsDir || !m || !PLUGIN_NAME_RE.test(m[1])) return c.text(serverText("error.plugin_missing"), 404);
    try {
      const code = await readFile(path.join(pluginsDir, `${m[1]}.js`), "utf8");
      return c.body(code, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
    } catch {
      return c.text(serverText("error.plugin_missing"), 404);
    }
  });

  // ── MCP: 에이전트 토큰만 받는다 ──
  app.all("/mcp", async (c) => {
    const principal = config.agentByToken(bearer(c));
    if (!principal) {
      c.header("www-authenticate", 'Bearer realm="keyring-notes"');
      return fail(c, 401, "unauthorized", "agent_token_required");
    }
    const lang = config.get().agentLanguage;
    const scoped = new ScopedVault(vault, principal, index, wiki, review, semantic);
    scoped.agentLang = lang;
    return handleMcpRequest(c.req.raw, scoped, ingestor, lang);
  });

  const api = new Hono<Env>();

  // 변경 요청은 JSON만 받는다. 다른 사이트의 단순 폼 전송(CSRF)이 preflight 없이 닿는 것을 막는다.
  // 파일 업로드는 원본 바이트를 받되, 사용자 정의 헤더(x-keyring-upload)를 요구해 같은 효과를 낸다.
  api.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const ct = c.req.header("content-type") ?? "";
      const rawBody = c.req.path === "/api/ingest/file" || c.req.path === "/api/attachment" || c.req.path === "/api/admin/backups/upload";
      const upload = rawBody && c.req.header("x-keyring-upload") === "1";
      if (!upload && !ct.toLowerCase().startsWith("application/json")) {
        return fail(c, 415, "bad_request", "json_required");
      }
    }
    await next();
  });
  api.use("*", async (c, next) => {
    // 백업 업로드는 디스크로 바로 흘려 쓰며 크기를 따로 센다
    if (c.req.path === "/api/admin/backups/upload") return next();
    // 업로드·웹 클립(페이지 HTML 전체)은 크게, 나머지는 10MB까지
    // 일괄 쓰기는 노드 되살리기(첨부 base64)를 실을 수 있어 크게
    const max =
      c.req.path === "/api/ingest/file" || c.req.path === "/api/attachment" || c.req.path === "/api/batch" ? 50 : c.req.path === "/api/ingest" ? 25 : 10;
    return bodyLimit({ maxSize: max * 1024 * 1024 })(c, next);
  });

  // ── 로그인 ──
  api.get("/auth/status", (c) => {
    const p = principalOf(c);
    return c.json({
      authenticated: p !== null,
      principal: p ? { name: p.name, kind: p.kind } : null,
      passwordSet: config.get().owner.passwordHash !== null,
      // 이 주소로 등록한 패스키가 있으면 로그인 화면에 "패스키로 로그인"을 보인다
      passkey: (() => {
        try {
          return passkeys.available((c.req.header("x-forwarded-host") ? new URL(`http://${c.req.header("x-forwarded-host")}`) : new URL(c.req.url)).hostname);
        } catch {
          return false;
        }
      })(),
    });
  });

  api.post("/auth/login", async (c) => {
    const { password } = await c.req.json();
    const wait = throttle.delayMs();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (typeof password !== "string" || !config.checkPassword(password)) {
      throttle.fail();
      return fail(c, 401, "unauthorized", "wrong_password");
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

  // 패스키 로그인: 서버가 낸 일회용 도전값에 인증기가 서명하면 비밀번호와 같은 세션을 준다
  api.post("/auth/passkey/options", async (c) => {
    const wait = throttle.delayMs();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return c.json(await passkeys.authenticationOptions(passkeys.origin(c.req.header("origin"), new URL(c.req.url).host, c.req.header("x-forwarded-host"))));
  });
  api.post("/auth/passkey/login", async (c) => {
    const { id, response } = await c.req.json();
    const wait = throttle.delayMs();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!(await passkeys.verifyAuthentication(id, response))) {
      throttle.fail();
      return fail(c, 401, "unauthorized", "passkey_failed");
    }
    throttle.reset();
    const s = config.issueSession();
    setCookie(c, SESSION_COOKIE, s.value, { httpOnly: true, sameSite: "Strict", secure: secureCookies(c), path: "/", maxAge: s.maxAge });
    return c.json({ ok: true });
  });

  // 처음 설치: 비밀번호가 아직 없을 때만, 서버 로그에 찍힌 일회용 코드로 웹에서 비밀번호를 정한다.
  api.post("/auth/setup", async (c) => {
    const { code, password } = await c.req.json();
    const expected = setupCode?.() ?? null;
    if (config.get().owner.passwordHash !== null || !expected) {
      return fail(c, 403, "forbidden", "already_set_up");
    }
    const wait = throttle.delayMs();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const norm = (v: string) => v.replace(/[^0-9a-z]/gi, "").toUpperCase();
    const given = Buffer.from(typeof code === "string" ? norm(code) : "");
    const want = Buffer.from(norm(expected));
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throttle.fail();
      return fail(c, 401, "unauthorized", "wrong_setup_code");
    }
    if (typeof password !== "string" || password.length < 8) throw new PathError("password_short");
    config.setPassword(password);
    const s = config.issueSession();
    setCookie(c, SESSION_COOKIE, s.value, { httpOnly: true, sameSite: "Strict", secure: secureCookies(c), path: "/", maxAge: s.maxAge });
    return c.json({ ok: true });
  });

  // 앱(데스크톱·모바일) 연결: 비밀번호로 이 기기용 토큰을 받는다. 관리 콘솔에서 기기별로 끊을 수 있다.
  api.post("/auth/device", async (c) => {
    const { password, name } = await c.req.json();
    const wait = throttle.delayMs();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (typeof password !== "string" || !config.checkPassword(password)) {
      throttle.fail();
      return fail(c, 401, "unauthorized", "wrong_password");
    }
    throttle.reset();
    let device: string;
    try {
      device = validDeviceName(name);
    } catch (e) {
      throw e instanceof KeyedError ? e : new PathError("invalid", { message: e instanceof Error ? e.message : String(e) });
    }
    const d = config.issueDeviceToken(device);
    return c.json({ id: d.id, name: d.name, token: d.token });
  });

  api.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // ── 여기부터는 인증 필요. 모든 경로가 ScopedVault(권한 계층)를 지난다 ──
  api.use("*", async (c, next) => {
    const p = principalOf(c);
    if (!p) return fail(c, 401, "unauthorized", "login_required");
    const scoped = new ScopedVault(vault, p, index, wiki, review, semantic);
    scoped.agentLang = config.get().agentLanguage;
    c.set("scoped", scoped);
    await next();
  });

  api.get("/whoami", (c) => c.json(c.var.scoped.whoami()));

  // ── 앱 동기화: 파일 목록과 해시(소유자만). 내용은 /file·/raw, 쓰기는 /file(baseHash)로 한다 ──
  const manifest = new SyncManifest(vault, (rel) => wiki.isGenerated(rel));
  api.get("/sync/manifest", async (c) => {
    if (c.var.scoped.principal.kind !== "owner") throw new ForbiddenError("sync_owner_only");
    return c.json({ files: await manifest.files() });
  });

  api.get("/tree", async (c) => c.json({ tree: await c.var.scoped.tree(c.req.query("folder")) }));

  // 노드의 바로 아래 노드(노드 = 노트 A.md + 하위 A/). path가 없으면 워크스페이스 목록
  api.get("/children", async (c) => c.json({ children: await c.var.scoped.children(c.req.query("path") || undefined) }));

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
    const fields = c.req
      .query("fields")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
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
    if (typeof body.name !== "string") throw new PathError("field_required", { field: "name" });
    return c.json(await c.var.scoped.createTopic(body.name));
  });

  api.post("/ingest", async (c) => {
    const b = await c.req.json();
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    if (typeof b.topic !== "string") throw new PathError("field_required", { field: "topic" });
    switch (b.kind) {
      case "url":
        if (typeof b.url !== "string") throw new PathError("field_required", { field: "url" });
        return c.json(await ingestor.ingest(c.var.scoped, { kind: "url", topic: b.topic, url: b.url, title: str(b.title) }));
      case "html":
        if (typeof b.html !== "string") throw new PathError("field_required", { field: "html" });
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
        if (typeof b.text !== "string" || typeof b.title !== "string") throw new PathError("field_required", { field: "text, title" });
        return c.json(await ingestor.ingest(c.var.scoped, { kind: "text", topic: b.topic, text: b.text, title: b.title, url: str(b.url) }));
      default:
        throw new PathError("ingest_kind");
    }
  });

  // 첨부 파일 올리기(붙여넣기·끌어놓기, 앱 동기화): 새 파일만(이미 있으면 409). 원본 바이트, 헤더 x-keyring-upload: 1
  api.post("/attachment", async (c) => {
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength === 0) throw new PathError("file_empty");
    return c.json(await c.var.scoped.putAttachment(requirePath(c.req.query("path")), data));
  });

  api.post("/ingest/file", async (c) => {
    const topic = c.req.query("topic");
    const name = c.req.query("name");
    if (!topic || !name) throw new PathError("field_required", { field: "topic, name" });
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength === 0) throw new PathError("file_empty");
    return c.json(await ingestor.ingest(c.var.scoped, { kind: "file", topic, filename: name, data, title: c.req.query("title") }));
  });

  api.get("/backlinks", async (c) => c.json({ backlinks: await c.var.scoped.backlinks(requirePath(c.req.query("path"))) }));
  api.get("/properties", (c) => c.json({ properties: c.var.scoped.properties() }));
  api.get("/mentions", async (c) => c.json(await c.var.scoped.mentions(requirePath(c.req.query("path")))));

  api.get("/plugins", async (c) => {
    const files = pluginsDir ? await readdir(pluginsDir).catch(() => [] as string[]) : [];
    const names = files.map((f) => /^(.+)\.js$/.exec(f)?.[1]).filter((n): n is string => !!n && PLUGIN_NAME_RE.test(n));
    return c.json({ plugins: names.sort() });
  });

  api.get("/semantic/status", (c) => c.json(semantic ? semantic.status() : { enabled: false }));
  api.get("/semantic", async (c) => {
    const limit = Number.parseInt(c.req.query("limit") ?? "", 10);
    return c.json({
      hits: await c.var.scoped.semantic(c.req.query("q") ?? "", { folder: c.req.query("folder"), limit: Number.isFinite(limit) ? limit : undefined }),
    });
  });

  api.get("/graph", async (c) => c.json(await c.var.scoped.graph(c.req.query("folder"))));

  api.get("/lint", async (c) => {
    const days = Number.parseInt(c.req.query("staleDays") ?? "", 10);
    return c.json(await c.var.scoped.lint({ folder: c.req.query("folder"), staleDays: Number.isFinite(days) && days > 0 ? days : undefined }));
  });

  api.get("/sources", async (c) => c.json(await c.var.scoped.sources(requirePath(c.req.query("path")))));

  api.get("/tags", async (c) => c.json({ tags: await c.var.scoped.tags(c.req.query("folder")) }));

  // 위젯은 읽기 전용이지만 YAML 본문이 길 수 있어 POST로 받는다.
  api.post("/widget", async (c) => {
    const body = await c.req.json();
    if (typeof body.source !== "string") throw new PathError("field_required", { field: "source" });
    return c.json(await c.var.scoped.widget(body.source));
  });

  api.post("/task", async (c) => {
    const body = await c.req.json();
    if (!Number.isInteger(body.line) || typeof body.done !== "boolean") throw new PathError("field_required", { field: "line, done" });
    return c.json(await c.var.scoped.setTask(requirePath(body.path), body.line, body.done, requireHash(body.baseHash)));
  });

  api.put("/file", async (c) => {
    const body = await c.req.json();
    if (typeof body.content !== "string") throw new PathError("field_required", { field: "content" });
    return c.json(await c.var.scoped.write(requirePath(body.path), body.content, optionalHash(body.baseHash), { coalesce: optionalBool(body.coalesce) }));
  });

  api.post("/append", async (c) => {
    const body = await c.req.json();
    if (typeof body.content !== "string") throw new PathError("field_required", { field: "content" });
    const base = body.baseHash === undefined ? undefined : optionalHash(body.baseHash);
    return c.json(await c.var.scoped.append(requirePath(body.path), body.content, base));
  });

  api.delete("/file", async (c) => {
    const body = await c.req.json();
    return c.json(await c.var.scoped.delete(requirePath(body.path), requireHash(body.baseHash)));
  });

  api.post("/move", async (c) => {
    const body = await c.req.json();
    // 노드 옮기기: 노드 노트와 하위 문서·첨부를 한 커밋으로(baseHash 없이, 지금 내용 기준)
    if (body.node === true)
      return c.json(await c.var.scoped.moveNode(requirePath(body.from), requirePath(body.to), { updateLinks: optionalBool(body.updateLinks) }));
    return c.json(
      await c.var.scoped.move(requirePath(body.from), requirePath(body.to), requireHash(body.baseHash), { updateLinks: optionalBool(body.updateLinks) }),
    );
  });

  // 노드 삭제: 노드 노트와 하위 전체를 한 커밋으로. files(지우기 전에 읽은 경로·해시)를 주면 그 사이 바뀌었을 때 409
  api.post("/node/delete", async (c) => {
    const body = await c.req.json();
    const files = Array.isArray(body.files)
      ? body.files.map((f: Record<string, unknown>) => ({ path: requirePath(f?.path), baseHash: requireHash(f?.baseHash) }))
      : undefined;
    return c.json(await c.var.scoped.deleteNode(requirePath(body.path), files));
  });

  api.post("/batch", async (c) => {
    const body = await c.req.json();
    if (!Array.isArray(body.operations)) throw new PathError("array_required", { field: "operations" });
    const ops: Op[] = body.operations.map((o: Record<string, unknown>): Op => {
      switch (o?.op) {
        case "write":
          if (typeof o.content !== "string") throw new PathError("field_required", { field: "content" });
          return { op: "write", path: requirePath(o.path), content: o.content, baseHash: optionalHash(o.baseHash) };
        case "append":
          if (typeof o.content !== "string") throw new PathError("field_required", { field: "content" });
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
        case "put":
          // 첨부 새로 만들기(노드 삭제 되돌리기): data는 base64
          if (typeof o.data !== "string") throw new PathError("field_required", { field: "data (base64)" });
          return { op: "put", path: requirePath(o.path), data: new Uint8Array(Buffer.from(o.data, "base64")) };
        default:
          throw new PathError("op_unknown", { op: String(o?.op) });
      }
    });
    const message = typeof body.message === "string" ? body.message : undefined;
    return c.json(await c.var.scoped.batch(ops, message, { updateLinks: optionalBool(body.updateLinks) }));
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
    if (!rev) throw new PathError("field_required", { field: "rev" });
    return c.json(await c.var.scoped.revision(requirePath(c.req.query("path")), rev));
  });

  api.post("/rollback", async (c) => {
    const body = await c.req.json();
    if (typeof body.rev !== "string") throw new PathError("field_required", { field: "rev" });
    return c.json(await c.var.scoped.rollback(requirePath(body.path), body.rev, optionalHash(body.baseHash)));
  });

  // ── 변경 검토 대기열(소유자만) ──
  const ownerOnly = (c: Context<Env>) => {
    if (c.var.scoped.principal.kind !== "owner") throw new ForbiddenError("review_owner_only");
    if (!review) throw new PathError("review_off");
    return review;
  };
  api.get("/review/settings", (c) => {
    ownerOnly(c);
    return c.json({ reviewPaths: config.get().reviewPaths });
  });
  api.put("/review/settings", async (c) => {
    ownerOnly(c);
    const { reviewPaths } = await c.req.json();
    if (!Array.isArray(reviewPaths) || reviewPaths.some((p) => typeof p !== "string")) throw new PathError("review_paths_invalid");
    try {
      config.update((cfg) => {
        cfg.reviewPaths = reviewPaths;
      });
    } catch (e) {
      throw e instanceof KeyedError ? e : new PathError("invalid", { message: e instanceof Error ? e.message : String(e) });
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

  api.route("/admin", adminRoutes({ vault, index, wiki, config, ...admin, passkeys }));

  app.route("/api", api);
  return app;
}
