// rc.5's JSONL index spans profiles. A log's presence, title, UUID or cwd alone is not a profile grant.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
export const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const title=t=>typeof t==='string'&&t.trim()&&t.isWellFormed()&&t.length<=4096?t:null;
const absHome=()=>{const h=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');if(!path.isAbsolute(h))throw Error('Absolute home required');return path.join(h,'data','dsh-standalone-memory');};
const rc=s=>fs.realpathSync.native(s);
export const rootSession=s=>!!s&&s.id===s.header?.id&&typeof s.id==='string'&&s.id.trim()&&s.id.length<=512&&!s.header.origin&&!s.header.parentSession&&!s.header.isSeeded&&s.inheritedEventCount===0&&path.isAbsolute(s.header.cwd??'');
// Observe a freshly born log, not session/created alone (also emitted on restoration).
export function profileReceipts(ctx){const owner=ctx.get('profileContext')?.name,dir=absHome(),file=path.join(dir,'catalog-'+hash(owner)+'.sqlite');const same=()=>typeof owner==='string'&&!!owner.trim()&&ctx.get('profileContext')?.name===owner;
 const dbCall=(write,fn)=>{if(!same()||!write&&!fs.existsSync(file))return; if(write)fs.mkdirSync(dir,{recursive:true,mode:0o700});const db=new DatabaseSync(file,{readOnly:!write});try{if(write)db.exec('PRAGMA busy_timeout=3000;CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,cwd TEXT NOT NULL,born INTEGER NOT NULL,title TEXT) STRICT');return fn(db);}finally{db.close();}};
 const newborn=new WeakSet();ctx.on?.('session/created',s=>{if(same()&&rootSession(s)&&ctx.sessions.get(s.id)===s&&s.seq===0)newborn.add(s);});
 ctx.on?.('session/event',(s,e)=>{if(!same()||!rootSession(s)||ctx.sessions.get(s.id)!==s||!Number.isSafeInteger(s.header.createdAt)||e?.seq!==0&&e?.type!=='session/title'||!s.isOwnSeq(e.seq))return;try{const cwd=rc(s.header.cwd),born=s.header.createdAt;dbCall(true,db=>{if(e.seq===0&&newborn.delete(s))db.prepare('INSERT OR IGNORE INTO receipts VALUES(?,?,?,NULL)').run(s.id,cwd,born);if(e.type==='session/title')db.prepare('UPDATE receipts SET title=? WHERE id=? AND cwd=? AND born=?').run(title(e.data?.title),s.id,cwd,born);});}catch{/* Catalogue failure must not interrupt a conversation. */}});
 return {owner,same,all:()=>dbCall(false,db=>db.prepare('SELECT * FROM receipts').all())??[],get:id=>dbCall(false,db=>db.prepare('SELECT * FROM receipts WHERE id=?').get(id)),flags:(cwd,ids)=>{const file=path.join(dir,hash([owner,cwd])+'.sqlite');if(!same()||!fs.existsSync(file))return [];const db=new DatabaseSync(file,{readOnly:true});try{if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='isolated_session_v1'").get())return [];const q=db.prepare('SELECT 1 FROM isolated_session_v1 WHERE workspace=? AND sid=?');return ids.map(id=>!!q.get(cwd,id));}finally{db.close();}}};}
export function nativeDirectory(ctx,receipts){const {owner,same}=receipts,service=ctx.sessions,auth=new WeakMap();const loaded=id=>{if(!same())return null;const s=service.get(id);return rootSession(s)&&s.id===id&&ctx.sessions.get(id)===s?s:null;};
 const nativeTitle=(header,fallback)=>{try{const v=ctx.get('sessionProjectionCache')?.cachedSnapshot(header,['title'])?.values?.title;return title(v)??title(fallback);}catch{return title(fallback);}};
 const liveRow=s=>{try{if(loaded(s.id)!==s)return null;const cwd=rc(s.header.cwd),receipt=receipts.get(s.id);return {id:s.id,cwd,title:nativeTitle(s.header,receipt?.cwd===cwd&&receipt.born===s.header.createdAt?receipt.title:null),loaded:true,s};}catch{return null;}};
 const match=(h,r)=>r&&h?.id===r.id&&h.createdAt===r.born&&rootSession({id:r.id,header:h,inheritedEventCount:0})&&rc(h.cwd)===r.cwd;
 const persist=()=>ctx.get('sessionPersistence');async function rows(){if(!same())throw Error('profile changed');const out=new Map();for(const s of service.list()){const row=liveRow(s);if(row)out.set(s.id,row);}const permits=new Map(receipts.all().map(r=>[r.id,r]));if(permits.size){const p=persist();if(p?.identity){const snaps=await p.list({signal:AbortSignal.timeout(10000)});if(!same()||persist()?.identity!==p.identity)throw Error('stale index');const seen=new Set();for(const snap of snaps){const id=snap.header?.id;if(out.get(id)?.loaded||service.get(id)||!permits.has(id))continue;if(seen.has(id)){out.delete(id);continue;}seen.add(id);const r=permits.get(id);try{if(snap.formatStatus==='current'&&snap.revision&&match(snap.header,r))out.set(id,{id,cwd:r.cwd,title:nativeTitle(snap.header,r.title),loaded:false,revision:snap.revision});}catch{/* Inaccessible workspace. */}}}}return [...out.values()].sort((a,b)=>a.id.localeCompare(b.id));}
 async function groups(){const m=new Map();for(const row of await rows()){const workspaceId=hash([owner,row.cwd]);if(!m.has(workspaceId))m.set(workspaceId,{workspaceId,cwd:row.cwd,sessions:[]});m.get(workspaceId).sessions.push(row);}return m;}
 // This catalogue is metadata for the two owner management pages only. Never feed
 // its rows into catalog(), select(), model tools, or a restoration/open API.
 async function managementGroups(){
  if(!same())throw Error('profile changed');
  const p=persist(),snaps=p?.identity?await p.list({signal:AbortSignal.timeout(10000)}):[];
  if(!same()||p?.identity!==persist()?.identity)throw Error('stale index');
  const permits=new Map(receipts.all().map(r=>[r.id,r])),m=new Map(),byId=new Map(),liveIds=new Set();
  function bucket(cwd){if(typeof cwd!=='string'||!cwd.isWellFormed()||!path.isAbsolute(cwd))return null;const workspaceId=hash([owner,cwd]);if(!m.has(workspaceId))m.set(workspaceId,{workspaceId,cwd,sessions:[]});return m.get(workspaceId);}
  function add({header:h,loaded,snap,s}){
   if(!h)return;const id=h.id;let cwd=h.cwd,reason=null,owned=null;
   if(typeof id!=='string'||!id.trim()||!id.isWellFormed()||id.length>512){bucket(cwd);return;}
   const refs=byId.get(id)??[];
   const live=service.get(id);
   if(refs.length>1||loaded&&refs.length===1&&(refs[0].header.cwd!==cwd||refs[0].header.createdAt!==h.createdAt)||!loaded&&live)reason='ambiguous_session';
   else if(h.origin||h.parentSession||h.isSeeded||loaded&&s.inheritedEventCount!==0||h.delegationDepth>0)reason='derived_session';
   else if(!loaded&&(snap.formatStatus!=='current'||!snap.revision)||loaded&&refs[0]?.formatStatus&&refs[0].formatStatus!=='current')reason='unsupported_session';
   else if(loaded){owned=liveRow(s);if(!owned)reason='workspace_unavailable';}
   else {const r=permits.get(id);try{if(match(h,r))owned={id,cwd:r.cwd,loaded:false,revision:snap.revision};else reason='profile_unverified';}catch{reason='workspace_unavailable';}}
   if(owned)cwd=owned.cwd;const g=bucket(cwd);if(!g)return;
   const r=permits.get(id);const row={...owned,id,cwd,title:owned?.title??nativeTitle(h,owned&&r&&r.born===h.createdAt&&r.cwd===cwd?r.title:null),loaded,actionable:!reason,reason};
   if(!g.seen)g.seen=new Set();if(!g.seen.has(id)){g.seen.add(id);g.sessions.push(row);}
  }
  for(const snap of snaps){const id=snap?.header?.id;if(!byId.has(id))byId.set(id,[]);byId.get(id).push(snap);}
  for(const s of service.list()){if(s?.id===s?.header?.id&&service.get(s.id)===s){liveIds.add(s.id);add({header:s.header,loaded:true,s});}}
  for(const snap of snaps){if(!liveIds.has(snap?.header?.id)||byId.get(snap.header.id).length>1||service.get(snap.header.id)?.header.cwd!==snap.header.cwd)add({header:snap?.header,loaded:false,snap});}
  // WorkspaceRegistry supplies registered workspaces (including zero sessions)
  // and native membership hints. A registry-only session id is not a grant.
  const registry=ctx.get('workspaceRegistry'),entities=await registry?.list()??[];
  if(!same()||p?.identity!==persist()?.identity)throw Error('stale index');
  for(const entity of entities){const g=bucket(entity?.path);if(!g)continue;g.displayName=title(entity.title);const ids=entity.sessionIds;if(!Array.isArray(ids))continue;g.seen??=new Set();for(const id of ids){if(typeof id!=='string'||!id.trim()||!id.isWellFormed()||id.length>512||g.seen.has(id))continue;g.seen.add(id);g.sessions.push({id,cwd:g.cwd,title:null,loaded:false,actionable:false,reason:'unsupported_session'});}}
  for(const g of m.values()){delete g.seen;g.sessions.sort((a,b)=>a.id.localeCompare(b.id));}return m;
 }
 // Resolve presentation metadata only for an already authorized, paginated query row.
 async function workspaceTitle(cwd){
  if(!same())throw Error('profile changed');
  let entity;
  try{entity=await ctx.get('workspaceRegistry')?.resolveByPath?.(cwd);}catch{/* Missing workspace metadata falls back to the path label. */}
  if(!same())throw Error('profile changed');
  return entity?.path===cwd?title(entity.title):null;
 }
 const valid=s=>{const c=auth.get(s);if(!c)return loaded(s?.id)===s;const r=receipts.get(s.id);return same()&&persist()?.identity===c.identity&&!service.get(s.id)&&match(s.header,r)&&r.cwd===c.cwd;};
 const recheck=async s=>{if(!valid(s))return false;const c=auth.get(s);if(!c)return true;const snap=await persist().stat(s.id,{signal:AbortSignal.timeout(5000)});return snap?.revision===c.rev&&snap.formatStatus==='current'&&valid(s)&&match(snap.header,receipts.get(s.id));};
 async function resolve(row){if(row.loaded)return loaded(row.id)===row.s&&rc(row.s.header.cwd)===row.cwd?row.s:null;const p=persist(),r=receipts.get(row.id),signal=AbortSignal.timeout(15000),current=()=>same()&&persist()?.identity===p?.identity&&!service.get(row.id);if(!r||!p?.identity||r.cwd!==row.cwd||!current())return null;const snap=await p.stat(row.id,{signal});if(!current()||snap?.revision!==row.revision||snap.formatStatus!=='current'||!match(snap.header,r))return null;
 const h=await p.open(row.id,'read',{signal}),events=[];try{if(!current()||h.id!==row.id||h.access!=='read'||h.inheritedEventCount!==0||!match(h.header,r))return null;for(;;){const page=await h.read(events.length,128,{signal});if(!current()||!Array.isArray(page.events)||page.events.length>128||events.length+page.events.length>250000)return null;for(const e of page.events){if(e?.seq!==events.length)return null;events.push(e);}if(page.events.length<128)break;}}finally{await h.close();}
 const s={id:row.id,header:snap.header,inheritedEventCount:0,seq:events.length,isOwnSeq:n=>Number.isSafeInteger(n)&&n>=0&&n<events.length,eventAt:n=>events[n]};auth.set(s,{rev:row.revision,identity:p.identity,cwd:r.cwd});return await recheck(s)?s:null;}
 return {select:async(id,op)=>{const s=loaded(id);if(s||!op||!same())return s;const r=(await rows()).find(r=>r.id===id);return r?resolve(r):null;},catalog:async page=>{const all=await rows();return {items:all.slice((page-1)*20,page*20).map(({id,cwd,title,loaded})=>({id,cwd,title,loaded})),page,nextPage:page*20<all.length?page+1:null};},directory:{groups,managementGroups,workspaceTitle,resolve,valid,recheck,flags:receipts.flags,owns:s=>auth.has(s)&&valid(s)}};}
