import path from 'node:path';
import {nativeUserAppend,nativeUserText} from './native-user.mjs';import {importSelected} from './import-host.mjs';
const ok=data=>({ok:true,data}),fail=error=>({ok:false,error});
const pageOf=(rows,page)=>({items:rows.slice((page-1)*20,page*20),page,nextPage:page*20<rows.length?page+1:null});
export const groupedOps=new Set(['workspaces','workspaceSessions','setSessionIsolation','importSessions']);
export async function groupedRequest(op,request,a,{directory,use,config,getSince}){
 if(!directory||request.sessionId!==undefined||!a||Array.isArray(a)||![Object.prototype,null].includes(Object.getPrototypeOf(a)))return fail('invalid_request');
 const write=op==='setSessionIsolation'||op==='importSessions',allowed=op==='workspaces'?['page','purpose']:op==='workspaceSessions'?['workspaceId','page','purpose']:op==='importSessions'?['workspaceId','sessionIds']:['workspaceId','sessionIds','enabled'];
 if(a.purpose!==undefined&&!['isolation','import'].includes(a.purpose)||Object.keys(a).some(k=>!allowed.includes(k))||request.confirm!==undefined&&typeof request.confirm!=='boolean'||a.page!==undefined&&(!Number.isSafeInteger(a.page)||a.page<1||a.page>1000000)||op!=='workspaces'&&(typeof a.workspaceId!=='string'||!/^[0-9a-f]{64}$/u.test(a.workspaceId)))return fail('invalid_request');
 if(write){if(!Array.isArray(a.sessionIds)||!a.sessionIds.length||a.sessionIds.length>20||new Set(a.sessionIds).size!==a.sessionIds.length||!a.sessionIds.every(id=>typeof id==='string'&&id.trim()&&id.isWellFormed()&&id.length<=512)||op==='setSessionIsolation'&&typeof a.enabled!=='boolean')return fail('invalid_request');if(request.confirm!==true)return fail('confirmation_required');}
 if(op==='importSessions'&&config.conversationArchive===false)return fail('disabled');const managing=write||a.purpose!==undefined;const groups=managing?await directory.managementGroups():await directory.groups(),page=a.page??1;
 if(op==='workspaces'){
  const result=pageOf([...groups.values()].sort((a,b)=>a.cwd.localeCompare(b.cwd)||a.workspaceId.localeCompare(b.workspaceId)),page);
  const items=await Promise.all(result.items.map(async group=>{
   const {workspaceId,cwd,sessions}=group;
   const nativeTitle=managing?group.displayName:await directory.workspaceTitle(cwd);
   return {workspaceId,cwd,count:sessions.length,displayName:nativeTitle||path.basename(cwd)||cwd};
  }));
  return ok({...result,items});
 }
 const group=groups.get(a.workspaceId);if(!group)return fail('session_unavailable');const globalIsolated=config.sessionIsolation===true;
 if(op==='workspaceSessions'){const p=pageOf(group.sessions,page),ids=p.items.filter(s=>!managing||s.actionable===true).map(s=>s.id),flags=ids.length?directory.flags(group.cwd,ids):[],values=new Map(ids.map((id,i)=>[id,!!flags[i]]));return ok({...p,workspaceId:a.workspaceId,items:p.items.map(({id,title,loaded,actionable,reason})=>({id,title,loaded,...(managing?{actionable,reason}:{}),...(values.has(id)?{sessionIsolated:values.get(id),globalIsolated,isolated:globalIsolated||values.get(id)}:{})}))});}
 const byId=new Map(group.sessions.map(s=>[s.id,s])),rows=a.sessionIds.map(id=>byId.get(id));if(rows.some(r=>r?.actionable!==true))return fail('session_unavailable');const sessions=[];for(const row of rows){const s=await directory.resolve(row);if(!s||!Number.isSafeInteger(s.seq)||s.seq<0)return fail('session_unavailable');sessions.push(s);}
 if(!(await Promise.all(sessions.map(directory.recheck))).every(Boolean)||!sessions.every(directory.valid))return fail('stale_session');
 if(op==='setSessionIsolation')return ok({updated:use(sessions[0],true,db=>db.setSessionIsolation(sessions.map(s=>({id:s.id,last:s.seq-1,verify:(n,predicate)=>{if(!Number.isSafeInteger(n)||n<0||n>=s.seq||!s.isOwnSeq(n))return false;const e=s.eventAt(n),raw=e?.seq===n&&nativeUserAppend(e)?nativeUserText(e.data):null;return typeof raw==='string'&&predicate(raw);}})),a.enabled)),globalIsolated});
 const items=sessions.map(s=>{try{if(!directory.valid(s))return {id:s.id,status:'stale_session',inserted:0};const r=use(s,true,db=>importSelected(s,db,getSince));return {id:s.id,status:r.status,inserted:r.inserted??0};}catch{return {id:s.id,status:'unavailable',inserted:0};}});return ok({items,inserted:items.reduce((n,r)=>n+r.inserted,0)});
}
