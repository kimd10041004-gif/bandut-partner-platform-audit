// Keep image data, remove metadata. Only JPEG and PNG; GIF/SVG are excluded.
export function cleanImage(bytes:Uint8Array):{bytes:Uint8Array;mime:string}{
 if(bytes.length<24||bytes.length>5*1024*1024)throw Error('사진은 5MB 이하의 JPEG·PNG만 가능합니다.');
 if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10){
  const out=[bytes.slice(0,8)];let pos=8,header=false,data=false,end=false;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  while(pos+12<=bytes.length){const length=view.getUint32(pos);if(pos+length+12>bytes.length)throw Error('손상된 PNG입니다.');const type=String.fromCharCode(...bytes.slice(pos+4,pos+8));
   if(!header){if(type!=='IHDR'||length!==13)throw Error('PNG 헤더가 없습니다.');const w=view.getUint32(pos+8),h=view.getUint32(pos+12);if(!w||!h||w*h>20_000_000)throw Error('이미지 크기는 2천만 화소 이하만 가능합니다.');header=true;}
   if(['IHDR','PLTE','tRNS','IDAT','IEND'].includes(type))out.push(bytes.slice(pos,pos+length+12));
   if(type==='IDAT')data=true;pos+=length+12;if(type==='IEND'){end=true;break;}
  }if(!data||!end||pos!==bytes.length)throw Error('손상된 PNG입니다.');return {bytes:join(out),mime:'image/png'};
 }
 if(bytes[0]===255&&bytes[1]===216){const out=[bytes.slice(0,2)];let p=2,dimensions=false;
  while(p+4<bytes.length){if(bytes[p]!==255)throw Error('손상된 JPEG입니다.');const marker=bytes[p+1]??0;if(marker===218){if(!dimensions||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('손상된 JPEG입니다.');out.push(bytes.slice(p));return {bytes:join(out),mime:'image/jpeg'};}const size=(bytes[p+2]??0)*256+(bytes[p+3]??0);if(size<2||p+size+2>bytes.length)throw Error('손상된 JPEG입니다.');if([192,193,194].includes(marker)){const h=(bytes[p+5]??0)*256+(bytes[p+6]??0),w=(bytes[p+7]??0)*256+(bytes[p+8]??0);if(!w||!h||w*h>20_000_000)throw Error('이미지 크기는 2천만 화소 이하만 가능합니다.');dimensions=true;}if(!(marker>=224&&marker<=239)&&marker!==254)out.push(bytes.slice(p,p+size+2));p+=size+2;
  }
 }throw Error('파일 내용을 확인할 수 없습니다. JPEG·PNG 사진을 선택해 주세요.');
}
function join(parts:Uint8Array[]){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}return out;}
