import { createHash, createHmac } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * S3 호환 저장소(AWS S3, Cloudflare R2, MinIO, Backblaze B2 …) 최소 클라이언트.
 * SDK 대신 SigV4 서명을 직접 해서 의존성을 늘리지 않는다. 쓰는 기능: PUT·GET·HEAD·DELETE·ListObjectsV2.
 */
export interface S3Config {
  /** 예: https://s3.ap-northeast-2.amazonaws.com, https://<계정>.r2.cloudflarestorage.com, http://minio:9000 */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 이 앱이 쓰는 키 앞부분(예: "keyring/"). 같은 버킷을 다른 용도와 나눠 쓸 때 */
  prefix: string;
  /** 경로 방식(https://host/bucket/key). 직접 지정한 엔드포인트(MinIO·R2)는 기본 true */
  pathStyle: boolean;
}

export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const env = (e: NodeJS.ProcessEnv, name: string) => e[name] || undefined;

/** KEYRING_S3_* 환경 변수에서 설정을 읽는다. 버킷이 없으면 null(S3 기능 꺼짐). */
export function s3ConfigFromEnv(e: NodeJS.ProcessEnv = process.env): S3Config | null {
  const bucket = env(e, "KEYRING_S3_BUCKET");
  if (!bucket) return null;
  const accessKeyId = env(e, "KEYRING_S3_ACCESS_KEY_ID") ?? env(e, "AWS_ACCESS_KEY_ID");
  const secretAccessKey = env(e, "KEYRING_S3_SECRET_ACCESS_KEY") ?? env(e, "AWS_SECRET_ACCESS_KEY");
  if (!accessKeyId || !secretAccessKey) throw new Error("KEYRING_S3_BUCKET을 쓰려면 KEYRING_S3_ACCESS_KEY_ID·KEYRING_S3_SECRET_ACCESS_KEY가 필요합니다");
  const region = env(e, "KEYRING_S3_REGION") ?? env(e, "AWS_REGION") ?? "us-east-1";
  const custom = env(e, "KEYRING_S3_ENDPOINT");
  const endpoint = (custom ?? `https://s3.${region}.amazonaws.com`).replace(/\/+$/, "");
  const ps = env(e, "KEYRING_S3_PATH_STYLE");
  let prefix = env(e, "KEYRING_S3_PREFIX") ?? "keyring/";
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, prefix: prefix.replace(/^\/+/, ""), pathStyle: ps ? ps === "1" || ps === "true" : custom !== undefined };
}

const sha256hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 인코딩(SigV4 규칙). 경로는 '/'를 남긴다. */
export function uriEncode(s: string, keepSlash = false): string {
  let out = "";
  for (const b of Buffer.from(s, "utf8")) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === "/")) out += c;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export interface SignInput {
  method: string;
  /** 인코딩한 경로 */
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** YYYYMMDDTHHMMSSZ */
  amzDate: string;
}

/** SigV4 Authorization 헤더 값. headers는 서명할 헤더 전부(host 포함, 이름은 소문자). */
export function signV4(i: SignInput): string {
  const names = Object.keys(i.headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(i.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names.map((n) => `${n}:${String(lower[n]).trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalQuery = Object.keys(i.query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(i.query[k])}`)
    .join("&");
  const canonicalRequest = [i.method, i.path, canonicalQuery, canonicalHeaders, signedHeaders, i.payloadHash].join("\n");
  const day = i.amzDate.slice(0, 8);
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", i.amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kDate = hmac("AWS4" + i.secretAccessKey, day);
  const kRegion = hmac(kDate, i.region);
  const kService = hmac(kRegion, i.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function amzDate(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function xmlValue(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? unescapeXml(m[1]) : undefined;
}

function unescapeXml(s: string): string {
  return s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const map: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return map[e.toLowerCase()];
  });
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: string;
}

type Body = Uint8Array | { file: string };

export class S3Client {
  constructor(
    readonly config: S3Config,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  /** 화면에 보일 위치(비밀 값 없음) */
  describe(): string {
    return `${this.config.endpoint} · ${this.config.bucket}/${this.config.prefix}`;
  }

  /** 앱 접두사를 붙인 전체 키 */
  key(name: string): string {
    return this.config.prefix + name;
  }

  private url(fullKey: string): { url: URL; path: string } {
    const base = new URL(this.config.endpoint);
    const encodedKey = uriEncode(fullKey, true);
    if (this.config.pathStyle) {
      const prefix = base.pathname.replace(/\/+$/, "");
      const path = `${prefix}/${uriEncode(this.config.bucket)}${fullKey ? "/" + encodedKey : "/"}`;
      return { url: new URL(path, base), path };
    }
    const host = `${this.config.bucket}.${base.host}`;
    const path = "/" + encodedKey;
    return { url: new URL(`${base.protocol}//${host}${path}`), path };
  }

  private async request(
    method: string,
    fullKey: string,
    opts: { query?: Record<string, string>; body?: Body; headers?: Record<string, string>; payloadHash?: string; okStatus?: number[] } = {},
  ): Promise<Response> {
    const { url, path } = this.url(fullKey);
    const query = opts.query ?? {};
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let payloadHash = opts.payloadHash;
    let body: BodyInit | undefined;
    let length: number | undefined;
    if (opts.body instanceof Uint8Array) {
      payloadHash ??= sha256hex(opts.body);
      body = opts.body as Uint8Array<ArrayBuffer>;
      length = opts.body.byteLength;
    } else if (opts.body) {
      payloadHash ??= await fileSha256(opts.body.file);
      length = (await stat(opts.body.file)).size;
      body = Readable.toWeb(createReadStream(opts.body.file)) as ReadableStream;
    }
    payloadHash ??= sha256hex("");
    const date = amzDate();
    const signed: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": date,
      ...Object.fromEntries(Object.entries(opts.headers ?? {}).filter(([k]) => k.toLowerCase().startsWith("x-amz-"))),
    };
    const authorization = signV4({
      method,
      path,
      query,
      headers: signed,
      payloadHash,
      region: this.config.region,
      service: "s3",
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      amzDate: date,
    });
    const headers: Record<string, string> = { ...opts.headers, "x-amz-content-sha256": payloadHash, "x-amz-date": date, authorization };
    if (length !== undefined) headers["content-length"] = String(length);
    const res = await this.fetchFn(url, { method, headers, body, ...(body && !(opts.body instanceof Uint8Array) ? { duplex: "half" } : {}) } as RequestInit);
    if (res.ok || opts.okStatus?.includes(res.status)) return res;
    const text = await res.text().catch(() => "");
    const code = xmlValue(text, "Code") ?? `HTTP ${res.status}`;
    throw new S3Error(res.status, code, `S3 ${method} ${fullKey || "/"}: ${code} — ${xmlValue(text, "Message") ?? res.statusText}`);
  }

  async put(fullKey: string, body: Body, opts: { contentType?: string; sha256?: string; metadata?: Record<string, string> } = {}): Promise<void> {
    const headers: Record<string, string> = { "content-type": opts.contentType ?? "application/octet-stream" };
    for (const [k, v] of Object.entries(opts.metadata ?? {})) headers[`x-amz-meta-${k}`] = v;
    await this.request("PUT", fullKey, { body, headers, payloadHash: opts.sha256 });
  }

  /** 없으면 null */
  async get(fullKey: string): Promise<Uint8Array | null> {
    const res = await this.request("GET", fullKey, { okStatus: [404] });
    if (res.status === 404) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  /** 파일로 내려받는다(큰 백업). 없으면 false */
  async download(fullKey: string, file: string): Promise<boolean> {
    const res = await this.request("GET", fullKey, { okStatus: [404] });
    if (res.status === 404 || !res.body) return false;
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file, { mode: 0o600 }));
    return true;
  }

  async head(fullKey: string): Promise<{ size: number } | null> {
    const res = await this.request("HEAD", fullKey, { okStatus: [404] });
    if (res.status === 404) return null;
    return { size: Number(res.headers.get("content-length") ?? 0) };
  }

  async delete(fullKey: string): Promise<void> {
    await this.request("DELETE", fullKey, { okStatus: [404] });
  }

  async list(prefix: string): Promise<S3Object[]> {
    const out: S3Object[] = [];
    let token: string | undefined;
    do {
      const query: Record<string, string> = { "list-type": "2", prefix };
      if (token) query["continuation-token"] = token;
      const xml = await (await this.request("GET", "", { query })).text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        out.push({ key: xmlValue(m[1], "Key") ?? "", size: Number(xmlValue(m[1], "Size") ?? 0), lastModified: xmlValue(m[1], "LastModified") ?? "" });
      }
      token = xmlValue(xml, "IsTruncated") === "true" ? xmlValue(xml, "NextContinuationToken") : undefined;
    } while (token);
    return out;
  }
}

export async function fileSha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}
