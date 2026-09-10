import { matches,inside } from '../utils/domain.js';
const locations=[['Piantini',18.472,-69.938],['Naco',18.476,-69.932],['Bella Vista',18.455,-69.949],['Santo Domingo Este',18.489,-69.856],['Santiago',19.4517,-70.697],['Punta Cana',18.582,-68.405],['La Romana',18.427,-68.973],['Las Terrenas',19.312,-69.542]];
const items=locations.flatMap(([sector,latitude,longitude],i)=>['sale','rent'].map((operation,j)=>({
 id:`AB-DEMO-${i}-${j}`,title:`${['Casa con jardín privado','Apartamento luminoso','Villa con terraza'][i%3]} · Demostración`,type:['house','apartment','villa','land','industrial','farm','commercial'][i%7],operation,price:j?25000+i*12000:5800000+i*1350000,currency:'DOP',bedrooms:2+i%3,bathrooms:2,parkingSpaces:2,areaM2:120+i*24,location:{sector,province:'República Dominicana',municipality:sector,latitude,longitude},thumbnailUrl:'/assets/demo-home.webp',mainImageUrl:'/assets/demo-home.webp',images:[{id:'demo',thumbnail:'/assets/demo-home.webp',medium:'/assets/demo-home.webp',large:'/assets/demo-home.webp'}],imageCount:1,description:'Anuncio ficticio para explorar la interfaz de ArríbaTe. La fotografía es una ilustración generada y no corresponde a una propiedad disponible. En modo real, cada anunciante añade sus fotografías y sus datos.',features:['Datos de demostración','Imagen ilustrativa'],contact:{whatsapp:'+18095550123'},status:'active',featured:false,quality:.8,version:1,createdAt:Date.now(),updatedAt:Date.now()
})));
export class DemoRepository {
 async getPropertiesInViewport(bounds,zoom,filters){return {items:items.filter(p=>matches(p,filters)&&inside(p,bounds)),clusters:[],next:{},zones:[],total:items.length,fromCache:false};}
 async getProperty(id){const p=items.find(x=>x.id===id);if(!p)throw Error('Anuncio de demostración no encontrado.');return p;}
}
