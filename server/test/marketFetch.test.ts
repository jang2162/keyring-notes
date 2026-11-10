import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PathError } from "@keyring-notes/core";
import { afterEach, describe, expect, it } from "vitest";
import { checkUrl, marketFetch, type MarketFetchOptions } from "../src/marketFetch.js";
import { isPrivateAddress, type LookupFn } from "../src/netGuard.js";

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

async function serve(handler: http.RequestListener, host = "127.0.0.1"): Promise<TestServer> {
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
    srv.listen(0, host, () => resolve());
  });
  t.port = (srv.address() as AddressInfo).port;
  servers.push(t);
  return t;
}

const ok =
  (body = "hello"): http.RequestListener =>
  (_req, res) =>
    res.end(body);

function resolver(address: string): LookupFn & { calls: number } {
  const fn: LookupFn & { calls: number } = Object.assign(
    async () => {
      fn.calls++;
      return [{ address, family: (address.includes(":") ? 6 : 4) as 4 | 6 }];
    },
    { calls: 0 },
  );
  return fn;
}

const base: MarketFetchOptions = { allowHttp: true, allowPrivate: false, maxBytes: 1_000_000, timeoutMs: 5000 };

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof PathError ? e.code : `other: ${String(e)}`;
  }
  return "no error";
}

async function err(p: Promise<unknown>): Promise<PathError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PathError) return e;
    throw e;
  }
  throw new Error("no error");
}

describe("주소 판정", () => {
  it("http 는 허용할 때만 — 접속 0", async () => {
    const s = await serve(ok());
    expect(await code(marketFetch(`http://127.0.0.1:${s.port}/x`, { ...base, allowHttp: false, allowPrivate: true }))).toBe("market_url_protocol");
    expect(s.connections).toBe(0);
    expect(() => checkUrl(new URL("http://x/"), { allowHttp: false, allowPrivate: false })).toThrow(PathError);
    expect(() => checkUrl(new URL("https://u:p@x/"), { allowHttp: false, allowPrivate: false })).toThrow(/./);
  });

  it("사설로 풀리는 이름 — 접속 0, 풀이는 한 번(판정한 풀이가 접속에 쓰인다)", async () => {
    const s = await serve(ok());
    const r = resolver("127.0.0.1");
    expect(await code(marketFetch(`http://repo.test:${s.port}/x`, { ...base, resolve: r }))).toBe("market_private_address");
    expect(s.connections).toBe(0);
    expect(r.calls).toBe(1);
  });

  it("허용하면 우리 풀이로 시험 서버에 닿는다(repo.test 는 실제 DNS 에 없다)", async () => {
    const s = await serve(ok("bytes"));
    const r = resolver("127.0.0.1");
    const b = await marketFetch(`http://repo.test:${s.port}/x`, { ...base, allowPrivate: true, resolve: r });
    expect(Buffer.from(b).toString()).toBe("bytes");
    expect(s.requests[0]!.headers.host).toBe(`repo.test:${s.port}`);
    expect(r.calls).toBe(1);
  });

  it("IP 글자는 lookup 을 타지 않으므로 따로 막는다 — 접속 0, 풀이 0", async () => {
    const s = await serve(ok());
    const r = resolver("1.1.1.1");
    for (const u of [
      `http://127.0.0.1:${s.port}/x`,
      `http://[::ffff:7f00:1]:${s.port}/x`,
      `http://[::ffff:127.0.0.1]:${s.port}/x`,
      `http://2130706433:${s.port}/x`,
      `http://0x7f.1:${s.port}/x`,
    ]) {
      expect(await code(marketFetch(u, { ...base, resolve: r })), u).toBe("market_private_address");
    }
    expect(new URL(`http://2130706433:${s.port}/`).hostname).toBe("127.0.0.1");
    expect(new URL(`http://[::ffff:127.0.0.1]/`).hostname).toBe("[::ffff:7f00:1]");
    expect(s.connections).toBe(0);
    expect(r.calls).toBe(0);
  });

  it("[::1] 도 대괄호를 벗겨 막는다(IPv6 루프백 시험 서버, 접속 0)", async (ctx) => {
    let s6: TestServer;
    try {
      s6 = await serve(ok(), "::1");
    } catch {
      ctx.skip(); // 이 기계에 IPv6 루프백이 없음
      return;
    }
    expect(await code(marketFetch(`http://[::1]:${s6.port}/x`, base))).toBe("market_private_address");
    expect(s6.connections).toBe(0);
  });

  it("zone 이 붙은 풀이 결과도 벗겨 판정", async () => {
    expect(await code(marketFetch("http://repo.test/x", { ...base, resolve: resolver("fe80::1%en0") }))).toBe("market_private_address");
  });

  it("접속한 소켓의 주소를 한 번 더 본다(둘째 줄)", async () => {
    const s = await serve(ok());
    // 판정 함수가 풀이 때는 공개라고 답해도(첫 줄을 뚫은 경우) 소켓 주소에서 끊는다
    let n = 0;
    const isPrivate = (ip: string) => (n++ === 0 ? false : isPrivateAddress(ip));
    expect(await code(marketFetch(`http://repo.test:${s.port}/x`, { ...base, resolve: resolver("127.0.0.1"), isPrivate }))).toBe("market_private_address");
    expect(s.requests).toHaveLength(0);
  });
});

describe("리다이렉트", () => {
  // 127.0.0.1 을 「공개」 로 보는 판정 — 이 기계 밖으로 나가지 않고 「공개 저장소에서 사설로 보내는」 경우를 만든다
  const loopbackIsPublic = (ip: string) => (ip === "127.0.0.1" ? false : isPrivateAddress(ip));

  it("공개에서 사설 IP 글자·사설로 풀리는 이름으로 보내면 거부", async () => {
    const s = await serve((req, res) => {
      if (req.url === "/a") res.writeHead(302, { location: "http://10.0.0.1/b" }).end();
      else if (req.url === "/c") res.writeHead(302, { location: "http://inner.test/d" }).end();
      else res.end("x");
    });
    const r: LookupFn = async (h) => [{ address: h === "inner.test" ? "192.168.0.10" : "127.0.0.1", family: 4 }];
    const opts = { ...base, resolve: r, isPrivate: loopbackIsPublic };
    expect(await code(marketFetch(`http://pub.test:${s.port}/a`, opts))).toBe("market_private_address");
    expect(await code(marketFetch(`http://pub.test:${s.port}/c`, opts))).toBe("market_private_address");
    expect(s.requests.map((q) => q.url)).toEqual(["/a", "/c"]);
  });

  it("다섯 번까지, 여섯 번째는 market_too_many_redirects, 주소 판정은 홉마다", async () => {
    const s = await serve((req, res) => {
      const n = Number(req.url!.slice(1));
      if (n < 6) res.writeHead(302, { location: `/${n + 1}` }).end();
      else res.end("done");
    });
    const opts = { ...base, allowPrivate: true };
    expect(await code(marketFetch(`http://127.0.0.1:${s.port}/0`, opts))).toBe("market_too_many_redirects");
    let checks = 0;
    const check: typeof checkUrl = (u, o) => {
      checks++;
      checkUrl(u, o);
    };
    expect(Buffer.from(await marketFetch(`http://127.0.0.1:${s.port}/1`, { ...opts, check })).toString()).toBe("done");
    expect(checks).toBe(6);
  });

  it("location 에 사용자 정보가 있으면 거부", async () => {
    const s = await serve((_req, res) => res.writeHead(302, { location: "http://u:p@127.0.0.1/x" }).end());
    expect(await code(marketFetch(`http://127.0.0.1:${s.port}/a`, { ...base, allowPrivate: true }))).toBe("market_url_credentials");
  });
});

describe("크기", () => {
  it("content-length 없이 상한을 넘으면 그 자리에서 끊는다", async () => {
    let closedEarly = false;
    let written = 0;
    const total = 50 * 1024 * 1024;
    const s = await serve((_req, res) => {
      const chunk = Buffer.alloc(64 * 1024, 1);
      res.on("close", () => {
        if (written < total) closedEarly = true;
      });
      const pump = () => {
        while (written < total) {
          written += chunk.length;
          if (!res.write(chunk)) return void res.once("drain", pump);
        }
        res.end();
      };
      pump();
    });
    expect(await code(marketFetch(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true, maxBytes: 100_000 }))).toBe("market_too_large");
    await new Promise((r) => setTimeout(r, 100));
    expect(closedEarly).toBe(true);
  });

  it("expectSize 와 다르면 market_size_mismatch", async () => {
    const s = await serve(ok("12345678901"));
    expect(await code(marketFetch(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true, expectSize: 10 }))).toBe("market_size_mismatch");
    expect(await code(marketFetch(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true, expectSize: 12 }))).toBe("market_size_mismatch");
    expect(Buffer.from(await marketFetch(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true, expectSize: 11 })).toString()).toBe("12345678901");
  });

  it("content-length 가 상한보다 크면 본문을 기다리지 않고 오류", async () => {
    const s = await serve((_req, res) => {
      res.writeHead(200, { "content-length": "10000000" });
      res.flushHeaders();
    });
    const t = Date.now();
    expect(await code(marketFetch(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true, maxBytes: 1000 }))).toBe("market_too_large");
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe("시간", () => {
  it("헤더 뒤 멈춤 → market_timeout", async () => {
    const s = await serve((_req, res) => {
      res.writeHead(200);
      res.write("partial");
    });
    expect(await code(marketFetch(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true, timeoutMs: 200 }))).toBe("market_timeout");
  });

  it("리다이렉트를 넘어 전체에 건다(홉마다 150ms × 3 > 300ms)", async () => {
    const s = await serve((req, res) => {
      const n = Number(req.url!.slice(1));
      setTimeout(() => (n < 3 ? res.writeHead(302, { location: `/${n + 1}` }).end() : res.end("done")), 150);
    });
    expect(await code(marketFetch(`http://127.0.0.1:${s.port}/1`, { ...base, allowPrivate: true, timeoutMs: 300 }))).toBe("market_timeout");
  });
});

describe("응답과 요청 헤더", () => {
  it("압축 응답은 거부(풀지 않는다), identity 는 받는다", async () => {
    const s = await serve((req, res) => {
      const enc = req.url!.slice(1);
      res.writeHead(200, { "content-encoding": enc });
      res.end("raw");
    });
    for (const enc of ["gzip", "br"]) {
      const e = await err(marketFetch(`http://127.0.0.1:${s.port}/${enc}`, { ...base, allowPrivate: true }));
      expect(e.code).toBe("market_fetch_failed");
      expect(e.params.reason).toBe("content-encoding");
    }
    expect(Buffer.from(await marketFetch(`http://127.0.0.1:${s.port}/identity`, { ...base, allowPrivate: true })).toString()).toBe("raw");
  });

  it("쿠키·인증 헤더를 보내지 않고 accept-encoding: identity", async () => {
    const s = await serve(ok());
    await marketFetch(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true });
    const h = s.requests[0]!.headers;
    expect(h.cookie).toBeUndefined();
    expect(h.authorization).toBeUndefined();
    expect(h["accept-encoding"]).toBe("identity");
  });

  it("200 이 아니면 market_fetch_failed(상태)", async () => {
    const s = await serve((_req, res) => res.writeHead(404).end("no"));
    const e = await err(marketFetch(`http://127.0.0.1:${s.port}/x`, { ...base, allowPrivate: true }));
    expect(e.code).toBe("market_fetch_failed");
    expect(e.params.reason).toBe("http_404");
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

  it("전역 agent 를 쓰지 않는다 — 프록시가 받은 요청 0", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "keyring-proxy-"));
    try {
      await writeFile(
        path.join(dir, "run.mts"),
        `import { marketFetch } from ${JSON.stringify(path.join(serverDir, "src", "marketFetch.ts"))};
const [port, allow] = process.argv.slice(2);
try {
  const b = await marketFetch("http://repo.test:" + port + "/x", { allowHttp: true, allowPrivate: allow === "1", maxBytes: 1000, timeoutMs: 5000, resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
  console.log("OK " + Buffer.from(b).toString());
} catch (e) {
  console.log("ERR " + (e.code ?? e.message));
}
`,
      );
      const target = await serve(ok("target"));
      const proxy = await serve(ok("proxy"));
      expect(await child(target.port, proxy.port, false, dir)).toBe("ERR market_private_address");
      expect(await child(target.port, proxy.port, true, dir)).toBe("OK target");
      expect(proxy.requests).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});
