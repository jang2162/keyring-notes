import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { Vault } from "./vault.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const vaultDir = path.resolve(process.env.KEYRING_VAULT ?? path.join(here, "../../vault"));
const webDist = path.resolve(process.env.KEYRING_WEB_DIST ?? path.join(here, "../../web/dist"));
const host = process.env.KEYRING_HOST ?? "127.0.0.1";
const port = Number(process.env.KEYRING_PORT ?? 8787);
const author = {
  name: process.env.KEYRING_AUTHOR_NAME ?? "me",
  email: process.env.KEYRING_AUTHOR_EMAIL ?? "me@keyring-notes.local",
};

const vault = new Vault(vaultDir);
await vault.init();

const app = createApp({ vault, author });

if (existsSync(path.join(webDist, "index.html"))) {
  const root = path.relative(process.cwd(), webDist);
  app.use("/*", serveStatic({ root }));
  const indexHtml = readFileSync(path.join(webDist, "index.html"), "utf8");
  app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : c.html(indexHtml)));
}

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`keyring-notes: http://${info.address}:${info.port}  (vault: ${vaultDir})`);
});
