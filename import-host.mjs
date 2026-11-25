import fs from 'node:fs';
import path from 'node:path';
import policy from './auto-policy.cjs';

const command='确认导入本会话可见原文';
export const isImportCommand=text=>text===command;
const controls=new Set([command,'开启本工作区对话归档','查询本工作区对话归档状态','恢复本工作区未来助手归档']);
const MAX_EVENTS=8192, MAX_UNITS=2*1024*1024, MAX_MESSAGE=65536;
const exact=(o,...keys)=>!!o&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const native=e=>e.surfaceOp==='append'&&e.sourceEventSeqs===undefined;
const clean=s=>s?.id&&s.id===s.header?.id&&!s.header.origin&&!s.header.parentSession&&!s.header.isSeeded&&s.inheritedEventCount===0&&path.isAbsolute(s.header.cwd??'');
const own=(s,i)=>{const e=s.eventAt(i);return s.isOwnSeq(i)&&e?.seq===i?e:null;};
const textBlock=b=>exact(b,'type','text')&&b.type==='text'&&typeof b.text==='string';
import {nativeUserText as user,timeSnapshot} from './native-user.mjs';
function final(e,end,done){
 const d=e?.data,m=d?.message,stop=d?.stream?.at(-1);
 if(e?.type!=='assistant/message'||!native(e)||d.interrupted||m?.role!=='assistant'||m.source?.kind!=='model'||typeof m.id!=='string'||!m.id||!Array.isArray(m.content)||!m.content.every(b=>textBlock(b)||['thinking','reasoning'].includes(b?.type))||stop?.type!=='chunk'||stop.chunk?.type!=='finish'||stop.chunk.reason!=='stop')return null;
 if(end?.type!=='step/end'||end.data.turn!==done.data.turn||d.turn!==done.data.turn||end.data.step!==d.step||done.data.reason?.kind!=='completed')return null;
 const blocks=m.content.filter(textBlock);return blocks.length?blocks.map(b=>b.text).join(''):null;
}
const denied=()=>({status:'not_requested'});
// Read the original reopened session, never list sessions, read files, assemble prompts,
// or consume a derived surface. Validate the *entire* prefix before any SQLite write.
function collect(s,stop){
 if(stop>MAX_EVENTS)return {status:'limit'};
 const turns=[];let t=null,units=0;
 for(let i=0;i<stop;i++){
  const e=own(s,i);if(!e||e.sourceEventSeqs!==undefined||e.surfaceOp&&e.surfaceOp!=='append')return {status:'unverified_source'};
  if(e.type==='turn/start'){t={turn:e.data.turn,count:0};continue;}
  if(e.type==='user/message'){
   if(timeSnapshot(e)||['runtime-context','skill-catalog'].includes(e.data?.source?.kind))continue;
   if(e.data?.source?.kind!=='user'){if(t)t.mixed=true;continue;}
   const text=native(e)?user(e.data):null;
   // An opaque owner message could itself be a withdrawal. Do not import even a prefix.
   if(text===null)return {status:'unverified_source'};
   units+=text.length;if(units>MAX_UNITS||text.length>MAX_MESSAGE)return {status:'limit'};
   if(text==='关闭本工作区对话归档'||policy.ongoingArchiveRefusal(text)||policy.historyDirective(text,'archive')!=='allow')return {status:'privacy_boundary'};
   if(t){t.count++;if(!controls.has(text))t.user={seq:i,ts:e.time,text};}
  }
  if(e.type==='turn/end'){
   if(t?.turn===e.data.turn&&t.count===1&&!t.mixed&&t.user&&e.data.reason?.kind==='completed'){
    const a=own(s,i-2),end=own(s,i-1),text=final(a,end,e),row={user:t.user};
    if(text&&text.length<=MAX_MESSAGE&&a.seq>t.user.seq&&policy.historyDirective(text,'archive')==='allow'&&!policy.ongoingArchiveRefusal(text)){
     units+=text.length;if(units>MAX_UNITS)return {status:'limit'};row.assistant={seq:a.seq,ts:a.time,text};
    }turns.push(row);
   }t=null;
  }
 }return {turns};
}
export function importSelected(s,db,getSince){if(!clean(s))return {status:'unverified_source'};const st=db.archiveStatus(),since=getSince();if(!st.enabled||!Number.isSafeInteger(since)||since<0)return {status:'disabled'};const scan=collect(s,s.seq);if(!scan.turns)return scan;return {status:'ok',inserted:db.archiveImportTurns({epoch:st.epoch,sid:s.id,turns:scan.turns,since}),destination:'archive_only'};}
export function registerImport(ctx,withStore,{enabled=false,getImportSince=()=>0}={}){
 if(enabled!==true)return;
 const claims=new WeakMap();const profile=()=>ctx.get('profileContext')?.name;
 const bound=(s,f)=>clean(s)&&ctx.sessions.get(s.id)===s&&profile()===f.profile&&fs.realpathSync.native(s.header.cwd)===f.project;
 ctx.on('agent/inbox/claimed',({agent,message,turn})=>{
  const s=ctx.sessions.get(agent?.id);if(!s)return;const prior=claims.get(s);claims.delete(s);
  if(!clean(s)||!Number.isSafeInteger(turn)||!profile())return;
  const f={turn,grant:false};claims.set(s,f);
  if(prior?.turn===turn||!isImportCommand(user(message)))return;
  try{Object.assign(f,{agent,id:message.id,profile:profile(),project:fs.realpathSync.native(s.header.cwd),grant:true});}catch{f.grant=false;}
 });
 ctx.on('session/event',(s,ev)=>{
  const f=claims.get(s);if(!f?.grant)return;
  try{const e=own(s,ev.seq);if(!e||e.type!==ev.type||!bound(s,f)||e.type==='turn/end'||e.type==='turn/start'&&e.data.turn!==f.turn){f.grant=false;return;}
   if(e.type==='user/message'&&!timeSnapshot(e)&&!['runtime-context','skill-catalog'].includes(e.data?.source?.kind)){
    if(f.seq!==undefined||!native(e)||e.data.id!==f.id||!isImportCommand(user(e.data))){f.grant=false;return;}
    f.seq=e.seq;const st=withStore(s,false,db=>db.archiveStatus());f.epoch=st===undefined?'default-daily':st.enabled?st.epoch:null;
   }
  }catch{f.grant=false;}
 });
 ctx.tools.register({name:'stm_import_session',description:'Only on the owner’s current exact command 确认导入本会话可见原文, call {} to import the permitted visible archive of this original session. No session selector. Report the returned status and inserted count; never report a curated fact.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(args,exec){
  try{const s=ctx.sessions.get(exec?.agent?.id),f=claims.get(s),e=f?.seq===undefined?null:own(s,f.seq);
   if(!exact(args)||Array.isArray(args)||!f?.grant||!bound(s,f)||f.agent!==exec.agent||exec.signal?.aborted||!e||!native(e)||e.type!=='user/message'||e.data.id!==f.id||!isImportCommand(user(e.data)))return JSON.stringify(denied());
   if(!f.epoch)return JSON.stringify({status:'disabled'});
   const boundary=getImportSince();if(!Number.isSafeInteger(boundary)||boundary<0)return JSON.stringify({status:'disabled'});
   if(f.receipt)return JSON.stringify(f.receipt);
   const scan=collect(s,f.seq);if(!scan.turns)return JSON.stringify(scan);
   const out=withStore(s,true,db=>{const st=db.archiveStatus();if(!st.enabled||st.epoch!==f.epoch)return {status:'disabled'};
    const since=getImportSince();if(!Number.isSafeInteger(since)||since<0)return {status:'disabled'};
    const inserted=db.archiveImportTurns({epoch:f.epoch,sid:s.id,turns:scan.turns,since});return {status:'ok',inserted,scope:'this_original_session',destination:'archive_only'};});
   if(out.status==='ok')f.receipt=out;return JSON.stringify(out);
  }catch{return JSON.stringify({status:'unavailable'});}
 }});
}
