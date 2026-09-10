import { firebase } from '../firebase/firebase.js';
import { config } from '../config/config.js';
export async function login(){
  if(config.demo)throw Error('La demostración no publica anuncios. Desactiva demo para conectar Firebase.');
  const {auth,authSDK}=await firebase();if(auth.currentUser)return auth.currentUser;
  return (await authSDK.signInWithPopup(auth,new authSDK.GoogleAuthProvider())).user;
}
export async function logout(){const {auth,authSDK}=await firebase();await authSDK.signOut(auth);}
export async function watchAuth(callback){const {auth,authSDK}=await firebase();return authSDK.onAuthStateChanged(auth,callback);}
