import { config } from './config/config.js';
import { $,el,toast,friendly,debounce,dialog,safeURL } from './ui/ui.js';
import { defaults,TYPES,DR,inside,validateFilters } from './utils/domain.js';
import { createMap } from './map/mapProvider.js';
import { repository } from './properties/propertyRepository.js';
import { propertyStore } from './properties/propertyStore.js';
import { calculatePropertyScore } from './properties/propertyRanking.js';
import { propertyCard } from './ui/propertyCard.js';
import { PropertyModal } from './modal/propertyModal.js';
import { PropertyForm } from './dashboard/propertyForm.js';
import { Dashboard } from './dashboard/dashboard.js';
import { Filters } from './filters/filters.js';
import { search,places } from './search/search.js';
import { Prefetch } from './search/prefetch.js';
import { PropertySync } from './properties/propertySync.js';
import { login,logout,watchAuth } from './auth/auth.js';
const demo=config.demo||new URLSearchParams(location.search).get('demo')==='1';
if(demo)config.demo=true;
const repo=demo?new (await import('./properties/demoRepository.js')).DemoRepository():repository;
const state={filters:defaults(),map:null,next:{},generation:0,busy:false,items:[],clusters:[],user:null,label:'República Dominicana'};
const modal=new PropertyModal(repo),form=new PropertyForm(repo,()=>refresh(true)),dashboard=new Dashboard(repo,form,modal,()=>refresh(true));
const filters=new Filters(f=>{state.filters=f;updateOperation();refresh();}),prefetch=demo?null:new Prefetch(repo);
const status=text=>$('#status').textContent=text;
function bounds(){return state.map?.bounds()||DR;}
function updateOperation(){for(const b of document.querySelectorAll('[data-operation]')){const active=b.dataset.operation===state.filters.operation;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
 const tags=$('#active-filters');tags.replaceChildren();let count=0;const f=state.filters;
 for(const [on,text]of [[f.type,TYPES[f.type]?.label],[f.minPrice>0,`Desde RD$${f.minPrice.toLocaleString('es-DO')}`],[f.maxPrice<1e12,`Hasta RD$${f.maxPrice.toLocaleString('es-DO')}`],[f.bedrooms>0,`${f.bedrooms}+ hab.`],[f.bathrooms>0,`${f.bathrooms}+ baños`],[f.parkingSpaces>0,`${f.parkingSpaces}+ parqueos`],[f.minArea>0||f.maxArea<1e9,'Área personalizada']])if(on){tags.append(el('span',{},text));count++;}
 $('#filter-count').hidden=!count;$('#filter-count').textContent=count;
}
function render(items,clusters=[]){
 const center=state.map?.center()||{lat:18.9,lng:-70.25};
 const sorted=items.filter(p=>inside(p,bounds())).sort((a,b)=>calculatePropertyScore(b,{center,filters:state.filters})-calculatePropertyScore(a,{center,filters:state.filters})).slice(0,config.maxVisible);
 state.items=sorted;propertyStore.merge(sorted);propertyStore.visible=sorted;const list=$('#property-list'),existing=new Map([...list.querySelectorAll('.property-card')].map(n=>[n.dataset.id,n]));
 for(const node of [...list.children])if(!node.classList.contains('property-card'))node.remove();
 const ids=new Set(sorted.map(p=>p.id));for(const [id,node]of existing)if(!ids.has(id))node.remove();
 for(const p of sorted){let node=existing.get(p.id);if(!node||Number(node.dataset.version)!==p.version){const fresh=propertyCard(p,x=>modal.open(x.id));fresh.dataset.version=p.version;node?.replaceWith(fresh);node=fresh;}list.append(node);}
 if(!sorted.length){const empty=el('div',{class:'empty-state'});if(demo){const img=el('img',{src:'/assets/demo-home.webp',alt:'Casa tropical ilustrativa',loading:'lazy'});empty.append(img);}empty.append(el('h3',{},clusters.length?'Acércate a una zona':'Encuentra tu próximo espacio'),el('p',{},clusters.length?'Los círculos muestran anuncios por zona y tipo. Acerca el mapa para consultar precios y características.':'No hay resultados cargados aquí. Mueve el mapa, cambia los filtros o busca más zonas.'));list.append(empty);}
 const adjusted=clusters.map(c=>({...c,displayCount:state.filters.type?(c.types?.[state.filters.type]||0):c.count}));state.map?.render(sorted,adjusted);
 $('#results-title').textContent=clusters.length?'Propiedades por zona':`${sorted.length} propiedades cargadas`;
}
async function refresh(force=false,more=false){
 if(state.busy){state.generation++;state.queued={force:force||state.queued?.force||false};return;}
 const generation=++state.generation;state.busy=true;$('#load-more').disabled=true;status(more?'Cargando más…':force?'Actualizando…':'Buscando en esta zona…');
 if(!more)state.next={};const currentBounds=bounds(),zoom=state.map?.zoom()||8;const saved=more?state.items:[];
 try{
  const result=await repo.getPropertiesInViewport(currentBounds,zoom,state.filters,{force,cursorByZone:more?state.next:{},onlyZones:more?Object.keys(state.next):null,onCache:items=>{if(generation===state.generation){render(items);status('Mostrando resultados guardados');}}});
  if(generation!==state.generation)return;
  state.next=result.next;state.clusters=result.clusters;
  const merged=[...new Map([...saved,...result.items].map(p=>[p.id,p])).values()];render(merged,result.clusters);
  $('#load-more').hidden=!Object.keys(state.next).length;
  status(!navigator.onLine?'Sin conexión · mostrando resultados guardados':result.aggregate?'Conteos de zona por operación y tipo; acerca el mapa para aplicar los demás filtros.':result.fromCache?'Mostrando resultados guardados · verificados recientemente':demo?'Anuncios ficticios de demostración':Object.keys(state.next).length?'Datos actualizados · hay más zonas o páginas por consultar':'Datos actualizados');
  if(state.items.length>=config.maxVisible){$('#load-more').hidden=true;status('Acerca el mapa para explorar más propiedades; se muestran los resultados más relevantes cargados.');}
  prefetch?.schedule(currentBounds,zoom,state.filters,result.zones);
 }catch(e){if(generation===state.generation){status(friendly(e));if(!state.items.length)render([]);}}
 finally{state.busy=false;$('#load-more').disabled=false;const queued=state.queued;state.queued=null;if(queued)queueMicrotask(()=>refresh(queued.force));}
}
const moved=debounce(()=>refresh(),450);
for(const b of document.querySelectorAll('[data-operation]'))b.onclick=()=>{state.filters={...defaults(),operation:b.dataset.operation};updateOperation();refresh();};
$('#filters-button').onclick=()=>filters.open(state.filters,Math.max(0,...state.items.map(p=>p.price)));
$('#load-more').onclick=()=>refresh(false,true);$('#refresh').onclick=()=>refresh(true);
$('#home').onclick=()=>{state.filters=defaults();updateOperation();state.map?.flyTo({lat:18.9,lng:-70.25},8);refresh();};
$('#search-form').onsubmit=async e=>{e.preventDefault();const button=$('button',e.target);button.disabled=true;try{const result=await search($('#search-input').value,state.filters);state.filters=result.filters;updateOperation();if(result.center){state.label=result.label;state.map?.flyTo(result.center,13);}await refresh();}catch(e){toast(friendly(e));}finally{button.disabled=false;}};
for(const [label]of places)$('#places').append(el('option',{value:label}));
$('#publish').onclick=async()=>{try{const user=await login();const items=await repo.own(user);if(items.length>=4){toast('Ya tienes cuatro anuncios. Edita o elimina uno para publicar otro.');return dashboard.open();}await form.open(user);}catch(e){toast(friendly(e));}};
$('#my-properties').onclick=()=>dashboard.open();$('#mobile-account').onclick=()=>dashboard.open();$('#auth-button').onclick=async()=>{try{if(state.user)await logout();else await login();}catch(e){toast(friendly(e));}};
$('#locate').onclick=()=>{if(!navigator.geolocation)return toast('Geolocalización no disponible.');navigator.geolocation.getCurrentPosition(p=>state.map?.flyTo({lat:p.coords.latitude,lng:p.coords.longitude},14),()=>toast('No se pudo obtener tu ubicación.'),{timeout:15000});};
for(const [id,enabled]of [['map-style',false],['satellite-style',true]])$( '#'+id).onclick=()=>{if(state.map?.satellite(enabled)){for(const [key,on]of [['map-style',!enabled],['satellite-style',enabled]]){const b=$('#'+key);b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));}}};
$('#mobile-view').onclick=()=>{const show=document.body.classList.toggle('show-list');$('#mobile-view').textContent=show?'Ver mapa':'Ver lista';if(show)$('#results').focus();};
$('#legend-button').onclick=()=>{const d=dialog('legend','Tipos de propiedad'),body=el('div',{class:'legend-list'});for(const t of Object.values(TYPES)){const p=el('p',{},`${t.icon} ${t.label}`);p.style.color=t.color;body.append(p);}d.append(body);d.addEventListener('close',()=>d.remove());d.showModal();};
for(const [id,url]of [['privacy',config.privacyUrl],['terms',config.termsUrl]])$('#'+id).onclick=()=>{if(safeURL(url)&&url)window.open(safeURL(url),'_blank','noopener');else toast('Este documento aún no ha sido publicado por ArríbaTe.');};
for(const s of config.socialLinks.slice(0,3))if(safeURL(s.url))$('#social-links').append(el('a',{href:safeURL(s.url),target:'_blank',rel:'noopener noreferrer'},s.label));
window.addEventListener('offline',()=>status('Sin conexión · puedes explorar resultados guardados'));
window.addEventListener('popstate',()=>{const id=location.pathname.match(/^\/propiedad\/([^/]+)$/)?.[1];if(id)modal.open(decodeURIComponent(id));else modal.d.close();});
$('#demo-banner').hidden=!demo;
for(let i=0;i<3;i++)$('#property-list').append(el('div',{class:'skeleton card-skeleton','aria-hidden':'true'}));
try{state.map=await createMap($('#map'),{onMove:moved,onSelect:p=>modal.open(p.id),onProvider:p=>{state.map=p;refresh();}});}catch{$('#map-error').hidden=false;}
await refresh();
if(!demo){watchAuth(user=>{state.user=user;$('#auth-button').textContent=user?'Cerrar sesión':'Iniciar sesión';$('#auth-button').title=user?.displayName||'Iniciar sesión con Google';document.querySelector('.avatar-button')?.remove();if(user){const avatar=el('button',{class:'avatar-button','aria-label':'Mi cuenta: '+(user.displayName||'Usuario')});if(safeURL(user.photoURL)){avatar.append(el('img',{src:safeURL(user.photoURL),alt:''}));}else avatar.textContent=(user.displayName||'U')[0];avatar.onclick=()=>dashboard.open();$('.account-controls').prepend(avatar);}}).catch(()=>{});new PropertySync(force=>{if(!state.busy)refresh(force);});}
const route=location.pathname.match(/^\/propiedad\/([^/]+)$/);if(route)modal.open(decodeURIComponent(route[1]));
if(location.pathname==='/dashboard.html')dashboard.open();if(location.pathname==='/publish.html')$('#publish').click();
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
// Progressive WebMCP support shares the same filters and loading pipeline as the UI.
const context=document.modelContext;if(context?.registerTool){try{Promise.resolve(context.registerTool({name:'set_property_filters',title:'Filtrar propiedades',description:'Aplica filtros y actualiza las propiedades visibles. No publica anuncios.',inputSchema:{type:'object',properties:{operation:{enum:['sale','rent']},type:{type:'string'},minPrice:{type:'number',minimum:0},maxPrice:{type:'number',minimum:0}},additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{state.filters=validateFilters({...state.filters,...input});updateOperation();await refresh();return {loaded:state.items.length,filters:state.filters};}})).catch(()=>{});}catch{}}
