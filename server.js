import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { WebSocketServer } from 'ws';

const PORT=Number(process.env.PORT||3000), ROOT=process.cwd(), MAP_SIZE=32, rooms=new Map();
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.glb':'model/gltf-binary','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,`http://${req.headers.host}`).pathname);const file=pathname==='/'?'index.html':pathname.slice(1);if(file.includes('..'))throw Error('invalid path');const body=await readFile(join(ROOT,'public',file));res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(body)}catch{res.writeHead(404);res.end('Not found')}});
const wss=new WebSocketServer({server}),uid=()=>Math.random().toString(36).slice(2,9),rand=(a,b)=>a+Math.random()*(b-a),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const shuffle=a=>{const out=[...a];for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]]}return out};
const maxPoliceFor=n=>n<=5?1:n<=8?2:3;
const WORLD_SCALE=3.5,MAP_CENTER=16,MAPS=new Set(['barcelona','paris','muscat','miami']);
const roomMap=map=>MAPS.has(map)?map:'barcelona';
function freshRoom(code,map='barcelona'){return{code,map:roomMap(map),status:'lobby',hostId:null,players:[],cops:[],thieves:[],birds:[],houses:[],droppedKeys:[],pedestrians:[],tracers:[],aimHistory:new Map(),startedAt:0,matchEndsAt:0,winner:null,feed:[],lastBroadcast:0}}
function newRoomCode(){let code;do{code=Array.from({length:5},()=>String.fromCharCode(65+Math.floor(Math.random()*26))).join('')}while(rooms.has(code));return code}
function send(ws,data){if(ws?.readyState===1)ws.send(JSON.stringify(data))}
function publicRoom(r,selfId,base=null){const ownHouse=r.thieves.find(t=>t.id===selfId)?.houseId,now=Date.now(),b=base||{code:r.code,map:r.map||'barcelona',status:r.status,hostId:r.hostId,serverTime:now,players:r.players.map(p=>({id:p.id,name:p.name,role:p.role||'unassigned',connected:p.connected,alive:p.alive,escaped:p.escaped,place:p.place})),cops:r.cops.map(x=>({...x,ammo:{...x.ammo}})),pedestrians:r.pedestrians.map(x=>({...x})),tracers:r.tracers.filter(x=>x.expires>now),startedAt:r.startedAt,matchEndsAt:r.matchEndsAt,winner:r.winner,feed:r.feed.slice(-6)};return{...b,serverTime:now,selfId,thieves:r.thieves.map(x=>({...x,keys:x.id===selfId?[...x.keys]:[],escapeDeadline:x.id===selfId?x.escapeDeadline:null})),birds:r.birds.map(x=>({id:x.id,x:x.x,z:x.z,alive:x.alive,phase:x.phase,isMine:x.key===ownHouse})),droppedKeys:r.droppedKeys.filter(k=>!k.picked).map(k=>({id:k.id,key:k.key,x:k.x,z:k.z,isMine:k.ownerId===selfId})),houses:r.houses.map(x=>({...x,owner:x.owner===selfId?'you':undefined}))}}
function broadcast(r){const now=Date.now(),b={code:r.code,map:r.map||'barcelona',status:r.status,hostId:r.hostId,serverTime:now,players:r.players.map(p=>({id:p.id,name:p.name,role:p.role||'unassigned',connected:p.connected,alive:p.alive,escaped:p.escaped,place:p.place})),cops:r.cops.map(x=>({...x,ammo:{...x.ammo}})),pedestrians:r.pedestrians.map(x=>({...x})),tracers:r.tracers.filter(x=>x.expires>now),startedAt:r.startedAt,matchEndsAt:r.matchEndsAt,winner:r.winner,feed:r.feed.slice(-6)};for(const p of r.players)if(p.connected)send(p.ws,{type:'state',room:publicRoom(r,p.id,b)});r.lastBroadcast=now}
function event(r,text){r.feed.push({text,at:Date.now()});r.feed=r.feed.slice(-12)}
const CAR_POS=[[16,6],[12,10],[20,22],[8,18],[24,26]];
const TREE_POS=Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return[16+Math.sin(a)*11/3.5,16+Math.cos(a)*11/3.5]});
function blocked(x,z,r=null,entity=null,ignore=null){
 const bx=Math.round((x-2)/4)*4+2,bz=Math.round((z-2)/4)*4+2;
 if(bx>=2&&bx<=30&&bz>=2&&bz<=30){
  if(Math.hypot(bx-16,bz-16)>=6&&Math.abs(x-bx)<1.35&&Math.abs(z-bz)<1.35)return true;
 }
 if(Math.hypot(x-16,z-16)<(r?.map==='paris'?1.4:r?.map==='muscat'?1.6:r?.map==='miami'?3.6:.56))return true;
 if(CAR_POS.some(([cx,cz])=>Math.abs(x-cx)<.42&&Math.abs(z-cz)<.8))return true;
 if(TREE_POS.some(([tx,tz])=>Math.hypot(x-tx,z-tz)<.43))return true;
 const lx=Math.round((x-.986)/4)*4+.986,lz=Math.round((z-.986)/4)*4+.986;
 if(lx>=.9&&lx<=33&&lz>=.9&&lz<=33){
  if(Math.hypot(x-lx,z-lz)<.105)return true;
 }
 if(r){
  if(r.houses.some(h=>Math.abs(x-h.x)<.58&&Math.abs(z-h.z)<.42))return true;
  const others=[...r.cops,...r.thieves];
  if(!entity?.key&&others.some(o=>o!==entity&&o!==ignore&&o.alive!==false&&Math.hypot(x-o.x,z-o.z)<.32))return true;
 }
 return false;
}
function canStep(x,z,r=null,entity=null){return x>=.35&&x<=31.65&&z>=.35&&z<=31.65&&!blocked(x,z,r,entity)}
function startGame(r){
 const ps=r.players.filter(p=>p.connected),cops=ps.filter(p=>p.role==='police'),thieves=ps.filter(p=>p.role==='thief');if(ps.length<2||ps.length>10||ps.some(p=>!['police','thief'].includes(p.role))||cops.length<1||cops.length>maxPoliceFor(ps.length)||thieves.length<1||thieves.length>7)return false;
 ps.forEach(p=>{p.alive=true;p.escaped=false;p.place=null});
 const copsAt=[[16,10],[10,16],[22,16],[16,22]],thiefSpawns=[[12,12],[20,12],[12,20],[20,20],[8,16],[24,16],[16,8]];
 r.cops=cops.map((p,i)=>({id:p.id,x:copsAt[i][0],z:copsAt[i][1],yaw:Math.atan2(copsAt[i][0]-16,copsAt[i][1]-16),backwards:false,weapon:'rifle',ammo:{shotgun:3,sniper:5,rifle:30},nextShot:0}));
 r.thieves=thieves.map((p,i)=>({id:p.id,x:thiefSpawns[i][0],z:thiefSpawns[i][1],yaw:Math.atan2(thiefSpawns[i][0]-16,thiefSpawns[i][1]-16),backwards:false,weapon:'rifle',keys:[],ammo:{rifle:30},nextShot:0,alive:true,escaped:false,rank:null,escapeDeadline:null}));
 const birdSpawns=[[16,4],[16,8],[28,16],[24,16],[16,28],[4,16],[8,16]];
 const spawnNodes=[...copsAt,...thiefSpawns],houseNodes=[];
 for(const x of [4,8,12,16,20,24,28])for(const z of [4,8,12,16,20,24,28])if(Math.hypot(x-16,z-16)>=8&&Math.hypot(x-16,z-16)<=17)houseNodes.push({x,z});
 const candidates=shuffle(houseNodes).filter(h=>!birdSpawns.some(b=>Math.hypot(h.x-b[0],h.z-b[1])<2)&&!spawnNodes.some(q=>Math.hypot(h.x-q[0],h.z-q[1])<2)&&!CAR_POS.some(([x,z])=>Math.hypot(h.x-x,h.z-z)<2));
 r.houses=shuffle(candidates).slice(0,7).map((h,i)=>({id:'h'+i,x:h.x,z:h.z,yaw:Math.random()*Math.PI*2,owner:null,unlocked:false}));
 r.thieves.forEach((t,i)=>{t.houseId=r.houses[i].id;r.houses[i].owner=t.id});
 r.birds=r.houses.map((h,i)=>({id:'b'+i,key:h.id,x:birdSpawns[i][0],z:birdSpawns[i][1],yaw:Math.random()*Math.PI*2,phase:rand(0,7),alive:true}));
 const civilianSpawns=[[16,1],[16,5],[12,16],[20,16],[16,12],[16,20],[4,8],[8,4],[28,8],[24,12],[4,24],[8,28],[28,24],[24,28],[12,4],[20,4],[4,16],[28,16],[12,28],[20,28]];
 r.pedestrians=civilianSpawns.map((spot,i)=>({id:'npc'+i,x:spot[0],z:spot[1],yaw:Math.round(rand(0,4))*Math.PI/2,speed:rand(.016,.024),turnAt:Date.now()+rand(1200,4200),alive:true}));
 r.tracers=[];r.droppedKeys=[];r.status='playing';r.startedAt=Date.now();r.matchEndsAt=r.startedAt+180000;r.winner=null;event(r,`The chase is on. ${cops.length} police are in the district; the city clock is set to three minutes.`);return true
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function clearShot(a,b,r=null,source=null,target=null){const steps=Math.ceil(distance(a,b)*8);for(let i=2;i<steps-1;i++){const t=i/steps;if(blocked(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t,r,source,target||b))return false}return true}
function move(ent,dx,dz,sprint=false,speedOverride=null,r=null){const mag=Math.hypot(dx,dz)||1,speed=speedOverride??(sprint?.145:.085),nx=clamp(ent.x+dx/mag*speed,.35,31.65),nz=clamp(ent.z+dz/mag*speed,.35,31.65);if(canStep(nx,ent.z,r,ent))ent.x=nx;if(canStep(ent.x,nz,r,ent))ent.z=nz}
function chooseBirdRun(b,threat,r){const dx=b.x-threat.x,dz=b.z-threat.z,len=Math.hypot(dx,dz)||1,awayX=dx/len,awayZ=dz/len,base=Math.atan2(awayZ,awayX);let best=null;for(const offset of [0,.38,-.38,.78,-.78,1.18,-1.18,1.57,-1.57,2.35,-2.35,Math.PI]){const a=base+offset,vx=Math.cos(a),vz=Math.sin(a),nx=clamp(b.x+vx*.065,.35,31.65),nz=clamp(b.z+vz*.065,.35,31.65);if(!canStep(nx,nz,r,b))continue;const progress=vx*awayX+vz*awayZ,clearance=distance({x:nx,z:nz},threat)-distance(b,threat),score=progress*2+clearance*3-Math.abs(offset)*.08+Math.random()*.025;if(!best||score>best.score)best={vx,vz,score}}return best}
function finishIfDone(r){if(r.status!=='playing'||r.thieves.some(t=>t.alive&&!t.escaped))return;r.status='finished';r.winner=r.thieves.some(t=>t.escaped)?'thieves':'police';event(r,r.winner==='thieves'?'The surviving thieves made it home.':'The police caught every thief.')}
function raySphere(origin,dir,center,radius){const ox=origin.x-center.x,oy=origin.y-center.y,oz=origin.z-center.z,b=ox*dir.x+oy*dir.y+oz*dir.z,c=ox*ox+oy*oy+oz*oz-radius*radius,disc=b*b-c;if(disc<0)return null;const root=Math.sqrt(disc),near=-b-root,far=-b+root;return near>=0?near:far>=0?far:null}
function positionAt(r,entity,at){const history=r.aimHistory.get(entity.id);if(!history?.length||!Number.isFinite(at))return entity;let before=history[0],after=history.at(-1);for(let i=1;i<history.length;i++)if(history[i].at>=at){before=history[i-1];after=history[i];break}if(at<=before.at)return before;if(at>=after.at)return after;const f=(at-before.at)/Math.max(1,after.at-before.at);return{x:before.x+(after.x-before.x)*f,z:before.z+(after.z-before.z)*f}}
function rememberPositions(r,at){for(const e of [...r.cops,...r.thieves,...r.birds]){const h=r.aimHistory.get(e.id)||[];h.push({at,x:e.x,z:e.z});while(h.length&&h[0].at<at-600)h.shift();r.aimHistory.set(e.id,h)}}
function rayCapsule(origin,dir,entity){
 // A slightly generous body capsule keeps police hits aligned with the visible character
 // despite the third-person camera and moving-target interpolation.
 const wx=(entity.x-MAP_CENTER)*WORLD_SCALE,wz=(entity.z-MAP_CENTER)*WORLD_SCALE;
 const candidates=[raySphere(origin,dir,{x:wx,y:1.12,z:wz},.68),raySphere(origin,dir,{x:wx,y:1.72,z:wz},.34),raySphere(origin,dir,{x:wx,y:.43,z:wz},.38)].filter(Number.isFinite);
 return candidates.length?Math.min(...candidates):null
}
function rayBird(origin,dir,bird){const wx=(bird.x-MAP_CENTER)*WORLD_SCALE,wz=(bird.z-MAP_CENTER)*WORLD_SCALE;return[raySphere(origin,dir,{x:wx,y:.5,z:wz},.6),raySphere(origin,dir,{x:wx,y:.72,z:wz},.28)].filter(Number.isFinite).sort((a,b)=>a-b)[0]??null}
function rayTarget(origin,dir,entities,range,r,source,isPolice,aimTime){
 const candidates=entities.map(t=>{const pos=positionAt(r,t,aimTime);return{t,pos,d:isPolice?rayCapsule(origin,dir,pos):rayBird(origin,dir,pos)}}).filter(q=>q.d!=null&&q.d<=range).sort((a,b)=>a.d-b.d);
 for(const q of candidates){const impact={x:origin.x+dir.x*q.d,y:origin.y+dir.y*q.d,z:origin.z+dir.z*q.d},impactMap={x:impact.x/WORLD_SCALE+MAP_CENTER,z:impact.z/WORLD_SCALE+MAP_CENTER};if(clearShot({x:origin.x/WORLD_SCALE+MAP_CENTER,z:origin.z/WORLD_SCALE+MAP_CENTER},impactMap,r,source,q.t))return{entity:q.t,position:q.pos,distance:q.d,impact}}
 return null
}
function trace(r,from,to,team,hitHeight=1.9,shooterId=null){r.tracers.push({id:uid(),shooterId,x1:from.x,z1:from.z,y1:from.y??1.35,x2:to.x,z2:to.z,y2:hitHeight,team,expires:Date.now()+480})}
 const MAG={shotgun:3,sniper:5,rifle:30},WEAPONS=['rifle','shotgun','sniper'];
function shoot(r,p,entity,msg){const now=Date.now();if(now<(entity.nextShot||0))return;const police=p.role==='police',weapon=entity.weapon||'rifle',ammo=entity.ammo?.[weapon]??0;if(ammo<=0){send(p.ws,{type:'error',message:`${weapon} empty — press R to reload`});return}
 const ranges={shotgun:4.5,sniper:32,rifle:24},cooldowns={shotgun:700,sniper:1050,rifle:105};entity.nextShot=now+cooldowns[weapon];entity.ammo[weapon]--;
 const aim=msg.aim||{},o=aim.origin||{},v=aim.direction||{},ox=Number(o.x),oy=Number(o.y),oz=Number(o.z),vx=Number(v.x),vy=Number(v.y),vz=Number(v.z),length=Math.hypot(vx,vy,vz),playerX=(entity.x-MAP_CENTER)*WORLD_SCALE,playerZ=(entity.z-MAP_CENTER)*WORLD_SCALE;
 const valid=[ox,oy,oz,vx,vy,vz,length].every(Number.isFinite)&&length>.9&&length<1.1&&Math.hypot(ox-playerX,oz-playerZ)<=8.5&&Math.abs(oy-1.9)<=.45;
 if(!valid){send(p.ws,{type:'error',message:'Aim ray rejected. Re-center the camera and fire again.'});entity.ammo[weapon]++;entity.nextShot=now;return}
 const aimTime=clamp(Number(aim.time)||now,now-180,now),origin={x:ox,y:oy,z:oz},dir={x:vx/length,y:vy/length,z:vz/length},targets=police?r.thieves.filter(t=>t.alive&&!t.escaped):r.birds.filter(b=>b.alive&&b.key===entity.houseId),rangeWorld=ranges[weapon]*WORLD_SCALE,rawHit=rayTarget(origin,dir,targets,rangeWorld,r,entity,police,aimTime);
 const startX=playerX,startY=1.35,startZ=playerZ;
 const hit=(rawHit&&((rawHit.impact.x-startX)*dir.x+(rawHit.impact.z-startZ)*dir.z>0.1))?rawHit:null;
 let maxDist=rangeWorld;
 if(dir.y<-0.001){const dGround=(0.05-startY)/dir.y;if(dGround>0&&dGround<maxDist)maxDist=dGround}
 const steps=Math.max(8,Math.ceil(maxDist*2.5));
 for(let s=1;s<=steps;s++){const d=(s/steps)*maxDist,wx=startX+dir.x*d,wz=startZ+dir.z*d,gx=wx/WORLD_SCALE+MAP_CENTER,gz=wz/WORLD_SCALE+MAP_CENTER;if(blocked(gx,gz,r,entity)){maxDist=d;break}}
 let impact=hit?.impact||{x:startX+dir.x*maxDist,y:Math.max(0.05,startY+dir.y*maxDist),z:startZ+dir.z*maxDist};
 if(weapon==='shotgun'){
  const hits=targets.map(t=>{const pos=positionAt(r,t,aimTime),center={x:(pos.x-MAP_CENTER)*WORLD_SCALE,y:police?1.12:.48,z:(pos.z-MAP_CENTER)*WORLD_SCALE},along=(center.x-ox)*dir.x+(center.y-oy)*dir.y+(center.z-oz)*dir.z,miss=Math.hypot(center.x-(ox+dir.x*along),center.y-(oy+dir.y*along),center.z-(oz+dir.z*along)),spread=(police ? .58 : .42)+Math.max(0,along)*.045;return{t,pos,along,miss,spread}}).filter(q=>q.along>0&&q.along<=rangeWorld&&q.miss<=q.spread).sort((a,b)=>a.along-b.along).filter(q=>clearShot({x:ox/WORLD_SCALE+MAP_CENTER,z:oz/WORLD_SCALE+MAP_CENTER},{x:ox/WORLD_SCALE+MAP_CENTER+dir.x*q.along/WORLD_SCALE,z:oz/WORLD_SCALE+MAP_CENTER+dir.z*q.along/WORLD_SCALE},r,entity,q.t));
  const caughtHits=hits.slice(0,3),caught=caughtHits.map(q=>q.t);if(caughtHits.length){const q=caughtHits[0];impact={x:(q.pos.x-MAP_CENTER)*WORLD_SCALE,y:police?1.12:.48,z:(q.pos.z-MAP_CENTER)*WORLD_SCALE} }for(const q of caughtHits){const t=q.t;t.alive=false;if(police){const v=r.players.find(x=>x.id===t.id);if(v)v.alive=false}else r.droppedKeys.push({id:uid(),key:t.key,x:q.pos.x,z:q.pos.z,ownerId:p.id,picked:false})}if(caught.length)event(r,police?`${p.name} fired the shotgun and caught ${caught.length} thief${caught.length===1?'':'s'}.`:`${p.name} downed the highlighted cock. Its key dropped there — reach it and press E.`);else event(r,`${p.name} fired the shotgun and missed.`)
 }else if(hit){const target=hit.entity;target.alive=false;if(police){const v=r.players.find(x=>x.id===target.id);if(v)v.alive=false;event(r,`${p.name} caught a thief with the ${weapon}.`)}else r.droppedKeys.push({id:uid(),key:target.key,x:hit.position.x,z:hit.position.z,ownerId:p.id,picked:false}),event(r,`${p.name} downed the highlighted cock. Its key dropped there — reach it and press E.`)}else{const wrongBird=!police?rayTarget(origin,dir,r.birds.filter(b=>b.alive&&b.key!==entity.houseId),rangeWorld,r,entity,false,aimTime):null;event(r,wrongBird?`${p.name} aimed at the wrong cock. Follow the green marker for the matching key.`:`${p.name} fired the ${weapon} and missed — center the target in your crosshair and keep a clear line of sight.`)}
 const muzzle={x:entity.x,y:1.35,z:entity.z},end=hit?hit.impact:impact,traceEnd={x:end.x/WORLD_SCALE+MAP_CENTER,y:end.y,z:end.z/WORLD_SCALE+MAP_CENTER};trace(r,muzzle,traceEnd,police?'police':'thief',traceEnd.y,p.id);finishIfDone(r)}
function handleAction(r,p,msg){if(!r||!p)return;if(msg.action==='assignRole'){if(r.status!=='lobby'||p.id!==r.hostId){send(p.ws,{type:'error',message:'Only the host can assign roles in the lobby.'})}else{const target=r.players.find(x=>x.id===msg.playerId&&x.connected),role=msg.role;if(!target||!['police','thief','unassigned'].includes(role)){send(p.ws,{type:'error',message:'Choose a connected player and a valid role.'})}else{const count=r.players.filter(x=>x.connected&&x.id!==target.id&&x.role===role).length,limit=role==='police'?maxPoliceFor(r.players.filter(x=>x.connected).length):role==='thief'?7:10;if(count>=limit)send(p.ws,{type:'error',message:`A game can have up to ${limit} ${role==='police'?'police officers':'thieves'} at this player count.`});else{target.role=role==='unassigned'?null:role;event(r,`${target.name} ${role==='unassigned'?'needs a team assignment':`assigned ${role==='police'?'to the police':'as a thief'}`}.`);broadcast(r)}}}}
 if(msg.action==='start'){if(p.id!==r.hostId)send(p.ws,{type:'error',message:'Only the host can start the game.'});else if(r.status!=='lobby')send(p.ws,{type:'error',message:'The round is already underway.'});else if(!startGame(r))send(p.ws,{type:'error',message:'Assign every player to a team: 1–3 police and 1–7 thieves, with 2–10 players total.'});else broadcast(r)}
 if(msg.action==='reset'&&r.status==='finished'){r.status='lobby';r.cops=[];r.thieves=[];r.birds=[];r.houses=[];r.droppedKeys=[];r.pedestrians=[];r.matchEndsAt=0;r.players.forEach(x=>{x.role=null;x.alive=true;x.escaped=false;x.place=null});event(r,'A new afternoon is waiting.');broadcast(r)}
 if(r.status==='playing'){
  const ent=p.role==='police'?r.cops.find(x=>x.id===p.id):r.thieves.find(x=>x.id===p.id);if(!ent)return;
  if(msg.action==='move'&&(p.role==='police'||ent.alive&&!ent.escaped)){const d=msg.dir||{},facing=Number(msg.facingYaw);if(Number.isFinite(facing))ent.yaw=Math.atan2(Math.sin(facing),Math.cos(facing));ent.backwards=!!d.backwards;move(ent,Number(d.x)||0,Number(d.z??d.y)||0,!!d.sprint,null,r)}
  if(msg.action==='look'&&(p.role==='police'||ent.alive&&!ent.escaped)){const yaw=Number(msg.yaw);if(Number.isFinite(yaw))ent.yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw))}
  if(msg.action==='turn'&&(p.role==='police'||ent.alive&&!ent.escaped)){ent.yaw=(ent.yaw||0)+clamp(Number(msg.delta)||0,-Math.PI,Math.PI);if(msg.walk){ent.backwards=false;move(ent,-Math.sin(ent.yaw),-Math.cos(ent.yaw),!!msg.sprint,null,r)}}
  if(msg.action==='switchWeapon'&&p.role==='police'){const i=WEAPONS.indexOf(ent.weapon),step=Number(msg.delta)<0?-1:1;ent.weapon=WEAPONS[(i+step+WEAPONS.length)%WEAPONS.length];broadcast(r)}
  if(msg.action==='selectWeapon'&&p.role==='police'&&WEAPONS.includes(msg.weapon)){ent.weapon=msg.weapon;broadcast(r)}
  if(msg.action==='reload'){const w=ent.weapon||'rifle';ent.ammo[w]=MAG[w];event(r,`${p.name} reloaded the ${w}.`);broadcast(r)}
  if(msg.action==='shoot'&&(p.role==='police'||ent.alive&&!ent.escaped)){shoot(r,p,ent,msg);broadcast(r)}
  if(msg.action==='interact'&&p.role==='thief'&&ent.alive&&!ent.escaped){const drop=r.droppedKeys.filter(k=>!k.picked&&k.ownerId===p.id&&distance(ent,k)<1.1).sort((a,b)=>distance(ent,a)-distance(ent,b))[0],house=r.houses.find(h=>h.id===ent.houseId);if(drop){drop.picked=true;if(!ent.keys.includes(drop.key))ent.keys.push(drop.key);ent.escapeDeadline=Math.min(Date.now()+60000,r.matchEndsAt);event(r,`${p.name} picked up the key. Reach your house before the red timer expires.`);broadcast(r)}else if(house&&distance(ent,house)<1.05){if(ent.keys.includes(house.id)){ent.escaped=true;house.unlocked=true;ent.rank=r.thieves.filter(t=>t.escaped).length+1;const pl=r.players.find(x=>x.id===p.id);if(pl){pl.escaped=true;pl.place=ent.rank}event(r,`${p.name} escaped home in place ${ent.rank}.`);finishIfDone(r);broadcast(r)}else send(p.ws,{type:'error',message:r.droppedKeys.some(k=>!k.picked&&k.ownerId===p.id)?'Move close to your dropped key and press E to pick it up.':'Your key has not been picked up yet. Shoot your highlighted cock, then press E beside the dropped key.'})}else send(p.ws,{type:'error',message:ent.keys.includes(ent.houseId)?'Find the green-marked house and press E at its door.':'Move close to your dropped key and press E to pick it up.'})}
 }
}
wss.on('connection',ws=>{
 let room=null,player=null;
 ws.on('message',raw=>{
  let msg;try{msg=JSON.parse(raw)}catch{return}
  if(msg.type==='createRoom'){
   if(room){send(ws,{type:'error',message:'You are already in a room.'});return}
   const code=newRoomCode();room=freshRoom(code,msg.map);player={id:uid(),token:msg.token||uid(),name:String(msg.name||'Runner').trim().slice(0,18)||'Runner',ws,connected:true,role:'police',alive:true,escaped:false};room.hostId=player.id;room.players.push(player);rooms.set(code,room);ws.room=room;ws.player=player;event(room,`${player.name} created room ${code}.`);broadcast(room);return
  }
  if(msg.type==='join'){
   if(room){send(ws,{type:'error',message:'You are already in a room.'});return}
   const code=String(msg.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);if(!code){send(ws,{type:'error',message:'Enter a room code.'});return}
   room=rooms.get(code)||freshRoom(code,msg.map);
   if(room.status!=='lobby'&&!room.players.some(x=>x.token===msg.token)){send(ws,{type:'error',message:'This round has already started.'});room=null;return}
   if(!rooms.has(code))rooms.set(code,room);
   const existing=room.players.find(x=>x.token===msg.token);
   if(existing&&room.status==='lobby'){
    player=existing;player.ws=ws;player.connected=true;player.name=String(msg.name||player.name).slice(0,18)
   }else{
    if(room.status!=='lobby'){send(ws,{type:'error',message:'This round has already started.'});room=null;return}
    if(room.players.length>=10){send(ws,{type:'error',message:'This room is full (10 players max).'});room=null;return}
    player={id:uid(),token:msg.token||uid(),name:String(msg.name||'Runner').trim().slice(0,18)||'Runner',ws,connected:true,role:null,alive:true,escaped:false};
    if(!room.hostId){room.hostId=player.id;player.role='police'}else{const cops=room.players.filter(x=>x.role==='police').length,thieves=room.players.filter(x=>x.role==='thief').length;player.role=thieves<7?'thief':cops<3?'police':null}
    room.players.push(player)
   }
   ws.room=room;ws.player=player;event(room,`${player.name} joined the lobby.`);broadcast(room);return
  }
  if(msg.type==='action')handleAction(room,player,msg)
 });
 ws.on('close',()=>{
  if(!room||!player||player.ws!==ws)return;
  player.connected=false;player.ws=null;event(room,`${player.name} disconnected.`);broadcast(room);
  if(room.players.every(x=>!x.connected)&&rooms.get(room.code)===room)rooms.delete(room.code)
 })
});
setInterval(()=>{const now=Date.now();for(const r of rooms.values())if(r.status==='playing'){
 if(now>=r.matchEndsAt){for(const t of r.thieves)if(t.alive&&!t.escaped){t.alive=false;const pl=r.players.find(x=>x.id===t.id);if(pl)pl.alive=false}event(r,'Three minutes are up. The remaining thieves were caught by the city patrol.');finishIfDone(r);broadcast(r);continue}
 for(const t of r.thieves)if(t.alive&&!t.escaped&&t.escapeDeadline&&now>=t.escapeDeadline){t.alive=false;const pl=r.players.find(x=>x.id===t.id);if(pl)pl.alive=false;event(r,`${pl?.name||'A thief'} ran out of time and was caught.`)}finishIfDone(r);if(r.status!=='playing'){broadcast(r);continue}
 for(const b of r.birds)if(b.alive){b.phase+=.055;const bx=b.x,bz=b.z,nearest=r.thieves.filter(t=>t.alive&&!t.escaped).sort((a,c)=>distance(b,a)-distance(b,c))[0],near=nearest&&distance(b,nearest)<6;if(near){const run=chooseBirdRun(b,nearest,r);if(run){b.yaw=Math.atan2(-run.vx,-run.vz);move(b,run.vx,run.vz,false,.065,r)}}else{const target=b.phase;b.yaw=target;move(b,-Math.sin(target)*.05,-Math.cos(target)*.05,false,.05,r)}if(Math.abs(b.x-bx)+Math.abs(b.z-bz)<.001){b.phase+=Math.PI/2;b.yaw=b.phase}}
 for(const n of r.pedestrians){if(now>n.turnAt){n.yaw=Math.round(rand(0,4))*Math.PI/2;n.turnAt=now+rand(1800,5200)}const dx=-Math.sin(n.yaw),dz=-Math.cos(n.yaw),bx=n.x,bz=n.z;move(n,dx,dz,false,n.speed,r);if(Math.abs(n.x-bx)+Math.abs(n.z-bz)<.002){n.yaw+=Math.PI/2;n.turnAt=now+500}}
 rememberPositions(r,now);r.tracers=r.tracers.filter(t=>t.expires>now);if(now-r.lastBroadcast>=30)broadcast(r)
 }},33);
server.listen(PORT,()=>console.log(`Nocturna on http://localhost:${PORT}`));
