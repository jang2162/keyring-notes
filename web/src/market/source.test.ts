import { KeyedError, MARKET_LIMITS, OFFICIAL_REPO_URL, type LockEntry } from "@keyring-notes/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fallbackSource,
  marketMode,
  nativeSource,
  pickSource,
  readDeviceMarketSettings,
  serverSource,
  writeDeviceMarketSettings,
  type PackageSource,
} from "./source";

// 서버 시험과 같은 픽스처 저장소(pkg index 로 만든 것). web 은 Node 형식이 없어 Vite 의 ?raw 로 읽는다
const raw = import.meta.glob("../../../server/test/fixtures/market/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const PREFIX = "../../../server/test/fixtures/market/";
const index = JSON.parse(raw[`${PREFIX}index.json`]!);
const REPO = "https://repo.test/m/";

function lockOf(id: string, version: string, repo = REPO): LockEntry {
  const files = index.packages[id].versions[version].files as { path: string; sha256: string }[];
  return { version, repo, sha256: Object.fromEntries(files.map((f) => [f.path, f.sha256])) };
}
const bytesOf = (rel: string) => {
  const t = raw[`${PREFIX}${rel}`];
  if (t === undefined) throw new TypeError(`no fixture ${rel}`);
  return new TextEncoder().encode(t);
};

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof KeyedError ? e.code : e instanceof TypeError ? "TypeError" : `other: ${String(e)}`;
  }
  return "no error";
}

afterEach(() => vi.unstubAllGlobals());

describe("marketMode·pickSource", () => {
  it("설계 표의 다섯 줄", () => {
    expect(marketMode({ local: false, kind: null, sync: false })).toBe("server");
    expect(marketMode({ local: true, kind: "app", sync: false })).toBe("app");
    expect(marketMode({ local: true, kind: "app", sync: true })).toBe("app+sync");
    expect(marketMode({ local: true, kind: "browser", sync: true })).toBe("browser+sync");
    expect(marketMode({ local: true, kind: "browser", sync: false })).toBe("browser");
  });

  it("browser 는 받는 쪽 없음, app+sync 는 서버 먼저 그다음 네이티브", async () => {
    const device = { allowHttp: false, allowPrivate: false };
    expect(pickSource("browser", { device })).toBeNull();
    const calls: string[] = [];
    const fetchFn = vi.fn(async () => {
      calls.push("server");
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    const invoke = vi.fn(async () => {
      calls.push("native");
      return new TextEncoder().encode(JSON.stringify(index)).buffer as ArrayBuffer;
    });
    const s = pickSource("app+sync", { server: { base: "https://notes.example", fetchFn, token: "t" }, device, invokeFn: invoke })!;
    const r = await s.index(REPO);
    expect(calls).toEqual(["server", "native"]);
    expect(r.index).not.toBeNull();
    expect(pickSource("app", { device, invokeFn: invoke })).not.toBeNull();
    expect(pickSource("browser+sync", { server: { base: "https://notes.example", fetchFn, token: "t" }, device })).not.toBeNull();
  });
});

describe("serverSource", () => {
  function fakeServer(override: Record<string, Response> = {}) {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      const u = new URL(url, "https://notes.example");
      if (override[u.pathname]) return override[u.pathname]!.clone();
      if (u.pathname === "/api/market/ensure") return Response.json({ ok: true });
      if (u.pathname === "/api/market/file") {
        const id = u.searchParams.get("id")!.slice(1);
        return new Response(bytesOf(`packages/${id}/${u.searchParams.get("version")}/${u.searchParams.get("path")}`));
      }
      if (u.pathname === "/api/market/index") return Response.json({ repo: REPO, index, ignored: [] });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    return { fetchFn, requests };
  }

  it("ensure 를 POST·JSON·Bearer 로, 파일마다 sha256 을 붙여 받고 화면에서 다시 잰다", async () => {
    const { fetchFn, requests } = fakeServer();
    const e = lockOf("@me/clock", "1.0.0");
    const files = await serverSource("https://notes.example", fetchFn, "tok").fetch("@me/clock", e);
    expect([...files.keys()].sort()).toEqual(Object.keys(e.sha256).sort());
    const ensure = requests[0]!;
    expect(ensure.url).toBe("https://notes.example/api/market/ensure");
    expect(ensure.init?.method).toBe("POST");
    expect((ensure.init!.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect((ensure.init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
    for (const r of requests.slice(1)) expect(r.url).toMatch(/sha256=[0-9a-f]{64}/);
  });

  it("index 는 fresh 일 때만 fresh=1 을 붙인다", async () => {
    const { fetchFn, requests } = fakeServer();
    const s = serverSource("", fetchFn);
    await s.index(REPO);
    await s.index(REPO, { fresh: true });
    expect(requests.map((r) => r.url)).toEqual([
      `/api/market/index?repo=${encodeURIComponent(REPO)}`,
      `/api/market/index?repo=${encodeURIComponent(REPO)}&fresh=1`,
    ]);
  });

  it("토큰이 없으면 authorization 을 보내지 않는다(같은 출처 쿠키)", async () => {
    const { fetchFn, requests } = fakeServer();
    await serverSource("", fetchFn).fetch("@me/clock", lockOf("@me/clock", "1.0.0"));
    expect((requests[0]!.init!.headers as Record<string, string>).authorization).toBeUndefined();
    expect(requests[0]!.url).toBe("/api/market/ensure");
  });

  it("서버가 준 바이트의 sha 가 다르면 market_hash_mismatch, 서버 오류는 같은 코드", async () => {
    const { fetchFn } = fakeServer({ "/api/market/file": new Response("tampered") });
    expect(await codeOf(serverSource("", fetchFn).fetch("@me/clock", lockOf("@me/clock", "1.0.0")))).toBe("market_hash_mismatch");
    const bad = fakeServer({ "/api/market/ensure": Response.json({ code: "market_private_address", params: { host: "x" } }, { status: 400 }) });
    expect(await codeOf(serverSource("", bad.fetchFn).fetch("@me/clock", lockOf("@me/clock", "1.0.0")))).toBe("market_private_address");
  });
});

describe("fallbackSource", () => {
  const fail = (e: unknown): PackageSource => ({
    index: async () => {
      throw e;
    },
    fetch: async () => {
      throw e;
    },
  });
  const okSource = (): PackageSource & { calls: number } => {
    const s = {
      calls: 0,
      index: async () => (s.calls++, { repo: REPO, index: null, ignored: [] }),
      fetch: async () => (s.calls++, new Map<string, Uint8Array>()),
    };
    return s;
  };
  const e = lockOf("@me/clock", "1.0.0");

  it("닿지 못함·사설 거부·http 거부·시간·리다이렉트·401 이면 대신 받는다", async () => {
    const unauthorized = Object.assign(new KeyedError("device_unauthorized"), { status: 401 });
    for (const err of [
      new TypeError("offline"),
      new KeyedError("market_private_address"),
      new KeyedError("market_fetch_failed", { reason: "x" }),
      new KeyedError("market_url_protocol"),
      new KeyedError("market_timeout"),
      new KeyedError("market_too_many_redirects"),
      unauthorized,
    ]) {
      const b = okSource();
      await fallbackSource(fail(err), b).fetch("@me/clock", e);
      expect(b.calls, String(err)).toBe(1);
    }
  });

  it("파일 자체의 문제면 대신 받지 않는다", async () => {
    for (const code of ["market_hash_mismatch", "market_size_mismatch", "market_manifest_invalid", "market_not_found", "market_scope_reserved"]) {
      const b = okSource();
      expect(await codeOf(fallbackSource(fail(new KeyedError(code)), b).fetch("@me/clock", e))).toBe(code);
      expect(b.calls, code).toBe(0);
    }
  });

  it("index 가 대신 받는 오류를 결과로 주면 그때도", async () => {
    const primary: PackageSource = {
      index: async () => ({ repo: REPO, index: null, ignored: [], error: { code: "market_private_address", params: {} } }),
      fetch: async () => new Map(),
    };
    const b = okSource();
    await fallbackSource(primary, b).index(REPO);
    expect(b.calls).toBe(1);
  });
});

describe("nativeSource", () => {
  function fakeInvoke(override: Record<string, Uint8Array | string> = {}) {
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    const fn = async (cmd: string, args: unknown): Promise<ArrayBuffer> => {
      const a = args as Record<string, unknown>;
      calls.push({ cmd, args: a });
      const url = a.url as string;
      const o = override[url];
      if (typeof o === "string") throw o;
      const bytes = o ?? bytesOf(url.replace(REPO, "").replace(OFFICIAL_REPO_URL, ""));
      return bytes.slice().buffer as ArrayBuffer;
    };
    return Object.assign(fn, { calls });
  }
  const device = { allowHttp: false, allowPrivate: false };

  it("packageFileUrl 로 받고 상한·expectSize·기기 설정을 넘긴다, 묶음을 checkPackageFiles 로 본다", async () => {
    const inv = fakeInvoke();
    const e = lockOf("@me/clock", "1.0.0");
    const sizes = Object.fromEntries((index.packages["@me/clock"].versions["1.0.0"].files as { path: string; size: number }[]).map((f) => [f.path, f.size]));
    const files = await nativeSource({ allowHttp: true, allowPrivate: true }, inv).fetch("@me/clock", e, sizes);
    expect(files.size).toBe(3);
    const frame = inv.calls.find((c) => (c.args.url as string).endsWith("frame.js"))!;
    expect(frame.cmd).toBe("market_fetch");
    expect(frame.args).toMatchObject({
      url: `${REPO}packages/me/clock/1.0.0/frame.js`,
      maxBytes: MARKET_LIMITS.fileBytes,
      expectSize: sizes["frame.js"],
      allowHttp: true,
      allowPrivate: true,
    });
  });

  it("공식이 아닌 repo 의 @keyring/… 는 invoke 0번으로 거부, 오류 글은 같은 코드", async () => {
    const inv = fakeInvoke();
    expect(await codeOf(nativeSource(device, inv).fetch("@keyring/hello", lockOf("@keyring/hello", "1.0.0")))).toBe("market_scope_reserved");
    expect(inv.calls).toEqual([]);
    const blocked = fakeInvoke({ [`${REPO}packages/me/clock/1.0.0/frame.js`]: "market_private_address" });
    expect(await codeOf(nativeSource(device, blocked).fetch("@me/clock", lockOf("@me/clock", "1.0.0")))).toBe("market_private_address");
    const enc = fakeInvoke({ [`${REPO}index.json`]: "market_fetch_failed:content-encoding" });
    expect((await nativeSource(device, enc).index(REPO)).error).toEqual({ code: "market_fetch_failed", params: { reason: "content-encoding" } });
  });

  it("sha 가 다르거나 매니페스트가 틀리면 거부", async () => {
    const inv = fakeInvoke({ [`${REPO}packages/me/clock/1.0.0/frame.js`]: new TextEncoder().encode("tampered") });
    expect(await codeOf(nativeSource(device, inv).fetch("@me/clock", lockOf("@me/clock", "1.0.0")))).toBe("market_hash_mismatch");
  });

  it("받은 묶음의 매니페스트 id 가 잠금 id 와 다르면 market_manifest_invalid", async () => {
    const e = lockOf("@me/clock", "1.0.0");
    const m = bytesOf("packages/me/clock/1.0.0/keyring-package.json");
    const f = bytesOf("packages/me/clock/1.0.0/frame.js");
    const k = bytesOf("packages/me/clock/1.0.0/messages/ko.json");
    const inv = fakeInvoke({
      [`${REPO}packages/me/other/1.0.0/keyring-package.json`]: m,
      [`${REPO}packages/me/other/1.0.0/frame.js`]: f,
      [`${REPO}packages/me/other/1.0.0/messages/ko.json`]: k,
    });
    expect(await codeOf(nativeSource(device, inv).fetch("@me/other", { ...e }))).toBe("market_manifest_invalid");
  });

  it("index 는 index.json 을 받아 parseRepoIndex(개인 저장소의 @keyring 은 ignored)", async () => {
    const r = await nativeSource(device, fakeInvoke()).index(REPO);
    expect(Object.keys(r.index!.packages).sort()).toEqual(["@me/clock", "@me/fog", "@me/ja", "@me/paper", "@me/sea"]);
    expect(r.ignored).toEqual(["@keyring/hello: scope_reserved"]);
    expect((await nativeSource(device, fakeInvoke()).index("http://repo.test/")).error?.code).toBe("market_url_protocol");
  });
});

describe("readDeviceMarketSettings", () => {
  it("값 없음·깨진 JSON·던지는 localStorage → 둘 다 false", () => {
    const store = (v: string | null) => vi.stubGlobal("localStorage", { getItem: () => v });
    store(null);
    expect(readDeviceMarketSettings()).toEqual({ allowHttp: false, allowPrivate: false });
    store("{");
    expect(readDeviceMarketSettings()).toEqual({ allowHttp: false, allowPrivate: false });
    store(JSON.stringify({ allowHttp: true, allowPrivate: "yes" }));
    expect(readDeviceMarketSettings()).toEqual({ allowHttp: true, allowPrivate: false });
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(readDeviceMarketSettings()).toEqual({ allowHttp: false, allowPrivate: false });
  });

  it("writeDeviceMarketSettings 뒤 같은 값을 읽는다", () => {
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
    writeDeviceMarketSettings({ allowHttp: true, allowPrivate: false });
    expect(readDeviceMarketSettings()).toEqual({ allowHttp: true, allowPrivate: false });
    writeDeviceMarketSettings({ allowHttp: false, allowPrivate: true });
    expect(readDeviceMarketSettings()).toEqual({ allowHttp: false, allowPrivate: true });
  });
});
