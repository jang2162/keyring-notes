// Keyring Notes 서비스 워커: 오프라인에서도 앱이 열리도록 화면(index·assets)만 캐시한다.
// 문서 데이터(/api)는 캐시하지 않는다 — 앱이 IndexedDB에 직접 둔다(오프라인 편집).
// 빌드마다 아래 값이 바뀌어 새 워커가 설치되고 예전 assets를 정리한다.
// 바로 앞 빌드 하나는 남긴다 — 새로 고치기 전의 옛 화면이 아직 안 불러온 조각을 받게.
const BUILD = "__KEYRING_BUILD__";
const CACHE = `keyring-shell-${BUILD}`;
const STATIC = ["/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];
// 처음 화면에는 없지만 나중에 불러오는 자산(수식·다이어그램 조각, 글꼴). 빌드 때 채워진다.
const LAZY = "__KEYRING_LAZY__";

async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch("/", { cache: "no-store" });
  if (!res.ok) throw new Error(`index ${res.status}`);
  const html = await res.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await cache.put("/", res);
  await cache.addAll([...STATIC, ...assets]);
}

self.addEventListener("install", (e) => {
  // 실패하면(설치 중 오프라인·서버 재시작 경합) 반쪽 캐시를 지운다 — 남으면 다음 빌드의 activate 가 그것을 「바로 앞 빌드」 로 남기고
  // 열려 있는 화면이 쓰는 진짜 바로 앞 캐시를 지운다(staleCaches)
  e.waitUntil(
    precache().then(
      () => self.skipWaiting(),
      async (err) => {
        await caches.delete(CACHE);
        throw err;
      },
    ),
  );
});

/**
 * 지울 옛 화면 캐시: 이 빌드 것이 아닌 keyring-shell-* 중 빌드 id 가 가장 큰 하나(바로 앞 빌드)를 뺀 나머지.
 * 빌드 id 는 Date.now().toString(36) 이라 36진수 크기가 만든 순서다. 되돌린 배포(지금 빌드가 더 옛것)에서도 가장 새것 하나를 남긴다.
 */
function staleCaches(keys) {
  const PREFIX = "keyring-shell-";
  const old = keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE);
  const age = (k) => parseInt(k.slice(PREFIX.length), 36) || 0;
  const keep = old.reduce((best, k) => (best === null || age(k) > age(best) ? k : best), null);
  return old.filter((k) => k !== keep);
}

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const key of staleCaches(await caches.keys())) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
  // 활성화를 막지 않고 뒤에서: 나중에 불러오는 자산을 받아 둬 오프라인에서도 수식·다이어그램이 보이게.
  // 데이터 절약 모드면 받지 않는다(쓸 때 받은 것만 캐시된다).
  if (!(self.navigator.connection && self.navigator.connection.saveData) && Array.isArray(LAZY)) void warmLazy();
});

async function warmLazy() {
  const cache = await caches.open(CACHE);
  for (const url of LAZY) {
    try {
      if (!(await cache.match(url))) {
        const res = await fetch(url);
        // remember 와 같은 방어: SPA 대체 응답을 주는 프록시·옛 서버에서 없는 조각 자리에 HTML 을 넣지 않는다
        if (res.ok && !isHtmlForAsset(url, res)) await cache.put(url, res);
      }
    } catch {
      return; // 연결이 끊겼으면 다음에
    }
  }
}

// 열려 있는 화면이 「이 워커의 빌드가 내 빌드와 같은가」 를 묻는다(web/src/pwaUpdate.ts 의 askBuild). 포트로 빌드 id 를 답한다
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "build" && e.ports && e.ports[0]) e.ports[0].postMessage(BUILD);
});

// /assets·/widget-frame(위젯 iframe 묶음)에 HTML 이 오면(없는 조각에 SPA 대체 응답을 주는 프록시·옛 서버) 캐시하지 않는다 —
// 넣으면 그 주소가 계속 HTML 로 깨진다
function isHtmlForAsset(req, res) {
  const pathname = typeof req === "string" ? req : new URL(req.url).pathname;
  return (pathname.startsWith("/assets/") || pathname.startsWith("/widget-frame/")) && (res.headers.get("content-type") || "").includes("text/html");
}

function remember(req, res) {
  if (res.ok && !isHtmlForAsset(req, res)) {
    const copy = res.clone();
    void caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // 데이터·플러그인·MCP는 늘 네트워크로
  if (url.pathname.startsWith("/api/") || url.pathname === "/mcp" || url.pathname.startsWith("/plugins/")) return;
  if (req.mode === "navigate") {
    // 화면은 네트워크 우선, 끊기면 캐시한 index
    e.respondWith(
      fetch(req)
        .then((res) => remember("/", res))
        .catch(async () => (await caches.match("/")) ?? Response.error()),
    );
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    // 이름에 해시가 든 파일은 캐시 우선
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => remember(req, res))));
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => remember(req, res))
        .catch(() => hit ?? Response.error());
      return hit ?? net;
    }),
  );
});
