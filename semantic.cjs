'use strict';
const {model,root,load,encode,pins}=require('./semantic-static.cjs');
const bad=code=>({ok:false,code,model,candidates:[]});
const valid=t=>typeof t==='string'&&t.isWellFormed()&&!!t.trim()&&t.length<=4096;
const fault=e=>bad(['resource_missing','resource_integrity'].includes(e?.message)?e.message:'inference_failed');
// Only freshly authorized rows from the host. No state/value/answer or user-data cache.
async function semanticCandidates(query,rows,options={}){
 const start=performance.now(), limit=options.limit??5;
 if(!valid(query)||!Array.isArray(rows)||rows.length>256||!Number.isInteger(limit)||limit<1||limit>20||rows.some(r=>!r||!((typeof r.id==='string'&&r.id.length>0&&r.id.length<=256)||Number.isSafeInteger(r.id))||!valid(r.text))||new Set(rows.map(r=>r.id)).size!==rows.length)return bad('invalid_input');
 try{const a=load(options.assetDir??root),q=encode(a,query);const candidates=[];if(q)for(const {id,text} of rows){const d=encode(a,text);if(!d)continue;const score=q.reduce((s,v,i)=>s+v*d[i],0);if(score>0)candidates.push({id,score});}
 return {ok:true,model,candidates:candidates.sort((a,b)=>b.score-a.score).slice(0,limit),scanned:rows.length,elapsedMs:Math.round(performance.now()-start)};}catch(e){return fault(e);}
}
function semanticSelfCheckSync(options={}){const start=performance.now();try{const a=load(options.assetDir??root,true),q=encode(a,'本地自检 model check');if(!q||Math.abs(1-Math.hypot(...q))>1e-6)return bad('invalid_output');return {ok:true,model,dimension:q.length,scope:'bundled-local-inference',runtime:'node-js-cpu',verifiedBytes:Object.values(pins).reduce((s,[n])=>s+n,0),elapsedMs:Math.round(performance.now()-start)};}catch(e){return fault(e);}}
async function semanticSelfCheck(options={}){return semanticSelfCheckSync(options);}
module.exports={semanticCandidates,semanticSelfCheck,semanticSelfCheckSync};
