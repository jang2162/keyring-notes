import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { KeyedError } from "@keyring-notes/core";
import type { S3Client } from "./s3.js";

/**
 * S3에 올리기 전 암호화(클라이언트 쪽). 원격 백업과 첨부 보관에 같이 쓴다.
 *
 * 키: KEYRING_S3_ENCRYPTION_KEY(암호문)나 KEYRING_S3_ENCRYPTION_KEY_FILE(그 파일의 내용).
 *   암호문 → scrypt(N=2^15, r=8, p=1, 솔트) → 마스터 키 → HKDF로 내용용·이름용 키를 나눈다.
 *   솔트와 "키 확인 값"은 S3의 <접두사>encryption.json에 둔다(비밀이 아니다). 처음 켤 때 만들고,
 *   다음부터는 확인 값이 맞지 않으면 시작하지 않는다(다른 키로 올린 것과 섞여 못 여는 일을 막는다).
 *
 * 객체 형식: "KNENC1\0\0"(8바이트) + 논스(12바이트) + AES-256-GCM 암호문 + 태그(16바이트).
 * 첨부의 S3 이름은 내용 해시 대신 HMAC(이름 키, 해시)로 해, 같은 파일을 가졌는지 S3에서 맞춰 볼 수 없게 한다.
 * 크기·올린 시각·백업 이름은 가리지 않는다.
 */
const MAGIC = Buffer.from("KNENC1\0\0", "latin1");
const NONCE = 12;
const TAG = 16;
const HEADER = MAGIC.length + NONCE;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const META_NAME = "encryption.json";

interface Meta {
  format: "keyring-s3-encryption";
  version: 1;
  kdf: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
  /** HMAC(확인 키, "keyring-s3-check") — 키가 맞는지만 알 수 있다 */
  check: string;
}

export class EncryptionError extends KeyedError {}

export type CryptoProvider = () => Promise<S3Crypto>;

/** 환경 변수에서 키(암호문)를 읽는다. 없으면 null(암호화 꺼짐). */
export async function encryptionSecretFromEnv(e: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const file = e.KEYRING_S3_ENCRYPTION_KEY_FILE;
  const raw = file ? (await readFile(file, "utf8")).trim() : e.KEYRING_S3_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  if (raw.length < 12) throw new EncryptionError("s3_key_short", { min: 12 });
  return raw;
}

const derive = (secret: string, salt: Buffer, m: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(secret, salt, 32, { N: m.N, r: m.r, p: m.p, maxmem: SCRYPT.maxmem }, (err, key) => (err ? reject(err) : resolve(key))),
  );

const sub = (master: Buffer, info: string) => Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `keyring-s3/${info}`, 32));

export function isSealed(head: Uint8Array): boolean {
  return head.length >= MAGIC.length && Buffer.from(head.subarray(0, MAGIC.length)).equals(MAGIC);
}

/** 파일 앞부분이 암호화 형식인지 */
export async function isSealedFile(file: string): Promise<boolean> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await fh.read(buf, 0, MAGIC.length, 0);
    return isSealed(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

export class S3Crypto {
  private constructor(
    private readonly contentKey: Buffer,
    private readonly nameKey: Buffer,
  ) {}

  /**
   * S3의 encryption.json으로 키를 맞춘다(없으면 만든다). 키가 다르면 EncryptionError.
   * 시험에서 scrypt 비용을 낮추려면 params를 준다(이미 있는 설정에는 쓰지 않는다).
   */
  static async connect(s3: S3Client, secret: string, params: { N?: number } = {}): Promise<S3Crypto> {
    const key = s3.key(META_NAME);
    const raw = await s3.get(key);
    let meta: Meta;
    if (raw) {
      try {
        meta = JSON.parse(new TextDecoder().decode(raw)) as Meta;
        if (meta.format !== "keyring-s3-encryption" || meta.version !== 1) throw new Error();
      } catch {
        throw new EncryptionError("s3_meta_unreadable", { name: META_NAME });
      }
    } else {
      meta = {
        format: "keyring-s3-encryption",
        version: 1,
        kdf: "scrypt",
        N: params.N ?? SCRYPT.N,
        r: SCRYPT.r,
        p: SCRYPT.p,
        salt: randomBytes(16).toString("base64"),
        check: "",
      };
    }
    const master = await derive(secret, Buffer.from(meta.salt, "base64"), meta);
    const check = createHmac("sha256", sub(master, "check")).update("keyring-s3-check").digest("hex");
    if (raw) {
      if (!timingSafeEqual(Buffer.from(check), Buffer.from(String(meta.check).padEnd(check.length).slice(0, check.length)))) {
        throw new EncryptionError("s3_key_mismatch");
      }
    } else {
      await s3.put(key, new TextEncoder().encode(JSON.stringify({ ...meta, check }, null, 2)), { contentType: "application/json" });
    }
    return new S3Crypto(sub(master, "content"), sub(master, "name"));
  }

  /**
   * 처음 쓸 때 연결하고 그 뒤로는 같은 것을 돌려주는 함수. S3가 잠시 안 되면 다음에 다시 시도한다
   * (그동안 올리기는 실패로 남고, 암호화하지 않은 채 올리는 일은 없다).
   */
  static lazy(s3: S3Client, secret: string, params: { N?: number } = {}): CryptoProvider {
    let ready: Promise<S3Crypto> | null = null;
    return () => {
      ready ??= S3Crypto.connect(s3, secret, params).catch((e) => {
        ready = null;
        throw e;
      });
      return ready;
    };
  }

  /** 첨부의 S3 이름(내용 해시 → HMAC) */
  blobName(sha256: string): string {
    return createHmac("sha256", this.nameKey).update(sha256).digest("hex");
  }

  sealBytes(data: Uint8Array): Uint8Array {
    const nonce = randomBytes(NONCE);
    const c = createCipheriv("aes-256-gcm", this.contentKey, nonce);
    return Buffer.concat([MAGIC, nonce, c.update(data), c.final(), c.getAuthTag()]);
  }

  openBytes(data: Uint8Array): Uint8Array {
    const buf = Buffer.from(data);
    if (!isSealed(buf) || buf.length < HEADER + TAG) throw new EncryptionError("not_encrypted");
    const d = createDecipheriv("aes-256-gcm", this.contentKey, buf.subarray(MAGIC.length, HEADER));
    d.setAuthTag(buf.subarray(buf.length - TAG));
    try {
      return Buffer.concat([d.update(buf.subarray(HEADER, buf.length - TAG)), d.final()]);
    } catch {
      throw new EncryptionError("decrypt_failed");
    }
  }

  /** 파일을 암호화해 다른 파일로(큰 백업도 메모리에 올리지 않는다) */
  async sealFile(src: string, dst: string): Promise<void> {
    const nonce = randomBytes(NONCE);
    const c = createCipheriv("aes-256-gcm", this.contentKey, nonce);
    let started = false;
    const framing = new Transform({
      transform(chunk: Buffer, _enc, done) {
        if (!started) {
          started = true;
          this.push(Buffer.concat([MAGIC, nonce]));
        }
        done(null, c.update(chunk));
      },
      flush(done) {
        if (!started) this.push(Buffer.concat([MAGIC, nonce]));
        this.push(c.final());
        done(null, c.getAuthTag());
      },
    });
    await pipeline(createReadStream(src), framing, createWriteStream(dst, { mode: 0o600 }));
  }

  /** 암호화한 파일을 풀어 dst로. 태그가 맞지 않으면 dst를 남기지 않고 EncryptionError */
  async openFile(src: string, dst: string): Promise<void> {
    const size = (await stat(src)).size;
    if (size < HEADER + TAG || !(await isSealedFile(src))) throw new EncryptionError("not_encrypted");
    const fh = await open(src, "r");
    const nonce = Buffer.alloc(NONCE);
    const tag = Buffer.alloc(TAG);
    try {
      await fh.read(nonce, 0, NONCE, MAGIC.length);
      await fh.read(tag, 0, TAG, size - TAG);
    } finally {
      await fh.close();
    }
    const d = createDecipheriv("aes-256-gcm", this.contentKey, nonce);
    d.setAuthTag(tag);
    const tmp = `${dst}.part`;
    try {
      await pipeline(createReadStream(src, { start: HEADER, end: size - TAG - 1 }), d, createWriteStream(tmp, { mode: 0o600 }));
    } catch {
      await rm(tmp, { force: true });
      throw new EncryptionError("decrypt_failed");
    }
    await rename(tmp, dst);
  }
}
