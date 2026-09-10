import { config } from '../config/config.js';
export function calculatePropertyScore(p, { center, filters }) {
  const w=config.ranking, distance=Math.hypot(p.location.latitude-center.lat,(p.location.longitude-center.lng)*.94);
  const recent=Math.exp(-Math.max(0,Date.now()-p.updatedAt)/(30*86400000));
  const fit=(filters.type===p.type?4:0)+(p.bedrooms>=filters.bedrooms?1:0)+(p.price<=filters.maxPrice?1:0);
  return w.distance/(1+distance*20)+w.featured*Number(p.featured||false)+w.quality*(p.quality||0)+w.recency*recent+fit;
}
