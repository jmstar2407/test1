import { dialog,el,field,select } from '../ui/ui.js';
import { TYPES,defaults,validateFilters } from '../utils/domain.js';
export class Filters {
 constructor(onApply){this.onApply=onApply;this.d=dialog('filters-sheet','Encuentra tu espacio');this.body=el('div',{class:'filter-body'});this.d.append(this.body);}
 open(filters,observedMax=0){
  const f=el('form');this.body.replaceChildren(f);const initial=filters;
  f.append(select('Operación','operation',[['sale','En venta'],['rent','En alquiler']],initial.operation),select('Tipo de propiedad','type',[['','Todos los tipos'],...Object.entries(TYPES).map(([k,v])=>[k,v.label])],initial.type));
  const upper=Math.max(observedMax,initial.operation==='sale'?100000000:250000,initial.maxPrice<1e12?initial.maxPrice:0);
  f.append(el('h3',{},'Precio · RD$'));
  const price=el('div',{class:'form-grid'});price.append(field('Desde','minPrice','number',initial.minPrice,{min:0,step:'any'}),field('Hasta','maxPrice','number',initial.maxPrice===1e12?'':initial.maxPrice,{min:0,step:'any',placeholder:'Sin límite'}));f.append(price);
  const ranges=el('div',{class:'ranges'}),min=el('input',{type:'range',min:0,max:upper,step:initial.operation==='sale'?10000:1000,'aria-label':'Precio mínimo'}),max=el('input',{type:'range',min:0,max:upper,step:initial.operation==='sale'?10000:1000,'aria-label':'Precio máximo'});min.value=initial.minPrice;max.value=initial.maxPrice===1e12?upper:initial.maxPrice;
  min.oninput=()=>{if(+min.value>+max.value)min.value=max.value;f.elements.minPrice.value=min.value;};max.oninput=()=>{if(+max.value<+min.value)max.value=min.value;f.elements.maxPrice.value=max.value;};ranges.append(min,max);f.append(ranges);
  const specs=el('div',{class:'form-grid'});for(const [k,t]of [['bedrooms','Habitaciones'],['bathrooms','Baños'],['parkingSpaces','Parqueos']])specs.append(select(t,k,[[0,'Cualquier cantidad'],...[1,2,3,4,5].map(n=>[n,n+'+'])],initial[k]));
  specs.append(field('Área mínima · m²','minArea','number',initial.minArea||'',{min:0,step:'any'}),field('Área máxima · m²','maxArea','number',initial.maxArea===1e9?'':initial.maxArea,{min:0,step:'any'}));f.append(specs);
  const status=el('p',{role:'alert'}),actions=el('div',{class:'filter-actions'});const reset=el('button',{type:'button',class:'secondary'},'Limpiar'),submit=el('button',{type:'submit',class:'primary'},'Mostrar propiedades');reset.onclick=()=>this.open({...defaults(),operation:initial.operation},observedMax);actions.append(reset,submit);f.append(status,actions);
  f.onsubmit=e=>{e.preventDefault();try{const data=Object.fromEntries(new FormData(f));data.maxPrice=data.maxPrice===''?1e12:+data.maxPrice;data.maxArea=data.maxArea===''?1e9:+data.maxArea;this.onApply(validateFilters(data));this.d.close();}catch(e){status.textContent=e.message;}};
  if(!this.d.open)this.d.showModal();
 }
}
