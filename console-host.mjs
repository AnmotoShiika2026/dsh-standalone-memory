// Owner UI application service. Not a model tool; only a host-verified UI adapter may mount it.
import fs from 'node:fs';import path from 'node:path';import policy from './auto-policy.cjs';
import {groupedRequest,groupedOps} from './grouped-console.mjs';import {profileReceipts,nativeDirectory} from './profile-directory.mjs';
import {nativeUserText,nativeUserAppend} from './native-user.mjs';
import {policyReadDenied} from './forget-host.mjs';import {consoleHistory} from './history.mjs';import {verifySemantic} from './semantic-host.mjs';import {verified as archiveText} from './archive-host.mjs';import {importSelected} from './import-host.mjs';
const spec={sessions:'page',status:'',archiveOn:'',archiveOff:'',archiveResume:'',import:'',clear:'',memories:'page',search:'query',read:'id offset',correct:'id summary keywords',forget:'id',save:'text summary keywords',archive:'from to role page',archiveGet:'id from to role offset',archiveForget:'id from to role',forgetExact:'text',history:'query',semantic:'query',current:'query'};
const writes=new Set('archiveOn archiveOff archiveResume import clear correct forget forgetExact archiveForget save'.split(' '));
const strings={query:256,id:128,from:10,to:10,role:9,text:16000,summary:160};
const plain=o=>o&&typeof o==='object'&&!Array.isArray(o)&&[null,Object.prototype].includes(Object.getPrototypeOf(o));
const str=(v,n)=>typeof v==='string'&&v.trim()&&v.length<=n&&v.isWellFormed();
const fail=error=>({ok:false,error}), ok=data=>({ok:true,data});
function valid(a,allowed){if(!plain(a))return false;const keys=allowed.split(' ');return Object.entries(a).every(([k,v])=>keys.includes(k)&&(k==='page'||k==='offset'?Number.isSafeInteger(v)&&v>=(k==='page'?1:0)&&v<=1000000:k==='keywords'?Array.isArray(v)&&v.length<=12&&v.every(w=>str(w,48)):str(v,strings[k])));}
export const clean=s=>s?.id===s?.header?.id&&str(s?.id,512)&&!s.header.origin&&!s.header.parentSession&&!s.header.isSeeded&&s.inheritedEventCount===0&&path.isAbsolute(s.header.cwd??'');
export function createLoadedDirectory(ctx){return nativeDirectory(ctx,profileReceipts(ctx));}
const noStatus={enabled:true,since:0,epoch:'default-daily',assistantGuarded:false};
const status=(db,config)=>({...db?.archiveStatus()??noStatus,profileEnabled:config.conversationArchive!==false,importEnabled:config.legacyImport===true,isolated:config.sessionIsolation===true||db?.isolated===true});
const date=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
export function createConsole(ctx,{use,sourceFor,verifySource,describeClaim=r=>r,config,rank,catalog,select,directory,getSince=()=>null}){return async request=>{
 try{if(!plain(request)||Object.keys(request).some(k=>!['op','sessionId','args','confirm'].includes(k)))return fail('invalid_request');const {op,sessionId,confirm,args:a={}}=request;
 if(groupedOps.has(op))return await groupedRequest(op,request,a,{directory,use,config,getSince});
 if(typeof op!=='string'||!Object.hasOwn(spec,op)||!valid(a,spec[op])||(confirm!==undefined&&typeof confirm!=='boolean'))return fail('invalid_request');
 if(op==='sessions')return sessionId===undefined?ok(await catalog(a.page??1)):fail('invalid_request');
 if(!str(sessionId,512))return fail('select_session');if(writes.has(op)&&confirm!==true)return fail('confirmation_required');
 if(['archive','archiveGet','history','semantic'].includes(op)&&config.historyLookup===false||op==='current'&&config.autoRecall===false||['import','archiveOn','archiveResume'].includes(op)&&config.conversationArchive===false||op==='import'&&config.legacyImport!==true)return fail('disabled');
 if(['history','semantic','current','search'].includes(op)&&(!str(a.query,256)||policyReadDenied(a.query)||policy.historyDirective(a.query,'request')!=='allow'))return fail('invalid_query');
 if(['archive','archiveGet','archiveForget'].includes(op)&&(!date(a.from)||!date(a.to)||a.from>a.to||a.role!==undefined&&!['assistant','user'].includes(a.role)))return fail('invalid_range');
 if(['read','correct','forget','archiveGet'].includes(op)&&!str(a.id,128)||op==='correct'&&a.summary===undefined&&a.keywords===undefined||op==='save'&&!str(a.text,16000))return fail('invalid_request');
 const profile=ctx.get('profileContext')?.name;if(!str(profile,512))return fail('unavailable');const s=await select(sessionId,op);if(!clean(s)||s.id!==sessionId)return fail('session_unavailable');const cwd=fs.realpathSync.native(s.header.cwd),startSeq=s.seq;
 const live=()=>ctx.get('profileContext')?.name===profile&&clean(s)&&s.seq===startSeq&&fs.realpathSync.native(s.header.cwd)===cwd&&(directory?directory.valid(s):typeof s.consoleLive==='function'?s.consoleLive():ctx.sessions.get(s.id)===s);if(!live()||directory&&!await directory.recheck(s))return fail('stale_session');
 const result=await use(s,writes.has(op),async db=>{if(!live())return fail('stale_session');switch(op){
 case 'status': return ok(status(db,config));
 case 'archiveOn':case 'archiveOff':db.setArchiveEnabled(op==='archiveOn');return ok(status(db,config));
 case 'archiveResume':return ok({...statusAfterResume(db,config)});
 case 'import':{const r=importSelected(s,db,getSince);return r.status==='ok'?ok(r):fail(r.status);}
 case 'clear':return ok(db.clearConsoleSession(s.id,s.seq-1));
 case 'memories':{const p=db.consolePage(a.page??1);return ok({...p,items:p.items.map(describeClaim)});}
 case 'search':return ok({items:db.search(a.query,5).map(describeClaim)});
 case 'read':{const r=db.read(a.id,a.offset??0,1000);return r?ok(describeClaim(verifySource?verifySource(ctx,db,r,s):r)):fail('not_found');}
 case 'save':{const src=sourceFor(s,a.text),e=s.eventAt(src.source.seq);if(!nativeUserAppend(e)||nativeUserText(e.data)===null)return fail('unverified_source');for(let n=e.seq+1;n<s.seq;n++){const later=s.eventAt(n);if(!s.isOwnSeq(n)||later?.seq!==n)return fail('unverified_source');if(later.type==='user/message'&&later.data?.source?.kind==='user'){const raw=nativeUserText(later.data);if(typeof raw!=='string'||later.surfaceOp!=='append'||later.sourceEventSeqs!==undefined||policy.historyDirective(raw)==='retract'&&!db.resolvedWithdrawal(s.id,n,raw))return fail('privacy_boundary');}}
 const original=e.data.content[0].text,prefix=/^请记住[:：]/u.exec(original)?.[0];if(prefix&&src.text===original){src.text=original.slice(prefix.length);if(!src.text.trim())return fail('not_saved');src.source={...src.source,utf16Offset:prefix.length,utf16Length:src.text.length};}const r=db.save({...src,summary:a.summary,keywords:a.keywords},original);return r?.id||typeof r==='string'?ok(r):fail('not_saved');}
 case 'correct':return db.correct(a.id,a)?ok({updated:true}):fail('not_found');
 case 'forgetExact':{if(!str(a.text,16000))return fail('invalid_request');const src=sourceFor(s,a.text),e=s.eventAt(src.source.seq);if(e.data.content[0].text!==a.text||e.sourceEventSeqs!==undefined)return fail('not_found');const hit=db.historyLiteralTarget(a.text);if(hit?.sid===s.id&&hit.seq===e.seq){const r=db.revokeVerifiedLiteral(a.text,s.id,e.seq,hit.archiveId,hit.archiveTime,hit.linkedId);return r.deleted?ok(r):fail('not_found');}if(hit?.status)return fail(hit.status);const r=db.forgetConsoleLiteral(a.text,s.id,e.seq);return r.deleted?ok(r):fail(r.status);}
 case 'archiveForget':{const row=db.archiveSource(a.id);if(!row||row.day<a.from||row.day>a.to||a.role&&row.role!==a.role)return fail('not_found');if(await archiveText(ctx,s,db,row,AbortSignal.timeout(5000))===null||!live()||directory&&!await directory.recheck(s)||db.archiveSource(a.id)?.digest!==row.digest)return fail('unverified_source');return db.forget(a.id)?ok({deleted:true}):fail('not_found');}
 case 'forget':return !a.id.startsWith('arc-')&&db.read(a.id,0,1)&&db.forget(a.id)?ok({deleted:true}):fail('not_found');
 case 'archiveGet':case 'archive':{const p=op==='archive'?db.archiveList(a):{items:[{id:a.id}]},items=[];for(const h of p.items){const row=db.archiveSource(h.id);if(!row||row.day<a.from||row.day>a.to||a.role&&row.role!==a.role)continue;const raw=await archiveText(ctx,s,db,row,AbortSignal.timeout(5000));if(!live()||raw===null||db.archiveSource(h.id)?.digest!==row.digest)continue;const chars=Array.from(raw),offset=a.offset??0,size=op==='archiveGet'?1000:160;items.push({...h,role:row.role,day:row.day,text:chars.slice(offset,offset+size).join(''),nextOffset:offset+size<chars.length?offset+size:null});}return op==='archive'?ok({...p,items}):items.length?ok(items[0]):fail('unverified_source');}
 case 'history':{const r=consoleHistory(s,a.query,db);return ok({...r,items:r.results});}
 case 'current':return ok({items:policy.recallAutomatic(db,a.query)});
 case 'semantic':{const budget={signal:AbortSignal.timeout(1800),left:512,units:65536},items=[];for(const id of db.semanticPool(64)){if(!live()||budget.signal.aborted)break;const hit=await verifySemantic(ctx,s,db,id,budget,live);if(hit)items.push(hit);}if(!items.length)return ok({items:[],status:'no_verified_candidates'});const r=await rank(a.query,items.map(({id,text})=>({id,text})),{limit:2});if(!r.ok)return fail('rank_unavailable');const out=[];for(const {id} of r.candidates.slice(0,2)){const before=items.find(h=>h.id===id),h=before&&await verifySemantic(ctx,s,db,id,budget,live);if(h&&h.raw===before.raw&&db.historyAllowed(h.source.sessionId,h.source.seq,h.raw)&&!budget.signal.aborted)out.push({id,text:Array.from(h.text).slice(0,120).join(''),source:h.source});}return ok({items:out,claimStatus:'candidates_only'});}
 }});if(!live()||directory&&!await directory.recheck(s))return fail('stale_session');if(result!==undefined)return result;if(op==='status')return ok(status(null,config));if(['search','history','current','semantic','memories','archive'].includes(op))return ok({items:[],page:a.page??1,nextPage:null});return fail('not_found');
 }catch(err){return fail(err?.code==='STM_PRIVACY_BOUNDARY'?'privacy_boundary':'unavailable');}
};}
function statusAfterResume(db,config){const resumed=db.resumeArchiveReplies();return {...status(db,config),resumed};}
