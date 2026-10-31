import { describe, expect, it, vi } from "vitest";
import swSource from "../public/sw.js?raw";

type Handler = (e: unknown) => void;

interface WorkerOptions {
  /** 네트워크 가짜(기본: 빈 200 응답) */
  fetch?: (req: unknown) => Promise<Response>;
  /** 나중에 불러오는 자산 목록(빌드 때 채우는 LAZY). 없으면 자리표시 글 그대로라 warmLazy 가 돌지 않는다 */
  lazy?: string[];
}

/** sw.js 를 가짜 self·caches 와 함께 돌린다. 빌드 id 자리는 build 로 채운다(빌드 때 vite.config.ts 가 하는 일) */
function loadWorker(build: string, cacheKeys: string[], opts: WorkerOptions = {}) {
  const handlers = new Map<string, Handler>();
  const deleted: string[] = [];
  /** 캐시에 넣은 것: [캐시 이름, 요청 주소] */
  const puts: [string, string][] = [];
  const self = {
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    clients: { claim: vi.fn(async () => undefined) },
    navigator: {},
    skipWaiting: vi.fn(async () => undefined),
  };
  const url = (req: unknown) => (typeof req === "string" ? req : (req as Request).url);
  const caches = {
    keys: async () => [...cacheKeys],
    delete: async (key: string) => (deleted.push(key), true),
    open: async (name: string) => ({
      match: async () => undefined,
      put: async (req: unknown) => void puts.push([name, url(req)]),
      addAll: async () => undefined,
    }),
    match: async () => undefined,
  };
  const fetch = opts.fetch ?? (async () => new Response(""));
  const location = { origin: "http://localhost" };
  new Function(
    "self",
    "caches",
    "fetch",
    "location",
    swSource.replace("__KEYRING_BUILD__", build).replace('"__KEYRING_LAZY__"', opts.lazy ? JSON.stringify(opts.lazy) : '"__KEYRING_LAZY__"'),
  )(self, caches, fetch, location);
  /** 처리기를 부르고 waitUntil·respondWith 로 넘긴 일이 끝날 때까지 기다린다 */
  async function fire(type: string, event: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    handlers.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }
  return { fire, deleted, puts, self };
}

describe("sw.js", () => {
  it("activate 는 지금 빌드와 바로 앞 빌드 캐시를 남기고 더 오래된 것만 지운다", async () => {
    const w = loadWorker("b0005", ["keyring-shell-b0001", "keyring-shell-b0003", "keyring-shell-b0005", "other-cache"]);
    await w.fire("activate");
    expect(w.deleted).toEqual(["keyring-shell-b0001"]);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it("빌드 id 는 36진수 크기로 비교한다(글자 순서가 아니다)", async () => {
    // "z" 는 글자 순서로 "10" 보다 뒤지만 36진수로는 35 < 36
    const w = loadWorker("11", ["keyring-shell-z", "keyring-shell-10", "keyring-shell-11"]);
    await w.fire("activate");
    expect(w.deleted).toEqual(["keyring-shell-z"]);
  });

  it("되돌린 배포(지금 빌드가 더 옛것)에서도 다른 것 중 가장 새것 하나를 남긴다", async () => {
    const w = loadWorker("b0005", ["keyring-shell-b0007", "keyring-shell-b0005", "keyring-shell-b0009"]);
    await w.fire("activate");
    expect(w.deleted).toEqual(["keyring-shell-b0007"]);
  });

  it("옛 캐시가 없으면 아무것도 지우지 않는다", async () => {
    const w = loadWorker("b0005", ["keyring-shell-b0005", "other-cache"]);
    await w.fire("activate");
    expect(w.deleted).toEqual([]);
  });

  it("build 메시지에 포트로 빌드 id 를 답한다", async () => {
    const w = loadWorker("b0005", []);
    const port = { postMessage: vi.fn() };
    await w.fire("message", { data: { type: "build" }, ports: [port] });
    expect(port.postMessage).toHaveBeenCalledWith("b0005");
  });

  it("다른 메시지·포트 없는 메시지는 무시한다(던지지 않는다)", async () => {
    const w = loadWorker("b0005", []);
    const port = { postMessage: vi.fn() };
    await expect(w.fire("message", { data: { type: "other" }, ports: [port] })).resolves.toBeUndefined();
    await expect(w.fire("message", { data: { type: "build" }, ports: [] })).resolves.toBeUndefined();
    await expect(w.fire("message", { data: null })).resolves.toBeUndefined();
    expect(port.postMessage).not.toHaveBeenCalled();
  });
  it("precache 가 실패하면(설치 중 오프라인 등) 그 빌드 캐시를 지운다 — 반쪽 캐시가 「바로 앞 빌드」 로 남지 않게", async () => {
    const w = loadWorker("b0005", [], { fetch: async () => Promise.reject(new TypeError("Failed to fetch")) });
    await expect(w.fire("install")).rejects.toThrow("Failed to fetch");
    expect(w.deleted).toEqual(["keyring-shell-b0005"]);
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });

  it("precache 가 성공하면 캐시를 지우지 않고 바로 자리를 잡는다", async () => {
    const w = loadWorker("b0005", [], { fetch: async () => new Response('<script src="/assets/index-a.js"></script>') });
    await w.fire("install");
    expect(w.deleted).toEqual([]);
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });
  it("/assets 요청에 HTML 이 오면(SPA 대체 응답 — 다른 프록시·옛 서버) 캐시하지 않는다", async () => {
    const w = loadWorker("b0005", [], { fetch: async () => new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=UTF-8" } }) });
    await w.fire("fetch", { request: new Request("http://localhost/assets/gone-chunk-zz9.js") });
    await new Promise((r) => setTimeout(r, 10));
    expect(w.puts).toEqual([]);
  });

  it("/assets 요청에 JS 가 오면 그 빌드 캐시에 넣는다", async () => {
    const w = loadWorker("b0005", [], { fetch: async () => new Response("export {};", { headers: { "content-type": "text/javascript" } }) });
    await w.fire("fetch", { request: new Request("http://localhost/assets/index-a.js") });
    await new Promise((r) => setTimeout(r, 10));
    expect(w.puts).toEqual([["keyring-shell-b0005", "http://localhost/assets/index-a.js"]]);
  });

  it("나중에 불러오는 자산을 미리 받을 때도(warmLazy) HTML 대체 응답은 캐시하지 않는다", async () => {
    const w = loadWorker("b0005", [], {
      lazy: ["/assets/gone-zz9.js", "/assets/katex-a.js"],
      fetch: async (req) =>
        String(req).includes("gone")
          ? new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=UTF-8" } })
          : new Response("export {};", { headers: { "content-type": "text/javascript" } }),
    });
    await w.fire("activate");
    await new Promise((r) => setTimeout(r, 10));
    expect(w.puts).toEqual([["keyring-shell-b0005", "/assets/katex-a.js"]]);
  });
});
