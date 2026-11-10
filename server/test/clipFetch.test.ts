import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { PathError } from "@keyring-notes/core";
import { afterEach, describe, expect, it } from "vitest";
import { fetchUrl, type FetchOptions } from "../src/convert.js";
import { isPrivateAddress, type LookupFn } from "../src/netGuard.js";

// URL 수집(convert.ts fetchUrl, 위키 ingest 의 kind: "url")의 나가는 요청 지킴. 마켓 받기(marketFetch.test.ts)와 같은 지킴을 탄다.

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface TestServer {
  port: number;
  connections: number;
  requests: http.IncomingMessage[];
  close(): Promise<void>;
}

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function serve(handler: http.RequestListener, host = "127.0.0.1", port = 0): Promise<TestServer> {
  const srv = http.createServer(handler);
  const t: TestServer = {
    port: 0,
    connections: 0,
    requests: [],
    close: () =>
      new Promise<void>((resolve) => {
        srv.closeAllConnections();
        srv.close(() => resolve());
      }),
  };
  srv.on("connection", () => t.connections++);
  srv.on("request", (req) => t.requests.push(req));
  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(port, host, () => resolve());
  });
  t.port = (srv.address() as AddressInfo).port;
  servers.push(t);
  return t;
}

const ok =
  (body = "hello", type = "text/html; charset=utf-8"): http.RequestListener =>
  (_req, res) =>
    res.writeHead(200, { "content-type": type }).end(body);

/** 부를 때마다 다음 답(끝에 이르면 마지막 답을 되풀이) */
function sequence(...answers: string[]): LookupFn & { calls: number } {
  const fn: LookupFn & { calls: number } = Object.assign(
    async () => {
      const address = answers[Math.min(fn.calls, answers.length - 1)]!;
      fn.calls++;
      return [{ address, family: (address.includes(":") ? 6 : 4) as 4 | 6 }];
    },
    { calls: 0 },
  );
  return fn;
}

// 127.0.0.1 을 「공개」 로 보는 판정 — 이 기계 밖으로 나가지 않고 「공개 이름」 을 만든다. ::1 등 나머지는 원래 표대로
const loopbackIsPublic = (ip: string) => (ip === "127.0.0.1" ? false : isPrivateAddress(ip));

const base: FetchOptions = { allowPrivate: false, timeoutMs: 5000 };

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof PathError ? e.code : `other: ${String(e)}`;
  }
  return "no error";
}

/** 같은 포트로 127.0.0.1(공개 쪽)·::1(사설 쪽) 두 서버. ::1 이 없는 기계면 null */
async function pair(handler: http.RequestListener): Promise<{ pub: TestServer; priv: TestServer } | null> {
  const pub = await serve(handler);
  try {
    const priv = await serve(ok("PRIVATE"), "::1", pub.port);
    return { pub, priv };
  } catch {
    return null;
  }
}

describe("DNS 재바인딩", () => {
  it("공개 이름이 둘째 풀이에서 사설을 줘도 판정한 첫 풀이로 접속한다 — 사설 쪽 접속 0, 풀이 한 번", async (ctx) => {
    const p = await pair(ok("PUBLIC"));
    if (!p) return ctx.skip(); // 이 기계에 IPv6 루프백이 없음
    const r = sequence("127.0.0.1", "::1");
    const got = await fetchUrl(`http://rebind.test:${p.pub.port}/a`, { ...base, resolve: r, isPrivate: loopbackIsPublic });
    expect(Buffer.from(got.data).toString()).toBe("PUBLIC");
    expect(p.pub.requests[0]!.headers.host).toBe(`rebind.test:${p.pub.port}`);
    expect(p.priv.connections).toBe(0);
    expect(r.calls).toBe(1);
  });

  it("사설로 풀리는 이름 — private_address, 접속 0", async () => {
    const s = await serve(ok());
    const r = sequence("127.0.0.1");
    expect(await code(fetchUrl(`http://inner.test:${s.port}/x`, { ...base, resolve: r }))).toBe("private_address");
    expect(s.connections).toBe(0);
    expect(r.calls).toBe(1);
  });

  it("허용(KEYRING_FETCH_ALLOW_PRIVATE)하면 사설 이름에도 닿는다", async () => {
    const s = await serve(ok("inner"));
    const got = await fetchUrl(`http://inner.test:${s.port}/x`, { ...base, allowPrivate: true, resolve: sequence("127.0.0.1") });
    expect(Buffer.from(got.data).toString()).toBe("inner");
  });

  it("접속한 소켓의 주소를 한 번 더 본다(둘째 줄)", async () => {
    const s = await serve(ok());
    let n = 0;
    const isPrivate = (ip: string) => (n++ === 0 ? false : isPrivateAddress(ip));
    expect(await code(fetchUrl(`http://pub.test:${s.port}/x`, { ...base, resolve: sequence("127.0.0.1"), isPrivate }))).toBe("private_address");
    expect(s.requests).toHaveLength(0);
  });
});

describe("리다이렉트", () => {
  it("공개 → 사설 IP 글자·사설로 풀리는 이름·[::1] 로 보내면 거부 — 사설 쪽 접속 0", async (ctx) => {
    let port = 0;
    const p = await pair((req, res) => {
      if (req.url === "/a") res.writeHead(302, { location: "http://10.0.0.1/b" }).end();
      else if (req.url === "/c") res.writeHead(302, { location: `http://inner.test:${port}/d` }).end();
      else if (req.url === "/e") res.writeHead(302, { location: `http://[::1]:${port}/f` }).end();
      else res.end("x");
    });
    if (!p) return ctx.skip();
    port = p.pub.port;
    const r: LookupFn = async (h) => (h === "inner.test" ? [{ address: "::1", family: 6 }] : [{ address: "127.0.0.1", family: 4 }]);
    const opts = { ...base, resolve: r, isPrivate: loopbackIsPublic };
    for (const u of ["/a", "/c", "/e"]) expect(await code(fetchUrl(`http://pub.test:${port}${u}`, opts)), u).toBe("private_address");
    expect(p.pub.requests.map((q) => q.url)).toEqual(["/a", "/c", "/e"]);
    expect(p.priv.connections).toBe(0);
  });

  it("다섯 번까지 따라가고 여섯 번째는 too_many_redirects, 마지막 주소를 돌려준다", async () => {
    const s = await serve((req, res) => {
      const n = Number(req.url!.slice(1));
      if (n < 6) res.writeHead(302, { location: `/${n + 1}` }).end();
      else res.writeHead(200, { "content-type": "Text/Plain" }).end("done");
    });
    const opts = { ...base, allowPrivate: true };
    expect(await code(fetchUrl(`http://127.0.0.1:${s.port}/0`, opts))).toBe("too_many_redirects");
    const got = await fetchUrl(`http://127.0.0.1:${s.port}/1`, opts);
    expect(Buffer.from(got.data).toString()).toBe("done");
    expect(got.url).toBe(`http://127.0.0.1:${s.port}/6`);
    expect(got.contentType).toBe("text/plain");
  });

  it("location 에 사용자 정보·다른 스킴이면 거부", async () => {
    const s = await serve((req, res) => res.writeHead(302, { location: req.url === "/a" ? "http://u:p@127.0.0.1/x" : "file:///etc/passwd" }).end());
    expect(await code(fetchUrl(`http://127.0.0.1:${s.port}/a`, { ...base, allowPrivate: true }))).toBe("url_credentials");
    expect(await code(fetchUrl(`http://127.0.0.1:${s.port}/b`, { ...base, allowPrivate: true }))).toBe("url_protocol");
  });
});

describe("IP 글자 주소(lookup 을 타지 않는다)", () => {
  it("대괄호 IPv6·10진·짧은 꼴·IPv4 사상 — private_address, 접속 0, 풀이 0", async () => {
    const s = await serve(ok());
    const r = sequence("1.1.1.1");
    for (const u of [
      `http://127.0.0.1:${s.port}/x`,
      `http://2130706433:${s.port}/x`,
      `http://0x7f.1:${s.port}/x`,
      `http://127.1:${s.port}/x`,
      `http://[::ffff:7f00:1]:${s.port}/x`,
      `http://[::ffff:127.0.0.1]:${s.port}/x`,
    ]) {
      expect(await code(fetchUrl(u, { ...base, resolve: r })), u).toBe("private_address");
    }
    expect(s.connections).toBe(0);
    expect(r.calls).toBe(0);
  });

  it("[::1] — private_address, 접속 0", async (ctx) => {
    let s6: TestServer;
    try {
      s6 = await serve(ok(), "::1");
    } catch {
      return ctx.skip();
    }
    expect(await code(fetchUrl(`http://[::1]:${s6.port}/x`, base))).toBe("private_address");
    expect(s6.connections).toBe(0);
  });
});

describe("기존 동작", () => {
  it("http·https 밖의 스킴, 사용자 정보, 잘못된 주소", async () => {
    expect(await code(fetchUrl("file:///etc/passwd", base))).toBe("url_protocol");
    expect(await code(fetchUrl("http://u:p@example.com/", base))).toBe("url_credentials");
    expect(await code(fetchUrl("not a url", base))).toBe("url_invalid");
  });

  it("2xx 가 아니면 fetch_failed(HTTP 상태), location 없는 3xx 도", async () => {
    const s = await serve((req, res) => res.writeHead(req.url === "/a" ? 404 : 302).end("no"));
    for (const [u, st] of [
      ["/a", 404],
      ["/b", 302],
    ] as const) {
      try {
        await fetchUrl(`http://127.0.0.1:${s.port}${u}`, { ...base, allowPrivate: true });
        throw new Error("no error");
      } catch (e) {
        expect((e as PathError).code).toBe("fetch_failed");
        expect((e as PathError).params.reason).toBe(`HTTP ${st}`);
      }
    }
  });

  it("크기 상한 — content-length 로도, 받는 동안 세어도", async () => {
    const s = await serve((req, res) => {
      if (req.url === "/declared") res.writeHead(200, { "content-length": "5000" }).end(Buffer.alloc(5000));
      else {
        res.writeHead(200);
        for (let i = 0; i < 10; i++) res.write(Buffer.alloc(1000));
        res.end();
      }
    });
    const opts = { ...base, allowPrivate: true, maxBytes: 3000 };
    expect(await code(fetchUrl(`http://127.0.0.1:${s.port}/declared`, opts))).toBe("doc_too_large");
    expect(await code(fetchUrl(`http://127.0.0.1:${s.port}/chunked`, opts))).toBe("doc_too_large");
  });

  it("gzip 응답은 풀고, 풀린 크기로 상한을 잰다", async () => {
    const html = "<html><body>" + "가".repeat(2000) + "</body></html>";
    const s = await serve((_req, res) => res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(gzipSync(html)));
    const got = await fetchUrl(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true });
    expect(Buffer.from(got.data).toString()).toBe(html);
    expect(await code(fetchUrl(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true, maxBytes: 1000 }))).toBe("doc_too_large");
  });

  it("헤더 뒤 멈춤 — 시간 제한에 걸려 fetch_failed", async () => {
    const s = await serve((_req, res) => {
      res.writeHead(200);
      res.write("partial");
    });
    expect(await code(fetchUrl(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true, timeoutMs: 200 }))).toBe("fetch_failed");
  });

  it("쿠키·인증 헤더를 보내지 않는다", async () => {
    const s = await serve(ok());
    await fetchUrl(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true });
    const h = s.requests[0]!.headers;
    expect(h.cookie).toBeUndefined();
    expect(h.authorization).toBeUndefined();
    expect(h["user-agent"]).toContain("KeyringNotes");
  });
});

describe("프록시 환경 변수(NODE_USE_ENV_PROXY)", () => {
  function child(port: number, proxyPort: number, allowPrivate: boolean, dir: string): Promise<string> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_USE_ENV_PROXY: "1",
      HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
      HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
    };
    delete env.NO_PROXY;
    delete env.no_proxy;
    return new Promise((resolve) =>
      execFile(
        process.execPath,
        ["--conditions=keyring-source", "--import", "tsx", path.join(dir, "run.mts"), String(port), allowPrivate ? "1" : "0"],
        { cwd: serverDir, env },
        (_e, stdout, stderr) => resolve(stdout.trim() || stderr.trim()),
      ),
    );
  }

  it("프록시를 타지 않는다 — 프록시가 받은 요청 0", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "keyring-clip-proxy-"));
    try {
      await writeFile(
        path.join(dir, "run.mts"),
        `import { fetchUrl } from ${JSON.stringify(path.join(serverDir, "src", "convert.ts"))};
const [port, allow] = process.argv.slice(2);
try {
  const r = await fetchUrl("http://clip.test:" + port + "/x", { allowPrivate: allow === "1", timeoutMs: 5000, resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
  console.log("OK " + Buffer.from(r.data).toString());
} catch (e) {
  console.log("ERR " + (e.code ?? e.message));
}
`,
      );
      const target = await serve(ok("target"));
      const proxy = await serve(ok("proxy"));
      expect(await child(target.port, proxy.port, false, dir)).toBe("ERR private_address");
      expect(await child(target.port, proxy.port, true, dir)).toBe("OK target");
      expect(proxy.requests).toHaveLength(0);
      expect(proxy.connections).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});
