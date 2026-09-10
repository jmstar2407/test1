export const $ = (s, root=document) => root.querySelector(s);
export function el(tag,attrs={},text='') {const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')n.className=v;else if(k==='style')n.style.cssText=v;else n.setAttribute(k,v);}if(text)n.textContent=text;return n;}
export function toast(message){const n=$('#toast');n.textContent=message;n.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.hidden=true,6000);}
export function friendly(error){console.error(error);const code=error?.code||'';
  if(code.includes('unauthenticated'))return 'Inicia sesión para continuar.';
  if(code.includes('permission-denied'))return 'No tienes permiso para realizar esta acción.';
  if(code.includes('resource-exhausted'))return 'Alcanzaste el límite permitido. Revisa tus publicaciones.';
  if(code.includes('unavailable') || !navigator.onLine)return 'Sin conexión. Puedes consultar las zonas guardadas.';
  if(code.includes('popup'))return 'No se completó el inicio de sesión. Permite la ventana de Google e inténtalo otra vez.';
  if(code.includes('failed-precondition'))return 'No se pudo completar la operación. Revisa la configuración o recarga el anuncio.';
  if(!code && error instanceof Error && !/fetch|network|firebase|script|import/i.test(error.message))return error.message;
  return 'No pudimos completar la solicitud. Inténtalo de nuevo en unos momentos.';
}
export function debounce(fn,ms=350){let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),ms);};}
export function dialog(id,title){
 const d=el('dialog',{id,class:'sheet'});const header=el('header',{class:'dialog-header'});
 header.append(el('span',{class:'brand-mark','aria-hidden':'true'},'A↑'),el('h2',{},title));
 const close=el('button',{type:'button',class:'icon-button','aria-label':'Cerrar'},'×');close.onclick=()=>d.close();header.append(close);d.append(header);
 d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
 document.body.append(d);return d;
}
export function safeURL(url){try{const u=new URL(url,location.origin);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
export function image(url,alt,cls=''){const img=el('img',{alt,class:cls,loading:'lazy',decoding:'async'});img.src=safeURL(url)||'/assets/property-placeholder.svg';img.onerror=()=>{img.onerror=null;img.src='/assets/property-placeholder.svg';};return img;}
export function field(label,name,type='text',value='',attrs={}){const wrap=el('label',{class:'field'});wrap.append(el('span',{},label));const input=el('input',{name,type,...attrs});input.value=value;wrap.append(input);return wrap;}
export function select(label,name,options,value=''){const wrap=el('label',{class:'field'});wrap.append(el('span',{},label));const s=el('select',{name});for(const [v,t]of options){const o=el('option',{value:v},t);s.append(o);}s.value=value;wrap.append(s);return wrap;}
