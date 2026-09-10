export class PropertyStore {
  constructor(){this.items=new Map();this.visible=[];this.selected=null;}
  merge(items){for(const p of items){const old=this.items.get(p.id);if(!old || p.version>=old.version)this.items.set(p.id,p);}while(this.items.size>1200)this.items.delete(this.items.keys().next().value);}
  remove(id){this.items.delete(id);this.visible=this.visible.filter(p=>p.id!==id);}
}
export const propertyStore = new PropertyStore();
