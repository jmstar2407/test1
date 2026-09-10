/* Configuración y acceso a Firebase: tanto file:// como HTTPS consultan este proyecto.
 * Requiere Internet, reglas e índices del proyecto y las funciones beginEdit,
 * saveProperty y deleteProperty desplegadas (incluidas en la entrega anterior).
 * Google Auth requiere HTTP/HTTPS y un dominio autorizado en Firebase Authentication.
 * Configura publicBaseUrl con tu URL publicada para compartir enlaces desde archivos locales.
 */
// config/config.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const config = {
  publicBaseUrl: '', // Dominio HTTPS publicado, si se desea compartir anuncios reales.
  firebase: {
    apiKey: 'AIzaSyBRjDso4IPrh9WLvWWMYoPiJxNFD6Vt3RU',
    authDomain: 'arribate-com.firebaseapp.com',
    projectId: 'arribate-com',
    storageBucket: 'arribate-com.firebasestorage.app',
    messagingSenderId: '46945634270',
    appId: '1:46945634270:web:c74fd6781ac1fab5da7f4f',
    measurementId: 'G-Y4J11MBYKQ'
  },
  region: 'us-central1',
  mapboxToken: '', // Token PUBLICO pk..., restringido por dominio.
  googleMapsEmbedKey: '', // Maps Embed API; restringir por HTTP referrer.
  appCheckSiteKey: '', // reCAPTCHA Enterprise. Activar antes de exigir App Check.
  useEmulators: false,
  pageSize: 30,
  maxZones: 16,
  cacheTTL: 60000,
  maxCacheQueries: 120,
  maxVisible: 180,
  ranking: { distance: 25, featured: 10, quality: 15, recency: 10 },
  socialLinks: [], // Hasta 3 objetos { label: 'Instagram', url: 'https://...' }
  privacyUrl: '',
  termsUrl: '',
  satelliteTiles: '', // Fallback: URL de un proveedor con licencia + atribucion.
  satelliteAttribution: ''
};

window.ArribaTe["config/config"] = { config };
})();


// firebase/firebase.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { config } = window.ArribaTe["config/config"];
let init;
const loads=new Map();
function load(name){if(!loads.has(name))loads.set(name,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=`https://www.gstatic.com/firebasejs/12.2.1/firebase-${name}-compat.js`;s.onload=resolve;s.onerror=()=>reject(Error('No se pudo cargar Firebase.'));document.head.append(s);}));return loads.get(name);}
function firebase(){return init ??= (async()=>{
 await load('app');for(const name of ['auth','firestore','functions','storage'])await load(name);
 const sdk=window.firebase,app=sdk.apps.length?sdk.app():sdk.initializeApp(config.firebase);
 const db=app.firestore(),auth=app.auth(),functions=app.functions(config.region),storage=app.storage();
 if(config.useEmulators){auth.useEmulator('http://127.0.0.1:9099');db.useEmulator('127.0.0.1',8080);functions.useEmulator('127.0.0.1',5001);storage.useEmulator('127.0.0.1',9199);}
 try{await db.enablePersistence({synchronizeTabs:true});}catch{/* Optional cache; repository maintains its own cache. */}
 if(config.appCheckSiteKey){await load('app-check');app.appCheck().activate(new sdk.appCheck.ReCaptchaEnterpriseProvider(config.appCheckSiteKey),true);}
 const snap=s=>({id:s.id,exists:()=>s.exists,data:()=>s.data()});
 const fs={
  doc:(db,...parts)=>db.doc(parts.join('/')),collection:(db,...parts)=>db.collection(parts.join('/')),
  query:(ref,...clauses)=>clauses.reduce((q,fn)=>fn(q),ref),
  where:(...args)=>q=>q.where(...args),orderBy:(...args)=>q=>q.orderBy(...args),limit:n=>q=>q.limit(n),startAfter:(...args)=>q=>q.startAfter(...args),documentId:()=>sdk.firestore.FieldPath.documentId(),
  getDocFromServer:async ref=>snap(await ref.get({source:'server'})),getDocsFromServer:ref=>ref.get({source:'server'}),getDocs:ref=>ref.get(),
  onSnapshot:(ref,next,error)=>ref.onSnapshot(s=>next(snap(s)),error)
 };
 const authSDK={GoogleAuthProvider:sdk.auth.GoogleAuthProvider,signInWithPopup:(a,p)=>a.signInWithPopup(p),signOut:a=>a.signOut(),onAuthStateChanged:(a,cb)=>a.onAuthStateChanged(cb)};
 const fn={httpsCallable:(f,name,options)=>f.httpsCallable(name,options)};
 const st={ref:(s,path)=>s.ref(path),uploadBytesResumable:(ref,blob,meta)=>ref.put(blob,meta)};
 await new Promise(resolve=>{let stop;stop=auth.onAuthStateChanged(()=>{resolve();queueMicrotask(()=>stop?.());});});
 return {app,auth,authSDK,db,fs,functions,fn,storage,st};
})().catch(e=>{init=null;throw e;});}
async function call(name,data){const {functions,fn}=await firebase();return (await fn.httpsCallable(functions,name,{timeout:120000})(data)).data;}

window.ArribaTe["firebase/firebase"] = { firebase, call };
})();


// cache/propertyCache.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { config } = window.ArribaTe["config/config"];
let promise;
function open(){
  return promise ??= new Promise((resolve,reject)=>{
    const r=indexedDB.open('arribate-v1',1);
    r.onupgradeneeded=()=>{for(const name of ['queries','properties','zones','details'])r.result.createObjectStore(name);};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
async function read(store,key){try{const db=await open();return await new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch{return undefined;}}
async function write(store,key,value){
  try{const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{/* Private browsing/storage quota: memory + network remain usable. */}
}
async function remove(store,key){try{const db=await open();const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);}catch{}}
async function prune(){
  try{const db=await open();for(const [name,cap] of [['queries',config.maxCacheQueries],['properties',2400],['zones',400],['details',40]]){
    const tx=db.transaction(name,'readwrite'),s=tx.objectStore(name),all=s.getAllKeys();all.onsuccess=()=>{for(const key of all.result.slice(0,Math.max(0,all.result.length-cap)))s.delete(key);};
  }}catch{}
}

window.ArribaTe["cache/propertyCache"] = { read, write, remove, prune };
})();


// properties/propertyRepository.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { firebase, call } = window.ArribaTe["firebase/firebase"];
const { config } = window.ArribaTe["config/config"];
const { queryPlan, cursorOf, compare } = window.ArribaTe["properties/queryPlan"];
const { matches, inside } = window.ArribaTe["utils/domain"];
const { cover, precisionForZoom, strategy } = window.ArribaTe["utils/geo"];
const cache = window.ArribaTe["cache/propertyCache"];
const { propertyStore } = window.ArribaTe["properties/propertyStore"];
const pending=new Map();
async function once(key,fn){if(!pending.has(key))pending.set(key,fn().finally(()=>pending.delete(key)));return pending.get(key);}
class PropertyRepository {
 async metadata(zone,force=false){return once('meta:'+zone,()=>this.fetchMetadata(zone,force));}
 async fetchMetadata(zone,force=false){
  const old=await cache.read('zones',zone);
  if(old && (!navigator.onLine || (!force&&Date.now()-old.fetchedAt<config.cacheTTL)))return old;
  if(!navigator.onLine)return {count:0,revision:0,types:{},fetchedAt:0,missing:true};
  const {db,fs}=await firebase(),snap=await fs.getDocFromServer(fs.doc(db,'zones',zone));
  const meta={count:0,revision:0,...snap.data(),fetchedAt:Date.now()};await cache.write('zones',zone,meta);return meta;
 }
 async page(zone,filters,cursor=null,force=false){
  const key=JSON.stringify([zone,filters,cursor]);
  return once(key,async()=>{
   const old=await cache.read('queries',key);
   if(!navigator.onLine){if(old)return {...old,fromCache:true};return {items:[],next:null,fromCache:true,missing:true};}
   const meta=await this.metadata(zone,force);
   if(old && old.revision===meta.revision)return {...old,fromCache:true};
   // Fully covered zones can be updated with just changed summaries, including deletions/moves.
   if(old && old.complete && !cursor){
    const {db,fs}=await firebase();
    const changes=await fs.getDocsFromServer(fs.query(fs.collection(db,'zones',zone,'changes'),fs.where('seq','>',old.revision),fs.where('seq','<=',meta.revision),fs.orderBy('seq'),fs.limit(50)));
    if(changes.size<50){
      const map=new Map(old.items.map(p=>[p.id,p]));
      for(const d of changes.docs){const p=d.data().property;if(matches(p,filters))map.set(p.id,p);else map.delete(p.id);}
      const all=[...map.values()].sort(compare),items=all.slice(0,config.pageSize);
      const next=all.length>config.pageSize?cursorOf(items.at(-1)):null;
      const result={items,next,complete:!next,revision:meta.revision,savedAt:Date.now()};
      await cache.write('queries',key,result);return result;
    }
   }
   const {db,fs}=await firebase(),p=queryPlan(zone,filters,cursor,config.pageSize),f=p.filters;
   const clauses=[fs.where('zoneKeys','array-contains',zone),fs.where('status','==','active'),fs.where('operation','==',f.operation),fs.where('type','in',p.types),
    fs.where('price','>=',f.minPrice),fs.where('price','<=',f.maxPrice),fs.where('bedrooms','>=',f.bedrooms),fs.where('bathrooms','>=',f.bathrooms),
    fs.where('parkingSpaces','>=',f.parkingSpaces),fs.where('areaM2','>=',f.minArea),fs.where('areaM2','<=',f.maxArea),
    ...p.order.map(k=>fs.orderBy(k==='__name__'?fs.documentId():k))];
   if(cursor)clauses.push(fs.startAfter(...cursor));clauses.push(fs.limit(p.limit));
   const snap=await fs.getDocsFromServer(fs.query(fs.collection(db,'propertySummaries'),...clauses));
   const items=snap.docs.map(d=>({...d.data(),id:d.id}));
   const next=items.length===p.limit?cursorOf(items.at(-1)):null;
   const result={items,next,complete:!next,revision:meta.revision,savedAt:Date.now()};
   await cache.write('queries',key,result);for(const item of items)await cache.write('properties',item.id,item);
   return result;
  });
 }
 async getPropertiesInViewport(bounds,zoom,filters,{cursorByZone={},onCache,force=false,onlyZones=null}={}){
  const hashes=cover(bounds,precisionForZoom(zoom),config.maxZones),zones=hashes.map(h=>`${filters.operation}_${h}`);
  const selected=onlyZones?zones.filter(z=>onlyZones.includes(z)):zones;
  const cached=await Promise.all(selected.map(z=>cache.read('queries',JSON.stringify([z,filters,cursorByZone[z]||null]))));
  if(onCache && cached.some(Boolean))onCache(cached.flatMap(x=>x?.items||[]).filter(p=>inside(p,bounds)));
  const metas=await Promise.all(selected.map(async z=>({zone:z,...await this.metadata(z,force)})));
  const total=metas.reduce((n,m)=>n+(filters.type?(m.types?.[filters.type]||0):m.count),0);
  // National/regional density is represented by server-maintained counts; never fetch 100k points.
  if(zoom<11 && total>200)return {items:[],clusters:metas.filter(m=>(filters.type?(m.types?.[filters.type]||0):m.count)>0),total,zones,next:{},aggregate:true};
  // Sequential per-zone budget, max 3 queries per interaction. Others have explicit pending cursors.
  const mode=strategy(total),budget=['small','viewport'].includes(mode)?3:mode==='cluster'?2:1;
  const relevant=selected.filter(z=>{const m=metas.find(m=>m.zone===z);return m?.missing||m?.count>0;});
  const queried=relevant.slice(0,budget),items=[],next={};let fromCache=true,missing=false;
  for(const zone of queried){const result=await this.page(zone,filters,cursorByZone[zone]||null,false);items.push(...result.items);if(result.next)next[zone]=result.next;fromCache&&=!!result.fromCache;missing||=!!result.missing;}
  for(const zone of relevant.slice(budget))next[zone]=cursorByZone[zone]||null;
  propertyStore.merge(items);cache.prune();
  return {items:[...new Map(items.map(p=>[p.id,p])).values()].filter(p=>inside(p,bounds)),clusters:[],total,zones,next,fromCache,missing};
 }
 async getProperty(id){
  if(!navigator.onLine){const p=await cache.read('details',id);if(p)return p;throw Error('Este detalle no está guardado para verlo sin conexión.');}
  const {db,fs}=await firebase();let snap;try{snap=await fs.getDocFromServer(fs.doc(db,'properties',id));}catch(e){if(e.code==='permission-denied')await cache.remove('details',id);throw e;}
  if(!snap.exists())throw Error('Esta propiedad ya no está disponible.');
  const p={...snap.data(),id};await cache.write('details',id,p);return p;
 }
 async watchProperty(id,fn,onError){const {db,fs}=await firebase();return fs.onSnapshot(fs.doc(db,'properties',id),s=>{if(s.exists()){const p={...s.data(),id};cache.write('details',id,p);fn(p);}else fn(null);},onError);}
 async own(user){const {db,fs}=await firebase();const s=await fs.getDocs(fs.query(fs.collection(db,'properties'),fs.where('ownerId','==',user.uid),fs.where('status','in',['active','draft']),fs.limit(4)));return s.docs.map(d=>({...d.data(),id:d.id}));}
 createProperty(id){return call('beginEdit',{id});}
 updateProperty(id){return call('beginEdit',{id});}
 saveProperty(data){return call('saveProperty',data);}
 async deleteProperty(p){await call('deleteProperty',{id:p.id,baseVersion:p.version});propertyStore.remove(p.id);await cache.remove('details',p.id);}
 searchProperties(bounds,zoom,filters,opts){return this.getPropertiesInViewport(bounds,zoom,filters,opts);}
 async getFeaturedProperties(bounds,zoom,filters){const r=await this.getPropertiesInViewport(bounds,zoom,filters);return r.items.filter(p=>p.featured);}
}
const repository=new PropertyRepository();

window.ArribaTe["properties/propertyRepository"] = { PropertyRepository, repository };
})();


// auth/auth.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { firebase } = window.ArribaTe["firebase/firebase"];
const { config } = window.ArribaTe["config/config"];
async function login(){
  if(location.protocol==='file:')throw Error('Para iniciar sesión con Google y publicar, abre la web desde tu alojamiento o un servidor HTTP local. Google no admite el inicio de sesión desde archivos file://.');
  const {auth,authSDK}=await firebase();if(auth.currentUser)return auth.currentUser;
  return (await authSDK.signInWithPopup(auth,new authSDK.GoogleAuthProvider())).user;
}
async function logout(){const {auth,authSDK}=await firebase();await authSDK.signOut(auth);}
async function watchAuth(callback){const {auth,authSDK}=await firebase();return authSDK.onAuthStateChanged(auth,callback);}

window.ArribaTe["auth/auth"] = { login, logout, watchAuth };
})();


// storage/storage.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { config } = window.ArribaTe["config/config"];
const { firebase } = window.ArribaTe["firebase/firebase"];
const { processImage } = window.ArribaTe["storage/imageProcessor"];
async function uploadImages(entries,session,user,onProgress){
 const result=[];let slot=0;const {storage,st}=await firebase();
 for(let i=0;i<entries.length;i++){
  const entry=entries[i];if(entry.existing){result.push({existing:entry.existing});continue;}
  onProgress(`Procesando imágenes… ${i+1} / ${entries.length}`);
  const variants=await processImage(entry.file),current=slot++;
  for(const [variant,blob]of Object.entries(variants)){
   if(blob.size>2500000)throw Error('La imagen comprimida supera el máximo. Selecciona una imagen más pequeña.');
   const ref=st.ref(storage,`uploads/${user.uid}/${session.id}/${session.sessionId}/${String(current).padStart(2,'0')}/${variant}`);
   await new Promise((resolve,reject)=>{
    const task=st.uploadBytesResumable(ref,blob,{contentType:blob.type,cacheControl:'public,max-age=31536000,immutable'});
    task.on('state_changed',snap=>onProgress(`Subiendo ${i+1} / ${entries.length} · ${Math.round(snap.bytesTransferred/snap.totalBytes*100)}%`),reject,resolve);
   });
  }
  result.push({slot:current});
 }
 return result;
}

window.ArribaTe["storage/storage"] = { uploadImages };
})();
