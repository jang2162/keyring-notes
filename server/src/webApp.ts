import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Env, Hono } from "hono";

/**
 * 웹 화면 빌드(web/dist)를 단다: 있는 파일은 그대로, 나머지 GET 은 index.html(화면 안 경로).
 * /api 와 /assets 의 없는 경로는 404 다 — /assets 에 index.html 을 주면 서비스 워커(web/public/sw.js)가 그 HTML 을
 * 조각 주소로 캐시하고, 화면은 조각 대신 HTML 을 받아 깨진다. dist 가 없으면(개발 서버) 아무것도 달지 않고 false.
 * index.ts 가 createApp 뒤에 부른다 — /llms.txt 처럼 앞에 단 경로는 가로채지 않는다
 */
export function mountWebApp<E extends Env>(app: Hono<E>, webDist: string): boolean {
  if (!existsSync(path.join(webDist, "index.html"))) return false;
  const root = path.relative(process.cwd(), webDist);
  app.use("/*", serveStatic({ root }));
  const indexHtml = readFileSync(path.join(webDist, "index.html"), "utf8");
  app.get("*", (c) => (c.req.path.startsWith("/api/") || c.req.path.startsWith("/assets/") ? c.notFound() : c.html(indexHtml)));
  return true;
}
