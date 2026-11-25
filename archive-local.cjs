'use strict';
// Owner-operated offline recovery. Not registered as a model tool. JSON output escapes terminal controls.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto'),{Store}=require('./core.cjs');
function main([profile,workspace,action,...args]){
 if(!profile||!path.isAbsolute(workspace||'')||!['list','get','purge-session'].includes(action))throw Error('Usage: node archive-local.cjs PROFILE ABSOLUTE_WORKSPACE list FROM TO [PAGE] | get ID [OFFSET] | purge-session SESSION --confirm');
 const project=fs.realpathSync.native(workspace),home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');if(!path.isAbsolute(home))throw Error('Absolute DSH_HOME required');
 const token=createHash('sha256').update(JSON.stringify([profile,project])).digest('hex'),file=path.join(home,'data','dsh-standalone-memory',token+'.sqlite');if(!fs.existsSync(file))return {status:'not_found'};
 const db=new Store(file,project);try{
 if(action==='purge-session'){if(args.length!==2||args[1]!=='--confirm')throw Error('Explicit confirmation required');return {deleted:db.purgeArchiveSession(args[0])};}
 if(!db.archiveStatus().enabled)return {status:'disabled'};
 const context={domain:{profile,workspace:project},sourceStatus:'local_snapshot_not_host_verified'};
 if(action==='list'){if(args.length<2||args.length>3)throw Error('Date range required');return {...context,...db.archiveList({from:args[0],to:args[1],page:Number(args[2]??1)})};}
 const r=db.archiveSource(args[0]),offset=Number(args[1]??0);if(!r||args.length>2||!Number.isSafeInteger(offset)||offset<0||createHash('sha256').update(r.text).digest('hex')!==r.digest)return {status:'unavailable'};
 const chars=Array.from(r.text),end=Math.min(offset+1200,chars.length);return offset>=end?{status:'unavailable'}:{...context,id:r.id,role:r.role,ts:r.ts,sessionId:r.sid,seq:r.seq,text:chars.slice(offset,end).join(''),nextOffset:end<chars.length?end:null};
 }finally{db.close();}}
module.exports={main};if(require.main===module){try{console.log(JSON.stringify(main(process.argv.slice(2))));}catch(e){console.error(e.message);process.exitCode=1;}}
