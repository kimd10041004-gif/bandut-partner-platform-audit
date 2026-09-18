import * as THREE from './vendor/three/three.module.js';
import {OrbitControls} from './vendor/three/OrbitControls.js';
import {GLTFExporter} from './vendor/three/GLTFExporter.js';
import {OBJExporter} from './vendor/three/OBJExporter.js';
import {CATALOG,initialProject,emptyRoom,centeredFurniture,uid,syncBoundary,wallLength,projectOnWall,openingFits,validateProject,furnitureOutside} from './model.js';
import {buildModel,disposeModel} from './scene.js';
import {prepareMaterials} from './materials.js';
import {lightingPresets,placeCamera,positionLights} from './consultation.js';
import {wallpaperFor,prepareWallpapers,imageToWallpaper} from './wallpaper.js';
import {prepareProducts,readProductFile,processProduct} from './products.js';
const prepareAssets=async p=>{await prepareWallpapers(p);await prepareProducts(p);};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons=()=>window.lucide?.createIcons();
const icon=n=>`<i data-lucide="${n}"></i>`;
const furnitureIcons={sofa:'sofa',armchair:'armchair',coffee:'rectangle-horizontal',rug:'scan',tv:'tv',bed:'bed-double',wardrobe:'archive',desk:'table-2',dining:'table',chair:'armchair',kitchen:'cooking-pot',fridge:'refrigerator'};
let project=emptyRoom(),selected=null,tool='select',placing=null,wallStart=null,drag=null,category='전체',history=[],future=[],dirty=false,cutaway=true,view='2d',step=1;
let renderer,scene,camera,controls,model,selectionBox,ambientLight,keyLight,fillLight,renderQueued=false,cameraMode='overview';
const materialsReady=prepareMaterials();materialsReady.then(()=>{rebuildThree();}).catch(()=>toast('기본 재질을 읽지 못했어요. 새로고침 후 다시 확인해 주세요.'));
const serialize=()=>JSON.stringify(project);
const snap=v=>Math.round(v*20)/20;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const selectedObject=()=>project.items.find(f=>f.id===selected)||project.walls.find(w=>w.id===selected)||project.openings.find(o=>o.id===selected);
const typeOf=id=>project.items.some(f=>f.id===id)?'item':project.walls.some(w=>w.id===id)?'wall':project.openings.some(o=>o.id===id)?'opening':null;
let toastTimer;function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4200);}
function trimHistory(stack){while(stack.length>1&&(stack.length>50||stack.reduce((n,s)=>n+s.length,0)>24_000_000))stack.shift();}
function record(before){if(before===serialize())return;history.push(before);trimHistory(history);future=[];dirty=true;updateStatus();}
function mutate(fn){const before=serialize();try{fn();validateProject(project);record(before);render();return true;}catch(error){project=JSON.parse(before);toast(error.message);render();return false;}}
function updateStatus(){
 $('#undoBtn').disabled=!history.length;$('#redoBtn').disabled=!future.length;
 $('#saveStatus').textContent=dirty?'변경됨 · 파일로 저장해 주세요':'자동 저장 안 됨 · 저장 버튼으로 보관';
 $('#areaStatus').textContent=`${(project.width*project.depth).toFixed(1)}m²`;
 $('#objectStatus').textContent=`가구 ${project.items.length}개 · 벽 ${project.walls.length}개`;
 const outside=project.items.filter(f=>furnitureOutside(project,f));
 $('#designNote').textContent=outside.length?`가구 ${outside.length}개가 외곽 밖으로 나가 있습니다. 위치와 크기를 확인하세요.`:'가구끼리 겹치는지는 직접 확인해 주세요. 치수와 색상은 가구를 누르면 바꿀 수 있어요.';
 $('#designNote').classList.toggle('warning',!!outside.length);
}
function setTool(next,type=null){tool=next;placing=type;wallStart=null;$$('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));$$('.catalog-card').forEach(b=>b.classList.toggle('active',b.dataset.type===placing));$('#planHint').textContent=tool==='wall'?'벽의 시작점을 눌러주세요':tool==='door'?'문을 만들 벽을 눌러주세요':tool==='window'?'창문을 만들 벽을 눌러주세요':tool==='place'?'평면도에서 놓을 위치를 눌러주세요':step===1?'위에서 내려다본 모습이에요':'가구를 누르고 끌어서 옮겨보세요';$('#toolNotice').hidden=tool==='select';$('#toolMessage').textContent=$('#planHint').textContent;if(tool!=='select'&&view==='3d')setView('2d');$('#plan').style.cursor=tool==='select'?'default':'crosshair';drawPlan();}
function setView(value){view=value;$('#surfaces').dataset.mode=value;$$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===value);b.setAttribute('aria-pressed',b.dataset.view===value);});requestAnimationFrame(resizeThree);}
function drawCatalog(){
 const search=$('#catalogSearch').value.trim();
 const entries=CATALOG.filter(c=>(category==='전체'||c.category===category)&&c.name.includes(search));
 $('#catalog').innerHTML=entries.map(c=>`<button class="catalog-card${placing===c.type?' active':''}" data-type="${c.type}" aria-label="${c.name} 배치"><span class="catalog-thumb">${icon(furnitureIcons[c.type])}<span class="plus">+</span></span><b>${c.name}</b><small>${Math.round(c.w*100)} × ${Math.round(c.d*100)} cm</small></button>`).join('')||'<p class="prop-hint">일치하는 가구가 없어요.</p>';
 icons();
}
function furnitureShape(f){if(f.type==='photo')return `<rect x="${-f.w/2}" y="${-f.d/2}" width="${f.w}" height="${f.d}" rx=".025" fill="#e3ece5" fill-opacity=".7" stroke="#557862" stroke-width=".018" stroke-dasharray=".05 .03"/><image href="${esc(f.photo.image)}" x="${-f.w/2}" y="${-f.d/2}" width="${f.w}" height="${f.d}" preserveAspectRatio="xMidYMid meet"/><path d="M ${-f.w/2} ${f.d/2} H ${f.w/2}" stroke="#2b6545" stroke-width=".045"/>`;const entry=CATALOG.find(c=>c.type===f.type),w=entry.w,d=entry.d,t=f.type,c=esc(f.color),stroke='#758176';let shape=`<rect x="${-w/2}" y="${-d/2}" width="${w}" height="${d}" rx=".035" fill="${c}" stroke="${stroke}" stroke-width=".018"/>`;
 if(t==='sofa'||t==='armchair'){
 shape+=`<rect x="${-w/2+.07}" y="${-d/2+.04}" width="${w-.14}" height="${d*.17}" rx=".04" fill="${c}" stroke="${stroke}" stroke-width=".02"/>`;
 const n=t==='sofa'?3:1;for(let i=0;i<n;i++)shape+=`<rect x="${-w*.41+w*.82*i/n}" y="${-d*.25}" width="${w*.82/n-.018}" height="${d*.65}" rx=".045" fill="#ffffff" fill-opacity=".14" stroke="${stroke}" stroke-width=".014"/>`;
 }else if(t==='bed'){
 shape+=`<rect x="${-w/2+.025}" y="${-d/2+.035}" width="${w-.05}" height="${d*.26}" fill="#f6f5f0"/><path d="M ${-w/2} ${-d*.21} H ${w/2}" stroke="${stroke}" stroke-width=".025"/>`;
 for(const x of [-1,1])shape+=`<rect x="${x*w*.24-w*.19}" y="${-d*.45}" width="${w*.38}" height="${d*.16}" rx=".045" fill="#fff" stroke="#cccfc5" stroke-width=".018"/>`;
 }else if(t==='rug')shape=`<rect x="${-w/2}" y="${-d/2}" width="${w}" height="${d}" rx=".04" fill="${c}" stroke="#b3b5a9" stroke-width=".025" stroke-dasharray=".025 .04"/><rect x="${-w/2+.09}" y="${-d/2+.09}" width="${Math.max(.01,w-.18)}" height="${Math.max(.01,d-.18)}" fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width=".02"/>`;
 else if(t==='kitchen')shape+=`<rect x="${-w*.38}" y="${-d*.31}" width="${w*.34}" height="${d*.62}" rx=".045" fill="#9eafad" stroke="#798d87" stroke-width=".025"/><circle cx="${w*.25}" cy="0" r="${d*.15}" fill="none" stroke="#8e9a8c" stroke-width=".025"/>`;
 else if(t==='tv')shape+=`<rect x="${-w*.38}" y="-.035" width="${w*.76}" height=".07" fill="#3a4b46"/>`;
 else if(t==='wardrobe')shape+=`<path d="M 0 ${-d/2} V ${d/2}" stroke="#969e90" stroke-width=".025"/>`;
 return `<g transform="scale(${f.w/w} ${f.d/d})">${shape}</g>`;
}
function drawPlan(){
 const p=project,svg=$('#plan'),pad=1.15;svg.setAttribute('viewBox',`${-pad} ${-.9} ${p.width+pad*2} ${p.depth+1.8}`);
 let out=`<defs><pattern id="grid" width=".5" height=".5" patternUnits="userSpaceOnUse"><path d="M .5 0 H 0 V .5" fill="none" stroke="#c9d1c5" stroke-width=".008"/></pattern><pattern id="smallGrid" width=".1" height=".1" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r=".006" fill="#d2d9ce"/></pattern></defs><rect x="-1.5" y="-1" width="${p.width+3}" height="${p.depth+2}" fill="url(#smallGrid)"/><rect width="${p.width}" height="${p.depth}" fill="#f0eee4"/><rect width="${p.width}" height="${p.depth}" fill="url(#grid)"/>`;
 // Furniture footprints are real scale plan symbols; rugs render below other objects.
 const sorted=[...p.items].sort((a,b)=>(a.type==='rug'?-1:0)-(b.type==='rug'?-1:0));
 for(const f of sorted){out+=`<g data-id="${esc(f.id)}" transform="translate(${f.x} ${f.z}) rotate(${f.r})" style="cursor:move"><title>${esc(f.name)} · ${Math.round(f.w*100)} × ${Math.round(f.d*100)} cm</title>${furnitureShape(f)}`;
 if(selected===f.id)out+=`<rect x="${-f.w/2-.06}" y="${-f.d/2-.06}" width="${f.w+.12}" height="${f.d+.12}" fill="none" stroke="#35755b" stroke-width=".025" stroke-dasharray=".08 .04"/>`;
 out+='</g>';}
 for(const w of p.walls){out+=`<g data-id="${esc(w.id)}" style="cursor:pointer"><line x1="${w.x1}" y1="${w.z1}" x2="${w.x2}" y2="${w.z2}" stroke="transparent" stroke-width=".28"/><line x1="${w.x1}" y1="${w.z1}" x2="${w.x2}" y2="${w.z2}" stroke="${selected===w.id?'#397a5b':'#667365'}" stroke-width="${w.t}" stroke-linecap="square"/></g>`;}
 for(const o of p.openings){const w=p.walls.find(w=>w.id===o.wallId),a=Math.atan2(w.z2-w.z1,w.x2-w.x1)*180/Math.PI,x=w.x1+(w.x2-w.x1)*o.at,z=w.z1+(w.z2-w.z1)*o.at,color=o.id===selected?'#1e7c5d':'#9b9077';out+=`<g data-id="${esc(o.id)}" transform="translate(${x} ${z}) rotate(${a})" style="cursor:move"><rect x="${-o.w/2}" y="${-w.t/2-.02}" width="${o.w}" height="${w.t+.04}" fill="#f7f8f4"/><rect x="${-o.w/2}" y="-.15" width="${o.w}" height=".3" fill="transparent"/>`;
 if(o.type==='door')out+=`<path d="M ${-o.w/2} 0 V ${o.w} M ${-o.w/2} ${o.w} A ${o.w} ${o.w} 0 0 0 ${o.w/2} 0" fill="none" stroke="${color}" stroke-width=".022"/>`;
 else out+=`<rect x="${-o.w/2}" y="${-w.t/2}" width="${o.w}" height="${w.t}" fill="#daeaeb" stroke="${color}" stroke-width=".018"/><path d="M ${-o.w/2} 0 H ${o.w/2}" stroke="${color}" stroke-width=".025"/>`;
 if(o.id===selected)out+=`<circle r=".075" fill="#35755b"/>`;out+='</g>';}
 const chosen=p.walls.find(w=>w.id===selected);if(chosen&&!chosen.boundary)for(const [which,x,z] of [['start',chosen.x1,chosen.z1],['end',chosen.x2,chosen.z2]])out+=`<circle data-id="${esc(chosen.id)}" data-handle="${which}" cx="${x}" cy="${z}" r=".11" fill="#fff" stroke="#35755b" stroke-width=".035" style="cursor:crosshair"/>`;
 const dimStyle='fill="none" stroke="#94a38f" stroke-width=".014"';out+=`<path d="M 0 -.22 V -.55 M ${p.width} -.22 V -.55 M 0 -.43 H ${p.width}" ${dimStyle}/><rect x="${p.width/2-.55}" y="-.58" width="1.1" height=".26" fill="#f7f8f4"/><text x="${p.width/2}" y="-.38" text-anchor="middle" font-size=".2" fill="#6c8165" font-family="sans-serif">${Math.round(p.width*100)} cm</text><path d="M ${p.width+.23} 0 H ${p.width+.55} M ${p.width+.23} ${p.depth} H ${p.width+.55} M ${p.width+.43} 0 V ${p.depth}" ${dimStyle}/><text x="${p.width+.64}" y="${p.depth/2}" text-anchor="middle" font-size=".2" fill="#6c8165" transform="rotate(90 ${p.width+.64} ${p.depth/2})" font-family="sans-serif">${Math.round(p.depth*100)} cm</text>`;
 if(wallStart)out+=`<circle cx="${wallStart.x}" cy="${wallStart.z}" r=".09" fill="#2a7954"/>`;
 svg.innerHTML=out;
}
function numberField(label,key,value,min,max,{unit='cm',full=false,step=1}={}){return `<label class="${full?'full':''}">${label}<span class="number-wrap"><input data-prop="${key}" aria-label="${label}" type="number" inputmode="decimal" step="${step}" min="${min}" max="${max}" value="${Number(value.toFixed(2))}"><span>${unit}</span></span></label>`;}
const swatches=['#d1b38f','#b78d61','#e1d8c9','#9b948a','#79918b','#829ba6','#bd815c','#eae8de'];
function colorControls(color,key){return `<div class="surface-swatches">${swatches.map(c=>`<button class="swatch ${c===color?'active':''}" data-color="${c}" data-key="${key}" style="background:${c}" aria-label="색상 ${c}" aria-pressed="${c===color}"></button>`).join('')}</div><label class="material-label">직접 선택<input type="color" value="${esc(color)}" data-prop="${key}" aria-label="직접 색상 선택"></label>`;}
function sizeControl(label,key,value,min,max){return `<div class="size-control">${numberField(label,key,value,min,max)}<input type="range" data-size="${key}" aria-label="${label} 슬라이더" min="${min}" max="${max}" step="1" value="${Math.round(value)}"></div>`;}
function wallpaperControls(w=null){
 const paper=w?wallpaperFor(project,w):project.wallpaper;
 return `<section class="prop-section wallpaper-section"><h3>${w?'이 벽의 벽지':'전체 벽지'}</h3><p class="prop-hint">${w?'선택한 벽의 양면에 적용해요.':'새 이미지를 올리면 개별 벽지를 포함해 모든 벽에 적용해요. 벽 하나만 바꾸려면 평면도에서 그 벽을 누르세요.'}</p>${paper?`<img class="wallpaper-preview" src="${esc(paper.image)}" alt="적용 중인 벽지"><p class="wallpaper-name">${esc(paper.name)}</p>`:''}<label class="wallpaper-upload">${icon('image-plus')} ${paper?'이미지 바꾸기':'내 이미지 올리기'}<input type="file" data-wallpaper-file accept="image/jpeg,image/png,image/webp"></label><p class="prop-hint">JPG · PNG · WebP, 최대 10MB<br>긴 변 1,024px로 줄여 저장해요.</p>${paper?`<label class="wallpaper-mode">이미지 배치<select data-wallpaper="mode" aria-label="벽지 이미지 배치"><option value="fit" ${paper.mode==='fit'?'selected':''}>벽마다 한 장으로 채우기</option><option value="tile" ${paper.mode==='tile'?'selected':''}>무늬 반복하기</option></select></label>${paper.mode==='tile'?`<label class="wallpaper-mode">무늬 한 장의 가로 길이 (cm)<input type="number" data-wallpaper="size" aria-label="벽지 무늬 가로 길이" min="10" max="500" step="1" value="${Math.round(paper.size*100)}"></label>`:'<p class="prop-hint">벽의 가로·세로에 맞춰 이미지 비율이 바뀝니다.</p>'}<div class="prop-actions"><button data-action="remove-wallpaper">벽지 지우기</button></div>`:''}${w&&w.wallpaper!==undefined?'<div class="prop-actions"><button data-action="inherit-wallpaper">전체 벽지 따라가기</button></div>':''}<p class="prop-hint">입체 보기에서 확인하세요. 앞쪽 벽이 안 보이면 ‘앞쪽 벽 숨김’을 눌러 전체 벽을 켜세요.</p></section>`;
}
function drawProperties(){
 const f=selectedObject(),kind=typeOf(selected);let out='';
 $('#selectionBar').hidden=kind!=='item'||step!==2;$('#selectionName').textContent=kind==='item'?f.name:'';
 if(!f){$('#propertiesTitle').textContent=step===1?'우리 방 크기':'공간 · 벽지 설정';out=`<section class="prop-section"><p class="prop-hint intro-hint">${step===1?'줄자로 잰 길이를 cm로 적어주세요.<br>예: 3m 50cm → 350cm':'평면도에서 가구를 누르면 크기와 색상을 바꿀 수 있어요.'}</p>${step===1?`<div class="room-presets" aria-label="기본 방 크기"><button data-room="3,3">작은 방<small>300 × 300cm</small></button><button data-room="4,3">보통 방<small>400 × 300cm</small></button><button data-room="6,4">넓은 방<small>600 × 400cm</small></button></div>`:''}<div class="field-grid">${numberField('가로 길이','width',project.width*100,200,3000)}${numberField('세로 길이','depth',project.depth*100,200,3000)}</div><p class="prop-hint">200~3,000cm 사이로 입력할 수 있어요.</p><div class="area-card">방 크기 (대략)<strong>${(project.width*project.depth).toFixed(1)} <small>m² · 약 ${(project.width*project.depth/3.305785).toFixed(1)}평</small></strong></div></section><details class="advanced"><summary>천장 높이·바닥 색상</summary><section class="prop-section"><div class="field-grid">${numberField('천장 높이','height',project.height*100,200,500,{full:true})}</div><h3>바닥 색상</h3>${colorControls(project.floor,'floor')}<p class="prop-hint">치수는 외곽 벽의 중심부터 반대편 벽 중심까지예요. 실제로 쓸 수 있는 면적은 조금 작아요.</p><div class="prop-actions"><button data-action="blank" style="grid-column:1/-1">가구·내부 벽 모두 비우기</button></div></section></details>`;
 }else if(kind==='item'){
 $('#propertiesTitle').textContent=f.name;out=`<p class="prop-hint intro-hint">위치는 평면도에서 끌어서 바꾸세요.</p>${f.type==='photo'?`<img class="wallpaper-preview" src="${esc(f.photo.image)}" alt="제품 사진"><p class="prop-hint">사진 가구 · ${f.photo.orientation==='floor'?'바닥 배치':'정면 사진 + 치수 윤곽'}<br>옆면·뒷면은 재현하지 않아요.</p>`:''}<section class="prop-section"><h3>가구 크기</h3><p class="prop-hint">숫자를 입력하거나 아래 막대를 움직여보세요.</p><div class="size-controls">${sizeControl('가로 폭','w',f.w*100,10,1000)}${sizeControl('앞뒤 길이','d',f.d*100,10,1000)}${sizeControl('높이','h',f.h*100,1,400)}</div>${f.type!=='photo'?'<div class="prop-actions"><button data-action="reset-size">기본 크기로 복원</button></div>':''}</section>${f.type!=='photo'?`<section class="prop-section"><h3>가구 색상</h3>${colorControls(f.color,'color')}</section>`:''}<details class="advanced"><summary>자세히 조정 · 위치와 각도</summary><section class="prop-section"><div class="field-grid">${numberField('가로 위치','x',f.x*100,0,project.width*100)}${numberField('세로 위치','z',f.z*100,0,project.depth*100)}${numberField('회전 각도','r',f.r,0,359,{unit:'°',full:true})}</div><p class="prop-hint">방의 왼쪽 위에서 가구 중심까지의 거리예요.</p></section></details><div class="prop-actions"><button data-action="deselect">선택 해제</button></div>`;
 }else if(kind==='wall'){
 $('#propertiesTitle').textContent=f.boundary?'외곽 벽':'내부 벽';out=`<section class="prop-section"><h3>벽 치수</h3><div class="field-grid">${numberField('두께','t',f.t*100,5,50,{full:true})}</div><p class="prop-hint">길이 ${(wallLength(f)*100).toFixed(0)} cm · 높이 ${project.height*100} cm</p></section>`;
 if(!f.boundary)out+=`<section class="prop-section"><h3>시작점과 끝점</h3><div class="field-grid">${numberField('시작 가로','x1',f.x1*100,0,project.width*100)}${numberField('시작 세로','z1',f.z1*100,0,project.depth*100)}${numberField('끝 가로','x2',f.x2*100,0,project.width*100)}${numberField('끝 세로','z2',f.z2*100,0,project.depth*100)}</div><p class="prop-hint">평면도의 양 끝점을 끌어도 바뀝니다.</p><div class="prop-actions"><button data-action="delete" class="delete">${icon('trash-2')}벽 삭제</button><button data-action="deselect">공간 설정</button></div></section>`;
 else out+=`<p class="prop-hint">외곽 벽의 위치는 공간 크기에서 변경하세요.</p><div class="prop-actions"><button data-action="deselect">공간 설정</button></div>`;
 }else{
 $('#propertiesTitle').textContent=f.type==='door'?'문':'창문';const w=project.walls.find(w=>w.id===f.wallId);out=`<section class="prop-section"><h3>문·창문 크기</h3><div class="field-grid">${numberField('너비','w',f.w*100,30,500)}${numberField('높이','h',f.h*100,30,400)}${f.type==='window'?numberField('바닥에서 높이','sill',f.sill*100,0,300,{full:true}):''}${numberField('벽 시작점에서 중심까지','at',f.at*wallLength(w)*100,0,wallLength(w)*100,{full:true})}</div><p class="prop-hint">문·창 사이와 벽 끝에서 최소 5cm를 확보합니다.</p><div class="prop-actions"><button data-action="delete" class="delete">${icon('trash-2')}삭제</button><button data-action="deselect">공간 설정</button></div></section>`;
 }
 if(!f||kind==='wall')out+=wallpaperControls(kind==='wall'?f:null);
 document.body.classList.toggle('object-selected',!!f);
 $('#properties').innerHTML=out;icons();
}
function select(id){selected=step===1?null:id;drawPlan();drawProperties();updateSelection();}
function render(){drawPlan();drawProperties();updateStatus();rebuildThree();resizeThree();}
function initThree(){try{
 scene=new THREE.Scene();scene.background=new THREE.Color('#e8e9e7');renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.outputColorSpace=THREE.SRGBColorSpace;$('#threeContainer').append(renderer.domElement);
 camera=new THREE.PerspectiveCamera(42,1,.03,500);camera.position.set(13,13,16);
 controls=new OrbitControls(camera,renderer.domElement);controls.target.set(project.width/2,.3,project.depth/2);controls.maxPolarAngle=Math.PI/2+.12;controls.minDistance=.15;controls.maxDistance=300;controls.enableDamping=false;controls.addEventListener('change',requestRender);
 ambientLight=new THREE.HemisphereLight();keyLight=new THREE.DirectionalLight();fillLight=new THREE.DirectionalLight();
 keyLight.castShadow=true;keyLight.shadow.mapSize.set(2048,2048);keyLight.shadow.normalBias=.015;keyLight.shadow.bias=-.0001;
 scene.add(ambientLight,keyLight,keyLight.target,fillLight,fillLight.target);applyLighting('daylight');
 placeCamera(camera,controls.target,project,cameraMode);

 new ResizeObserver(resizeThree).observe($('#threeContainer'));
 let pointerStart;renderer.domElement.addEventListener('pointerdown',e=>pointerStart={x:e.clientX,y:e.clientY});renderer.domElement.addEventListener('pointerup',e=>{if(!pointerStart||Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>4)return;const r=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);let id=null;const hits=ray.intersectObject(model,true);for(const hit of hits){let obj=hit.object,visible=true;while(obj){if(!obj.visible)visible=false;obj=obj.parent;}if(!visible)continue;obj=hit.object;while(obj&&!obj.userData.itemId)obj=obj.parent;if(obj){id=obj.userData.itemId;break;}}select(id);});
 controls.update();resizeThree();
 }catch(error){$('#threeError').hidden=false;renderer?.dispose();renderer?.domElement.remove();renderer=null;console.error(error);}}
function requestRender(){if(!renderer||renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;if(renderer)renderer.render(scene,camera);});}
function resizeThree(){if(!renderer)return;const r=$('#threeContainer').getBoundingClientRect();if(r.width<1||r.height<1)return;const aspect=r.width/r.height,changed=Math.abs(camera.aspect-aspect)>.001;camera.aspect=aspect;camera.updateProjectionMatrix();if(changed&&cameraMode==='overview'){placeCamera(camera,controls.target,project,cameraMode);controls.update();}renderer.setSize(r.width,r.height);requestRender();}
function updateSelection(){if(!renderer||!model)return;if(selectionBox){scene.remove(selectionBox);selectionBox.geometry.dispose();selectionBox.material.dispose();selectionBox=null;}if(selected){const object=model.children.find(o=>o.userData.itemId===selected);if(object?.visible){selectionBox=new THREE.BoxHelper(object,0x51846a);scene.add(selectionBox);}}requestRender();}
function rebuildThree(){if(!renderer)return;if(model){scene.remove(model);disposeModel(model);}model=buildModel(project,{cutaway});scene.add(model);positionLights(keyLight,fillLight,project);updateSelection();requestRender();}
function applyLighting(name){
 if(!renderer)return;const preset=lightingPresets[name];
 ambientLight.color.set(preset.sky);ambientLight.groundColor.set(preset.ground);ambientLight.intensity=preset.ambient;
 keyLight.color.set(preset.key);keyLight.intensity=preset.intensity;fillLight.color.set(preset.fill);fillLight.intensity=preset.fillIntensity;
 renderer.toneMappingExposure=preset.exposure;requestRender();
}
function setCutaway(value){cutaway=value;$('#cutawayBtn').innerHTML=`${icon(cutaway?'scan-eye':'box')}${cutaway?'앞쪽 벽 숨김':'전체 벽 보기'}`;$('#cutawayBtn').setAttribute('aria-pressed',cutaway);icons();rebuildThree();}
function setCameraMode(mode){
 if(!renderer)return;cameraMode=mode;resizeThree();placeCamera(camera,controls.target,project,mode);controls.update();
 $$('[data-camera]').forEach(b=>{b.classList.toggle('active',b.dataset.camera===mode);b.setAttribute('aria-pressed',b.dataset.camera===mode);});
 setCutaway(mode==='overview');$('#cameraHint').textContent=mode==='eye'?'눈높이 150cm에서 시작 · 끌어서 시점 조정 · 전체 공간으로 돌아갈 수 있어요':'끌어서 둘러보기 · 휠 또는 두 손가락으로 확대·축소';
}
function fit(){setCameraMode('overview');toast('공간 전체를 화면에 맞췄어요.');}
$$('[data-camera]').forEach(b=>b.onclick=()=>setCameraMode(b.dataset.camera));
$('#lightingPreset').onchange=e=>applyLighting(e.target.value);
function point(e){const svg=$('#plan'),pt=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());return {x:snap(clamp(pt.x,0,project.width)),z:snap(clamp(pt.y,0,project.depth))};}
$('#plan').addEventListener('pointerdown',e=>{
 if(e.button!==0)return;e.preventDefault();$('#plan').focus({preventScroll:true});const pos=point(e),target=e.target.closest('[data-id]');
 if(tool==='place'){
 if(project.items.length>=200){toast('가구는 최대 200개까지 배치할 수 있어요.');return;}
 const c=CATALOG.find(f=>f.type===placing);mutate(()=>{const f={...c,id:uid(),x:pos.x,z:pos.z,r:0};project.items.push(f);selected=f.id;});setTool('select');return;
 }
 if(tool==='wall'){
 if(!wallStart){wallStart=pos;$('#planHint').textContent='이제 벽의 끝점을 눌러주세요';$('#toolMessage').textContent=$('#planHint').textContent;drawPlan();return;}
 if(Math.hypot(pos.x-wallStart.x,pos.z-wallStart.z)<.2){toast('벽 길이는 최소 20cm여야 합니다.');return;}
 const start=wallStart;mutate(()=>{const w={id:uid(),x1:start.x,z1:start.z,x2:pos.x,z2:pos.z,t:.12};project.walls.push(w);selected=w.id;});setTool('select');return;
 }
 if(tool==='door'||tool==='window'){
 const matches=project.walls.map(w=>({w,...projectOnWall(w,pos.x,pos.z)})).sort((a,b)=>a.distance-b.distance),hit=matches[0];if(!hit||hit.distance>.4){toast('문·창문을 놓을 벽을 눌러주세요.');return;}
 const o={id:uid(),wallId:hit.w.id,type:tool,at:hit.at,w:tool==='door'?.9:1.2,h:tool==='door'?Math.min(2.1,project.height-.1):1.1,sill:tool==='door'?0:.8};
 if(!openingFits(project,o)){toast('기존 문·창과 겹치거나 벽 끝에 너무 가까워요. 다른 위치를 선택하세요.');return;}
 mutate(()=>{project.openings.push(o);selected=o.id;});setTool('select');return;
 }
 const id=target?.dataset.id||null;select(id);const obj=selectedObject();if(obj&&!(typeOf(id)==='wall'&&obj.boundary)){drag={id,kind:typeOf(id),handle:target?.dataset.handle,start:pos,original:structuredClone(obj),before:serialize()};$('#plan').setPointerCapture(e.pointerId);}
});
let previewTime=0;
$('#plan').addEventListener('pointermove',e=>{
 if(!drag)return;const pos=point(e),dx=pos.x-drag.start.x,dz=pos.z-drag.start.z,ob=selectedObject(),org=drag.original;const previous=structuredClone(ob);
 if(drag.kind==='item'){ob.x=clamp(snap(org.x+dx),0,project.width);ob.z=clamp(snap(org.z+dz),0,project.depth);}
 else if(drag.kind==='opening'){const w=project.walls.find(w=>w.id===ob.wallId);ob.at=projectOnWall(w,pos.x,pos.z).at;}
 else if(drag.handle){const n=drag.handle==='start'?'1':'2';ob['x'+n]=pos.x;ob['z'+n]=pos.z;}
 else{const x=clamp(dx,-Math.min(org.x1,org.x2),project.width-Math.max(org.x1,org.x2)),z=clamp(dz,-Math.min(org.z1,org.z2),project.depth-Math.max(org.z1,org.z2));Object.assign(ob,{x1:org.x1+x,x2:org.x2+x,z1:org.z1+z,z2:org.z2+z});}
 try{validateProject(project);}catch{Object.assign(ob,previous);return;}
 drawPlan();if(performance.now()-previewTime>80){rebuildThree();previewTime=performance.now();}
});
function endDrag(e){if(!drag)return;record(drag.before);drag=null;if($('#plan').hasPointerCapture(e.pointerId))$('#plan').releasePointerCapture(e.pointerId);render();}
$('#plan').addEventListener('pointerup',endDrag);$('#plan').addEventListener('pointercancel',e=>{if(drag){project=JSON.parse(drag.before);drag=null;render();}});$('#plan').addEventListener('lostpointercapture',endDrag);
let resizing=null,wallpaperRequest=0;
$('#properties').addEventListener('input',e=>{
 const input=e.target,key=input.dataset.size,f=selectedObject();if(!key||typeOf(selected)!=='item')return;
 if(!resizing)resizing={before:serialize(),id:selected};
 f[key]=Number(input.value)/100;
 const number=$(`#properties [data-prop="${key}"]`);if(number)number.value=input.value;
 drawPlan();rebuildThree();dirty=true;updateStatus();
});
$('#properties').addEventListener('change',async e=>{
 if(e.target.matches('[data-wallpaper-file]')){
  const file=e.target.files[0],targetId=typeOf(selected)==='wall'?selected:null,originalProject=project;
  e.target.value='';if(!file)return;const request=++wallpaperRequest;toast('벽지 이미지를 준비하고 있어요.');
  try{
   const paper=await imageToWallpaper(file);const candidate=structuredClone(project),target=targetId?candidate.walls.find(w=>w.id===targetId):candidate;
   if(!target||project!==originalProject||request!==wallpaperRequest)return;target.wallpaper=paper;if(!targetId)candidate.walls.forEach(w=>delete w.wallpaper);
   validateProject(candidate);await prepareAssets(candidate);
   if(request!==wallpaperRequest)return;
   if(project!==originalProject){toast('설계가 바뀌었어요. 이미지를 다시 선택해 주세요.');return;}
   if(mutate(()=>{const current=targetId?project.walls.find(w=>w.id===targetId):project;if(!current)throw Error('선택한 벽이 삭제됐어요.');current.wallpaper=paper;if(!targetId)project.walls.forEach(w=>delete w.wallpaper);})){setView('split');toast('벽지를 적용했어요. 입체 화면에서 확인하세요.');}
  }catch(error){toast(error.message);}return;
 }
 if(e.target.dataset.wallpaper){
  const input=e.target,key=input.dataset.wallpaper;if(!input.checkValidity()||!input.value){toast('무늬 크기는 10~500cm로 입력해 주세요.');drawProperties();return;}
  mutate(()=>{const w=typeOf(selected)==='wall'?selectedObject():null,target=w||project,paper=w?wallpaperFor(project,w):project.wallpaper;target.wallpaper={...paper,[key]:key==='size'?Number(input.value)/100:input.value};});return;
 }
 if(e.target.dataset.size){if(resizing){record(resizing.before);resizing=null;render();}return;}

 const input=e.target,key=input.dataset.prop;if(!key)return;let value;const opened=[...$('#properties').querySelectorAll('details')].map(d=>d.open);
 if(input.type==='color')value=input.value;else{if(input.value.trim()===''||!input.checkValidity()){toast('표시된 범위 안의 숫자를 입력해 주세요.');drawProperties();return;}value=Number(input.value);if(key!=='r')value/=100;}
 mutate(()=>{const f=selectedObject();if(f){if(key==='at'){const w=project.walls.find(w=>w.id===f.wallId);f.at=value/wallLength(w);}else f[key]=value;}else{project[key]=value;if(['width','depth'].includes(key))syncBoundary(project);try{validateProject(project);}catch{throw Error('가구·벽·문이 바뀐 방 크기에 맞지 않아요. 먼저 안쪽으로 옮기거나 비운 뒤 크기를 바꿔주세요.');}}});
 [...$('#properties').querySelectorAll('details')].forEach((d,i)=>d.open=opened[i]||false);
});
function perform(action){
 if(action==='remove-wallpaper'||action==='inherit-wallpaper'){
  wallpaperRequest++;
  mutate(()=>{const w=typeOf(selected)==='wall'?selectedObject():null;if(w){if(action==='inherit-wallpaper')delete w.wallpaper;else w.wallpaper=null;}else{delete project.wallpaper;project.walls.forEach(w=>delete w.wallpaper);}});return;
 }
 if(action==='size'){$('.properties-panel').scrollIntoView({behavior:'smooth',block:'start'});$('#properties [data-prop="w"]')?.focus({preventScroll:true});return;}
 if(action==='reset-size'&&typeOf(selected)==='item'){mutate(()=>{const f=selectedObject(),c=CATALOG.find(c=>c.type===f.type);if(!c)return;Object.assign(f,{w:c.w,d:c.d,h:c.h});});return;}

 if(action==='blank'){if(!confirm('현재 가구, 내부 벽, 문·창을 비우고 시작할까요? 실행 취소로 되돌릴 수 있습니다.'))return;mutate(()=>{project.items=[];project.openings=[];project.walls=project.walls.filter(w=>w.boundary);selected=null;});return;}
 if(action==='deselect'){select(null);return;}const f=selectedObject(),kind=typeOf(selected);if(!f)return;
 if(action==='rotate'&&kind==='item')mutate(()=>f.r=(f.r+90)%360);
 if(action==='duplicate'&&kind==='item')mutate(()=>{const n={...f,id:uid(),x:clamp(f.x+.2,0,project.width),z:clamp(f.z+.2,0,project.depth)};project.items.push(n);selected=n.id;});
 if(action==='delete'&&!(kind==='wall'&&f.boundary)){
 if(kind==='wall'&&project.openings.some(o=>o.wallId===selected)&&!confirm('이 벽과 연결된 문·창문을 함께 삭제할까요?'))return;
 mutate(()=>{project.items=project.items.filter(x=>x.id!==selected);project.openings=project.openings.filter(x=>x.id!==selected&&x.wallId!==selected);project.walls=project.walls.filter(x=>x.id!==selected);selected=null;});
 }
}
$('#properties').addEventListener('click',e=>{const preset=e.target.closest('[data-room]');if(preset){const [w,d]=preset.dataset.room.split(',').map(Number);replaceRoom(emptyRoom(w,d));return;}const color=e.target.closest('[data-color]'),action=e.target.closest('[data-action]');if(color){const opened=[...$('#properties').querySelectorAll('details')].map(d=>d.open);mutate(()=>{const f=selectedObject();if(f)f.color=color.dataset.color;else project.floor=color.dataset.color;});[...$('#properties').querySelectorAll('details')].forEach((d,i)=>d.open=opened[i]||false);}if(action)perform(action.dataset.action);});
$$('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$$('[data-library]').forEach(b=>b.addEventListener('click',()=>{$$('[data-library]').forEach(x=>x.classList.toggle('active',x===b));$('#furnitureLibrary').hidden=b.dataset.library!=='furniture';$('#structureLibrary').hidden=b.dataset.library!=='structure';}));
$('#catalog').addEventListener('click',e=>{const b=e.target.closest('[data-type]');if(!b)return;setTool('select');setView('2d');if(mutate(()=>{const f=centeredFurniture(project,b.dataset.type);project.items.push(f);selected=f.id;}))toast('방 가운데에 놓았어요. 가구를 끌어서 원하는 곳으로 옮기세요.');});
$('#catalogSearch').addEventListener('input',drawCatalog);
$('#categories').addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(!b)return;category=b.dataset.category;$$('[data-category]').forEach(x=>x.classList.toggle('active',x===b));drawCatalog();});
async function undo(){if(!history.length)return;const before=serialize(),target=history.at(-1);try{await prepareAssets(JSON.parse(target));}catch(error){toast(error.message);return;}if(before!==serialize()||target!==history.at(-1))return;future.push(before);trimHistory(future);project=JSON.parse(history.pop());selected=null;dirty=true;setTool('select');$('#projectName').value=project.name;render();}
async function redo(){if(!future.length)return;const before=serialize(),target=future.at(-1);try{await prepareAssets(JSON.parse(target));}catch(error){toast(error.message);return;}if(before!==serialize()||target!==future.at(-1))return;history.push(before);trimHistory(history);project=JSON.parse(future.pop());selected=null;dirty=true;setTool('select');$('#projectName').value=project.name;render();}
$('#undoBtn').onclick=undo;$('#redoBtn').onclick=redo;$('#fitBtn').onclick=fit;
$('#cutawayBtn').onclick=()=>setCutaway(!cutaway);
$('#projectName').addEventListener('change',e=>{const name=e.target.value.trim();if(!name){e.target.value=project.name;return;}mutate(()=>project.name=name);});
function download(data,name,mime){const blob=data instanceof Blob?data:new Blob([data],{type:mime});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const filename=()=>project.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').slice(0,60)||'room-studio';
$('#saveBtn').onclick=()=>{download(JSON.stringify(project,null,2),filename()+'.room.json','application/json');dirty=false;updateStatus();$('#saveStatus').textContent='프로젝트 파일 다운로드 요청됨';toast('프로젝트 파일을 다운로드합니다. 기기에 보관해 주세요.');};
$('#loadBtn').onclick=()=>$('#fileInput').click();
$('#fileInput').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>16_000_000){toast('16MB 이하의 프로젝트 파일을 선택하세요.');return;}try{const loaded=validateProject(JSON.parse(await file.text()));await prepareAssets(loaded);if(dirty&&!confirm('저장하지 않은 변경 사항이 있습니다. 파일을 불러올까요?'))return;history.push(serialize());trimHistory(history);future=[];project=loaded;selected=null;dirty=false;setTool('select');$('#projectName').value=project.name;render();goStep(2);fit();toast('프로젝트를 불러왔어요.');}catch{toast('올바른 공간 스튜디오 프로젝트 파일이 아닙니다. 현재 설계는 유지됩니다.');}});
$('#helpBtn').onclick=()=>$('#helpDialog').showModal();$('#exportBtn').onclick=()=>$('#exportDialog').showModal();
$$('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}));
$$('[data-export]').forEach(b=>b.addEventListener('click',async()=>{let full;try{
 $$('[data-export]').forEach(x=>x.disabled=true);validateProject(project);await prepareAssets(project);await materialsReady;full=buildModel(project);const format=b.dataset.export;
 if(format==='glb'){const data=await new GLTFExporter().parseAsync(full,{binary:true});download(data,filename()+'.glb','model/gltf-binary');}
 else{download(new OBJExporter().parse(full),filename()+'.obj','text/plain');}
 $('#exportDialog').close();toast(`${format.toUpperCase()} 파일을 다운로드합니다. 전체 벽과 가구가 포함됩니다.`);
 }catch(error){toast('내보내기를 완료하지 못했어요. 프로젝트를 저장한 뒤 다시 시도하세요.');console.error(error);}finally{if(full)disposeModel(full);$$('[data-export]').forEach(x=>x.disabled=false);}}));
window.addEventListener('keydown',e=>{
 if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||$$('dialog[open]').length)return;
 if(e.key==='Escape'){if(drag){project=JSON.parse(drag.before);drag=null;render();}setTool('select');select(null);return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
 if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();perform('delete');return;}
 if(e.key.toLowerCase()==='r'){perform('rotate');return;}
 const moves={ArrowLeft:[-.05,0],ArrowRight:[.05,0],ArrowUp:[0,-.05],ArrowDown:[0,.05]};const f=selectedObject();if(moves[e.key]&&typeOf(selected)==='item'){e.preventDefault();mutate(()=>{f.x=clamp(snap(f.x+moves[e.key][0]),0,project.width);f.z=clamp(snap(f.z+moves[e.key][1]),0,project.depth);});}
});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
const stepText={1:['방 크기 설정','실측한 가로·세로를 입력하거나 기본 크기를 선택하세요.','다음 · 가구 놓기'],2:['가구 배치','가구를 선택한 뒤 끌어서 이동하고 방향을 조정하세요.','다음 · 입체로 보기'],3:['3D 공간 검토','시점과 조명을 바꿔 배치를 확인하세요. 가구를 선택하면 크기와 색을 수정할 수 있습니다.','내 설계 저장']};
function goStep(value){
 step=value;document.body.dataset.step=String(value);setTool('select');select(null);
 $$('nav [data-step]').forEach(b=>{if(Number(b.dataset.step)===step)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
 $('#stepCount').textContent=`${step} / 3`;$('#stepTitle').textContent=stepText[step][0];$('#stepDescription').textContent=stepText[step][1];$('#nextStepBtn').textContent=stepText[step][2];$('#sampleBtn').hidden=step!==1;
 setView(step===3?'3d':'2d');drawProperties();
}
function replaceRoom(next){
 if((project.items.length||project.openings.length||project.walls.some(w=>!w.boundary))&&!confirm('현재 배치를 새 방으로 바꿀까요? 잘못 바꿨다면 ‘되돌리기’를 누르세요.'))return;
 next.name=project.name;
 if(mutate(()=>{project=next;selected=null;})){setTool('select');fit();toast('방을 바꿨어요. 되돌리기로 이전 배치를 복원할 수 있어요.');}
}
$$('nav [data-step]').forEach(b=>b.onclick=()=>goStep(Number(b.dataset.step)));
$('#nextStepBtn').onclick=()=>step<3?goStep(step+1):$('#saveBtn').click();
$('#sampleBtn').onclick=()=>{const before=serialize();replaceRoom(initialProject());if(serialize()!==before)goStep(2);};
$$('[data-quick]').forEach(b=>b.onclick=()=>perform(b.dataset.quick));
$('#wallpaperBtn').onclick=()=>{goStep(2);select(null);$('.wallpaper-section').scrollIntoView({behavior:'smooth',block:'center'});};
$('#cancelToolBtn').onclick=()=>setTool('select');
for(const [id,label] of [['undoBtn','되돌리기'],['redoBtn','다시 하기'],['fitBtn','전체 보기']]){const b=$('#'+id);b.classList.remove('icon-button');b.classList.add('text-tool');b.setAttribute('aria-label',label);b.insertAdjacentHTML('beforeend',`<span>${label}</span>`);}
drawCatalog();initThree();render();goStep(1);icons();

let productSource=null,productDraft=null,productRequest=0;
const productDialog=$('#productDialog');
function updateProductPreview(resetSize=false){
 if(!productSource)return;
 productDraft=processProduct(productSource,$('#productRemoveBg').checked);
 $('#productPreview').src=productDraft.image;
 $('#productStatus').textContent=productDraft.removed?'단색 배경·여백 정리 완료 · 제품이 잘 보이는지 확인하세요.':'사진 준비 완료 · 배경이 남았다면 배경 없는 PNG나 단색 배경 사진을 사용하세요.';
 if(resetSize){const floor=$('#productOrientation').value==='floor';$('#productWidth').value=100;$('#productDepth').value=floor?Math.min(1000,Math.max(10,Math.round(100/productDraft.ratio))):60;$('#productHeight').value=floor?2:Math.min(400,Math.max(1,Math.round(100/productDraft.ratio)));}
}
$('#productPhotoBtn').onclick=()=>productDialog.showModal();
productDialog.addEventListener('close',()=>{productRequest++;productSource=null;productDraft=null;$('#productFields').hidden=true;$('#productPreview').removeAttribute('src');$('#productStatus').textContent='사진은 이 기기에서 처리됩니다.';$('#productFile').disabled=false;$('#productAdd').disabled=false;$('#productFile').value='';});
async function chooseProduct(file){
 if(!file)return;const request=++productRequest;
 productSource=null;productDraft=null;$('#productFields').hidden=true;$('#productStatus').textContent='사진을 읽고 배경과 여백을 정리하고 있어요…';
 try{
  const source=await readProductFile(file);if(request!==productRequest||!productDialog.open)return;
  productSource=source;$('#productRemoveBg').checked=true;$('#productOrientation').value='upright';$('#productName').value=(file.name.replace(/\.[^.]+$/,'')||'내 제품').slice(0,80);updateProductPreview(true);$('#productFields').hidden=false;$('#productAdd').disabled=false;
 }catch(error){if(request===productRequest)$('#productStatus').textContent=error.message;}
}
$('#productFile').onchange=e=>{const file=e.target.files[0];e.target.value='';chooseProduct(file);};
$('#productRemoveBg').onchange=()=>{try{updateProductPreview(false);}catch(error){productDraft=null;$('#productAdd').disabled=true;$('#productStatus').textContent=error.message;}};
$('#productOrientation').onchange=()=>{const floor=$('#productOrientation').value==='floor';$('#productHeight').value=floor?2:Math.min(400,Math.max(1,Math.round(Number($('#productWidth').value)/productDraft.ratio)));if(floor)$('#productDepth').value=Math.min(1000,Math.max(10,Math.round(Number($('#productWidth').value)/productDraft.ratio)));};
for(const event of ['dragenter','dragover'])$('#productDrop').addEventListener(event,e=>{e.preventDefault();$('#productDrop').classList.add('drag-over');});
$('#productDrop').addEventListener('dragleave',()=>$('#productDrop').classList.remove('drag-over'));
$('#productDrop').addEventListener('drop',e=>{e.preventDefault();$('#productDrop').classList.remove('drag-over');if(!$('#productFile').disabled)chooseProduct(e.dataTransfer.files[0]);});
$('#productForm').onsubmit=async e=>{
 e.preventDefault();if(!productDraft||!e.target.reportValidity())return;
 const request=productRequest,original=serialize();$('#productAdd').disabled=true;$('#productFile').disabled=true;
 try{
  const name=$('#productName').value.trim();if(!name)throw Error('제품 이름을 적어 주세요.');
  const f={id:uid(),type:'photo',name,color:'#ffffff',w:Number($('#productWidth').value)/100,d:Number($('#productDepth').value)/100,h:Number($('#productHeight').value)/100,x:project.width/2,z:project.depth/2,r:0,photo:{image:productDraft.image,orientation:$('#productOrientation').value}};
  const candidate=structuredClone(project);candidate.items.push(f);validateProject(candidate);await prepareProducts(candidate);
  if(request!==productRequest||!productDialog.open)return;
  if(original!==serialize())throw Error('설계가 바뀌었어요. 다시 추가해 주세요.');
  if(mutate(()=>{project.items.push(f);selected=f.id;})){
   productDialog.close();goStep(2);select(f.id);setView('split');toast('사진 가구를 놓았어요. 치수를 확인하고 원하는 곳으로 옮기세요.');
  }
 }catch(error){$('#productStatus').textContent=error.message;}finally{$('#productAdd').disabled=false;$('#productFile').disabled=false;}
};
