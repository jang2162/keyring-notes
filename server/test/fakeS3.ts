import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { signV4 } from "../src/s3.js";

export const FAKE_KEY = { accessKeyId: "test-key", secretAccessKey: "test-secret" };

/**
 * 시험용 S3(경로 방식, 버킷 하나). 받은 요청의 SigV4 서명을 다시 계산해 맞는지 확인하고,
 * 본문 해시(x-amz-content-sha256)도 검사한다. down=true면 503.
 */
export async function startFakeS3(bucket = "notes") {
  const objects = new Map<string, Buffer>();
  const state = { down: false, requests: 0, badSignatures: 0 };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      state.requests++;
      const body = Buffer.concat(chunks);
      const url = new URL(req.url!, "http://x");
      if (state.down) {
        res.writeHead(503).end("<Error><Code>SlowDown</Code><Message>down</Message></Error>");
        return;
      }
      // 서명 확인
      const auth = req.headers.authorization ?? "";
      const m = /Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(auth);
      const payloadHash = String(req.headers["x-amz-content-sha256"] ?? "");
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => (query[k] = v));
      const headers = m ? Object.fromEntries(m[4].split(";").map((h) => [h, String(req.headers[h] ?? "")])) : {};
      const expected = m
        ? signV4({
            method: req.method!,
            path: url.pathname,
            query,
            headers,
            payloadHash,
            region: m[3],
            service: "s3",
            accessKeyId: m[1],
            secretAccessKey: FAKE_KEY.secretAccessKey,
            amzDate: String(req.headers["x-amz-date"]),
          })
        : "";
      const bodyOk = req.method !== "PUT" || createHash("sha256").update(body).digest("hex") === payloadHash;
      if (!m || m[1] !== FAKE_KEY.accessKeyId || expected !== auth || !bodyOk || !m[4].split(";").includes("host")) {
        state.badSignatures++;
        res.writeHead(403).end("<Error><Code>SignatureDoesNotMatch</Code><Message>bad signature</Message></Error>");
        return;
      }
      const parts = url.pathname.split("/").slice(1);
      if (decodeURIComponent(parts[0]) !== bucket) {
        res.writeHead(404).end("<Error><Code>NoSuchBucket</Code><Message>no bucket</Message></Error>");
        return;
      }
      const key = parts.slice(1).map(decodeURIComponent).join("/");
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      if (req.method === "GET" && !key) {
        const prefix = url.searchParams.get("prefix") ?? "";
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const xml = `<ListBucketResult><IsTruncated>false</IsTruncated>${keys
          .map((k) => `<Contents><Key>${esc(k)}</Key><LastModified>2026-10-06T00:00:00.000Z</LastModified><Size>${objects.get(k)!.length}</Size></Contents>`)
          .join("")}</ListBucketResult>`;
        res.writeHead(200, { "content-type": "application/xml" }).end(xml);
        return;
      }
      const obj = objects.get(key);
      switch (req.method) {
        case "PUT":
          objects.set(key, body);
          res.writeHead(200).end();
          return;
        case "GET":
          if (!obj) res.writeHead(404).end("<Error><Code>NoSuchKey</Code><Message>none</Message></Error>");
          else res.writeHead(200, { "content-length": obj.length }).end(obj);
          return;
        case "HEAD":
          res.writeHead(obj ? 200 : 404, obj ? { "content-length": obj.length } : {}).end();
          return;
        case "DELETE":
          objects.delete(key);
          res.writeHead(204).end();
          return;
      }
      res.writeHead(405).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    objects,
    state,
    config: { endpoint: `http://127.0.0.1:${port}`, region: "us-east-1", bucket, prefix: "keyring/", pathStyle: true, ...FAKE_KEY },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
