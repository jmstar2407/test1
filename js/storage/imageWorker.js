self.onmessage=async e=>{
 try{
  const bitmap=await createImageBitmap(e.data.file,{imageOrientation:'from-image'}),result={};
  try{if(bitmap.width*bitmap.height>40000000)throw Error('La imagen supera 40 megapíxeles.');for(const [variant,size]of [['thumbnail',400],['medium',1100],['large',2000]]){
   const ratio=Math.min(1,size/Math.max(bitmap.width,bitmap.height)),w=Math.round(bitmap.width*ratio),h=Math.round(bitmap.height*ratio);
   const canvas=new OffscreenCanvas(w,h);canvas.getContext('2d').drawImage(bitmap,0,0,w,h);
   let blob=await canvas.convertToBlob({type:'image/webp',quality:variant==='thumbnail'?.74:.82});
   if(blob.type!=='image/webp')blob=await canvas.convertToBlob({type:'image/jpeg',quality:.82});
   result[variant]=blob;
  }}finally{bitmap.close();}
  self.postMessage({result});
 }catch(e){self.postMessage({error:e.message});}
};
