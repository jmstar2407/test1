const VERSION='arribate-shell-1';
const SHELL=["/", "/index.html", "/js/app.js", "/css/map.css", "/css/modal.css", "/css/forms.css", "/css/responsive.css", "/css/main.css", "/assets/favicon.svg", "/assets/demo-home.webp", "/assets/property-placeholder.svg", "/js/filters/filters.js", "/js/modal/propertyModal.js", "/js/ui/ui.js", "/js/ui/propertyCard.js", "/js/properties/propertyRepository.js", "/js/properties/propertyRanking.js", "/js/properties/demoRepository.js", "/js/properties/propertyStore.js", "/js/properties/queryPlan.js", "/js/properties/propertySync.js", "/js/storage/imageProcessor.js", "/js/storage/storage.js", "/js/storage/imageWorker.js", "/js/firebase/firebase.js", "/js/cache/propertyCache.js", "/js/config/config.js", "/js/utils/geo.js", "/js/utils/country.js", "/js/utils/domain.js", "/js/map/mapProvider.js", "/js/map/leafletProvider.js", "/js/map/mapboxProvider.js", "/js/map/propertyClustering.js", "/js/dashboard/propertyForm.js", "/js/dashboard/dashboard.js", "/js/search/search.js", "/js/search/prefetch.js", "/js/auth/auth.js"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('arribate-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;const url=new URL(e.request.url);
 if(url.origin!==self.location.origin)return;
 if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));return;}
 if(!SHELL.includes(url.pathname))return;
 e.respondWith(caches.match(e.request).then(cached=>{const fresh=fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(VERSION).then(c=>c.put(e.request,copy));}return r;}).catch(e=>{if(cached)return cached;throw e;});return cached||fresh;}));
});
