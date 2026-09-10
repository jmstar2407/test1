import { MapProvider, stylesheet, script } from './mapProvider.js';
import { config } from '../config/config.js';
import { TYPES,priceLabel } from '../utils/domain.js';
import { decode } from '../utils/geo.js';
export class MapboxProvider extends MapProvider {
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
