/* NYC 여행앱 오프라인 캐시
   목적: 지하철 등 일시적 통신 단절 구간에서 앱이 열리고 지도가 보이게 하는 것.
   범위를 일부러 좁게 잡았다 — 대량 사전 다운로드는 하지 않는다.

   · 앱 셸  : 네트워크 우선 (최신 배포를 놓치지 않음) → 실패 시 캐시
   · 지도 타일: 캐시 우선 (한 번 본 곳은 지하에서도 계속 보임), 상한 800장
   · 환율·날씨·행사·경로 API: 캐시하지 않음
     → 오래된 값을 최신인 척 보여주면 안 되기 때문. 실패는 앱이 직접 처리한다 */

const SHELL = 'nyc-shell-v1';
const TILES = 'nyc-tiles-v1';
const TILE_MAX = 800;                 /* 약 25MB — 방문 구역 위주로 자연스럽게 쌓임 */

const SHELL_URLS = [
  './',
  './index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.all(SHELL_URLS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles(){
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length > TILE_MAX){
    await Promise.all(keys.slice(0, keys.length - TILE_MAX).map(k => c.delete(k)));
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch(err){ return; }

  const isTile = /basemaps\.cartocdn\.com|tiles\.openfreemap\.org/.test(url.hostname);
  const isLib  = /cdnjs\.cloudflare\.com|unpkg\.com/.test(url.hostname);

  /* 타일·라이브러리 — 캐시 우선 */
  if (isTile || isLib){
    e.respondWith((async () => {
      const cache = await caches.open(isTile ? TILES : SHELL);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')){
          cache.put(req, res.clone());
          if (isTile) trimTiles();
        }
        return res;
      } catch(err){
        return hit || Response.error();
      }
    })());
    return;
  }

  /* 앱 셸 — 네트워크 우선, 끊기면 캐시 */
  if (url.origin === self.location.origin){
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok){
          const cache = await caches.open(SHELL);
          cache.put(req, res.clone());
        }
        return res;
      } catch(err){
        const hit = await caches.match(req);
        return hit || await caches.match('./index.html') || Response.error();
      }
    })());
  }
  /* 그 외 외부 API는 그대로 통과 — 캐시하지 않는다 */
});
