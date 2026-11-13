/* Public shell/static caching only. Never cache API, account or token URLs. */
const VERSION = "v5";
const SHELL_CACHE = `profitlens-shell-${VERSION}`;
const STATIC_CACHE = `profitlens-static-${VERSION}`;
const HASHED_ASSET = /[.-][0-9a-f]{8,}\.[a-z0-9]+$/i;
const PUBLIC_PAGES = new Set(["/", "/features", "/pricing", "/about", "/en", "/en/features", "/en/pricing", "/en/about"]);
const PRIVATE_PAGE = /^\/(auth|auth-v2|business|business-v2|billing-v2|platform-v2|contact)(\/|$)|^\/sales-v2\//;
const offline = () => new Response("Offline. Please reconnect and try again.", {status:503, headers:{"Content-Type":"text/plain; charset=utf-8", "X-Robots-Tag":"noindex"}});
self.addEventListener("install", event => {
 event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(["/app.html", "/manifest.json"])));
});
self.addEventListener("activate", event => {
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==SHELL_CACHE&&k!==STATIC_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("message", event => {if(event.data?.type==="SKIP_WAITING")self.skipWaiting();});
self.addEventListener("fetch", event => {
 const {request}=event, url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;
 if(request.mode==="navigate"){
  const publicPage=PUBLIC_PAGES.has(url.pathname)&&!url.search;
  event.respondWith(fetch(request).then(async response=>{
   if(publicPage&&response.ok&&response.headers.get("content-type")?.includes("text/html")){
    const copy=response.clone();await caches.open(SHELL_CACHE).then(cache=>cache.put(url.pathname,copy)).catch(()=>{});
   }
   return response;
  }).catch(async()=>publicPage?(await caches.match(url.pathname))||offline():PRIVATE_PAGE.test(url.pathname)?(await caches.match("/app.html"))||offline():offline()));
  return;
 }
 const staticAsset=(url.pathname.startsWith("/static/")&&HASHED_ASSET.test(url.pathname))||url.pathname.startsWith("/icons/")||url.pathname.startsWith("/social/")||["/manifest.json","/favicon.ico"].includes(url.pathname);
 if(staticAsset&&!url.search)event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(async response=>{
  if(response.ok){const copy=response.clone();await caches.open(STATIC_CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});}
  return response;
 })));
});
