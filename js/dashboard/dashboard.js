import { dialog,el,toast,friendly } from '../ui/ui.js';
import { propertyCard } from '../ui/propertyCard.js';
import { login } from '../auth/auth.js';
export class Dashboard {
 constructor(repo,form,modal,onChange){this.repo=repo;this.form=form;this.modal=modal;this.onChange=onChange;this.d=dialog('my-properties','Mis propiedades');this.body=el('div',{class:'dashboard-body'});this.d.append(this.body);}
 async open(){try{this.user=await login();if(!this.d.open)this.d.showModal();await this.refresh();}catch(e){toast(friendly(e));}}
 async refresh(){this.body.replaceChildren(el('p',{},'Cargando tus propiedades…'));try{
  const items=await this.repo.own(this.user);this.body.replaceChildren(el('p',{class:'muted'},`${items.length} de 4 espacios utilizados`));
  const add=el('button',{class:'primary',type:'button'},'Publicar una propiedad');add.disabled=items.length>=4;add.onclick=()=>{this.d.close();this.form.open(this.user).catch(e=>toast(friendly(e)));};this.body.append(add);
  for(const p of items){const card=propertyCard(p,x=>{if(x.status==='active')this.modal.open(x.id);else this.form.open(this.user,x).catch(e=>toast(friendly(e)));});const info=el('p',{class:'dashboard-meta'},`${p.status==='active'?'Publicado':'Borrador'} · ${new Date(p.updatedAt).toLocaleDateString('es-DO')}`);const actions=el('div',{class:'dashboard-actions'});
   const edit=el('button',{type:'button',class:'secondary'},'Editar');edit.onclick=()=>{this.d.close();this.form.open(this.user,p).catch(e=>toast(friendly(e)));};
   const del=el('button',{type:'button',class:'danger'},'Eliminar');del.onclick=()=>this.confirmDelete(p);actions.append(edit,del);card.append(info,actions);this.body.append(card);
  }
 }catch(e){this.body.replaceChildren(el('p',{},friendly(e)));}}
 confirmDelete(p){const d=dialog('confirm-delete','Eliminar propiedad');const body=el('div',{class:'confirm-body'});body.append(el('p',{},`¿Eliminar “${p.title||'Borrador'}”? Se retirará del mapa y sus fotografías se eliminarán.`));const actions=el('div',{class:'confirm-actions'});const yes=el('button',{class:'danger',type:'button'},'Eliminar'),no=el('button',{class:'secondary',type:'button'},'Cancelar');no.onclick=()=>d.close();yes.onclick=async()=>{yes.disabled=true;try{await this.repo.deleteProperty(p);d.close();await this.refresh();await this.onChange();toast('Propiedad eliminada.');}catch(e){toast(friendly(e));yes.disabled=false;}};actions.append(yes,no);body.append(actions);d.append(body);d.addEventListener('close',()=>d.remove());d.showModal();no.focus();}
}
