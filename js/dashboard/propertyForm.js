import { dialog,el,field,select,$,toast,friendly,image } from '../ui/ui.js';
import { TYPES,validateProperty } from '../utils/domain.js';
import { loadLeaflet } from '../map/leafletProvider.js';
import { uploadImages } from '../storage/storage.js';
export class PropertyForm {
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
