'use strict';
// Content-free, incremental projection of already committed, permitted event
// metadata. Never opens session logs or invokes captures/models. A single
// coalescing dirty interval per project replaces an unbounded event queue.
const schema=`CREATE INDEX IF NOT EXISTS mem_organize_project ON mem(project);
 CREATE TABLE IF NOT EXISTS organize_dirty_v1(project TEXT PRIMARY KEY,lo INTEGER NOT NULL,hi INTEGER NOT NULL) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS organize_event_v1(r INTEGER PRIMARY KEY,project TEXT NOT NULL,sid TEXT NOT NULL,seq INTEGER NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS organize_day_v1 ON organize_event_v1(project,created,r);
 CREATE INDEX IF NOT EXISTS organize_expiry_v1 ON organize_event_v1(project,expires,r);
 CREATE INDEX IF NOT EXISTS organize_source_v1 ON organize_event_v1(project,sid,seq);
 CREATE TRIGGER IF NOT EXISTS organize_on_grant_v1 AFTER INSERT ON mem_consent_v2 BEGIN
   INSERT INTO organize_dirty_v1 SELECT project,new.r,new.r FROM mem WHERE rowid=new.r
   ON CONFLICT(project) DO UPDATE SET lo=min(lo,new.r),hi=max(hi,new.r);
 END;
 CREATE TRIGGER IF NOT EXISTS organize_on_consent_loss_v1 AFTER DELETE ON mem_consent_v2 BEGIN DELETE FROM organize_event_v1 WHERE r=old.r; END;
 CREATE TRIGGER IF NOT EXISTS organize_on_delete_v1 AFTER DELETE ON mem BEGIN DELETE FROM organize_event_v1 WHERE r=old.rowid; END;
 CREATE TRIGGER IF NOT EXISTS organize_on_permit_loss_v1 AFTER DELETE ON history_permit_v2 BEGIN DELETE FROM organize_event_v1 WHERE project=old.project AND sid=old.sid AND seq=old.seq; END;`;
function install(db){if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='organize_on_grant_v1'").get())db.exec(schema);}
function run(db,project,limit=8){if(!Number.isInteger(limit)||limit<1||limit>8)throw RangeError('Maintenance limit 1..8');
 const now=Date.now();db.prepare('DELETE FROM organize_event_v1 WHERE r IN (SELECT r FROM organize_event_v1 WHERE project=? AND expires>0 AND expires<=? ORDER BY expires LIMIT ?)').run(project,now,limit);
 const interval=db.prepare('SELECT lo,hi FROM organize_dirty_v1 WHERE project=?').get(project);if(!interval)return {examined:0,indexed:0,pending:false};
 const rows=db.prepare('SELECT rowid r FROM mem INDEXED BY mem_organize_project WHERE project=? AND rowid BETWEEN ? AND ? ORDER BY rowid LIMIT ?').all(project,interval.lo,interval.hi,limit);
 const resolve=db.prepare(`INSERT OR IGNORE INTO organize_event_v1(r,project,sid,seq,created,expires)
 SELECT m.rowid,m.project,h.sid,h.seq,a.created,a.expires FROM mem m JOIN mem_consent_v2 g ON g.r=m.rowid JOIN mem_meta a ON a.r=m.rowid
 JOIN history_permit_v2 h ON h.project=m.project AND h.sid=json_extract(m.source,'$.sessionId') AND h.seq=json_extract(m.source,'$.seq')
 WHERE m.rowid=? AND m.project=? AND json_extract(m.source,'$.kind')='host-user-quote' AND (a.expires=0 OR a.expires>?)
 AND NOT EXISTS(SELECT 1 FROM history_denied d WHERE d.project=m.project AND d.sid=h.sid AND d.seq=h.seq)
 AND NOT EXISTS(SELECT 1 FROM history_floor f WHERE f.project=m.project AND f.sid=h.sid AND f.seq>=h.seq)
 AND NOT EXISTS(SELECT 1 FROM history_gap_v1 x WHERE x.project=m.project AND x.sid=h.sid AND h.seq BETWEEN x.lo AND x.hi)`);
 let indexed=0;for(const {r} of rows)indexed+=resolve.run(r,project,now).changes;
 const last=rows.at(-1)?.r,pending=rows.length===limit&&last<interval.hi;
 if(pending)db.prepare('UPDATE organize_dirty_v1 SET lo=? WHERE project=?').run(last+1,project);else db.prepare('DELETE FROM organize_dirty_v1 WHERE project=?').run(project);
 return {examined:rows.length,indexed,pending};
}
module.exports={install,run};
