import * as THREE from './vendor/three/three.module.js';

export const lightingPresets={
 daylight:{sky:'#eff4fa',ground:'#b3a998',ambient:1.3,key:'#fff4e2',intensity:3.2,fill:'#dceaff',fillIntensity:.65,exposure:1.05},
 neutral:{sky:'#ffffff',ground:'#b6b2aa',ambient:1.65,key:'#ffffff',intensity:2,fill:'#ffffff',fillIntensity:.8,exposure:1},
 warm:{sky:'#ffe8cc',ground:'#8c7969',ambient:1.1,key:'#ffd4a0',intensity:2.4,fill:'#ffe8d1',fillIntensity:.5,exposure:1.05},
};

export function placeCamera(camera,target,p,mode){
 camera.fov=mode==='eye'?55:42;camera.zoom=1;
 if(mode==='eye'){
  // A repeatable starting viewpoint; this is not a collision-aware walk mode.
  const x=p.width*.28,z=Math.max(.4,p.depth-.45);
  camera.position.set(x,1.5,z);target.set(x,1.5,Math.max(.1,z-Math.min(p.depth*.65,3)));
 }else{
  target.set(p.width/2,p.height*.32,p.depth/2);
  const vertical=THREE.MathUtils.degToRad(camera.fov),horizontal=2*Math.atan(Math.tan(vertical/2)*camera.aspect);
  const radius=Math.hypot(p.width,p.height,p.depth)/2;
  const distance=radius/Math.sin(Math.min(vertical,horizontal)/2)*1.05;
  camera.position.copy(target).addScaledVector(new THREE.Vector3(.85,.8,1).normalize(),distance);
 }
 camera.lookAt(target);camera.updateProjectionMatrix();
}

export function positionLights(key,fill,p){
 key.position.set(p.width*.18,p.height+5,-p.depth*.3);
 key.target.position.set(p.width*.5,0,p.depth*.6);key.target.updateMatrixWorld();
 const extent=Math.hypot(p.width,p.depth)/2+2;
 Object.assign(key.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:.1,far:Math.max(40,extent*4)});
 key.shadow.camera.updateProjectionMatrix();
 fill.position.set(p.width,p.height+2,p.depth);fill.target.position.set(p.width/2,0,p.depth/2);fill.target.updateMatrixWorld();
}
