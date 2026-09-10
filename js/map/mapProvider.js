import { config } from '../config/config.js';
import { el, toast } from '../ui/ui.js';
export function stylesheet(url){if(document.querySelector(`link[href="${url}"]`))return;document.head.append(el('link',{rel:'stylesheet',href:url}));}
const scripts=new Map();
export function script(url){if(!scripts.has(url))scripts.set(url,new Promise((resolve,reject)=>{const s=el('script',{src:url});s.onload=resolve;s.onerror=()=>reject(Error('No se pudo cargar el mapa.'));document.head.append(s);}));return scripts.get(url);}
export class MapProvider {
 async init() {throw Error('Implementar init');}
 bounds(){throw Error('Implementar bounds');}
 zoom(){throw Error('Implementar zoom');}
 render(){throw Error('Implementar render');}
 flyTo(){throw Error('Implementar flyTo');}
 destroy(){throw Error('Implementar destroy');}
}
export async function createMap(container,handlers){
 let provider,fallbackStarted=false;
 const fallback=async()=>{
  if(fallbackStarted)return;fallbackStarted=true;const old=provider?.center();provider?.destroy();container.replaceChildren();
  const {LeafletProvider}=await import('./leafletProvider.js');provider=new LeafletProvider(container,handlers);await provider.init();
  if(old)provider.flyTo(old,12);handlers.onProvider?.(provider);return provider;
 };
 if(config.mapboxToken){try{const {MapboxProvider}=await import('./mapboxProvider.js');provider=new MapboxProvider(container,{...handlers,onFatal:()=>fallback().catch(()=>toast('El mapa no está disponible. Puedes utilizar la lista.'))});await provider.init();return provider;}catch{return fallback();}}
 return fallback();
}
