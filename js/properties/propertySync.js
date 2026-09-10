export class PropertySync {
 constructor(refresh){this.refresh=refresh;this.online=()=>refresh(true);this.visibility=()=>{if(!document.hidden&&navigator.onLine)refresh(true);};window.addEventListener('online',this.online);document.addEventListener('visibilitychange',this.visibility);
  this.timer=setInterval(()=>{if(!document.hidden&&navigator.onLine)refresh(true);},60000);
 }
 stop(){clearInterval(this.timer);window.removeEventListener('online',this.online);document.removeEventListener('visibilitychange',this.visibility);}
}
