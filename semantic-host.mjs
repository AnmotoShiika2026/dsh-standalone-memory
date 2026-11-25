import fs from 'node:fs';
import path from 'node:path';
import policy from './auto-policy.cjs';
import engine from './semantic.cjs';
import {policyReadDenied} from './forget-host.mjs';
const eligible=s=>s?.header&&!s.header.origin&&!s.header.parentSession&&path.isAbsolute(s.header.cwd??'');
import {nativeUserAppend as native} from './native-user.mjs';
import {nativeUserText as plain} from './native-user.mjs';
export function semanticRequest(q){if(typeof q!=='string'||q.length>512||/(?:不要|别|禁止|不许|不准)\s*(?:再|去)?\s*(?:查|搜|检索|读取)|\b(?:do not|don't|don’t|never)\s+(?:search|look up|retrieve|read|query)\b/iu.test(q)||policyReadDenied(q)||policy.historyDirective(q,'request')!=='allow')return null;
 const m=/^(?:(?:请|请帮我)?(?:在|从)?(?:本|这个|当前)(?:项目|工作区)(?:的精选记忆)?(?:中|里)?(?:按语义(?:搜索|检索|查找|回顾)|语义(?:检索|搜索|回顾))|(?:please )?semantic(?:ally search| search) (?:in )?(?:this|the current) (?:project|workspace))\s*[:：]\s*([^\r\n<>]{1,256})$/iu.exec(q);return m ? rankText(m[1].trim()) || null : null;}
// Rank-text only; never normalize the genuine user message or rerun authorization on a shortened request.
const answerTails=['请回答所问物品的位置；没有可用依据就说明。','请直接回答这个问题；没有可用依据就说明。',' Please answer with the location of the item asked about; if there is no supporting evidence, say so.',' Please answer the question directly; if there is no supporting evidence, say so.'];
function rankText(q){for(const tail of answerTails){if(!q.endsWith(tail))continue;const topic=q.slice(0,-tail.length);
 // Conservative simple-question grammar: do not reinterpret quotations, code, compound questions or other punctuation.
 if(/^[\p{L}\p{N}][\p{L}\p{N} ，,]{0,200}[?？]$/u.test(topic))return topic;
 }return q;}
const empty=status=>({status,scope:'permitted_curated_current_workspace',claimStatus:'candidates_only',candidates:[]});
// Only open a permit-bearing source id from a curated row. Scan the bounded tail
// for withdrawals, in a stable revision, without walking session directories.
async function cold(ctx,s,db,p,budget,live){
 const svc=ctx.get?.('sessionPersistence'),sid=p.sessionId,signal=budget.signal;
 if(!svc?.identity||!live()||signal.aborted||budget.left<=0)return;
 const project=fs.realpathSync.native(s.header.cwd),same=h=>h?.id===sid&&!h.origin&&!h.parentSession&&!h.isSeeded&&path.isAbsolute(h.cwd??'')&&fs.realpathSync.native(h.cwd)===project;
 const snap=await svc.stat(sid,{signal});if(!snap?.revision||snap.formatStatus==='migration-required'||!same(snap.header))return;
 const h=await svc.open(sid,'read',{signal});let first;try{if(h.id!==sid||h.access!=='read'||h.inheritedEventCount!==0||!same(h.header))return;
 for(let i=p.seq;;){if(!live()||signal.aborted||budget.left<=0)return;const n=Math.min(budget.left,32),{events}=await h.read(i,n,{signal});if(!Array.isArray(events)||events.length>n)return;budget.left-=Math.max(1,events.length);
 for(const e of events){if(e?.seq!==i++)return;if(!first)first=e;if(e.type!=='user/message'||e.data?.source?.kind!=='user')continue;const raw=plain(e.data);if(!native(e)||!raw||raw.length>16000||(budget.units-=raw.length)<0)return;if(e.seq>p.seq&&policy.historyDirective(raw)==='retract'&&!db.resolvedWithdrawal(sid,e.seq,raw))return;}if(events.length<n)break;}
 }finally{await h.close();}const after=await svc.stat(sid,{signal});if(live()&&!signal.aborted&&ctx.get?.('sessionPersistence')?.identity===svc.identity&&after?.revision===snap.revision&&same(after.header))return first;
}
function snapshot(db,id){const r=db.read(id,0,256),[hit]=db.automaticEvidenceRow(id);if(hit?.summary&&hit.state==='active'&&(!hit.expires||hit.expires>Date.now())&&r?.state==='active'&&r.claimStatus!=='disputed'&&r.nextOffset===null&&r.text.startsWith(hit.summary)&&r.source?.kind==='host-user-quote')return r;}
export async function verifySemantic(ctx,s,db,id,budget,live){
 const r=snapshot(db,id);if(!r)return;const p=r.source;let e;
 if(s.id===p.sessionId){if(!s.isOwnSeq(p.seq))return;e=s.eventAt(p.seq);}else{try{e=await cold(ctx,s,db,p,budget,live);}catch{return;}}
 const raw=plain(e?.data);if(!native(e)||e.seq!==p.seq||!raw||p.block!==0||!Number.isSafeInteger(p.utf16Offset)||p.utf16Offset<0||p.utf16Length!==r.text.length||raw.slice(p.utf16Offset,p.utf16Offset+p.utf16Length)!==r.text||!db.historyAllowed(p.sessionId,p.seq,raw))return;
 return {id,text:r.text,source:p,raw};
}
export function registerSemantic(ctx,withStore,getProfile,rank=engine.semanticCandidates){
 const frames=new WeakMap();
 ctx.on('agent/inbox/claimed',({agent,message,turn})=>{const s=ctx.sessions.get(agent.id);if(!eligible(s))return;frames.delete(s);const raw=plain(message),query=semanticRequest(raw);if(query)frames.set(s,{raw,query,id:message.id,turn});});
 ctx.on('session/event',(s,e)=>{const f=frames.get(s);if(!f)return;if(e.type==='turn/end'||(e.type==='turn/start'&&f.turn!==e.data.turn)){frames.delete(s);return;}if(e.type!=='user/message'||e.data?.source?.kind!=='user')return;if(f.seq===undefined&&native(e)&&s.isOwnSeq(e.seq)&&e.data.id===f.id&&plain(e.data)===f.raw)f.seq=e.seq;else frames.delete(s);});
 ctx.tools.register({name:'stm_semantic',description:'Only on an explicit current-project semantic search, e.g. 请在本项目语义检索：问题. Return up to two untrusted candidate quotations, never a current value. No arguments.',parameters:{type:'object',properties:{},additionalProperties:false,required:[]},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(args,exec){
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw Error('stm_semantic takes no arguments');
 try{const s=ctx.sessions.get(exec?.agent?.id),f=frames.get(s),profile=getProfile();if(!eligible(s)||s.id!==exec.agent.id||f?.seq===undefined||f.used||typeof profile!=='string'||!profile.trim())return JSON.stringify(empty('not_requested'));
 const workspace=fs.realpathSync.native(s.header.cwd);const live=()=>{const e=s.eventAt(f.seq);return !exec.signal?.aborted&&ctx.sessions.get(s.id)===s&&frames.get(s)===f&&getProfile()===profile&&fs.realpathSync.native(s.header.cwd)===workspace&&s.isOwnSeq(f.seq)&&native(e)&&e.data.id===f.id&&plain(e.data)===f.raw;};
 if(!live())return JSON.stringify(empty('not_requested'));f.used=true;
 const deadline=AbortSignal.timeout(1800),budget={left:512,units:65536,signal:exec.signal?AbortSignal.any([exec.signal,deadline]):deadline};
 const rows=await withStore(s,async db=>{const items=[];for(const id of db.semanticPool(64)){if(!live()||budget.signal.aborted)break;const r=await verifySemantic(ctx,s,db,id,budget,live);if(r)items.push(r);}return items;})??[];
 if(!rows.length)return JSON.stringify(empty('no_verified_candidates'));const result=await rank(f.query,rows.map(({id,text})=>({id,text})),{limit:2});
 if(!live())return JSON.stringify(empty('stale_request'));if(!result.ok)return JSON.stringify(empty(result.code));
 const matches=await withStore(s,async db=>{const hits=[];for(const {id} of result.candidates.slice(0,2)){const before=rows.find(r=>r.id===id),after=before&&await verifySemantic(ctx,s,db,id,budget,live);if(after&&after.text===before.text&&JSON.stringify(after.source)===JSON.stringify(before.source))hits.push(after);}if(!live()||budget.signal.aborted)return [];return hits.filter(h=>{const r=snapshot(db,h.id);return r?.text===h.text&&JSON.stringify(r.source)===JSON.stringify(h.source)&&db.historyAllowed(h.source.sessionId,h.source.seq,h.raw);}).map(h=>({id:h.id,excerpt:Array.from(h.text).slice(0,120).join(''),source:h.source}));})??[];
 return JSON.stringify({...empty(matches.length?'candidates':'no_verified_candidates'),candidates:matches,scanned:rows.length,poolLimit:64});
 }catch{return JSON.stringify(empty('unavailable'));}
 }});
}
