import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackupService } from "../src/backup.js";
import { BLOB_INDEX, BlobStore } from "../src/blobs.js";
import { ConfigStore } from "../src/config.js";
import { S3Client, s3ConfigFromEnv, signV4 } from "../src/s3.js";
import { EncryptionError, isSealed, S3Crypto } from "../src/s3crypto.js";
import { ScopedVault } from "../src/scoped.js";
import { hashContent } from "../src/vault.js";
import { startFakeS3 } from "./fakeS3.js";
import { openVault, ownerPrincipal, tempDir } from "./helpers.js";

describe("SigV4", () => {
  it("AWS 문서의 예제 서명과 같다", () => {
    // https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html 의 IAM ListUsers 예
    const auth = signV4({
      method: "GET",
      path: "/",
      query: { Action: "ListUsers", Version: "2010-05-08" },
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8", host: "iam.amazonaws.com", "x-amz-date": "20150830T123600Z" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "us-east-1",
      service: "iam",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      amzDate: "20150830T123600Z",
    });
    expect(auth).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
  });

  it("환경 변수 설정", () => {
    expect(s3ConfigFromEnv({})).toBeNull();
    expect(() => s3ConfigFromEnv({ KEYRING_S3_BUCKET: "b" })).toThrow(/ACCESS_KEY/);
    expect(s3ConfigFromEnv({ KEYRING_S3_BUCKET: "b", KEYRING_S3_ACCESS_KEY_ID: "a", KEYRING_S3_SECRET_ACCESS_KEY: "s", KEYRING_S3_REGION: "ap-northeast-2" })).toMatchObject({
      endpoint: "https://s3.ap-northeast-2.amazonaws.com",
      pathStyle: false,
      prefix: "keyring/",
    });
    expect(s3ConfigFromEnv({ KEYRING_S3_BUCKET: "b", KEYRING_S3_ACCESS_KEY_ID: "a", KEYRING_S3_SECRET_ACCESS_KEY: "s", KEYRING_S3_ENDPOINT: "http://minio:9000/", KEYRING_S3_PREFIX: "notes" })).toMatchObject({
      endpoint: "http://minio:9000",
      pathStyle: true,
      prefix: "notes/",
    });
  });
});

let fake: Awaited<ReturnType<typeof startFakeS3>>;
let cleanup: () => Promise<void>;
let root: string;

beforeEach(async () => {
  fake = await startFakeS3();
  const t = await tempDir("keyring-s3-");
  root = t.dir;
  cleanup = t.cleanup;
});
afterEach(async () => {
  await fake.close();
  await cleanup();
});

describe("S3 클라이언트", () => {
  it("올리기·받기·목록·지우기(한글·공백 키, 파일 스트림)", async () => {
    const s3 = new S3Client(fake.config);
    await s3.put(s3.key("문서/첫 파일.txt"), new TextEncoder().encode("안녕"));
    const file = path.join(root, "big.bin");
    await writeFile(file, Buffer.alloc(300_000, 7));
    await s3.put(s3.key("backups/big.bin"), { file });
    expect(new TextDecoder().decode((await s3.get(s3.key("문서/첫 파일.txt")))!)).toBe("안녕");
    expect(await s3.head(s3.key("backups/big.bin"))).toEqual({ size: 300_000 });
    expect(await s3.get(s3.key("없음"))).toBeNull();
    expect((await s3.list(s3.key(""))).map((o) => o.key).sort()).toEqual(["keyring/backups/big.bin", "keyring/문서/첫 파일.txt"]);
    expect(await s3.download(s3.key("backups/big.bin"), path.join(root, "down.bin"))).toBe(true);
    expect((await readFile(path.join(root, "down.bin"))).length).toBe(300_000);
    await s3.delete(s3.key("backups/big.bin"));
    expect(await s3.head(s3.key("backups/big.bin"))).toBeNull();
    expect(fake.state.badSignatures).toBe(0);
  });

  it("잘못된 키는 거부된다", async () => {
    const s3 = new S3Client({ ...fake.config, secretAccessKey: "wrong" });
    await expect(s3.put(s3.key("x"), new Uint8Array([1]))).rejects.toThrow(/SignatureDoesNotMatch|bad signature/);
  });
});

async function setup(opts: { blobs?: boolean; minBytes?: number } = {}) {
  const v = await openVault(path.join(root, "vault"), { init: false });
  const config = new ConfigStore(path.join(root, "config", "keyring.json"));
  const s3 = new S3Client(fake.config);
  const blobs = opts.blobs ? new BlobStore(v.vault, s3, opts.minBytes ?? 10) : null;
  await v.wiki.prepare();
  if (blobs) await blobs.attach();
  await v.vault.init();
  await v.wiki.init();
  const backups = new BackupService(v.vault, config, path.join(root, "backups"), () => v.wiki.resync());
  backups.remote = s3;
  backups.blobs = blobs;
  const owner = new ScopedVault(v.vault, ownerPrincipal, v.index, v.wiki);
  return { ...v, config, s3, blobs, backups, owner };
}

const git = (vaultDir: string, ...args: string[]) =>
  execFileSync("git", ["--git-dir", path.join(vaultDir, ".history"), "--work-tree", vaultDir, "-c", "core.quotePath=false", ...args], { encoding: "utf8" }).trim();

describe("S3 원격 백업", () => {
  it("백업을 만들면 S3에도 올라가고, S3에서 받아 복원할 수 있다", async () => {
    const { owner, backups, config, vault } = await setup();
    await owner.write("a.md", "# A\n처음\n", null);
    const b = await backups.create("manual");
    const remote = await backups.listRemote();
    expect(remote).toMatchObject([{ name: b.name, kind: "manual", local: true }]);
    expect(remote[0].size).toBe(b.size);

    // 서버 디스크를 잃었다고 치고 로컬 백업을 지운 뒤 S3에서 받아 복원
    await backups.remove(b.name);
    expect((await backups.listRemote())[0].local).toBe(false);
    const fetched = await backups.fetchRemote(b.name);
    expect(fetched.head).toBe(b.head);
    const a = await owner.read("a.md");
    await owner.write("a.md", "# A\n나중\n", a.hash);
    await backups.restore(fetched.name);
    expect((await vault.read("a.md")).content).toBe("# A\n처음\n");

    // 끄면 올리지 않는다
    config.update((c) => {
      c.backup.remote = false;
    });
    await backups.create("manual");
    expect((await backups.listRemote()).filter((r) => r.kind === "manual")).toHaveLength(1);
  });

  it("S3에 남길 자동 백업 수를 지킨다", async () => {
    const { owner, backups, config } = await setup();
    config.update((c) => {
      c.backup.remoteKeep = 2;
      c.backup.keep = 1;
    });
    for (let i = 0; i < 4; i++) {
      await owner.write(`n${i}.md`, `${i}`, null);
      await backups.create("auto");
      await new Promise((r) => setTimeout(r, 1100)); // 이름의 초 단위 시각이 겹치지 않게
    }
    await backups.prune();
    expect((await backups.listRemote()).filter((r) => r.kind === "auto")).toHaveLength(2);
    expect((await backups.list()).filter((r) => r.kind === "auto")).toHaveLength(1);
  }, 20_000);

  it("S3가 안 되면 로컬 백업은 만들고 오류만 남긴다", async () => {
    const { owner, backups } = await setup();
    await owner.write("a.md", "x", null);
    fake.state.down = true;
    const b = await backups.create("manual");
    expect(b.name).toMatch(/manual/);
    expect(backups.lastRemoteError).toMatch(/SlowDown|503/);
    fake.state.down = false;
    await backups.pushRemote(b.name);
    expect(backups.lastRemoteError).toBeNull();
  });
});

describe("S3 첨부 보관", () => {
  const png = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

  it("큰 첨부는 S3에 내용 해시로 올리고 Git에는 목록만 남긴다", async () => {
    const { owner, vault, blobs } = await setup({ blobs: true, minBytes: 100 });
    await owner.batch([
      { op: "put", path: "자료/큰그림.png", data: png(500) },
      { op: "put", path: "자료/작은그림.png", data: png(20) },
      { op: "write", path: "자료/글.md", content: "![[큰그림.png]]", baseHash: null },
    ]);
    const root = vault.root;
    const tracked = git(root, "ls-files").split("\n");
    expect(tracked).toContain("자료/작은그림.png");
    expect(tracked).toContain("자료/글.md");
    expect(tracked).toContain(BLOB_INDEX);
    expect(tracked).not.toContain("자료/큰그림.png");
    const sha = hashContent(Buffer.from(png(500)));
    expect([...fake.objects.keys()]).toContain(`keyring/blobs/${sha.slice(0, 2)}/${sha}`);
    const index = JSON.parse(await readFile(path.join(root, BLOB_INDEX), "utf8"));
    expect(index.files["자료/큰그림.png"]).toEqual({ sha256: sha, size: 500 });
    // 파일은 볼트에 그대로 있다(화면·API·다른 편집기)
    expect((await vault.readRaw("자료/큰그림.png")).data.length).toBe(500);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(blobs!.status()).toMatchObject({ count: 1, bytes: 500, pending: 0 });

    // 밖에서 바꾸면 새 해시로, 지우면 목록에서 빠진다
    await writeFile(path.join(root, "자료/큰그림.png"), png(600, 2));
    await vault.absorbOutsideChanges();
    const sha2 = hashContent(Buffer.from(png(600, 2)));
    expect(JSON.parse(await readFile(path.join(root, BLOB_INDEX), "utf8")).files["자료/큰그림.png"].sha256).toBe(sha2);
    expect(fake.objects.has(`keyring/blobs/${sha.slice(0, 2)}/${sha}`)).toBe(true); // 예전 버전도 남는다
    await rm(path.join(root, "자료/큰그림.png"));
    await vault.absorbOutsideChanges();
    expect(JSON.parse(await readFile(path.join(root, BLOB_INDEX), "utf8")).files).toEqual({});
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("S3에 둔 첨부도 노드 이동(한 커밋)으로 옮겨지고 목록이 따라간다", async () => {
    const { owner, vault } = await setup({ blobs: true, minBytes: 100 });
    await owner.batch([
      { op: "put", path: "자료/큰그림.png", data: png(500) },
      { op: "put", path: "자료/작은그림.png", data: png(20) },
      { op: "write", path: "자료/글.md", content: "![[큰그림.png]] ![](작은그림.png)", baseHash: null },
    ]);
    const before = Number(git(vault.root, "rev-list", "--count", "HEAD"));
    const r = await owner.moveNode("자료", "보관/자료");
    expect(r.rev).not.toBeNull();
    expect(Number(git(vault.root, "rev-list", "--count", "HEAD"))).toBe(before + 1);
    const sha = hashContent(Buffer.from(png(500)));
    const index = JSON.parse(await readFile(path.join(vault.root, BLOB_INDEX), "utf8"));
    expect(index.files).toEqual({ "보관/자료/큰그림.png": { sha256: sha, size: 500 } });
    const tracked = git(vault.root, "ls-files").split("\n");
    expect(tracked).toContain("보관/자료/작은그림.png");
    expect(tracked).not.toContain("자료/작은그림.png");
    expect(tracked).not.toContain("보관/자료/큰그림.png");
    expect((await vault.readRaw("보관/자료/큰그림.png")).data.length).toBe(500);
    expect((await owner.read("보관/자료/글.md")).content).toBe("![[큰그림.png]] ![](작은그림.png)");
    expect(git(vault.root, "status", "--porcelain")).toBe("");
  });

  it("이미 Git에 있던 큰 첨부는 켜는 순간 이력에서 빠진다", async () => {
    // 먼저 S3 없이 첨부를 커밋
    const first = await setup();
    await first.owner.batch([{ op: "put", path: "옛첨부.pdf", data: png(300) }]);
    expect(git(first.vault.root, "ls-files")).toContain("옛첨부.pdf");
    // 같은 볼트를 첨부 보관을 켜고 다시 연다
    const { vault } = await setup({ blobs: true, minBytes: 100 });
    expect(git(vault.root, "ls-files")).not.toContain("옛첨부.pdf");
    expect(git(vault.root, "ls-files")).toContain(BLOB_INDEX);
    expect((await vault.readRaw("옛첨부.pdf")).data.length).toBe(300);
    expect(git(vault.root, "status", "--porcelain")).toBe("");
  });

  it("S3가 안 되면 쓰기는 되고 나중에 올린다", async () => {
    const { owner, blobs, vault } = await setup({ blobs: true, minBytes: 100 });
    fake.state.down = true;
    await owner.batch([{ op: "put", path: "p.png", data: png(200) }]);
    expect(blobs!.status()).toMatchObject({ count: 1, pending: 1 });
    expect(git(vault.root, "ls-files")).not.toContain("p.png");
    fake.state.down = false;
    expect(await blobs!.retryPending()).toBe(0);
    expect(blobs!.status().pending).toBe(0);
    expect(fake.objects.size).toBe(1);
  });

  it("복원하면 그때의 첨부를 S3에서 받아 오고, 그 뒤에 생긴 첨부는 지운다", async () => {
    const { owner, backups, vault } = await setup({ blobs: true, minBytes: 100 });
    await owner.batch([{ op: "put", path: "a.png", data: png(200, 1) }]);
    const b = await backups.create("manual");
    // 백업 뒤: a.png를 바꾸고 b.png를 더한다
    await writeFile(path.join(vault.root, "a.png"), png(250, 9));
    await owner.batch([{ op: "put", path: "b.png", data: png(300) }]);
    const r = await backups.restore(b.name);
    expect(r.attachments).toEqual({ downloaded: ["a.png"], removed: ["b.png"], missing: [] });
    expect([...(await vault.readRaw("a.png")).data]).toEqual([...png(200, 1)]);
    await expect(vault.readRaw("b.png")).rejects.toThrow();
  });
});

describe("S3 올리기 전 암호화", () => {
  // 시험에서는 scrypt 비용을 낮춘다
  const lazy = (s3: S3Client, secret = "correct horse battery staple") => S3Crypto.lazy(s3, secret, { N: 1 << 10 });

  it("백업은 암호화해 올리고, 받으면 풀어서 복원한다", async () => {
    const { owner, backups, vault, s3 } = await setup();
    backups.crypto = lazy(s3);
    await owner.write("a.md", "# A\n비밀 메모\n", null);
    const b = await backups.create("manual");
    const raw = fake.objects.get(`keyring/backups/${b.name}`)!;
    expect(isSealed(raw)).toBe(true);
    expect(raw.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))).toBe(false); // gzip 머리가 보이지 않는다
    expect(JSON.parse(fake.objects.get("keyring/encryption.json")!.toString())).toMatchObject({ format: "keyring-s3-encryption", kdf: "scrypt" });

    await backups.remove(b.name);
    const fetched = await backups.fetchRemote(b.name);
    expect(fetched.head).toBe(b.head);
    await owner.write("a.md", "바뀜", (await owner.read("a.md")).hash);
    await backups.restore(fetched.name);
    expect((await vault.read("a.md")).content).toBe("# A\n비밀 메모\n");

    // 키 없이는 받지 못하고, 다른 키로는 시작하지 않는다
    backups.crypto = null;
    await expect(backups.fetchRemote(b.name)).rejects.toThrow(/암호화된 백업/);
    await expect(lazy(s3, "another long secret")()).rejects.toThrow(EncryptionError);
  });

  it("바뀐 암호문은 풀지 않는다", async () => {
    const { s3 } = await setup();
    const c = await lazy(s3)();
    const sealed = Buffer.from(c.sealBytes(new TextEncoder().encode("내용")));
    expect(new TextDecoder().decode(c.openBytes(sealed))).toBe("내용");
    sealed[sealed.length - 20] ^= 1;
    expect(() => c.openBytes(sealed)).toThrow(EncryptionError);
    const src = path.join(root, "plain.bin");
    await writeFile(src, Buffer.alloc(200_000, 3));
    await c.sealFile(src, path.join(root, "sealed.bin"));
    const f = await readFile(path.join(root, "sealed.bin"));
    f[1000] ^= 1;
    await writeFile(path.join(root, "sealed.bin"), f);
    await expect(c.openFile(path.join(root, "sealed.bin"), path.join(root, "out.bin"))).rejects.toThrow(EncryptionError);
    await expect(readFile(path.join(root, "out.bin"))).rejects.toThrow(); // 깨진 결과를 남기지 않는다
  });

  it("첨부는 HMAC 이름으로 암호화해 올리고, 복원 때 풀어 받는다(예전 평문 첨부도 읽는다)", async () => {
    const png = (n: number, fill = 1) => new Uint8Array(n).fill(fill);
    // 먼저 암호화 없이 하나 올려 둔다
    const first = await setup({ blobs: true, minBytes: 100 });
    await first.owner.batch([{ op: "put", path: "옛.png", data: png(150, 4) }]);
    const oldSha = hashContent(Buffer.from(png(150, 4)));
    expect(fake.objects.has(`keyring/blobs/${oldSha.slice(0, 2)}/${oldSha}`)).toBe(true);

    const { owner, backups, vault, blobs, s3 } = await setup({ blobs: true, minBytes: 100 });
    blobs!.crypto = lazy(s3);
    backups.crypto = blobs!.crypto;
    await owner.batch([{ op: "put", path: "새.png", data: png(300, 5) }]);
    const sha = hashContent(Buffer.from(png(300, 5)));
    const keys = [...fake.objects.keys()];
    expect(keys.some((k) => k.includes(sha))).toBe(false); // 내용 해시가 S3 이름에 드러나지 않는다
    const sealedKey = keys.find((k) => k.startsWith("keyring/blobs-enc/"))!;
    expect(isSealed(fake.objects.get(sealedKey)!)).toBe(true);
    expect(blobs!.status()).toMatchObject({ count: 2, pending: 0, encrypted: true });

    const b = await backups.create("manual");
    await rm(path.join(vault.root, "새.png"));
    await rm(path.join(vault.root, "옛.png"));
    const r = await backups.restore(b.name);
    expect(r.attachments).toMatchObject({ downloaded: expect.arrayContaining(["새.png", "옛.png"]), missing: [] });
    expect([...(await vault.readRaw("새.png")).data]).toEqual([...png(300, 5)]);
    expect([...(await vault.readRaw("옛.png")).data]).toEqual([...png(150, 4)]);
  });
});

describe("S3 암호화 연결 실패", () => {
  it("처음 연결 때 S3가 안 되면 평문으로 올리지 않고 나중에 다시 시도한다", async () => {
    const { owner, blobs, s3 } = await setup({ blobs: true, minBytes: 100 });
    blobs!.crypto = S3Crypto.lazy(s3, "correct horse battery staple", { N: 1 << 10 });
    fake.state.down = true;
    await owner.batch([{ op: "put", path: "p.png", data: new Uint8Array(200).fill(1) }]);
    expect(blobs!.status()).toMatchObject({ pending: 1 });
    expect(fake.objects.size).toBe(0);
    fake.state.down = false;
    expect(await blobs!.retryPending()).toBe(0);
    expect([...fake.objects.keys()].sort()).toEqual([expect.stringMatching(/^keyring\/blobs-enc\//), "keyring/encryption.json"]);
  });
});
