import { el,image } from './ui.js';
import { TYPES,priceLabel } from '../utils/domain.js';
export function propertyCard(p,onOpen){
 const card=el('article',{class:'property-card','data-id':p.id});
 const button=el('button',{type:'button',class:'card-open','aria-label':`Ver ${p.title}`});
 const photo=el('div',{class:'card-photo'});photo.append(image(p.thumbnailUrl,p.title));
 const badge=el('span',{class:'type-badge'},TYPES[p.type]?.label||'Borrador');photo.append(badge);
 const body=el('div',{class:'card-body'});body.append(el('strong',{class:'card-price'},p.price?priceLabel(p):'Sin publicar'),el('h3',{},p.title||'Nuevo borrador'),el('p',{class:'muted'},[p.location?.sector,p.location?.municipality].filter(Boolean).join(' · ')));
 const specs=el('div',{class:'specs'});specs.append(el('span',{},`${p.bedrooms||0} hab.`),el('span',{},`${p.bathrooms||0} baños`),el('span',{},`${p.areaM2||0} m²`));body.append(specs);
 button.append(photo,body);button.onclick=()=>onOpen(p);card.append(button);return card;
}
