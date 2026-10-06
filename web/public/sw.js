// Keyring Notes 서비스 워커: 오프라인에서도 앱이 열리도록 화면(index·assets)만 캐시한다.
// 문서 데이터(/api)는 캐시하지 않는다 — 앱이 IndexedDB에 직접 둔다(오프라인 편집).
// 빌드마다 아래 값이 바뀌어 새 워커가 설치되고 예전 assets를 정리한다.
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
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("keyring-shell-") && key !== CACHE) await caches.delete(key);
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
        if (res.ok) await cache.put(url, res);
      }
    } catch {
      return; // 연결이 끊겼으면 다음에
    }
  }
}

function remember(req, res) {
  if (res.ok) {
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
