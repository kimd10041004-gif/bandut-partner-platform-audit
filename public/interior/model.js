import {validateProducts} from './products.js';
import {validateWallpapers} from './wallpaper.js';
export const CATALOG = [
 {type:'sofa',name:'3인 소파',category:'거실',w:2.2,d:.9,h:.82,color:'#79918b'},
 {type:'armchair',name:'라운지 체어',category:'거실',w:.8,d:.8,h:.8,color:'#bd815c'},
 {type:'coffee',name:'낮은 테이블',category:'거실',w:1.1,d:.6,h:.38,color:'#b38b64'},
 {type:'rug',name:'러그',category:'거실',w:2.6,d:1.8,h:.02,color:'#dad5c9'},
 {type:'tv',name:'TV 수납장',category:'거실',w:1.8,d:.4,h:.55,color:'#b38b64'},
 {type:'bed',name:'퀸 침대',category:'침실',w:1.6,d:2.1,h:.65,color:'#829ba6'},
 {type:'wardrobe',name:'옷장',category:'침실',w:1.6,d:.6,h:2.1,color:'#e1d9cc'},
 {type:'desk',name:'책상',category:'침실',w:1.2,d:.6,h:.74,color:'#b38b64'},
 {type:'dining',name:'식탁',category:'주방',w:1.4,d:.8,h:.75,color:'#b38b64'},
 {type:'chair',name:'식탁 의자',category:'주방',w:.45,d:.48,h:.8,color:'#80938b'},
 {type:'kitchen',name:'싱크대',category:'주방',w:1.8,d:.6,h:.9,color:'#d3d6ce'},
 {type:'fridge',name:'냉장고',category:'주방',w:.8,d:.7,h:1.8,color:'#afb7b9'},
];
export function uid(){
 const crypto=globalThis.crypto;
 if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
 // getRandomValues also works when a local HTTP preview lacks randomUUID.
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function initialProject(){
 const p={version:1,name:'나의 첫 번째 공간',width:8,depth:6,height:2.5,floor:'#d1b38f',walls:[],openings:[],items:[]};
 syncBoundary(p);
 p.walls.push({id:'partition',x1:4.8,z1:0,x2:4.8,z2:6,t:.12});
 p.openings=[{id:'door1',wallId:'partition',type:'door',at:.7,w:.9,h:2.1,sill:0},{id:'window1',wallId:'north',type:'window',at:.3,w:2.1,h:1.2,sill:.9},{id:'window2',wallId:'north',type:'window',at:.8,w:1.5,h:1.2,sill:.9},{id:'entry',wallId:'south',type:'door',at:.2,w:.9,h:2.1,sill:0}];
 const put=(type,x,z,r=0)=>p.items.push({...CATALOG.find(c=>c.type===type),id:uid(),x,z,r});
 put('rug',2.5,2.4); put('sofa',2.5,1.25); put('coffee',2.5,2.5); put('tv',2.5,3.6); put('armchair',.9,2.8,90); put('kitchen',1.4,5.55); put('dining',3.5,4.7); put('chair',3.5,5.35); put('chair',3.5,4.05,180); put('bed',6.6,1.6); put('wardrobe',7.5,4.7,90); put('desk',5.6,5.55);
 return p;
}
export function syncBoundary(p){
 const specs=[['north',0,0,p.width,0],['east',p.width,0,p.width,p.depth],['south',0,p.depth,p.width,p.depth],['west',0,0,0,p.depth]];
 for(const [id,x1,z1,x2,z2] of specs){const w=p.walls.find(w=>w.id===id); const values={id,x1,z1,x2,z2,t:w?.t??.16,boundary:true}; if(w)Object.assign(w,values);else p.walls.push(values);}
}
export const wallLength=w=>Math.hypot(w.x2-w.x1,w.z2-w.z1);
export function projectOnWall(w,x,z){const dx=w.x2-w.x1,dz=w.z2-w.z1;const at=Math.max(0,Math.min(1,((x-w.x1)*dx+(z-w.z1)*dz)/(dx*dx+dz*dz)));return {at,x:w.x1+dx*at,z:w.z1+dz*at,distance:Math.hypot(x-w.x1-dx*at,z-w.z1-dz*at)};}
export function openingFits(p,o){const w=p.walls.find(w=>w.id===o.wallId);if(!w)return false;const len=wallLength(w),start=o.at*len-o.w/2,end=start+o.w;return start>=.05&&end<=len-.05&&o.sill+o.h<=p.height&&p.openings.filter(x=>x.wallId===o.wallId&&x.id!==o.id).every(x=>Math.abs(x.at*len-o.at*len)>=(x.w+o.w)/2+.05);}
// Wall solids are split around openings, so both render and export contain real gaps.
export function wallSegments(p,w){
 const len=wallLength(w),openings=p.openings.filter(o=>o.wallId===w.id).sort((a,b)=>a.at-b.at);const seg=[];let cursor=0;
 const add=(start,end,bottom,top)=>{if(end-start>1e-5&&top-bottom>1e-5)seg.push({start,end,bottom,top});};
 for(const o of openings){const a=o.at*len-o.w/2,b=a+o.w;add(cursor,a,0,p.height);add(a,b,0,o.sill);add(a,b,o.sill+o.h,p.height);cursor=b;}
 add(cursor,len,0,p.height);return seg;
}
export function validateProject(p){
 const fail=()=>{throw Error('프로젝트의 형식이나 치수를 확인해 주세요.');};
 const num=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
 const str=(v,max=80)=>typeof v==='string'&&v.length>0&&v.length<=max;
 const col=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
 if(!p||p.version!==1||!str(p.name)||!num(p.width,2,30)||!num(p.depth,2,30)||!num(p.height,2,5)||!col(p.floor)||!Array.isArray(p.walls)||p.walls.length>100||!Array.isArray(p.items)||p.items.length>200||!Array.isArray(p.openings)||p.openings.length>100)fail();
 validateWallpapers(p);validateProducts(p);
 const ids=new Set();const id=v=>{if(!str(v)||ids.has(v))fail();ids.add(v);};
 for(const w of p.walls){id(w.id);if(![w.x1,w.x2].every(v=>num(v,0,p.width))||![w.z1,w.z2].every(v=>num(v,0,p.depth))||!num(w.t,.05,.5)||wallLength(w)<.2)fail();}
 const expected={north:[0,0,p.width,0],east:[p.width,0,p.width,p.depth],south:[0,p.depth,p.width,p.depth],west:[0,0,0,p.depth]};
 for(const [key,coords] of Object.entries(expected)){const w=p.walls.find(x=>x.id===key);if(!w||!w.boundary||[w.x1,w.z1,w.x2,w.z2].some((v,i)=>v!==coords[i]))fail();}
 for(const w of p.walls)if(w.boundary&&!expected[w.id])fail();
 for(const o of p.openings){id(o.id);if(!['door','window'].includes(o.type)||!num(o.at,0,1)||!num(o.w,.3,5)||!num(o.h,.3,4)||!num(o.sill,0,3)||(o.type==='door'&&o.sill!==0)||!openingFits(p,o))fail();}
 for(const f of p.items){id(f.id);if(!(f.type==='photo'||CATALOG.some(c=>c.type===f.type))||!str(f.name)||!col(f.color)||![f.w,f.d].every(v=>num(v,.1,10))||!num(f.h,.01,4)||!num(f.x,0,p.width)||!num(f.z,0,p.depth)||!num(f.r,0,359.99))fail();}
 return p;
}
export function furnitureOutside(p,f){const r=f.r*Math.PI/180,ex=(Math.abs(Math.cos(r))*f.w+Math.abs(Math.sin(r))*f.d)/2,ez=(Math.abs(Math.sin(r))*f.w+Math.abs(Math.cos(r))*f.d)/2;return f.x-ex<0||f.x+ex>p.width||f.z-ez<0||f.z+ez>p.depth;}

export function emptyRoom(width=4,depth=3){
 const p={version:1,name:'나의 첫 번째 공간',width,depth,height:2.5,floor:'#d1b38f',walls:[],openings:[],items:[]};
 syncBoundary(p);return validateProject(p);
}
export function centeredFurniture(p,type){
 const entry=CATALOG.find(f=>f.type===type);
 if(!entry)throw Error('가구를 다시 선택해 주세요.');
 if(p.items.length>=200)throw Error('가구는 최대 200개까지 놓을 수 있어요.');
 const f={...entry,id:uid(),x:p.width/2,z:p.depth/2,r:0};
 if(furnitureOutside(p,f))f.r=90;
 if(furnitureOutside(p,f))throw Error('이 가구가 방보다 커요. 방 크기를 늘리거나 더 작은 가구를 골라주세요.');
 return f;
}
