// filters/filters.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { dialog,el,field,select } = window.ArribaTe["ui/ui"];
const { TYPES,defaults,validateFilters } = window.ArribaTe["utils/domain"];
class Filters {
 constructor(onApply){this.onApply=onApply;this.d=dialog('filters-sheet','Encuentra tu espacio');this.body=el('div',{class:'filter-body'});this.d.append(this.body);}
 open(filters,observedMax=0){
  const f=el('form');this.body.replaceChildren(f);const initial=filters;
  f.append(select('Operación','operation',[['sale','En venta'],['rent','En alquiler']],initial.operation),select('Tipo de propiedad','type',[['','Todos los tipos'],...Object.entries(TYPES).map(([k,v])=>[k,v.label])],initial.type));
  const upper=Math.max(observedMax,initial.operation==='sale'?100000000:250000,initial.maxPrice<1e12?initial.maxPrice:0);
  f.append(el('h3',{},'Precio · RD$'));
  const price=el('div',{class:'form-grid'});price.append(field('Desde','minPrice','number',initial.minPrice,{min:0,step:'any'}),field('Hasta','maxPrice','number',initial.maxPrice===1e12?'':initial.maxPrice,{min:0,step:'any',placeholder:'Sin límite'}));f.append(price);
  const ranges=el('div',{class:'ranges'}),min=el('input',{type:'range',min:0,max:upper,step:initial.operation==='sale'?10000:1000,'aria-label':'Precio mínimo'}),max=el('input',{type:'range',min:0,max:upper,step:initial.operation==='sale'?10000:1000,'aria-label':'Precio máximo'});min.value=initial.minPrice;max.value=initial.maxPrice===1e12?upper:initial.maxPrice;
  min.oninput=()=>{if(+min.value>+max.value)min.value=max.value;f.elements.minPrice.value=min.value;};max.oninput=()=>{if(+max.value<+min.value)max.value=min.value;f.elements.maxPrice.value=max.value;};ranges.append(min,max);f.append(ranges);
  const specs=el('div',{class:'form-grid'});for(const [k,t]of [['bedrooms','Habitaciones'],['bathrooms','Baños'],['parkingSpaces','Parqueos']])specs.append(select(t,k,[[0,'Cualquier cantidad'],...[1,2,3,4,5].map(n=>[n,n+'+'])],initial[k]));
  specs.append(field('Área mínima · m²','minArea','number',initial.minArea||'',{min:0,step:'any'}),field('Área máxima · m²','maxArea','number',initial.maxArea===1e9?'':initial.maxArea,{min:0,step:'any'}));f.append(specs);
  const status=el('p',{role:'alert'}),actions=el('div',{class:'filter-actions'});const reset=el('button',{type:'button',class:'secondary'},'Limpiar'),submit=el('button',{type:'submit',class:'primary'},'Mostrar propiedades');reset.onclick=()=>this.open({...defaults(),operation:initial.operation},observedMax);actions.append(reset,submit);f.append(status,actions);
  f.onsubmit=e=>{e.preventDefault();try{const data=Object.fromEntries(new FormData(f));data.maxPrice=data.maxPrice===''?1e12:+data.maxPrice;data.maxArea=data.maxArea===''?1e9:+data.maxArea;this.onApply(validateFilters(data));this.d.close();}catch(e){status.textContent=e.message;}};
  if(!this.d.open)this.d.showModal();
 }
}

window.ArribaTe["filters/filters"] = { Filters };
})();


// modal/propertyModal.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { dialog,el,image,toast,friendly,safeURL } = window.ArribaTe["ui/ui"];
const { config } = window.ArribaTe["config/config"];
const { priceLabel } = window.ArribaTe["utils/domain"];
class PropertyModal {
 constructor(repo){this.repo=repo;this.d=dialog('property-detail','Detalle de la propiedad');this.d.classList.add('property-detail');this.body=el('div',{class:'detail-body'});this.d.append(this.body);this.index=0;this.generation=0;
  this.d.addEventListener('close',()=>{this.generation++;this.unsubscribe?.();this.unsubscribe=null;if(location.hash.startsWith('#propiedad/'))history.replaceState({},'',location.pathname+location.search);});
 }
 async open(id){
  const generation=++this.generation;this.unsubscribe?.();this.unsubscribe=null;
  this.body.replaceChildren(el('div',{class:'skeleton detail-loading','aria-label':'Cargando propiedad'}));if(!this.d.open)this.d.showModal();
  try{
   const p=await this.repo.getProperty(id);if(generation!==this.generation)return;
   if(p.status!=='active'){this.body.replaceChildren(el('p',{},'Esta propiedad no está disponible.'));return;}
   this.index=0;this.render(p);if(location.hash!==`#propiedad/${encodeURIComponent(id)}`)history.pushState({property:id},'',`#propiedad/${encodeURIComponent(id)}`);
   if(navigator.onLine){const stop=await this.repo.watchProperty(id,next=>{
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
  const show=n=>{this.index=(n+images.length)%images.length||0;photo.classList.remove('zoomed');const img=images[this.index];photo.src=img?.medium||p.mainImageUrl||'img/property-placeholder.svg';counter.textContent=`${this.index+1} / ${images.length||1}`;[...thumbs.children].forEach((b,i)=>b.setAttribute('aria-pressed',String(i===this.index)));};
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
  const footer=el('footer',{class:'detail-footer'}),link=(config.publicBaseUrl||location.protocol!=='file:')?new URL(`#propiedad/${encodeURIComponent(p.id)}`,config.publicBaseUrl||document.baseURI).href:p.title+' ('+p.id+')';
  const wa=el('a',{class:'whatsapp',target:'_blank',rel:'noopener noreferrer',href:`https://wa.me/${p.contact.whatsapp.replace(/\D/g,'')}?text=${encodeURIComponent(`Hola, me interesa saber información de la propiedad publicada en ArríbaTe: ${link}`)}`},'Para más información WhatsApp');
  footer.append(el('span',{class:'brand'},'ArríbaTe'),wa);
  this.body.append(gallery,content,footer);
  const legal=document.getElementById('legal-footer').content.cloneNode(true);
  for(const [name,url] of [['privacy',config.privacyUrl],['terms',config.termsUrl]])legal.querySelector('[data-legal="'+name+'"]').onclick=()=>{if(url&&safeURL(url))window.open(safeURL(url),'_blank','noopener');else toast('Este documento aún no ha sido publicado por ArríbaTe.');};
  const socials=legal.querySelector('.social-links');
  for(const s of config.socialLinks.slice(0,3))if(safeURL(s.url))socials.append(el('a',{href:safeURL(s.url),target:'_blank',rel:'noopener noreferrer'},s.label));
  if(!socials.children.length)socials.textContent='Redes sociales próximamente';
  this.body.append(legal);
 }
}

window.ArribaTe["modal/propertyModal"] = { PropertyModal };
})();


// ui/propertyCard.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { el,image } = window.ArribaTe["ui/ui"];
const { TYPES,priceLabel } = window.ArribaTe["utils/domain"];
function propertyCard(p,onOpen){
 const card=el('article',{class:'property-card','data-id':p.id});
 const button=el('button',{type:'button',class:'card-open','aria-label':`Ver ${p.title}`});
 const photo=el('div',{class:'card-photo'});photo.append(image(p.thumbnailUrl,p.title));
 const badge=el('span',{class:'type-badge'},TYPES[p.type]?.label||'Borrador');photo.append(badge);
 const body=el('div',{class:'card-body'});body.append(el('strong',{class:'card-price'},p.price?priceLabel(p):'Sin publicar'),el('h3',{},p.title||'Nuevo borrador'),el('p',{class:'muted'},[p.location?.sector,p.location?.municipality].filter(Boolean).join(' · ')));
 const specs=el('div',{class:'specs'});specs.append(el('span',{},`${p.bedrooms||0} hab.`),el('span',{},`${p.bathrooms||0} baños`),el('span',{},`${p.areaM2||0} m²`));body.append(specs);
 button.append(photo,body);button.onclick=()=>onOpen(p);card.append(button);return card;
}

window.ArribaTe["ui/propertyCard"] = { propertyCard };
})();


// properties/propertyRanking.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { config } = window.ArribaTe["config/config"];
function calculatePropertyScore(p, { center, filters }) {
  const w=config.ranking, distance=Math.hypot(p.location.latitude-center.lat,(p.location.longitude-center.lng)*.94);
  const recent=Math.exp(-Math.max(0,Date.now()-p.updatedAt)/(30*86400000));
  const fit=(filters.type===p.type?4:0)+(p.bedrooms>=filters.bedrooms?1:0)+(p.price<=filters.maxPrice?1:0);
  return w.distance/(1+distance*20)+w.featured*Number(p.featured||false)+w.quality*(p.quality||0)+w.recency*recent+fit;
}

window.ArribaTe["properties/propertyRanking"] = { calculatePropertyScore };
})();


// properties/propertySync.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
class PropertySync {
 constructor(refresh){this.refresh=refresh;this.online=()=>refresh(true);this.visibility=()=>{if(!document.hidden&&navigator.onLine)refresh(true);};window.addEventListener('online',this.online);document.addEventListener('visibilitychange',this.visibility);
  this.timer=setInterval(()=>{if(!document.hidden&&navigator.onLine)refresh(true);},60000);
 }
 stop(){clearInterval(this.timer);window.removeEventListener('online',this.online);document.removeEventListener('visibilitychange',this.visibility);}
}

window.ArribaTe["properties/propertySync"] = { PropertySync };
})();


// dashboard/propertyForm.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { config } = window.ArribaTe["config/config"];
const { dialog,el,field,select,$,toast,friendly,image } = window.ArribaTe["ui/ui"];
const { TYPES,validateProperty } = window.ArribaTe["utils/domain"];
const { loadLeaflet } = window.ArribaTe["map/leafletProvider"];
const { uploadImages } = window.ArribaTe["storage/storage"];
class PropertyForm {
 constructor(repo,onSaved){this.repo=repo;this.onSaved=onSaved;this.d=dialog('publish-sheet','PublícaTe');this.d.classList.add('publish-sheet');this.content=el('div',{class:'form-content'});this.d.append(this.content);this.d.addEventListener('close',()=>{this.map?.remove();this.map=null;for(const e of this.entries||[])if(e.preview?.startsWith('blob:'))URL.revokeObjectURL(e.preview);});}
 async open(user,property=null){
  this.user=user;this.p=property||{};this.entries=(property?.images||[]).map(i=>({existing:i.id,preview:i.thumbnail}));
  const id=property?.id||`AB-${crypto.randomUUID().toUpperCase()}`;
  this.session=await (property?this.repo.updateProperty(id):this.repo.createProperty(id));
  this.render();this.d.showModal();await this.picker();
 }
 render(){
  const p=this.p,f=el('form',{class:'property-form'});this.content.replaceChildren(f);this.form=f;
  f.append(el('p',{class:'muted'},'Tu anuncio se guarda como borrador hasta publicarlo. Puedes tener hasta 4 anuncios, incluidos borradores.'));
  const basic=el('fieldset');basic.append(el('legend',{},'01 · Tu propiedad'));
  const grid=el('div',{class:'form-grid'});grid.append(select('Tipo','type',Object.entries(TYPES).map(([v,t])=>[v,t.label]),p.type||'house'),select('Operación','operation',[['sale','En venta'],['rent','En alquiler']],p.operation||'sale'),field('Precio · RD$','price','number',p.price||'',{min:1,max:1e12,required:'',step:'.01'}),field('Título','title','text',p.title||'',{minlength:8,maxlength:100,required:''}));
  const desc=el('label',{class:'field'});desc.append(el('span',{},'Descripción'));const ta=el('textarea',{name:'description',minlength:30,maxlength:6000,rows:4,required:''});ta.value=p.description||'';desc.append(ta);basic.append(grid,desc);
  const specs=el('div',{class:'form-grid four'});for(const [k,label,min,max]of [['bedrooms','Habitaciones',0,100],['bathrooms','Baños',0,100],['parkingSpaces','Parqueos',0,1000],['areaM2','Área · m²',1,1e9]])specs.append(field(label,k,'number',p[k]??(min? '':0),{min,max,required:'',step:k==='areaM2'?'any':1}));basic.append(specs,field('Características adicionales · separadas por comas','features','text',(p.features||[]).join(', '),{maxlength:2400,placeholder:'Piscina, balcón, seguridad…'}));f.append(basic);
  const loc=el('fieldset');loc.append(el('legend',{},'02 · Ubicación'));const lg=el('div',{class:'form-grid'});
  for(const [name,label]of [['province','Provincia'],['municipality','Municipio'],['sector','Sector'],['reference','Dirección / referencia (opcional)']])lg.append(field(label,name,'text',p.location?.[name]||'',{maxlength:name==='reference'?200:80,...(['province','municipality'].includes(name)?{required:''}:{})}));
  lg.append(field('Latitud','latitude','number',p.location?.latitude||18.4861,{step:'any',required:''}),field('Longitud','longitude','number',p.location?.longitude||-69.9312,{step:'any',required:''}));loc.append(lg,el('p',{class:'muted'},'Toca el mapa o mueve el marcador hasta la ubicación exacta. Las coordenadas serán públicas.'));
  const map=el('div',{id:'location-picker',class:'location-picker','aria-label':'Seleccionar ubicación'}),geo=el('button',{type:'button',class:'secondary'},'Usar mi ubicación');geo.onclick=()=>{if(!navigator.geolocation)return toast('Tu navegador no ofrece geolocalización.');navigator.geolocation.getCurrentPosition(pos=>this.setLocation(pos.coords.latitude,pos.coords.longitude),()=>toast('No pudimos obtener tu ubicación. Selecciónala en el mapa.'),{enableHighAccuracy:true,timeout:15000});};loc.append(map,geo);f.append(loc);
  const contact=el('fieldset');contact.append(el('legend',{},'03 · Contacto'));const cg=el('div',{class:'form-grid'});
  for(const [name,label]of [['phone','Teléfono'],['whatsapp','WhatsApp']]){
   const wrap=el('div',{class:'phone-field'}),stored=p.contact?.[name]||'+1';let country=['+1','+34','+57','+58','+52'].find(c=>stored.startsWith(c))||'+1';
   wrap.append(select('País',name+'Country',[['+1','🇩🇴 / 🇺🇸 +1'],['+34','🇪🇸 +34'],['+57','🇨🇴 +57'],['+58','🇻🇪 +58'],['+52','🇲🇽 +52']],country),field(label,name,'tel',stored.slice(country.length),{required:'',placeholder:'809-555-0123',maxlength:20}));
   const inp=$('input',wrap);inp.oninput=()=>{const digits=inp.value.replace(/\D/g,'').slice(0,13);inp.value=digits.length<=3?digits:digits.length<=6?digits.slice(0,3)+'-'+digits.slice(3):digits.slice(0,3)+'-'+digits.slice(3,6)+'-'+digits.slice(6);};cg.append(wrap);
  }contact.append(cg);f.append(contact);
  const photos=el('fieldset');photos.append(el('legend',{},'04 · Fotografías'));const drop=el('label',{class:'upload-drop'});drop.append(el('strong',{},'Arrastra tus fotos o selecciónalas'),el('span',{},'JPG, PNG o WebP · hasta 20 imágenes · 15 MB por archivo'));
  const input=el('input',{type:'file',accept:'image/jpeg,image/png,image/webp',multiple:'','aria-label':'Seleccionar fotografías'});input.onchange=()=>{this.addFiles(input.files);input.value='';};drop.append(input);
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragging');};drop.ondragleave=()=>drop.classList.remove('dragging');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragging');this.addFiles(e.dataTransfer.files);};
  this.photoList=el('div',{class:'photo-list'});photos.append(drop,this.photoList);f.append(photos);this.renderPhotos();
  this.progress=el('p',{role:'status','aria-live':'polite'});const footer=el('div',{class:'form-footer'});this.submit=el('button',{type:'submit',class:'primary'},p.status==='active'?'Guardar cambios':'Publicar propiedad');footer.append(this.progress,this.submit);f.append(footer);
  f.onsubmit=e=>{e.preventDefault();this.save();};
 }
 async picker(){try{const L=await loadLeaflet();if(!this.d.open)return;const lat=+this.form.elements.latitude.value,lng=+this.form.elements.longitude.value;
  this.map=L.map('location-picker').setView([lat,lng],14);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(this.map);
  this.marker=L.marker([lat,lng],{draggable:true}).addTo(this.map);this.marker.on('dragend',()=>{const p=this.marker.getLatLng();this.setLocation(p.lat,p.lng,false);});this.map.on('click',e=>this.setLocation(e.latlng.lat,e.latlng.lng,false));
  for(const key of ['latitude','longitude'])this.form.elements[key].onchange=()=>{const lat=+this.form.elements.latitude.value,lng=+this.form.elements.longitude.value;if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)this.setLocation(lat,lng);};
 }catch{toast('El selector de mapa no pudo cargar. Puedes escribir las coordenadas.');}}
 setLocation(lat,lng,pan=true){this.form.elements.latitude.value=lat.toFixed(6);this.form.elements.longitude.value=lng.toFixed(6);this.marker?.setLatLng([lat,lng]);if(pan)this.map?.setView([lat,lng],16);}
 addFiles(files){for(const file of files){if(this.entries.length>=20){toast('Puedes agregar hasta 20 fotografías.');break;}if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024){toast('Cada imagen debe ser JPG, PNG o WebP de hasta 15 MB.');continue;}this.entries.push({file,preview:URL.createObjectURL(file)});}this.renderPhotos();}
 renderPhotos(){this.photoList.replaceChildren();this.entries.forEach((entry,i)=>{
  const card=el('div',{class:'photo-edit',draggable:'true'}),img=el('img',{src:entry.preview,alt:`Fotografía ${i+1}`,loading:'lazy'});card.append(img,el('span',{},i===0?'Principal':String(i+1)));
  const actions=el('div');for(const [label,delta]of [['←',-1],['→',1]]){const b=el('button',{type:'button','aria-label':delta<0?'Mover foto antes':'Mover foto después'},label);b.disabled=i+delta<0||i+delta>=this.entries.length;b.onclick=()=>this.move(i,i+delta);actions.append(b);}
  const remove=el('button',{type:'button','aria-label':'Eliminar fotografía'},'×');remove.onclick=()=>{if(entry.preview.startsWith('blob:'))URL.revokeObjectURL(entry.preview);this.entries.splice(i,1);this.renderPhotos();};actions.append(remove);card.append(actions);
  card.ondragstart=e=>e.dataTransfer.setData('text/plain',String(i));card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain'));if(Number.isInteger(from)&&from>=0&&from<this.entries.length)this.move(from,i);};this.photoList.append(card);
 });}
 move(from,to){this.entries.splice(to,0,this.entries.splice(from,1)[0]);this.renderPhotos();}
 async save(){
  if(!navigator.onLine)return toast('Conéctate a Internet para publicar.');
  let property;try{const data=Object.fromEntries(new FormData(this.form));property=validateProperty({...data,location:{...data},contact:{phone:data.phoneCountry+data.phone.replace(/\D/g,''),whatsapp:data.whatsappCountry+data.whatsapp.replace(/\D/g,'')},features:data.features.split(',')});if(!this.entries.length)throw Error('Agrega al menos una fotografía.');}catch(e){return toast(friendly(e));}
  const controls=[...this.form.querySelectorAll('input,select,textarea,button')];controls.forEach(x=>x.disabled=true);this.d.querySelector('.dialog-header button').disabled=true;
  const cancel=e=>e.preventDefault();this.d.addEventListener('cancel',cancel);
  try{const images=await uploadImages(this.entries,this.session,this.user,text=>this.progress.textContent=text);this.progress.textContent='Validando y publicando…';await this.repo.saveProperty({...this.session,property,images});toast('Publicado correctamente.');this.d.close();await this.onSaved();}
  catch(e){toast(friendly(e));this.progress.textContent='No se publicaron los cambios. Reabre el editor si necesitas reintentar la carga.';}
  finally{controls.forEach(x=>x.disabled=false);this.d.querySelector('.dialog-header button').disabled=false;this.d.removeEventListener('cancel',cancel);}
 }
}

window.ArribaTe["dashboard/propertyForm"] = { PropertyForm };
})();


// dashboard/dashboard.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { dialog,el,toast,friendly } = window.ArribaTe["ui/ui"];
const { propertyCard } = window.ArribaTe["ui/propertyCard"];
const { login } = window.ArribaTe["auth/auth"];
class Dashboard {
 constructor(repo,form,modal,onChange){this.repo=repo;this.form=form;this.modal=modal;this.onChange=onChange;this.d=dialog('my-properties','Mis propiedades');this.body=el('div',{class:'dashboard-body'});this.d.append(this.body);}
 async open(){try{this.user=await login();if(!this.d.open)this.d.showModal();await this.refresh();}catch(e){toast(friendly(e));}}
 async refresh(){this.body.replaceChildren(el('p',{},'Cargando tus propiedades…'));try{
  const items=await this.repo.own(this.user);this.body.replaceChildren(el('p',{class:'muted'},`${items.length} de 4 espacios utilizados`));
  const add=el('button',{class:'primary',type:'button'},'Publicar una propiedad');add.disabled=items.length>=4;add.onclick=()=>{this.d.close();this.form.open(this.user).catch(e=>toast(friendly(e)));};this.body.append(add);
  for(const p of items){const card=propertyCard(p,x=>{if(x.status==='active')this.modal.open(x.id);else this.form.open(this.user,x).catch(e=>toast(friendly(e)));});const info=el('p',{class:'dashboard-meta'},`${p.status==='active'?'Publicado':'Borrador'} · ${new Date(p.updatedAt).toLocaleDateString('es-DO')}`);const actions=el('div',{class:'dashboard-actions'});
   const edit=el('button',{type:'button',class:'secondary'},'Editar');edit.onclick=()=>{this.d.close();this.form.open(this.user,p).catch(e=>toast(friendly(e)));};
   const del=el('button',{type:'button',class:'danger'},'Eliminar');del.onclick=()=>this.confirmDelete(p);actions.append(edit,del);card.append(info,actions);this.body.append(card);
  }
 }catch(e){this.body.replaceChildren(el('p',{},friendly(e)));}}
 confirmDelete(p){const d=dialog('confirm-delete','Eliminar propiedad');const body=el('div',{class:'confirm-body'});body.append(el('p',{},`¿Eliminar “${p.title||'Borrador'}”? Se retirará del mapa y sus fotografías se eliminarán.`));const actions=el('div',{class:'confirm-actions'});const yes=el('button',{class:'danger',type:'button'},'Eliminar'),no=el('button',{class:'secondary',type:'button'},'Cancelar');no.onclick=()=>d.close();yes.onclick=async()=>{yes.disabled=true;try{await this.repo.deleteProperty(p);d.close();await this.refresh();await this.onChange();toast('Propiedad eliminada.');}catch(e){toast(friendly(e));yes.disabled=false;}};actions.append(yes,no);body.append(actions);d.append(body);d.addEventListener('close',()=>d.remove());d.showModal();no.focus();}
}

window.ArribaTe["dashboard/dashboard"] = { Dashboard };
})();


// search/search.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { config } = window.ArribaTe["config/config"];
const { normalize,TYPES } = window.ArribaTe["utils/domain"];
// Approximate navigation centers, editable catalog. They do not validate an address.
const places=[
 ['Santo Domingo',18.4861,-69.9312],['Santo Domingo Este',18.4885,-69.856],['Distrito Nacional',18.4861,-69.9312],
 ['Santiago',19.4517,-70.697],['Punta Cana',18.582,-68.405],['Bávaro',18.683,-68.45],['La Romana',18.427,-68.973],
 ['Puerto Plata',19.793,-70.688],['San Pedro de Macorís',18.453,-69.308],['La Vega',19.222,-70.529],['San Cristóbal',18.416,-70.109],
 ['Samaná',19.204,-69.336],['Las Terrenas',19.312,-69.542],['Jarabacoa',19.121,-70.643],['Higüey',18.615,-68.708],['Baní',18.279,-70.331],
 ['Naco',18.476,-69.932],['Piantini',18.472,-69.938],['Bella Vista',18.455,-69.949],['Ensanche Ozama',18.484,-69.872]
];
async function search(text,filters){
 let query=normalize(text),next={...filters};
 const aliases=[['apartamento','apartment'],['casa','house'],['solar','land'],['terreno','land'],['villa','villa'],['finca','farm'],['nave industrial','industrial'],['local comercial','commercial']];
 for(const [label,type]of aliases){const re=new RegExp(`\\b${label}s?\\b`);if(re.test(query)){next.type=type;query=query.replace(re,'').trim();break;}}
 const price=query.match(/(?:hasta|precio|rd\$|rd)\s*([\d,.]+)\s*(millones|millon|mil)?/);
 if(price){next.maxPrice=Number(price[1].replace(/,/g,''))*(price[2]?.startsWith('millon')?1e6:price[2]==='mil'?1000:1);query=query.replace(price[0],'').trim();}
 query=query.replace(/^(en|de)\s+/,'').trim();if(!query)return {filters:next};
 const local=places.find(p=>normalize(p[0])===query);if(local)return {filters:next,center:{lat:local[1],lng:local[2]},label:local[0]};
 if(!config.mapboxToken)throw Error('Ubicación no encontrada en el catálogo local. Selecciona otra zona en el mapa; la búsqueda completa requiere configurar Mapbox.');
 const params=new URLSearchParams({q:query,country:'do',language:'es',limit:'1',autocomplete:'false',access_token:config.mapboxToken});
 const r=await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('No pudimos buscar esa ubicación. Inténtalo de nuevo.');
 const result=(await r.json()).features?.[0];if(!result)throw Error('No encontramos esa ubicación en República Dominicana.');
 // Temporary geocoding results are not persisted, in accordance with the provider terms.
 return {filters:next,center:{lng:result.geometry.coordinates[0],lat:result.geometry.coordinates[1]},label:result.properties.name||text};
}

window.ArribaTe["search/search"] = { places, search };
})();


// search/prefetch.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { cover,precisionForZoom } = window.ArribaTe["utils/geo"];
class Prefetch {
 constructor(repo){this.repo=repo;this.last=0;this.center=null;this.timer=null;}
 schedule(bounds,zoom,filters,knownZones){
  const center={lng:(bounds.west+bounds.east)/2,lat:(bounds.south+bounds.north)/2},previous=this.center;this.center=center;
  clearTimeout(this.timer);
  if(!previous||!navigator.onLine||navigator.connection?.saveData||document.hidden||Date.now()-this.last<60000||zoom<11)return;
  const dx=center.lng-previous.lng,dy=center.lat-previous.lat;if(Math.abs(dx)+Math.abs(dy)<.001)return;
  const shifted={west:bounds.west+dx,east:bounds.east+dx,south:bounds.south+dy,north:bounds.north+dy};
  const zone=cover(shifted,precisionForZoom(zoom),16).map(h=>`${filters.operation}_${h}`).find(z=>!knownZones.includes(z));if(!zone)return;
  this.timer=setTimeout(async()=>{try{this.last=Date.now();const meta=await this.repo.metadata(zone);if(meta.count>0&&meta.count<=50)await this.repo.page(zone,filters);}catch{/* Speculative work must never interrupt exploration. */}},1800);
 }
}

window.ArribaTe["search/prefetch"] = { Prefetch };
})();
