import * as THREE from './vendor/three/three.module.js';
import {wallpaperFor,wallpaperImages} from './wallpaper.js';
import {productImages} from './products.js';
import {CATALOG,wallLength,wallSegments} from './model.js';
import {softBox,surfaceTexture,mapInMeters} from './materials.js';
export function buildModel(p,{cutaway=false}={}){
 const root=new THREE.Group();root.name='Room Studio';root.userData={units:'meters',project:p.name};
 const mats=new Map(),textures=new Map();
 const material=(color,opacity=1,finish='paint')=>{
  const key=[color,opacity,finish].join('/');
  if(!mats.has(key)){
   const settings={paint:[.72,0],wood:[.48,0],fabric:[.95,0],metal:[.28,.6],glass:[.12,.05],screen:[.18,.15]};
   const [roughness,metalness]=settings[finish];
   const m=new THREE.MeshStandardMaterial({color,roughness,metalness,transparent:opacity<1,opacity,depthWrite:opacity===1});
   const image=finish==='wood'?'oak':finish==='fabric'?'linen':null;
   if(image){if(!textures.has(image))textures.set(image,surfaceTexture(image));m.map=textures.get(image);}
   mats.set(key,m);
  }
  return mats.get(key);
 };
 function box(parent,name,w,h,d,x,y,z,color,r=0,opacity=1,finish='paint',rounded=0){
  const geometry=rounded?softBox(w,h,d,rounded):new THREE.BoxGeometry(w,h,d);
  if(finish==='wood'||finish==='fabric')mapInMeters(geometry,finish==='wood'?1.2:.24);
  const m=new THREE.Mesh(geometry,material(color,opacity,finish));m.position.set(x,y,z);m.rotation.y=r;m.name=name;m.castShadow=opacity===1;m.receiveShadow=true;parent.add(m);return m;
 }
 box(root,'Floor',p.width,.12,p.depth,p.width/2,-.06,p.depth/2,p.floor,0,1,'wood');
 // Staggered 20 cm boards give the material a physical scale, in one draw call.
 const seams=[];let row=0;
 for(let x=0;x<p.width;x+=.2,row++){
  if(x>0)seams.push(x,.002,0,x,.002,p.depth);
  for(let z=.4+(row%3)*.4;z<p.depth;z+=1.2)seams.push(x,.002,z,Math.min(x+.2,p.width),.002,z);
 }
 const seamGeometry=new THREE.BufferGeometry();seamGeometry.setAttribute('position',new THREE.Float32BufferAttribute(seams,3));
 const seamLines=new THREE.LineSegments(seamGeometry,new THREE.LineBasicMaterial({color:'#786450',transparent:true,opacity:.22}));seamLines.name='Floor joints';root.add(seamLines);
 for(const w of p.walls){
 const g=new THREE.Group();g.name='Wall_'+w.id;g.userData.itemId=w.id;root.add(g);if(cutaway&&['east','south'].includes(w.id))g.visible=false;
 const len=wallLength(w),a=Math.atan2(w.z2-w.z1,w.x2-w.x1);g.position.set(w.x1,0,w.z1);g.rotation.y=-a;
 const paper=wallpaperFor(p,w);let skin;
 if(paper){
  const image=wallpaperImages.get(paper.image);if(!image)throw Error('벽지 이미지를 아직 읽지 못했어요. 다시 시도해 주세요.');
  const texture=new THREE.Texture(image);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=paper.mode==='tile'?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;texture.needsUpdate=true;
  skin=new THREE.MeshStandardMaterial({map:texture,roughness:.85});
 }
 for(const s of wallSegments(p,w)){
  const solid=box(g,'Wall solid',s.end-s.start,s.top-s.bottom,w.t,(s.start+s.end)/2,(s.top+s.bottom)/2,0,'#eeeae2');
  if(s.bottom===0)box(g,'Skirting',s.end-s.start,.085,w.t+.018,(s.start+s.end)/2,.0425,0,'#f4f1eb');
  if(skin){
   const base=solid.material;solid.material=[base,base,base,base,skin,skin];
   const uv=solid.geometry.attributes.uv,pos=solid.geometry.attributes.position;
   const width=paper.mode==='fit'?len:paper.size,height=paper.mode==='fit'?p.height:paper.size*skin.map.image.height/skin.map.image.width;
   for(const face of solid.geometry.groups.filter(g=>g.materialIndex>=4))for(let j=face.start;j<face.start+face.count;j++){
    const i=solid.geometry.index.getX(j),x=pos.getX(i)+solid.position.x,y=pos.getY(i)+solid.position.y;
    uv.setXY(i,(face.materialIndex===5?len-x:x)/width,y/height);
   }
   uv.needsUpdate=true;
  }
 }
 for(const o of p.openings.filter(o=>o.wallId===w.id)){
 const c=o.at*len,b=o.sill,t=b+o.h,frame='#eeeae3';
 box(g,o.type+' frame left',.045,o.h,w.t+.025,c-o.w/2,b+o.h/2,0,frame);
 box(g,o.type+' frame right',.045,o.h,w.t+.025,c+o.w/2,b+o.h/2,0,frame);
 box(g,o.type+' frame top',o.w,.045,w.t+.025,c,t,0,frame);
 if(o.type==='window'){
 box(g,'Window sill',o.w+.1,.055,w.t+.12,c,b,0,frame);
 box(g,'Window glass',o.w-.05,o.h-.05,.014,c,b+o.h/2,0,'#dae9ec',0,.17,'glass');
 box(g,'Window mullion',.035,o.h,.035,c,b+o.h/2,0,frame);
 }else{
 // The leaf is open 90 degrees, keeping the doorway visibly traversable.
 box(g,'Door leaf',.04,o.h-.04,o.w-.04,c-o.w/2,b+(o.h-.04)/2,o.w/2,'#b99c7c');
 }
 }
 }
 for(const f of p.items){
 const g=new THREE.Group();g.name=f.name;g.userData.itemId=f.id;root.add(g);
 if(f.type==='photo'){
  const image=productImages.get(f.photo.image);if(!image)throw Error('제품 사진을 아직 읽지 못했어요.');
  const texture=new THREE.Texture(image);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
  const skin=new THREE.MeshBasicMaterial({map:texture,alphaTest:.08,side:THREE.DoubleSide,toneMapped:false});
  const flat=f.photo.orientation==='floor';
  const photo=new THREE.Mesh(new THREE.PlaneGeometry(f.w,flat?f.d:f.h),skin);photo.name='Product photo reference';
  photo.position.set(0,flat?f.h:.5*f.h,flat?0:f.d/2+.001);if(flat)photo.rotation.x=-Math.PI/2;g.add(photo);
  if(!flat){
   const geometry=new THREE.BoxGeometry(f.w,f.h,f.d),edges=new THREE.EdgesGeometry(geometry);geometry.dispose();
   const guide=new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color:'#61766b',transparent:true,opacity:.35}));guide.name='Approximate product dimensions';guide.position.y=f.h/2;g.add(guide);
  }
  g.userData.representation='photo-reference-not-reconstructed-3d';g.position.set(f.x,0,f.z);g.rotation.y=-f.r*Math.PI/180;continue;
 }
 const {w,d,h}=CATALOG.find(c=>c.type===f.type);const {color:c,type}=f;
 const finishFor=name=>/Screen/.test(name)?'screen':/Faucet|Sink|Handle/.test(name)||type==='fridge'?'metal':/Leg|Tabletop|Bed base/.test(name)||type==='tv'?'wood':['sofa','armchair','rug','bed'].includes(type)?'fabric':'paint';
 const b=(name,ww,hh,dd,x,y,z,col=c)=>box(g,name,ww,hh,dd,x,y,z,col,0,1,finishFor(name),/cushion|Pillow|Duvet|Mattress|Arm|Back/.test(name)?.055:.012);
 const legs=(top)=>{for(const x of [-1,1])for(const z of [-1,1])b('Leg',.045,top,.045,x*(w/2-.08),top/2,z*(d/2-.08),'#615346');};
 if(type==='rug')b('Rug',w,h,d,0,h/2,0);
 else if(type==='sofa'||type==='armchair'){
 legs(.15);b('Base',w,h*.35,d,0,h*.3,0);b('Back',w,h*.6,d*.16,0,h*.7,-d*.42);for(const x of [-1,1])b('Arm',w*.08,h*.65,d,x*w*.46,h*.48,0);const n=type==='sofa'?3:1;for(let i=0;i<n;i++)b('Seat cushion',w*.82/n-.02,h*.15,d*.72,-w*.41+w*.82*(i+.5)/n,h*.54,d*.06);
 for(let i=0;i<n;i++){const cushion=b('Back cushion',w*.8/n-.025,h*.43,d*.19,-w*.4+w*.8*(i+.5)/n,h*.74,-d*.24);cushion.rotation.x=-.09;}
 const pillow=b('Scatter cushion',w*.22,h*.34,d*.17,-w*.25,h*.72,-d*.03,'#e4d9c8');pillow.rotation.z=.16;
 }else if(type==='bed'){
 b('Bed base',w,h*.38,d,0,h*.22,0,'#ac9579');b('Mattress',w*.98,h*.35,d*.98,0,h*.57,0,'#f4f1ea');b('Duvet',w*.99,h*.1,d*.72,0,h*.79,d*.13);for(const x of [-1,1])b('Pillow',w*.4,h*.18,d*.18,x*w*.24,h*.81,-d*.34,'#f5f2e9');b('Headboard',w,h*1.4,.09,0,h*.7,-d/2,'#c0ad95');
 }else if(['desk','coffee','dining'].includes(type)){
 legs(h-.06);b('Tabletop',w,.06,d,0,h-.03,0);
 b('Table apron',w-.14,.07,d-.14,0,h-.095,0);
 }else if(type==='chair'){
 legs(h*.52);b('Seat',w,.06,d,0,h*.55,0);b('Back',w,h*.45,.06,0,h*.77,-d*.43);
 }else{
 b('Cabinet',w,h,d,0,h/2,0);const count=type==='fridge'?1:Math.max(2,Math.round(w/.6));for(let i=1;i<count;i++)b('Door seam',.01,h*.9,.008,-w/2+w*i/count,h/2,d/2+.004,'#a6a49c');
 if(['wardrobe','kitchen','fridge'].includes(type))for(let i=0;i<count;i++)b('Handle',.018,.18,.028,-w/2+w*(i+.7)/count,h*.58,d/2+.018,'#66645e');
 if(type==='fridge')b('Door seam',w*.95,.008,.009,0,h*.35,d/2+.006,'#737c80');
 if(type==='tv'){b('Screen frame',w*.75,h*1.2,.05,0,h*1.75,0,'#20282a');b('Screen',w*.72,h*1.14,.006,0,h*1.75,.028,'#111a22');b('Screen stand',.3,.04,.2,0,h+.02,0,'#283639');}
 if(type==='kitchen'){b('Countertop',w+.03,.04,d+.02,0,h+.02,0,'#f4f0e8');b('Sink rim',w*.35,.015,d*.65,-w*.2,h+.045,0,'#9ba7a6');b('Sink basin',w*.29,.016,d*.52,-w*.2,h+.05,0,'#637776');b('Faucet',.035,.22,.035,-w*.2,h+.15,-d*.22,'#8b999b');}
 }
 // Inspector dimensions always represent the complete object, including its back or headboard.
 const bounds=new THREE.Box3().setFromObject(g),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 for(const child of g.children){child.position.x-=center.x;child.position.z-=center.z;child.position.y-=bounds.min.y;}
 g.scale.set(f.w/size.x,f.h/size.y,f.d/size.z);
 g.position.set(f.x,0,f.z);g.rotation.y=-f.r*Math.PI/180;
 }
 root.updateMatrixWorld(true);return root;
}
export function disposeModel(root){const mats=new Set(),textures=new Set();root.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);});mats.forEach(m=>{if(m.map)textures.add(m.map);m.dispose();});textures.forEach(t=>t.dispose());}
