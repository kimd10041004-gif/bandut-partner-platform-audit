import * as THREE from './vendor/three/three.module.js';

export const materialImages=new Map();
export async function prepareMaterials(){
 await Promise.all(['oak','linen'].map(async name=>{
  if(materialImages.has(name))return;
  const image=new Image();image.src=new URL(`./assets/${name}.png`,import.meta.url).href;
  await image.decode();materialImages.set(name,image);
 }));
}

// A beveled box keeps the same bounding dimensions as the inspector.
export function softBox(w,h,d,radius=.025){
 const radiusSafe=Math.min(radius,w/3,h/3,d/3);
 const geometry=new THREE.BoxGeometry(w,h,d,4,4,4);
 const pos=geometry.attributes.position,normal=geometry.attributes.normal;
 const half=new THREE.Vector3(w/2,h/2,d/2),inner=half.clone().addScalar(-radiusSafe);
 const point=new THREE.Vector3(),nearest=new THREE.Vector3(),direction=new THREE.Vector3();
 for(let i=0;i<pos.count;i++){
  point.fromBufferAttribute(pos,i);nearest.copy(point).clamp(inner.clone().negate(),inner);
  direction.subVectors(point,nearest).normalize();point.copy(nearest).addScaledVector(direction,radiusSafe);
  pos.setXYZ(i,point.x,point.y,point.z);normal.setXYZ(i,direction.x,direction.y,direction.z);
 }
 return geometry;
}

export function surfaceTexture(name){
 const image=materialImages.get(name);if(!image)return null;
 const texture=new THREE.Texture(image);texture.colorSpace=THREE.SRGBColorSpace;
 texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;texture.needsUpdate=true;
 return texture;
}

export function mapInMeters(geometry,scale=1){
 const pos=geometry.attributes.position,normal=geometry.attributes.normal,uv=geometry.attributes.uv;
 for(let i=0;i<pos.count;i++){
  const nx=Math.abs(normal.getX(i)),ny=Math.abs(normal.getY(i)),nz=Math.abs(normal.getZ(i));
  const u=nx>ny&&nx>nz?pos.getZ(i):pos.getX(i);
  const v=ny>nx&&ny>nz?pos.getZ(i):pos.getY(i);
  uv.setXY(i,u/scale,v/scale);
 }
}
