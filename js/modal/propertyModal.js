import { dialog,el,image,toast,friendly } from '../ui/ui.js';
import { config } from '../config/config.js';
import { priceLabel } from '../utils/domain.js';
export class PropertyModal {
 constructor(repo){this.repo=repo;this.d=dialog('property-detail','Detalle de la propiedad');this.d.classList.add('property-detail');this.body=el('div',{class:'detail-body'});this.d.append(this.body);this.index=0;this.generation=0;
  this.d.addEventListener('close',()=>{this.generation++;this.unsubscribe?.();this.unsubscribe=null;if(location.pathname.startsWith('/propiedad/'))history.replaceState({},'', config.demo?'/?demo=1':'/');});
 }
 async open(id){
  const generation=++this.generation;this.unsubscribe?.();this.unsubscribe=null;
  this.body.replaceChildren(el('div',{class:'skeleton detail-loading','aria-label':'Cargando propiedad'}));if(!this.d.open)this.d.showModal();
  try{
   const p=await this.repo.getProperty(id);if(generation!==this.generation)return;
   if(p.status!=='active'){this.body.replaceChildren(el('p',{},'Esta propiedad no está disponible.'));return;}
   this.index=0;this.render(p);if(location.pathname!==`/propiedad/${encodeURIComponent(id)}`)history.pushState({property:id},'',`/propiedad/${encodeURIComponent(id)}${config.demo?'?demo=1':''}`);
   if(!config.demo&&navigator.onLine){const stop=await this.repo.watchProperty(id,next=>{
    if(generation!==this.generation)return;
    if(!next||next.status!=='active'){this.body.replaceChildren(el('p',{},'Esta propiedad ya no está disponible.'));return;}
    if(next.version!==this.p.version)this.render(next);
   },()=>{if(generation===this.generation)this.body.replaceChildren(el('p',{},'No se pudo actualizar el anuncio. Cierra y vuelve a abrir para comprobar su disponibilidad.'));});
   if(generation===this.generation)this.unsubscribe=stop;else stop();}
  }catch(e){if(generation===this.generation)this.body.replaceChildren(el('p',{},friendly(e)));}
 }
 render(p){
  this.p=p;this.body.replaceChildren();const gallery=el('section',{class:'gallery','aria-label':'Galería de fotografías'});
  const stage=el('div',{class:'gallery-stage',tabindex:'0','aria-label':'Fotografía; usa flechas para navegar'}),photo=image('',p.title);photo.loading='eager';stage.append(photo);
  const prev=el('button',{class:'gallery-prev icon-button','aria-label':'Fotografía anterior'},'‹'),next=el('button',{class:'gallery-next icon-button','aria-label':'Fotografía siguiente'},'›');
  const full=el('button',{class:'gallery-full icon-button','aria-label':'Pantalla completa'},'⛶'),zoom=el('button',{class:'gallery-zoom icon-button','aria-label':'Ampliar fotografía'},'＋');
  const counter=el('span',{class:'gallery-counter'});stage.append(prev,next,full,zoom,counter);
  const thumbs=el('div',{class:'gallery-thumbs'});const images=p.images||[];
  const show=n=>{this.index=(n+images.length)%images.length||0;photo.classList.remove('zoomed');const img=images[this.index];photo.src=img?.medium||p.mainImageUrl||'/assets/property-placeholder.svg';counter.textContent=`${this.index+1} / ${images.length||1}`;[...thumbs.children].forEach((b,i)=>b.setAttribute('aria-pressed',String(i===this.index)));};
  images.forEach((img,i)=>{const b=el('button',{'aria-label':`Fotografía ${i+1}`,type:'button'});b.append(image(img.thumbnail,`Miniatura ${i+1}`));b.onclick=()=>show(i);thumbs.append(b);});
  prev.onclick=()=>show(this.index-1);next.onclick=()=>show(this.index+1);
  full.onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(stage.requestFullscreen)await stage.requestFullscreen();else photo.classList.toggle('zoomed');}catch{toast('La pantalla completa no está disponible.');}};
  zoom.onclick=()=>{photo.src=images[this.index]?.large||photo.src;photo.classList.toggle('zoomed');};
  stage.onkeydown=e=>{if(e.key==='ArrowRight'){e.preventDefault();show(this.index+1);}if(e.key==='ArrowLeft'){e.preventDefault();show(this.index-1);}};
  let startX;stage.addEventListener('touchstart',e=>startX=e.changedTouches[0].clientX,{passive:true});stage.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-startX;if(Math.abs(dx)>50)show(this.index+(dx<0?1:-1));},{passive:true});
  gallery.append(stage,thumbs);show(Math.min(this.index,images.length-1));
  const content=el('section',{class:'detail-info'});content.append(el('p',{class:'eyebrow'},`${p.operation==='rent'?'EN ALQUILER':'EN VENTA'} · ${p.id}`),el('strong',{class:'detail-price'},priceLabel(p)),el('h1',{},p.title));
  const specs=el('div',{class:'detail-specs'});for(const t of [`${p.bedrooms} habitaciones`,`${p.bathrooms} baños`,`${p.parkingSpaces} parqueos`,`${p.areaM2} m²`])specs.append(el('span',{},t));
  content.append(specs,el('h3',{},'Acerca de esta propiedad'),el('p',{class:'description'},p.description));const tags=el('div',{class:'tags'});for(const f of p.features||[])tags.append(el('span',{},f));content.append(tags,el('h3',{},'Ubicación de la propiedad'),el('p',{class:'muted'},[p.location.sector,p.location.municipality,p.location.province].filter(Boolean).join(', ')));
  const coords=`${p.location.latitude},${p.location.longitude}`;
  if(config.googleMapsEmbedKey){const frame=el('iframe',{title:'Ubicación de la propiedad en Google Maps',loading:'lazy',referrerpolicy:'no-referrer-when-downgrade',src:`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(config.googleMapsEmbedKey)}&q=${encodeURIComponent(coords)}&zoom=16`});content.append(frame);}
  content.append(el('a',{href:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}`,target:'_blank',rel:'noopener noreferrer'},'Abrir ubicación en Google Maps'));
  const footer=el('footer',{class:'detail-footer'}),link=new URL(`/propiedad/${p.id}`,location.origin).href;
  const wa=el('a',{class:'whatsapp',target:'_blank',rel:'noopener noreferrer',href:`https://wa.me/${p.contact.whatsapp.replace(/\D/g,'')}?text=${encodeURIComponent(`Hola, me interesa saber información de la propiedad publicada en ArríbaTe: ${link}`)}`},'Para más información WhatsApp');
  footer.append(el('span',{class:'brand'},'ArríbaTe'),wa);if(config.demo){wa.removeAttribute('href');wa.setAttribute('aria-disabled','true');wa.textContent='Contacto desactivado en demostración';}
  this.body.append(gallery,content,footer);
 }
}
