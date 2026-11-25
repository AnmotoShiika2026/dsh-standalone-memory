'use strict';
const {createHash}=require('node:crypto');
const digest=s=>createHash('sha256').update(s).digest('hex');
const domain=(workspace,id)=>'session:'+digest(JSON.stringify([workspace,id]));
function install(db){db.exec('CREATE TABLE IF NOT EXISTS isolated_session_v1(workspace TEXT NOT NULL,sid TEXT NOT NULL,PRIMARY KEY(workspace,sid)) WITHOUT ROWID; CREATE TABLE IF NOT EXISTS shared_source_cut_v1(workspace TEXT NOT NULL,sid TEXT NOT NULL,cut INTEGER NOT NULL,PRIMARY KEY(workspace,sid)) WITHOUT ROWID');}
const selected=(db,workspace,sid)=>!!db.prepare('SELECT 1 FROM isolated_session_v1 WHERE workspace=? AND sid=?').get(workspace,sid);
// Called within one workspace transaction, only with verified directory members. Move
// existing grants, never mint a grant or merge duplicate event/digest permissions.
function set(db,workspace,members,enabled){let updated=0;for(const {id,verify,last} of members){
 if(enabled||selected(db,workspace,id))db.prepare('INSERT INTO shared_source_cut_v1 VALUES(?,?,?) ON CONFLICT(workspace,sid) DO UPDATE SET cut=max(cut,excluded.cut)').run(workspace,id,last);
 if(!enabled){updated+=db.prepare('DELETE FROM isolated_session_v1 WHERE workspace=? AND sid=?').run(workspace,id).changes;continue;}
 updated+=db.prepare('INSERT OR IGNORE INTO isolated_session_v1 VALUES(?,?)').run(workspace,id).changes;
 const dest=domain(workspace,id),quarantine='sealed:'+dest;db.prepare('INSERT OR IGNORE INTO session_domains VALUES(?,?,?)').run(dest,workspace,id);
 // Verify native user events again before moving source grants or quotations. Invalid
 // or conflicting records leave the shared domain but are not admitted to the private one.
 for(const row of db.prepare('SELECT seq,digest FROM history_permit_v2 WHERE project=? AND sid=?').all(workspace,id)){
  if(verify(row.seq,raw=>digest(raw)===row.digest))db.prepare('UPDATE OR IGNORE history_permit_v2 SET project=? WHERE project=? AND sid=? AND seq=?').run(dest,workspace,id,row.seq);
 }db.prepare('DELETE FROM history_permit_v2 WHERE project=? AND sid=?').run(workspace,id);
 const rows=db.prepare("SELECT rowid r,raw,source,dedup FROM mem WHERE project=? AND json_extract(source,'$.sessionId')=?").all(workspace,id);
 for(const row of rows){const p=JSON.parse(row.source),raw=Buffer.from(row.raw).toString('utf8');const valid=p.kind==='host-user-quote'&&p.block===0&&Number.isSafeInteger(p.utf16Offset)&&p.utf16Offset>=0&&p.utf16Length===raw.length&&verify(p.seq,t=>p.utf16Offset+raw.length<=t.length&&t.slice(p.utf16Offset,p.utf16Offset+raw.length)===raw);
  const target=valid&&!db.prepare('SELECT 1 FROM mem WHERE project=? AND dedup=?').get(dest,row.dedup)?dest:quarantine+':'+row.r;
  db.prepare('UPDATE mem SET project=? WHERE rowid=?').run(target,row.r);db.prepare('UPDATE mem_idx SET scope=CASE WHEN scope LIKE \'archive%\' THEN \'archive\'||? ELSE ? END WHERE rowid=?').run(digest(target),digest(target),row.r);
  db.prepare('UPDATE mem_topic SET project=? WHERE r=?').run(target,row.r);db.prepare('UPDATE mem_reverse_overflow SET project=? WHERE r=?').run(target,row.r);
  // Do not reinterpret cross-session correction links / scheduled choices as local facts.
  const slot=db.prepare('SELECT slot FROM mem_meta WHERE r=?').get(row.r)?.slot;
  if(slot){db.prepare('INSERT OR IGNORE INTO mem_auto_hold VALUES(?)').run(row.r);db.prepare('UPDATE mem_meta SET slot=? WHERE r=?').run('migrated:'+row.r,row.r);}
 }
 // Archived native rows keep their existing ids, vetoes and model holds. Existing
 // private turns win as a unit (never attach a shared final to another private turn).
 db.prepare('WITH eligible AS MATERIALIZED (SELECT a.id FROM archive a WHERE a.project=? AND a.sid=? AND NOT EXISTS (SELECT 1 FROM archive p WHERE p.project=? AND p.sid=a.sid AND (p.userSeq=a.userSeq OR p.seq=a.seq))) UPDATE archive SET project=? WHERE id IN (SELECT id FROM eligible)').run(workspace,id,dest,dest);
 db.prepare('UPDATE archive SET project=?||id WHERE project=? AND sid=?').run(quarantine,workspace,id);
 }return updated;}
module.exports={domain,install,selected,set};
