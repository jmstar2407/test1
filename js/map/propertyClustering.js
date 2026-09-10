// Pixel-grid clustering for the bounded Leaflet result set. National counts come from Firestore zones.
export function clusterPoints(items,project,zoom){
 const lowMemory=(navigator.deviceMemory||8)<=4;
 if(items.length<=30 && zoom>=11)return items.map(p=>({items:[p],lat:p.location.latitude,lng:p.location.longitude}));
 const size=zoom>=16?36:lowMemory?100:76,map=new Map();
 for(const p of items){const px=project(p.location),key=`${Math.floor(px.x/size)}:${Math.floor(px.y/size)}`;const c=map.get(key)||{items:[],lat:0,lng:0};c.items.push(p);c.lat+=p.location.latitude;c.lng+=p.location.longitude;map.set(key,c);}
 return [...map.values()].map(c=>({...c,lat:c.lat/c.items.length,lng:c.lng/c.items.length}));
}
