import { MapProvider, stylesheet, script } from './mapProvider.js';
import { config } from '../config/config.js';
import { TYPES, priceLabel } from '../utils/domain.js';
import { decode } from '../utils/geo.js';
import { el, toast } from '../ui/ui.js';
import { clusterPoints } from './propertyClustering.js';
export async function loadLeaflet(){stylesheet('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');await script('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');return window.L;}
export class LeafletProvider extends MapProvider {
 constructor(container,handlers){super();this.container=container;this.handlers=handlers;this.markers=new Map();this.items=[];this.clusters=[];}
 async init(){
  const L=await loadLeaflet();this.map=L.map(this.container,{zoomControl:false,preferCanvas:true}).setView([18.9,-70.25],8);
  this.base=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(this.map);
  L.control.zoom({position:'bottomright'}).addTo(this.map);
  this.map.on('moveend',()=>{this.render(this.items,this.clusters);this.handlers.onMove?.();});
  this.observer=new ResizeObserver(()=>this.map.invalidateSize());this.observer.observe(this.container);
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
