import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import { openVault, tempDir } from "./helpers.js";

/**
 * 시험용 소프트웨어 인증기(ES256, 증명 "none"). 브라우저의 navigator.credentials 대신
 * 등록·로그인 응답을 직접 만들어 서버 검증을 끝까지 지나게 한다.
 */
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(n, 1);
    return b;
  };
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("cbor: 모르는 값");
}

const b64u = (b: Buffer) => b.toString("base64url");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();

class SoftAuthenticator {
  readonly credId = randomBytes(16);
  private key: KeyObject;
  private pub: { x: Buffer; y: Buffer };
  counter = 0;
  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.key = privateKey;
    const jwk = publicKey.export({ format: "jwk" });
    this.pub = { x: Buffer.from(jwk.x!, "base64url"), y: Buffer.from(jwk.y!, "base64url") };
  }

  register(options: { challenge: string; rp: { id: string } }, origin: string) {
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }));
    const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, this.pub.x], [-3, this.pub.y]]));
    const len = Buffer.alloc(2);
    len.writeUInt16BE(this.credId.length);
    const authData = Buffer.concat([sha(options.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, this.credId, cose]);
    const attestation = cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    return {
      id: b64u(this.credId),
      rawId: b64u(this.credId),
      type: "public-key",
      clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attestation), transports: ["internal"] },
    };
  }

  login(options: { challenge: string; rpId: string }, origin: string, opts: { counter?: number } = {}) {
    this.counter = opts.counter ?? this.counter + 1;
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }));
    const c = Buffer.alloc(4);
    c.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha(options.rpId), Buffer.from([0x05]), c]);
    const signature = sign("sha256", Buffer.concat([authData, sha(clientData)]), this.key);
    return {
      id: b64u(this.credId),
      rawId: b64u(this.credId),
      type: "public-key",
      clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature) },
    };
  }
}

const ORIGIN = "https://notes.example";
const json = { "content-type": "application/json", origin: ORIGIN };
let cleanup: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let config: ConfigStore;
let cookie = "";

const req = (p: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(`${ORIGIN}${p}`, { method: init.method ?? (init.body !== undefined ? "POST" : "GET"), headers: { ...json, ...init.headers }, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });

beforeEach(async () => {
  const t = await tempDir("keyring-passkey-");
  cleanup = t.cleanup;
  const { vault, index, wiki, ingestor } = await openVault(path.join(t.dir, "vault"));
  config = new ConfigStore(path.join(t.dir, "config", "keyring.json"));
  config.setPassword("correct horse");
  app = createApp({ vault, index, config, wiki, ingestor, admin: { backups: new BackupService(vault, config, path.join(t.dir, "backups"), () => wiki.resync()) } });
  const res = await req("/api/auth/login", { body: { password: "correct horse" } });
  cookie = res.headers.get("set-cookie")!.split(";")[0];
});
afterEach(() => cleanup());

async function registerKey(auth: SoftAuthenticator, name = "노트북") {
  const { id, options } = await (await req("/api/admin/passkeys/options", { body: {}, headers: { cookie } })).json();
  expect(options.rp.id).toBe("notes.example");
  const res = await req("/api/admin/passkeys", { body: { id, response: auth.register(options, ORIGIN), name }, headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

describe("패스키", () => {
  it("등록하면 로그인 화면에 보이고, 패스키로 로그인한다", async () => {
    expect((await (await req("/api/auth/status")).json()).passkey).toBe(false);
    const auth = new SoftAuthenticator();
    const saved = await registerKey(auth);
    expect(saved).toMatchObject({ name: "노트북", rpID: "notes.example" });
    expect(saved.publicKey).toBeUndefined();
    expect((await (await req("/api/auth/status")).json()).passkey).toBe(true);

    const { id, options } = await (await req("/api/auth/passkey/options", { body: {} })).json();
    const res = await req("/api/auth/passkey/login", { body: { id, response: auth.login(options, ORIGIN) } });
    expect(res.status).toBe(200);
    const session = res.headers.get("set-cookie")!.split(";")[0];
    expect((await req("/api/tree", { headers: { cookie: session } })).status).toBe(200);
    expect(config.get().passkeys[0]).toMatchObject({ counter: 1, lastUsedAt: expect.any(String) });
    // 도전값은 한 번만
    expect((await req("/api/auth/passkey/login", { body: { id, response: auth.login(options, ORIGIN) } })).status).toBe(400);
  });

  it("다른 키·다른 주소·되돌아간 서명 횟수는 거부한다", async () => {
    const auth = new SoftAuthenticator();
    await registerKey(auth);
    const stranger = new SoftAuthenticator();
    let o = await (await req("/api/auth/passkey/options", { body: {} })).json();
    expect((await req("/api/auth/passkey/login", { body: { id: o.id, response: stranger.login(o.options, ORIGIN) } })).status).toBe(401);
    // 다른 곳(피싱 사이트)이 받은 서명
    o = await (await req("/api/auth/passkey/options", { body: {} })).json();
    expect((await req("/api/auth/passkey/login", { body: { id: o.id, response: auth.login(o.options, "https://evil.example") } })).status).toBe(401);
    // Origin이 요청 받은 호스트와 다르면 도전값부터 내주지 않는다
    expect((await req("/api/auth/passkey/options", { body: {}, headers: { origin: "https://evil.example" } })).status).toBe(400);
    // 복제된 인증기(서명 횟수가 뒤로)
    o = await (await req("/api/auth/passkey/options", { body: {} })).json();
    expect((await req("/api/auth/passkey/login", { body: { id: o.id, response: auth.login(o.options, ORIGIN, { counter: 5 }) } })).status).toBe(200);
    o = await (await req("/api/auth/passkey/options", { body: {} })).json();
    expect((await req("/api/auth/passkey/login", { body: { id: o.id, response: auth.login(o.options, ORIGIN, { counter: 3 }) } })).status).toBe(401);
  });

  it("관리 콘솔에서 목록·삭제, 로그인 없이는 등록 못 한다", async () => {
    const auth = new SoftAuthenticator();
    const saved = await registerKey(auth, "휴대폰");
    expect((await req("/api/admin/passkeys/options", { body: {} })).status).toBe(401);
    const list = await (await req("/api/admin/passkeys", { headers: { cookie } })).json();
    expect(list).toMatchObject({ here: "notes.example", passkeys: [{ id: saved.id, name: "휴대폰" }] });
    expect((await req(`/api/admin/passkeys/${saved.id}`, { method: "DELETE", headers: { cookie } })).status).toBe(200);
    expect((await (await req("/api/auth/status")).json()).passkey).toBe(false);
    expect((await req("/api/auth/passkey/options", { body: {} })).status).toBe(400);
  });
});
