import { firebase, call } from '../firebase/firebase.js';
import { config } from '../config/config.js';
import { queryPlan, cursorOf, compare } from './queryPlan.js';
import { matches, inside } from '../utils/domain.js';
import { cover, precisionForZoom, strategy } from '../utils/geo.js';
import * as cache from '../cache/propertyCache.js';
import { propertyStore } from './propertyStore.js';
const pending=new Map();
async function once(key,fn){if(!pending.has(key))pending.set(key,fn().finally(()=>pending.delete(key)));return pending.get(key);}
export class PropertyRepository {
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
export const repository=new PropertyRepository();
