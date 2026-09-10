export async function processImage(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('Usa JPG, PNG o WebP de hasta 15 MB.');
 if('OffscreenCanvas'in window && 'Worker'in window){
  try{return await new Promise((resolve,reject)=>{const worker=new Worker(new URL('./imageWorker.js',import.meta.url),{type:'module'});const timer=setTimeout(()=>{worker.terminate();reject(Error('Tiempo de procesamiento agotado.'));},30000);worker.onmessage=e=>{clearTimeout(timer);worker.terminate();e.data.error?reject(Error(e.data.error)):resolve(e.data.result);};worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(e);};worker.postMessage({file});});}catch{/* Canvas fallback for browsers without worker image decoding. */}
 }
 const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}),result={};
 try{if(bitmap.width*bitmap.height>40000000)throw Error('La imagen supera 40 megapíxeles.');
 for(const [variant,max]of [['thumbnail',400],['medium',1100],['large',2000]]){
  const ratio=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  result[variant]=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.82));
  if(!result[variant])throw Error('No se pudo procesar esta imagen.');await new Promise(r=>setTimeout(r,0));
 }}finally{bitmap.close();}return result;
}
