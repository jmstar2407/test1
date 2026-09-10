// map/mapProvider.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { config } = window.ArribaTe["config/config"];
const { el, toast } = window.ArribaTe["ui/ui"];
function stylesheet(url){if(document.querySelector(`link[href="${url}"]`))return;document.head.append(el('link',{rel:'stylesheet',href:url}));}
const scripts=new Map();
function script(url){if(!scripts.has(url))scripts.set(url,new Promise((resolve,reject)=>{const s=el('script',{src:url});s.onload=resolve;s.onerror=()=>reject(Error('No se pudo cargar el mapa.'));document.head.append(s);}));return scripts.get(url);}
class MapProvider {
 async init() {throw Error('Implementar init');}
 bounds(){throw Error('Implementar bounds');}
 zoom(){throw Error('Implementar zoom');}
 render(){throw Error('Implementar render');}
 flyTo(){throw Error('Implementar flyTo');}
 destroy(){throw Error('Implementar destroy');}
}
async function createMap(container,handlers){
 let provider,fallbackStarted=false;
 const fallback=async()=>{
  if(fallbackStarted)return;fallbackStarted=true;const old=provider?.center();provider?.destroy();container.replaceChildren();
  const {LeafletProvider}=window.ArribaTe["map/leafletProvider"];provider=new LeafletProvider(container,handlers);await provider.init();
  if(old)provider.flyTo(old,12);handlers.onProvider?.(provider);return provider;
 };
 if(config.mapboxToken){try{const {MapboxProvider}=window.ArribaTe["map/mapboxProvider"];provider=new MapboxProvider(container,{...handlers,onFatal:()=>fallback().catch(()=>toast('El mapa no está disponible. Puedes utilizar la lista.'))});await provider.init();return provider;}catch{return fallback();}}
 return fallback();
}

window.ArribaTe["map/mapProvider"] = { stylesheet, script, MapProvider, createMap };
})();


// map/propertyClustering.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
// Pixel-grid clustering for the bounded Leaflet result set. National counts come from Firestore zones.
function clusterPoints(items,project,zoom){
 const lowMemory=(navigator.deviceMemory||8)<=4;
 if(items.length<=30 && zoom>=11)return items.map(p=>({items:[p],lat:p.location.latitude,lng:p.location.longitude}));
 const size=zoom>=16?36:lowMemory?100:76,map=new Map();
 for(const p of items){const px=project(p.location),key=`${Math.floor(px.x/size)}:${Math.floor(px.y/size)}`;const c=map.get(key)||{items:[],lat:0,lng:0};c.items.push(p);c.lat+=p.location.latitude;c.lng+=p.location.longitude;map.set(key,c);}
 return [...map.values()].map(c=>({...c,lat:c.lat/c.items.length,lng:c.lng/c.items.length}));
}

window.ArribaTe["map/propertyClustering"] = { clusterPoints };
})();


// map/leafletProvider.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { MapProvider, stylesheet, script } = window.ArribaTe["map/mapProvider"];
const { config } = window.ArribaTe["config/config"];
const { TYPES, priceLabel } = window.ArribaTe["utils/domain"];
const { decode } = window.ArribaTe["utils/geo"];
const { el, toast } = window.ArribaTe["ui/ui"];
const { clusterPoints } = window.ArribaTe["map/propertyClustering"];
async function loadLeaflet(){stylesheet('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');if(!window.L)await script('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');return window.L;}
class LeafletProvider extends MapProvider {
 constructor(container,handlers){super();this.container=container;this.handlers=handlers;this.markers=new Map();this.items=[];this.clusters=[];}
 async init(){
  const L=await loadLeaflet();this.map=L.map(this.container,{zoomControl:false,preferCanvas:true}).setView([18.9,-70.25],8);
  this.base=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(this.map);
  L.control.zoom({position:'bottomright'}).addTo(this.map);
  this.map.on('moveend',()=>{this.render(this.items,this.clusters);this.handlers.onMove?.();});
  if(window.ResizeObserver){this.observer=new ResizeObserver(()=>this.map.invalidateSize());this.observer.observe(this.container);}
 }
 bounds(){const b=this.map.getBounds();return {west:b.getWest(),east:b.getEast(),south:b.getSouth(),north:b.getNorth()};}
 zoom(){return this.map.getZoom();} center(){return this.map.getCenter();}
 flyTo({lat,lng},zoom=13){this.map.setView([lat,lng],zoom,{animate:!matchMedia('(prefers-reduced-motion: reduce)').matches});}
 render(items=[],clusters=[]){
  this.items=items;this.clusters=clusters;const L=window.L,groups=clusterPoints(items,p=>this.map.latLngToContainerPoint([p.latitude,p.longitude]),this.zoom());
  const entries=groups.map(c=>({key:c.items.length===1?c.items[0].id:c.items.map(p=>p.id).sort().join(','),...c}));
  for(const c of clusters){const b=decode(c.zone.split('_')[1]);entries.push({key:c.zone,lat:(b.south+b.north)/2,lng:(b.west+b.east)/2,items:[],count:c.displayCount??c.count,bounds:b});}
  const active=new Set();
  for(const c of entries){
   active.add(c.key);const p=c.items.length===1?c.items[0]:null,count=c.count||c.items.length;
   const text=p?`${TYPES[p.type].icon} ${priceLabel(p)}`:String(count),signature=text+':'+c.lat+':'+c.lng;
   if(this.markers.get(c.key)?.signature===signature)continue;
   const old=this.markers.get(c.key);if(old)this.map.removeLayer(old.marker);
   const node=el('span',{class:p?'price-pin':'cluster-pin'},text);if(p)node.style.setProperty('--pin',TYPES[p.type].color);
   const marker=L.marker([c.lat,c.lng],{icon:L.divIcon({html:node,className:'marker-wrapper',iconSize:p?[140,36]:[48,48],iconAnchor:p?[70,18]:[24,24]}),keyboard:true,title:p?p.title:`${count} propiedades; acercar`}).addTo(this.map);
   marker.on('click',()=>{if(p)this.handlers.onSelect(p);else if(c.bounds)this.map.fitBounds([[c.bounds.south,c.bounds.west],[c.bounds.north,c.bounds.east]]);else this.flyTo(c,Math.min(this.zoom()+2,19));});
   this.markers.set(c.key,{marker,signature});
  }
  for(const [key,v]of this.markers)if(!active.has(key)){this.map.removeLayer(v.marker);this.markers.delete(key);}
 }
 satellite(enabled){
  if(enabled&&!config.satelliteTiles){toast('La vista satélite requiere configurar Mapbox o un proveedor de imágenes.');return false;}
  if(this.base)this.map.removeLayer(this.base);
  this.base=window.L.tileLayer(enabled?config.satelliteTiles:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:enabled?config.satelliteAttribution:'© OpenStreetMap contributors'}).addTo(this.map);return true;
 }
 destroy(){this.observer?.disconnect();this.map?.remove();}
}

window.ArribaTe["map/leafletProvider"] = { loadLeaflet, LeafletProvider };
})();


// map/mapboxProvider.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { MapProvider, stylesheet, script } = window.ArribaTe["map/mapProvider"];
const { config } = window.ArribaTe["config/config"];
const { TYPES,priceLabel } = window.ArribaTe["utils/domain"];
const { decode } = window.ArribaTe["utils/geo"];
class MapboxProvider extends MapProvider {
 constructor(container,handlers){super();this.container=container;this.handlers=handlers;this.items=[];this.clusters=[];}
 async init(){
  stylesheet('https://api.mapbox.com/mapbox-gl-js/v3.30.0/mapbox-gl.css');await script('https://api.mapbox.com/mapbox-gl-js/v3.30.0/mapbox-gl.js');
  if(!window.mapboxgl.supported())throw Error('WebGL no disponible.');
  this.map=new mapboxgl.Map({container:this.container,accessToken:config.mapboxToken,style:'mapbox://styles/mapbox/streets-v12',center:[-70.25,18.9],zoom:8});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Tiempo de carga del mapa agotado.')),12000);this.map.once('load',()=>{clearTimeout(timer);resolve();});this.map.once('error',e=>{clearTimeout(timer);reject(e.error);});});
  this.map.addControl(new mapboxgl.NavigationControl(),'bottom-right');this.layers();
  this.map.on('style.load',()=>this.layers());this.map.on('moveend',()=>this.handlers.onMove?.());
  this.map.on('error',e=>{if(e.error?.status===401||e.error?.status===403)this.handlers.onFatal?.();});
  this.map.on('click','property-points',e=>{const p=this.items.find(p=>p.id===e.features[0].properties.id);if(p)this.handlers.onSelect(p);});
  this.map.on('click','property-clusters',e=>{const f=e.features[0];this.map.getSource('properties').getClusterExpansionZoom(f.properties.cluster_id,(err,z)=>{if(!err)this.map.easeTo({center:f.geometry.coordinates,zoom:z});});});
  this.map.on('click','zone-circles',e=>{const b=decode(e.features[0].properties.zone.split('_')[1]);this.map.fitBounds([[b.west,b.south],[b.east,b.north]],{padding:50});});
 }
 layers(){
  if(this.map.getSource('properties'))return;
  this.map.addSource('properties',{type:'geojson',data:{type:'FeatureCollection',features:[]},cluster:true,clusterRadius:65,clusterMaxZoom:15});
  this.map.addLayer({id:'property-clusters',type:'circle',source:'properties',filter:['has','point_count'],paint:{'circle-color':'#125d52','circle-radius':25,'circle-stroke-width':4,'circle-stroke-color':'#ffffff'}});
  this.map.addLayer({id:'cluster-count',type:'symbol',source:'properties',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-size':14},paint:{'text-color':'#ffffff'}});
  this.map.addLayer({id:'property-dots',type:'circle',source:'properties',filter:['!', ['has','point_count']],paint:{'circle-color':['get','color'],'circle-radius':7,'circle-stroke-width':2,'circle-stroke-color':'#ffffff'}});
  this.map.addLayer({id:'property-points',type:'symbol',source:'properties',filter:['!', ['has','point_count']],layout:{'text-field':['get','label'],'text-size':13,'text-offset':[0,-1.1],'text-allow-overlap':false},paint:{'text-color':['get','color'],'text-halo-color':'#ffffff','text-halo-width':3}});
  this.map.addSource('zones',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  this.map.addLayer({id:'zone-circles',type:'circle',source:'zones',paint:{'circle-color':'#125d52','circle-radius':29,'circle-stroke-color':'#ffffff','circle-stroke-width':4}});
  this.map.addLayer({id:'zone-count',type:'symbol',source:'zones',layout:{'text-field':['to-string',['get','count']],'text-size':14},paint:{'text-color':'#ffffff'}});
  this.render(this.items,this.clusters);
 }
 render(items=[],clusters=[]){
  this.items=items;this.clusters=clusters;
  this.map.getSource('properties')?.setData({type:'FeatureCollection',features:items.map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.location.longitude,p.location.latitude]},properties:{id:p.id,label:`${TYPES[p.type].icon} ${priceLabel(p)}`,color:TYPES[p.type].color}}))});
  this.map.getSource('zones')?.setData({type:'FeatureCollection',features:clusters.map(c=>{const b=decode(c.zone.split('_')[1]);return {type:'Feature',geometry:{type:'Point',coordinates:[(b.west+b.east)/2,(b.south+b.north)/2]},properties:{zone:c.zone,count:c.displayCount??c.count}};})});
 }
 bounds(){const b=this.map.getBounds();return {west:b.getWest(),east:b.getEast(),south:b.getSouth(),north:b.getNorth()};}
 zoom(){return this.map.getZoom();}center(){return this.map.getCenter();}
 flyTo({lat,lng},zoom=13){this.map.easeTo({center:[lng,lat],zoom,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:700});}
 satellite(enabled){this.map.setStyle(enabled?'mapbox://styles/mapbox/satellite-streets-v12':'mapbox://styles/mapbox/streets-v12');return true;}
 destroy(){this.map?.remove();}
}

window.ArribaTe["map/mapboxProvider"] = { MapboxProvider };
})();
