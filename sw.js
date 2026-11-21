// 서비스 워커: 앱 파일을 미리 저장해 오프라인에서도 연다. 파일 목록을 바꾸면 VERSION 을 올린다.
const VERSION = "frame-backlog-sim-v1.0.0-1";
const FILES = [
  "./", "index.html", "app.css", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "src/app.js", "src/engine.js", "src/analytic.js", "src/model.js", "src/scenarios.js", "src/timing.js", "src/gen.js",
  "src/i18n.js", "src/store.js", "src/charts.js", "src/export.js", "src/worker.js",
  "vendor/pretendard/pretendard.css", "vendor/pretendard/Pretendard-Regular.subset.woff2",
  "vendor/pretendard/Pretendard-SemiBold.subset.woff2", "vendor/pretendard/Pretendard-Bold.subset.woff2",
];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // 네트워크 먼저 (HTTP 캐시도 서버에 확인), 실패하면 저장본
  e.respondWith(
    fetch(e.request.url, { cache: "no-cache" }).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))),
  );
});
