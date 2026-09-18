// Photo references preserve visible pixels; they do not reconstruct hidden geometry.
export const productImages=new Map();
export function validateProducts(p){
 let total=0;
 for(const f of p.items){
  if(f.type!=='photo')continue;
  if(!f.photo||typeof f.photo.image!=='string'||f.photo.image.length>1_400_000||!/^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(f.photo.image)||!['upright','floor'].includes(f.photo.orientation))throw Error('제품 사진의 형식을 확인해 주세요.');
  total+=f.photo.image.length;
 }
 if(total>8_000_000)throw Error('제품 사진의 합계가 8MB를 넘었어요. 사진 가구를 줄인 후 다시 시도하세요.');
 if(JSON.stringify(p).length>14_000_000)throw Error('설계 용량이 커졌어요. 사진이나 벽지를 줄여 주세요.');
}
export async function decodeProduct(source){
 const image=new Image();image.src=source;
 try{await image.decode();}catch{throw Error('사진을 읽지 못했어요. JPG, PNG, WebP 파일을 선택해 주세요.');}
 return image;
}
export async function prepareProducts(p){
 validateProducts(p);
 const sources=[...new Set(p.items.filter(f=>f.type==='photo').map(f=>f.photo.image))];
 for(const source of sources)if(!productImages.has(source)){
  const image=await decodeProduct(source);
  if(!image.width||!image.height||image.width>768||image.height>768)throw Error('제품 사진은 가로·세로 768px 이하여야 합니다.');
  productImages.set(source,image);
 }
 for(const source of productImages.keys())if(productImages.size>20&&!sources.includes(source))productImages.delete(source);
}
// Edge-connected, nearly uniform background only. No semantic object recognition.
export function trimProductPixels(data,width,height,removeBackground=true){
 const out=new Uint8ClampedArray(data),seen=new Uint8Array(width*height),queue=new Int32Array(width*height);let head=0,tail=0;
 const corners=[0,width-1,(height-1)*width,width*height-1];
 const bg=[0,1,2].map(c=>corners.reduce((s,i)=>s+data[i*4+c],0)/4);
 const uniform=corners.every(i=>data[i*4+3]>240&&bg.every((v,c)=>Math.abs(v-data[i*4+c])<22));
 const matches=i=>data[i*4+3]<16||(uniform&&bg.every((v,c)=>Math.abs(v-data[i*4+c])<32));
 const add=i=>{if(!seen[i]){seen[i]=1;if(matches(i))queue[tail++]=i;}};
 if(removeBackground){
  for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}for(let y=0;y<height;y++){add(y*width);add(y*width+width-1);}
  while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);out[i*4+3]=0;if(x)add(i-1);if(x<width-1)add(i+1);if(y)add(i-width);if(y<height-1)add(i+width);}
 }
 let left=width,top=height,right=-1,bottom=-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(out[(y*width+x)*4+3]>24){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 // Keep the source when automatic removal would erase almost everything.
 const kept=out.reduce((n,v,i)=>n+(i%4===3&&v>24?1:0),0);
 if(right<left||kept<width*height*.01)return {data:new Uint8ClampedArray(data),x:0,y:0,width,height,removed:false};
 return {data:out,x:left,y:top,width:right-left+1,height:bottom-top+1,removed:removeBackground&&tail>0};
}
export async function readProductFile(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10_000_000)throw Error('10MB 이하의 JPG, PNG, WebP 사진을 선택해 주세요.');
 const url=URL.createObjectURL(file);
 try{
  const image=await decodeProduct(url);
  if(image.width*image.height>40_000_000)throw Error('사진 해상도가 너무 커요. 4천만 화소 이하로 줄여 주세요.');
  const scale=Math.min(1,768/Math.max(image.width,image.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('이 기기에서 사진을 처리할 수 없어요.');
  ctx.drawImage(image,0,0,canvas.width,canvas.height);return canvas;
 }finally{URL.revokeObjectURL(url);}
}
export function processProduct(canvas,remove){
 const ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height),result=trimProductPixels(pixels.data,canvas.width,canvas.height,remove);
 const work=document.createElement('canvas');work.width=canvas.width;work.height=canvas.height;
 pixels.data.set(result.data);work.getContext('2d').putImageData(pixels,0,0);
 const cropped=document.createElement('canvas');cropped.width=result.width;cropped.height=result.height;
 cropped.getContext('2d').drawImage(work,result.x,result.y,result.width,result.height,0,0,result.width,result.height);
 let image=cropped.toDataURL('image/png');
 if(image.length>1_400_000){const small=document.createElement('canvas');small.width=Math.max(1,Math.round(result.width*.65));small.height=Math.max(1,Math.round(result.height*.65));small.getContext('2d').drawImage(cropped,0,0,small.width,small.height);image=small.toDataURL('image/png');}
 if(image.length>1_400_000)throw Error('사진 용량을 줄이지 못했어요. 더 작은 사진을 선택해 주세요.');
 return {image,ratio:result.width/result.height,removed:result.removed};
}
