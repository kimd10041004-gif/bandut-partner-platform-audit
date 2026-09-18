export const wallpaperFor=(p,w)=>w.wallpaper===undefined?p.wallpaper:w.wallpaper;
export const wallpaperImages=new Map();
export function validateWallpapers(p){
 const assets=new Set();let total=0;
 for(const paper of [p.wallpaper,...p.walls.map(w=>w.wallpaper)]){
  if(paper==null)continue;
  if(typeof paper!=='object'||typeof paper.name!=='string'||!paper.name.length||paper.name.length>120||!['fit','tile'].includes(paper.mode)||!Number.isFinite(paper.size)||paper.size<.1||paper.size>5||typeof paper.image!=='string'||paper.image.length>1_400_000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(paper.image))throw Error('벽지 이미지와 무늬 크기를 확인해 주세요.');
  assets.add(paper.image);total+=paper.image.length;
 }
 if(assets.size>8||total>12_000_000)throw Error('벽지 이미지는 최대 8종, 저장 용량 합계 12MB까지 사용할 수 있어요.');
}
export async function decodeWallpaper(source){
 const image=new Image();image.src=source;
 try{await image.decode();}catch{throw Error('이미지를 읽을 수 없어요. JPG, PNG, WebP 파일을 선택해 주세요.');}
 return image;
}
export async function prepareWallpapers(p){
 validateWallpapers(p);
 const sources=[...new Set([p.wallpaper,...p.walls.map(w=>w.wallpaper)].filter(Boolean).map(w=>w.image))];
 for(const source of sources){
  if(!wallpaperImages.has(source)){
   const image=await decodeWallpaper(source);
   if(image.width>1024||image.height>1024||!image.width||!image.height)throw Error('프로젝트의 벽지 이미지는 가로·세로 1,024px 이하여야 합니다.');
   wallpaperImages.set(source,image);
  }
 }
 for(const source of wallpaperImages.keys())if(wallpaperImages.size>16&&!sources.includes(source))wallpaperImages.delete(source);
}
export async function imageToWallpaper(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10_000_000)throw Error('10MB 이하의 JPG, PNG, WebP 이미지를 선택해 주세요.');
 const url=URL.createObjectURL(file);
 try{
  const image=await decodeWallpaper(url),scale=Math.min(1,1024/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('이미지를 처리할 수 없어요. 다시 시도해 주세요.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  return {name:(file.name||'내 벽지').slice(0,120),image:canvas.toDataURL('image/jpeg',.85),mode:'fit',size:1};
 }finally{URL.revokeObjectURL(url);}
}
