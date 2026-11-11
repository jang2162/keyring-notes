import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockEntryValue, PathError, setVaultSetting, type LockEntry } from "@keyring-notes/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import { attachMarketReconcile, MarketCache } from "../src/marketCache.js";
import type { MarketFetchOptions } from "../src/marketFetch.js";
import { openVault, tempDir } from "./helpers.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "market");
const REPO = "https://repo.test/m/";
const json = { "content-type": "application/json" };
const indexJson = JSON.parse(await readFile(path.join(fixture, "index.json"), "utf8"));

function lockOf(id: string, version: string): LockEntry {
  const files = indexJson.packages[id].versions[version].files as { path: string; sha256: string }[];
  return { version, repo: REPO, sha256: Object.fromEntries(files.map((f) => [f.path, f.sha256])) };
}

const calls: string[] = [];
async function fakeFetch(url: string, opts: MarketFetchOptions): Promise<Uint8Array> {
  calls.push(url);
  if (!url.startsWith(REPO)) throw new PathError("market_fetch_failed", { reason: "http_404" });
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path.join(fixture, url.slice(REPO.length))));
  } catch {
    throw new PathError("market_fetch_failed", { reason: "http_404" });
  }
  if (bytes.byteLength > opts.maxBytes) throw new PathError("market_too_large");
  return bytes;
}

let cleanup: () => Promise<void>;
let env: Awaited<ReturnType<typeof setup>>;

async function setup() {
  const t = await tempDir("keyring-market-api-");
  cleanup = t.cleanup;
  const v = await openVault(path.join(t.dir, "vault"));
  const config = new ConfigStore(path.join(t.dir, "config", "keyring.json"));
  config.setPassword("correct horse");
  const market = new MarketCache({ root: path.join(t.dir, "packages"), allowHttp: false, allowPrivate: false, fetch: fakeFetch });
  await attachMarketReconcile(v.vault, market);
  const backups = new BackupService(v.vault, config, path.join(t.dir, "backups"), () => v.wiki.resync());
  const app = createApp({ ...v, config, admin: { backups }, market });
  const agentToken = config.issueToken("bot");
  config.setRule("bot", "/", "delete");
  const login = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse" }) });
  const cookie = { cookie: login.headers.get("set-cookie")!.split(";")[0]! };
  const device = await (
    await app.request("/api/auth/device", { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse", name: "노트북" }) })
  ).json();
  return { ...v, app, market, cookie, agent: { authorization: `Bearer ${agentToken}` }, device: { authorization: `Bearer ${device.token as string}` } };
}

beforeEach(async () => {
  calls.length = 0;
  env = await setup();
});
afterEach(() => cleanup());

const e = () => lockOf("@me/clock", "1.0.0");
const fileQuery = (p: string, sha: string) =>
  `/api/market/file?id=${encodeURIComponent("@me/clock")}&version=1.0.0&path=${encodeURIComponent(p)}&sha256=${sha}`;
const ensureBody = (entry: LockEntry, id = "@me/clock") => JSON.stringify({ id, entry });

describe("권한", () => {
  it("로그인 없이 401, 에이전트는 쓰기 규칙이 / 전체여도 403 market_owner_only", async () => {
    const { app, agent } = env;
    const paths: [string, RequestInit][] = [
      [`/api/market/index?repo=${encodeURIComponent(REPO)}`, {}],
      [`/api/market/index?repo=${encodeURIComponent(REPO)}&fresh=1`, {}],
      ["/api/market/ensure", { method: "POST", headers: json, body: ensureBody(e()) }],
      [fileQuery("frame.js", e().sha256["frame.js"]!), {}],
      ["/api/market/status", {}],
    ];
    for (const [p, init] of paths) {
      expect((await app.request(p, init)).status, p).toBe(401);
      const r = await app.request(p, { ...init, headers: { ...(init.headers as Record<string, string>), ...agent } });
      expect(r.status, p).toBe(403);
      expect((await r.json()).code).toBe("market_owner_only");
    }
    expect(calls).toEqual([]);
  });

  it("기기 토큰은 200 이고 다른 출처가 읽을 수 있다, 쿠키 로그인도 200", async () => {
    const { app, device, cookie } = env;
    const r = await app.request("/api/market/status", { headers: { ...device, origin: "tauri://localhost" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const idx = await app.request(`/api/market/index?repo=${encodeURIComponent(REPO)}`, { headers: device });
    expect(idx.status).toBe(200);
    expect(Object.keys((await idx.json()).index.packages).sort()).toEqual([
      "@me/clock",
      "@me/counter",
      "@me/editor",
      "@me/fog",
      "@me/ja",
      "@me/paper",
      "@me/probe",
      "@me/sea",
      "@me/silent",
      "@me/sketch",
    ]);
    expect((await app.request("/api/market/status", { headers: cookie })).status).toBe(200);
  });

  it("fresh=1 은 소유자에게 200 이고 캐시를 건너뛴다(10초 바닥 — 시험 안에서는 바로 다시 받지 않음)", async () => {
    const { app, device } = env;
    const q = `/api/market/index?repo=${encodeURIComponent(REPO)}`;
    expect((await app.request(q, { headers: device })).status).toBe(200);
    const n = calls.length;
    const r = await app.request(`${q}&fresh=1`, { headers: device });
    expect(r.status).toBe(200);
    expect(calls.length).toBe(n);
  });
});

describe("받게 하기와 파일", () => {
  it("ensure 뒤 file 은 픽스처 바이트, 실행할 수 없는 헤더", async () => {
    const { app, cookie } = env;
    const r = await app.request("/api/market/ensure", { method: "POST", headers: { ...json, ...cookie }, body: ensureBody(e()) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const f = await app.request(fileQuery("frame.js", e().sha256["frame.js"]!), { headers: cookie });
    expect(f.status).toBe(200);
    expect(Buffer.from(await f.arrayBuffer()).equals(await readFile(path.join(fixture, "packages/me/clock/1.0.0/frame.js")))).toBe(true);
    expect(f.headers.get("content-type")).toBe("application/octet-stream");
    expect(f.headers.get("x-content-type-options")).toBe("nosniff");
    expect(f.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(f.headers.get("content-disposition")).toBe("attachment");
    expect((await app.request(fileQuery("frame.js", "0".repeat(64)), { headers: cookie })).status).toBe(404);
  });

  it("경로 탈출은 400/404 이고 설정 파일 바이트가 응답에 없다", async () => {
    const { app, cookie } = env;
    await app.request("/api/market/ensure", { method: "POST", headers: { ...json, ...cookie }, body: ensureBody(e()) });
    for (const p of ["../../config/keyring.json", "../../../config/keyring.json", "/etc/passwd"]) {
      const r = await app.request(fileQuery(p, "a".repeat(64)), { headers: cookie });
      expect([400, 404], p).toContain(r.status);
      expect(await r.text()).not.toContain("passwordHash");
    }
  });

  it("sha 가 틀린 항목은 400 market_hash_mismatch(path), 잠금에 없는 id 라 status 에는 없다", async () => {
    const { app, cookie } = env;
    const bad = { ...e(), sha256: { ...e().sha256, "frame.js": "f".repeat(64) } };
    const r = await app.request("/api/market/ensure", { method: "POST", headers: { ...json, ...cookie }, body: ensureBody(bad) });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.code).toBe("market_hash_mismatch");
    expect(body.params.path).toBe("frame.js");
    const s = await (await app.request("/api/market/status", { headers: cookie })).json();
    // status 는 잠금의 패키지별 — 잠금에 없는 id 의 실패는 ensure 응답으로만 간다(리뷰 L1)
    expect(s["@me/clock"]).toBeUndefined();
  });

  it("POST 는 JSON 만(415)", async () => {
    const { app, cookie } = env;
    const r = await app.request("/api/market/ensure", { method: "POST", headers: { "content-type": "text/plain", ...cookie }, body: ensureBody(e()) });
    expect(r.status).toBe(415);
  });
});

describe("잠금 쓰기 = 설치", () => {
  it("소유자가 공통 설정에 잠금 항목을 쓰면 서버가 받아 둔다, 에이전트는 공통 설정을 쓸 수 없다", async () => {
    const { app, cookie, agent } = env;
    const content = setVaultSetting(null, ["marketplace", "packages", "@me/clock"], lockEntryValue(e()));
    const denied = await app.request("/api/file", {
      method: "PUT",
      headers: { ...json, ...agent },
      body: JSON.stringify({ path: "keyring-settings.md", content, baseHash: null }),
    });
    expect(denied.status).toBe(403);
    const ok = await app.request("/api/file", {
      method: "PUT",
      headers: { ...json, ...cookie },
      body: JSON.stringify({ path: "keyring-settings.md", content, baseHash: null }),
    });
    expect(ok.status).toBe(200);
    let status = 0;
    for (let i = 0; i < 50 && status !== 200; i++) {
      await new Promise((r) => setTimeout(r, 20));
      status = (await app.request(fileQuery("frame.js", e().sha256["frame.js"]!), { headers: cookie })).status;
    }
    expect(status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
  });
});
