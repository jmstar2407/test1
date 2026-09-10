import { config } from '../config/config.js';
let promise;
function open(){
  return promise ??= new Promise((resolve,reject)=>{
    const r=indexedDB.open('arribate-v1',1);
    r.onupgradeneeded=()=>{for(const name of ['queries','properties','zones','details'])r.result.createObjectStore(name);};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
export async function read(store,key){try{const db=await open();return await new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch{return undefined;}}
export async function write(store,key,value){
  try{const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{/* Private browsing/storage quota: memory + network remain usable. */}
}
export async function remove(store,key){try{const db=await open();const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);}catch{}}
export async function prune(){
  try{const db=await open();for(const [name,cap] of [['queries',config.maxCacheQueries],['properties',2400],['zones',400],['details',40]]){
    const tx=db.transaction(name,'readwrite'),s=tx.objectStore(name),all=s.getAllKeys();all.onsuccess=()=>{for(const key of all.result.slice(0,Math.max(0,all.result.length-cap)))s.delete(key);};
  }}catch{}
}
