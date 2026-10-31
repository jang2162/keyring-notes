import { describe, expect, it, vi } from "vitest";
import swSource from "../public/sw.js?raw";

type Handler = (e: unknown) => void;

/** sw.js 를 가짜 self·caches 와 함께 돌린다. 빌드 id 자리는 build 로 채운다(빌드 때 vite.config.ts 가 하는 일) */
function loadWorker(build: string, cacheKeys: string[]) {
  const handlers = new Map<string, Handler>();
  const deleted: string[] = [];
  const self = {
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    clients: { claim: vi.fn(async () => undefined) },
    navigator: {},
    skipWaiting: vi.fn(async () => undefined),
  };
  const caches = {
    keys: async () => [...cacheKeys],
    delete: async (key: string) => (deleted.push(key), true),
    open: async () => ({ match: async () => undefined, put: async () => undefined, addAll: async () => undefined }),
    match: async () => undefined,
  };
  const fetch = vi.fn(async () => new Response(""));
  new Function("self", "caches", "fetch", swSource.replace("__KEYRING_BUILD__", build))(self, caches, fetch);
  /** 처리기를 부르고 waitUntil 로 넘긴 일이 끝날 때까지 기다린다 */
  async function fire(type: string, event: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    handlers.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }
  return { fire, deleted, self };
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
});
