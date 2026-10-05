import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Author } from "./git.js";
import { PathError } from "./paths.js";
import { ConflictError, NotFoundError, type Vault } from "./vault.js";

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
  /** 1단계에서는 로그인 없이 한 사람만 쓰므로, 웹 편집은 모두 이 작성자로 기록한다. */
  author: Author;
}

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

export function createApp({ vault, author }: AppOptions) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof ConflictError) {
      return c.json({ error: "conflict", message: err.message, currentHash: err.currentHash }, 409);
    }
    if (err instanceof NotFoundError) return c.json({ error: "not_found", message: err.message }, 404);
    if (err instanceof PathError) return c.json({ error: "bad_request", message: err.message }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "bad_request", message: "JSON 본문이 잘못되었습니다" }, 400);
    console.error(err);
    return c.json({ error: "internal", message: "서버 오류" }, 500);
  });

  const api = new Hono();

  // 변경 요청은 JSON만 받는다. 다른 사이트의 단순 폼 전송(CSRF)이 preflight 없이 닿는 것을 막는다.
  api.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const ct = c.req.header("content-type") ?? "";
      if (!ct.toLowerCase().startsWith("application/json")) {
        return c.json({ error: "bad_request", message: "Content-Type: application/json 이 필요합니다" }, 415);
      }
    }
    await next();
  });
  api.use("*", bodyLimit({ maxSize: 10 * 1024 * 1024 }));

  api.get("/tree", async (c) => c.json({ tree: await vault.tree() }));

  api.get("/file", async (c) => c.json(await vault.read(requirePath(c.req.query("path")))));

  api.put("/file", async (c) => {
    const body = await c.req.json();
    if (typeof body.content !== "string") throw new PathError("content가 필요합니다");
    const doc = await vault.write(requirePath(body.path), body.content, optionalHash(body.baseHash), author);
    return c.json(doc);
  });

  api.delete("/file", async (c) => {
    const body = await c.req.json();
    return c.json(await vault.delete(requirePath(body.path), requireHash(body.baseHash), author));
  });

  api.post("/move", async (c) => {
    const body = await c.req.json();
    const doc = await vault.move(requirePath(body.from), requirePath(body.to), requireHash(body.baseHash), author);
    return c.json(doc);
  });

  api.get("/raw", async (c) => {
    const { path, data } = await vault.readRaw(requirePath(c.req.query("path")));
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const type = MIME[ext] ?? "application/octet-stream";
    return c.body(new Uint8Array(data), 200, {
      "content-type": type,
      // SVG 등에 섞인 스크립트가 앱 출처로 실행되지 않게 한다.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    });
  });

  api.get("/history", async (c) => c.json({ commits: await vault.history(requirePath(c.req.query("path"))) }));

  api.get("/revision", async (c) => {
    const rev = c.req.query("rev");
    if (!rev) throw new PathError("rev가 필요합니다");
    return c.json(await vault.revision(requirePath(c.req.query("path")), rev));
  });

  api.post("/rollback", async (c) => {
    const body = await c.req.json();
    if (typeof body.rev !== "string") throw new PathError("rev가 필요합니다");
    const doc = await vault.rollback(requirePath(body.path), body.rev, optionalHash(body.baseHash), author);
    return c.json(doc);
  });

  app.route("/api", api);
  return app;
}
