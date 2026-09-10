import { cover,precisionForZoom } from '../utils/geo.js';
export class Prefetch {
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
