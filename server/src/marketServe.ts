import { lstat, readFile, realpath } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { PACKAGE_TYPES, packageFileAllowed, parsePackageId, parseSemver } from "@keyring-notes/core";
import { buildRepoIndex } from "./pkgCli.js";

/**
 * 마켓 저장소 정적 서버(`pkg serve`): 시작할 때와 주기마다 `pkg index` 로 index.json 을 다시 만들고(멱등 — 바뀔 때만 쓴다),
 * `/index.json` 과 `/packages/<scope>/<name>/<version>/<파일>` 만 내준다. 이것을 띄우는 곳은 별도 저장소
 * keyring-notes-marketplace 의 마켓 서버 이미지뿐이다 — 옵션·MARKET_* 환경 변수를 바꾸면 그쪽도 맞춘다.
 * 앱 서버와 따로 돈다(볼트·로그인 없음). TLS 는 앞의 리버스 프록시가 붙인다 — 앱은 https 저장소만 받는다.
 *
 * - 압축하지 않는다: 앱·서버 받기는 identity 만 받는다(content-encoding 이 있으면 거부).
 * - 허용 꼴이 아닌 경로·숨김 파일·링크·폴더 밖은 404. 경로 조각은 core 의 id·판·파일 이름 검사를 지난 것만 잇는다.
 * - index.json 은 짧은 캐시(새 판이 곧 보이게), 패키지 파일은 판마다 바뀌지 않으므로 긴 캐시.
 */
export interface MarketServerOptions {
  root: string;
  host: string;
  port: number;
  /** index.json 을 다시 만드는 주기(ms). 0 이면 시작 때 한 번만 */
  rebuildMs: number;
  /** index.json 의 name(기존 index.json 이 있으면 그것) */
  name?: string;
  log?: (msg: string) => void;
}

export interface MarketServer {
  server: http.Server;
  rebuild(): Promise<void>;
  close(): Promise<void>;
}

const INDEX_CACHE = "public, max-age=60";
const FILE_CACHE = "public, max-age=31536000, immutable";

/** 요청 경로 → 내줄 파일(검사를 지난 것만). 아니면 null */
async function resolveFile(root: string, pathname: string): Promise<{ abs: string; index: boolean } | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  if (decoded === "/index.json") return { abs: path.join(root, "index.json"), index: true };
  const m = /^\/packages\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(decoded);
  if (!m) return null;
  const [, scope, name, version, file] = m as unknown as [string, string, string, string, string];
  if (!parsePackageId(`@${scope}/${name}`) || !parseSemver(version) || !PACKAGE_TYPES.some((t) => packageFileAllowed(t, file))) return null;
  const abs = path.join(root, "packages", scope, name, version, ...file.split("/"));
  try {
    // 경로 중간의 링크도 따라가지 않는다: 실제 경로가 root 아래 그 이름 그대로여야 한다
    const realRoot = await realpath(root);
    if ((await realpath(abs)) !== path.join(realRoot, "packages", scope, name, version, ...file.split("/"))) return null;
    if (!(await lstat(abs)).isFile()) return null;
  } catch {
    return null;
  }
  return { abs, index: false };
}

export async function startMarketServer(opts: MarketServerOptions): Promise<MarketServer> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const rebuild = async () => {
    try {
      const { index, written } = await buildRepoIndex(opts.root, opts.name ? { name: opts.name } : {});
      if (written) log(`index.json: ${Object.keys(index.packages).length} packages`);
    } catch (e) {
      // 잘못된 패키지가 하나라도 있으면 옛 index.json 을 그대로 둔다(내주던 것이 갑자기 사라지지 않게)
      log(`index.json not rebuilt: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await rebuild();
  const server = http.createServer((req, res) => {
    const send = (status: number, body: string | Buffer, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "x-content-type-options": "nosniff", ...headers });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "", { allow: "GET, HEAD" });
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    void resolveFile(opts.root, pathname)
      .then(async (f) => {
        if (!f) return send(404, "not found", { "content-type": "text/plain; charset=utf-8" });
        const body = await readFile(f.abs);
        send(
          200,
          body,
          f.index
            ? { "content-type": "application/json", "cache-control": INDEX_CACHE }
            : { "content-type": "application/octet-stream", "cache-control": FILE_CACHE },
        );
      })
      .catch(() => send(404, "not found", { "content-type": "text/plain; charset=utf-8" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  const timer = opts.rebuildMs > 0 ? setInterval(() => void rebuild(), opts.rebuildMs) : null;
  timer?.unref();
  return {
    server,
    rebuild,
    close: () =>
      new Promise<void>((resolve) => {
        if (timer) clearInterval(timer);
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
