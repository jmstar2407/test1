import { firebase } from '../firebase/firebase.js';
import { processImage } from './imageProcessor.js';
export async function uploadImages(entries,session,user,onProgress){
 const {storage,st}=await firebase();const result=[];let slot=0;
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
