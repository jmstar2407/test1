import { config } from '../config/config.js';
const V='https://www.gstatic.com/firebasejs/12.2.1/';
let init;
export function firebase(){return init ??= (async()=>{
  const [appSDK,authSDK,fs,fn,st]=await Promise.all(['app','auth','firestore','functions','storage'].map(s=>import(`${V}firebase-${s}.js`)));
  const app=appSDK.initializeApp(config.firebase);
  const db=fs.initializeFirestore(app,{localCache:fs.persistentLocalCache({tabManager:fs.persistentMultipleTabManager()})});
  const auth=authSDK.getAuth(app),functions=fn.getFunctions(app,config.region),storage=st.getStorage(app);
  if(config.appCheckSiteKey){const ac=await import(`${V}firebase-app-check.js`);ac.initializeAppCheck(app,{provider:new ac.ReCaptchaEnterpriseProvider(config.appCheckSiteKey),isTokenAutoRefreshEnabled:true});}
  if(config.useEmulators){authSDK.connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});fs.connectFirestoreEmulator(db,'127.0.0.1',8080);fn.connectFunctionsEmulator(functions,'127.0.0.1',5001);st.connectStorageEmulator(storage,'127.0.0.1',9199);}
  await auth.authStateReady();
  return {app,auth,authSDK,db,fs,functions,fn,storage,st};
})().catch(e=>{init=null;throw e;});}
export async function call(name,data){const {functions,fn}=await firebase();return (await fn.httpsCallable(functions,name,{timeout:120000})(data)).data;}
