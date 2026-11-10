import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startMarketServer, type MarketServer } from "../src/marketServe.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "market");
let dir: string;
let srv: MarketServer;
let base: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "keyring-serve-"));
  await cp(path.join(fixture, "packages"), path.join(dir, "repo", "packages"), { recursive: true });
  await writeFile(path.join(dir, "secret.txt"), "secret");
  srv = await startMarketServer({ root: path.join(dir, "repo"), host: "127.0.0.1", port: 0, rebuildMs: 0 });
  base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await srv.close();
  await rm(dir, { recursive: true, force: true });
});

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("마켓 정적 서버", () => {
  it("시작 때 index.json 을 만들고 그 sha256 이 내주는 파일과 같다", async () => {
    const res = await fetch(`${base}/index.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-encoding")).toBeNull();
    const index = await res.json();
    for (const f of index.packages["@me/clock"].versions["1.0.0"].files) {
      const r = await fetch(`${base}/packages/me/clock/1.0.0/${f.path}`);
      expect(r.status, f.path).toBe(200);
      expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(r.headers.get("content-type")).toBe("application/octet-stream");
      expect(sha(new Uint8Array(await r.arrayBuffer()))).toBe(f.sha256);
    }
  });

  it("판을 하나 더 넣고 다시 만들면 index.json 에 보인다", async () => {
    const src = path.join(dir, "repo", "packages", "me", "sea", "0.1.0", "keyring-package.json");
    const m = JSON.parse(await readFile(src, "utf8"));
    await mkdir(path.join(dir, "repo", "packages", "me", "sea", "0.2.0"), { recursive: true });
    await writeFile(path.join(dir, "repo", "packages", "me", "sea", "0.2.0", "keyring-package.json"), JSON.stringify({ ...m, version: "0.2.0" }));
    await srv.rebuild();
    const index = await (await fetch(`${base}/index.json`)).json();
    expect(Object.keys(index.packages["@me/sea"].versions)).toEqual(["0.1.0", "0.2.0"]);
  });

  it("폴더 밖·숨김·링크·허용 꼴이 아닌 경로는 내주지 않는다", async () => {
    await symlink(path.join(dir, "secret.txt"), path.join(dir, "repo", "packages", "me", "clock", "1.0.0", "messages", "en.json"));
    await symlink(path.join(dir), path.join(dir, "repo", "packages", "me", "clock", "9.9.9"));
    for (const p of [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/packages/me/clock/1.0.0/..%2f..%2f..%2f..%2fsecret.txt",
      "/packages/me/clock/1.0.0/messages/en.json",
      "/packages/me/clock/9.9.9/secret.txt",
      "/packages/me/clock/1.0.0/.keyring-cache.json",
      "/packages/me/clock/1.0.0/notes.txt",
      "/packages/",
      "/",
      "/index.json.tmp-1",
    ]) {
      const r = await fetch(`${base}${p}`);
      expect(r.status, p).toBe(404);
      expect(await r.text(), p).not.toContain("secret");
    }
    expect((await fetch(`${base}/index.json`, { method: "POST" })).status).toBe(405);
    // 중간 폴더 링크(messages -> 밖)도 따라가지 않는다
    await mkdir(path.join(dir, "outside"), { recursive: true });
    await writeFile(path.join(dir, "outside", "ko.json"), '"secret"');
    await rm(path.join(dir, "repo", "packages", "me", "clock", "1.0.0", "messages"), { recursive: true });
    await symlink(path.join(dir, "outside"), path.join(dir, "repo", "packages", "me", "clock", "1.0.0", "messages"));
    const r = await fetch(`${base}/packages/me/clock/1.0.0/messages/ko.json`);
    expect(r.status).toBe(404);
  });
});
