import fs from 'node:fs';import path from 'node:path';import policy from './curated-forget.cjs';
import autoPolicy from './auto-policy.cjs';
const requirePrevious=autoPolicy.previousWithdrawal;
import {nativeUserText as text,timeSnapshot} from './native-user.mjs';
const ok=s=>s&&s.header?.id===s.id&&s.inheritedEventCount===0&&!s.header.origin&&!s.header.parentSession&&!s.header.isSeeded&&path.isAbsolute(s.header.cwd);
export function registerForget(ctx,useDB){const frames=new WeakMap(),profile=()=>ctx.get('profileContext')?.name;
ctx.on('agent/inbox/claimed',({agent,message,turn})=>{const s=ctx.sessions.get(agent.id);if(!s)return;const prev=frames.get(s);frames.delete(s);if(!ok(s)||!Number.isSafeInteger(turn))return;const raw=text(message);try{frames.set(s,{turn,agent,multi:prev?.turn===turn,target:policy.request(raw)??(requirePrevious(raw)?{previous:true}:null),raw,id:message.id,profile:profile(),project:fs.realpathSync.native(s.header.cwd)});}catch{}});
function live(s,f){return ok(s)&&f?.profile&&profile()===f.profile&&fs.realpathSync.native(s.header.cwd)===f.project&&ctx.sessions.get(s.id)===s;}
function matches(s,f,i){const e=s.eventAt(i);return e?.seq===i&&s.isOwnSeq(i)&&e.type==='user/message'&&e.surfaceOp==='append'&&e.sourceEventSeqs===undefined&&e.data.id===f.id&&text(e.data)===f.raw;}
ctx.on('session/event',(s,e)=>{const f=frames.get(s);if(!f)return;if(e.type==='turn/end'||(e.type==='turn/start'&&e.data.turn!==f.turn)){frames.delete(s);return;}if(e.type!=='user/message')return;if(timeSnapshot(e)||['runtime-context','skill-catalog'].includes(e.data?.source?.kind))return;try{if(f.seq!==undefined||!live(s,f)||!matches(s,f,e.seq)){frames.delete(s);return;}f.seq=e.seq;}catch{frames.delete(s);}});
async function forgetExact(db,s,f,exec){
 const raw=f.target.literal,hit=db.historyLiteralTarget(raw);
 if(!hit)return db.forgetRequested(f.raw);if(hit.status)return hit;
 const {sid,seq}=hit,svc=ctx.get('sessionPersistence'),identity=svc?.identity;
 const current=()=>frames.get(s)===f&&live(s,f)&&matches(s,f,f.seq)&&!exec.signal?.aborted;
 const scoped=h=>h?.id===sid&&!h.isSeeded&&!h.origin&&!h.parentSession&&fs.realpathSync.native(h.cwd)===f.project;
 const valid=e=>e?.seq===seq&&e.type==='user/message'&&e.surfaceOp==='append'&&e.sourceEventSeqs===undefined&&text(e.data)===raw&&(hit.archiveId===null||hit.archiveTime===e.time);
 const fail={deleted:false,status:'unavailable'};
 if(sid===s.id){if(seq>=f.seq||!s.isOwnSeq(seq)||!valid(s.eventAt(seq)))return fail;}
 else {if(!identity)return fail;const signal=exec.signal?AbortSignal.any([exec.signal,AbortSignal.timeout(1200)]):AbortSignal.timeout(1200);
 const first=await svc.stat(sid,{signal});if(!first?.revision||first.formatStatus==='migration-required'||!scoped(first.header))return fail;
 const h=await svc.open(sid,'read',{signal});try{if(h.access!=='read'||h.id!==sid||h.inheritedEventCount!==0||!scoped(h.header))return fail;const {events}=await h.read(seq,1,{signal});if(events?.length!==1||!valid(events[0]))return fail;}finally{await h.close();}
 const last=await svc.stat(sid,{signal});if(last?.revision!==first.revision||!scoped(last.header)||ctx.get('sessionPersistence')?.identity!==identity||signal.aborted)return fail;}
 if(!current())return fail;return db.revokeVerifiedLiteral(raw,sid,seq,hit.archiveId,hit.archiveTime,hit.linkedId);
}
ctx.tools.register({name:'stm_forget',description:'On a current explicit request to forget a specific memory, call {}. The host resolves only the authorized target. Only deleted:true confirms success. Otherwise say not deleted; never invent success or reveal candidate details.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(args,exec){const no=status=>JSON.stringify({deleted:false,status,message:status==='ambiguous'?'未删除：无法唯一确定。不要重复提交相同原句。若你在保存回执里能确认目标记忆 ID，请另发“删除记忆”加该 ID。没有可确认的 ID 就先保留，不要猜。':'未删除；不得声称已删除。若要指定，请用户另发：删除原话：「完整原句」，或 把包含「可区分的连续原文」的那条记忆删除。不要代填原文。'});try{const s=ctx.sessions.get(exec?.agent?.id),f=frames.get(s);if(!f?.target||!live(s,f)||f.agent!==exec.agent||f.multi||f.seq===undefined||!matches(s,f,f.seq)||exec.signal?.aborted)return no('not_requested');if(!args||Array.isArray(args)||Object.keys(args).some(k=>k!=='id')||(Object.hasOwn(args,'id')&&args.id!==(f.target.id??f.target.label)))return no('target_mismatch');if(f.target.previous){const done=useDB(s,false,db=>db.resolvedWithdrawal(s.id,f.seq,f.raw));return done?JSON.stringify({deleted:true,status:'deleted'}):no('unavailable');}const pending=f.result??=useDB(s,false,db=>f.target.literal?forgetExact(db,s,f,exec):db.forgetRequested(f.raw))??{status:'not_found',deleted:false};const result=await pending;return result.deleted?JSON.stringify(result):no(result.status);}catch{return no('unavailable');}}});
// Read gates consume only the authenticated, still-current human envelope.
return exec=>{try{const s=ctx.sessions.get(exec?.agent?.id),f=frames.get(s);if(!f||typeof f.raw!=='string'||!live(s,f)||f.agent!==exec.agent||f.multi||f.seq===undefined||!matches(s,f,f.seq)||exec.signal?.aborted)return false;return !policyReadDenied(f.raw);}catch{return false;}};
}
export function policyReadDenied(raw){const t=raw.normalize('NFKC').replace(/[\s\u200B-\u200D\uFEFF]/gu,'');return /(?:不(?:要|用|许|必)?|别|禁止|无需)(?:再|去)?(?:参考|参照|查(?:询|阅|看|找)?|搜(?:索)?|检索|调取|翻(?:阅)?|读取|使用|用到|依据|结合|考虑|调用|动用)(?:我|本人|个人|以往|以前|过去|历史|之前|任何|记忆|记录|旧|聊天|本工作区|工作区)/u.test(t);}
