'use strict';
// Internal, synchronous adapter. Only the host's observed append/final pair may
// enter turn(); this is intentionally not a user/model-facing write API.
const {randomUUID,createHash}=require('node:crypto');
const {historyDirective}=require('./auto-policy.cjs');
const hash=t=>createHash('sha256').update(t).digest('hex');
const pos=n=>Number.isSafeInteger(n)&&n>=0;
const validSid=s=>typeof s==='string'&&s.length>0&&s.length<=512;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
function localDay(ts){const d=new Date(ts);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
const source=r=>({sessionId:r.sid,seq:r.seq});
const eligible=(t,role)=>typeof t==='string'&&!t.includes('\0')&&historyDirective(t,'archive')==='allow';
const visible=`NOT EXISTS(SELECT 1 FROM history_denied h WHERE h.project=a.project AND h.sid=a.sid AND h.seq=a.userSeq) AND NOT EXISTS(SELECT 1 FROM history_floor f WHERE f.project=a.project AND f.sid=a.sid AND f.seq>=a.userSeq)`;
class ArchiveStore {
  constructor(db,project,workspace=project){this.db=db;this.p=project;this.workspace=workspace;db.function('stm_archive_eligible',{deterministic:true},(t,role)=>Number(eligible(t,role)));
    db.exec(`CREATE TABLE IF NOT EXISTS archive_setting(project TEXT PRIMARY KEY,enabled INTEGER NOT NULL,since INTEGER NOT NULL,epoch TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS archive_veto(project TEXT PRIMARY KEY,cut INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS archive_reply_fence(project TEXT NOT NULL,sid TEXT NOT NULL,cut INTEGER NOT NULL,following INTEGER,PRIMARY KEY(project,sid)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS archive(project TEXT NOT NULL,id TEXT NOT NULL UNIQUE,sid TEXT NOT NULL,seq INTEGER NOT NULL,userSeq INTEGER NOT NULL,role TEXT NOT NULL,ts INTEGER NOT NULL,day TEXT NOT NULL,text TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(project,sid,seq));
      CREATE TABLE IF NOT EXISTS archive_model_hold(id TEXT PRIMARY KEY) WITHOUT ROWID;
      CREATE TRIGGER IF NOT EXISTS archive_model_hold_clean AFTER DELETE ON archive BEGIN DELETE FROM archive_model_hold WHERE id=OLD.id; END;
      CREATE INDEX IF NOT EXISTS archive_day ON archive(project,day,ts,id);
      CREATE INDEX IF NOT EXISTS archive_role_day ON archive(project,role,day,ts,id);
      CREATE INDEX IF NOT EXISTS archive_turn ON archive(project,sid,userSeq);`);
    // Keep old handles/revocations, preserve the durable original; remove only the unused FTS duplicate.
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='archive_idx'").get())db.exec("DROP TRIGGER IF EXISTS archive_add; DROP TRIGGER IF EXISTS archive_remove; DROP TABLE archive_idx");
  }
  purgeSession(sid){if(!validSid(sid))throw TypeError('Invalid session');const r=this.db.prepare('SELECT max(seq) seq FROM archive WHERE project=? AND sid=?').get(this.p,sid);if(r.seq==null)return false;this.db.prepare('INSERT INTO history_floor VALUES(?,?,?) ON CONFLICT(project,sid) DO UPDATE SET seq=max(seq,excluded.seq)').run(this.p,sid,r.seq);this.deny(sid,r.seq,true);return true;}
  status(){const r=this.db.prepare('SELECT enabled,since,epoch FROM archive_setting WHERE project=?').get(this.workspace);
    const guarded=!!this.db.prepare('SELECT 1 FROM archive_veto WHERE project=?').get(this.workspace);
    return {enabled:r?!!r.enabled:true,since:r?.since??0,epoch:r?.epoch??'default-daily',assistantGuarded:guarded};}
  set(on){if(typeof on!=='boolean')throw TypeError('Expected boolean');const old=this.status();if(old.enabled===on)return old;
    // Advance the boundary even after a clock rollback. Never reuse a grant token.
    this.db.prepare('INSERT OR REPLACE INTO archive_setting VALUES(?,?,?,?)').run(this.workspace,+on,Math.max(old.since,Date.now()),randomUUID());return this.status();}
  resume(){const st=this.status();if(!st.enabled||!st.assistantGuarded)return false;
    // Explicit prospective recovery only: a pre-migration in-flight final has an obsolete epoch.
    this.db.prepare('DELETE FROM archive_veto WHERE project=?').run(this.workspace);
    this.db.prepare('INSERT OR REPLACE INTO archive_setting VALUES(?,1,?,?)').run(this.workspace,Math.max(st.since,Date.now()),randomUUID());return true;}
  // No quote fingerprint, body or reversible content in veto records. Unless
  // independently known, lineage of assistant text can cross turns/sessions.
  guard(cut=0){this.db.prepare('INSERT INTO archive_veto VALUES(?,?) ON CONFLICT(project) DO UPDATE SET cut=min(cut,excluded.cut)').run(this.workspace,cut);
    this.db.prepare("INSERT OR IGNORE INTO archive_model_hold SELECT id FROM archive WHERE (project=? OR project IN (SELECT scope FROM session_domains WHERE workspace=?)) AND role='assistant' AND ts>=?").run(this.workspace,this.workspace,cut);}
  deny(sid,seq,through=false){return this.denyIn(this.p,sid,seq,through);}
  denyIn(project,sid,seq,through){const op=through?'<=':'=';
    this.fence(sid,seq,project);this.db.prepare(`DELETE FROM archive WHERE project=? AND sid=? AND userSeq${op}?`).run(project,sid,seq);}
  fence(sid,seq,project=this.p){
    this.db.prepare('INSERT INTO archive_reply_fence VALUES(?,?,?,NULL) ON CONFLICT(project,sid) DO UPDATE SET cut=excluded.cut,following=NULL WHERE excluded.cut>cut').run(this.workspace,sid,seq);
    // Historic later replies may quote this turn. Keep their owner snapshots, but never present them to the model.
    this.db.prepare("INSERT OR IGNORE INTO archive_model_hold SELECT id FROM archive WHERE project=? AND sid=? AND userSeq>? AND role='assistant'").run(project,sid,seq);
    this.db.prepare("DELETE FROM archive WHERE project=? AND sid=? AND userSeq=? AND role='assistant'").run(project,sid,seq);}
  turn({epoch,sid,user:u,assistant:a}){
    const st=this.status();if(!st.enabled||!epoch||st.epoch!==epoch||!validSid(sid)||!u||!pos(u.seq)||!pos(u.ts)||u.ts<=st.since||u.ts>Date.now()||!eligible(u.text))return 0;
    if(this.db.prepare('SELECT 1 FROM history_floor WHERE project=? AND sid=? AND seq>=? UNION ALL SELECT 1 FROM history_denied WHERE project=? AND sid=? AND seq=? LIMIT 1').get(this.p,sid,u.seq,this.p,sid,u.seq))return 0;
    const digest=hash(u.text),prior=this.db.prepare('SELECT role,digest FROM archive WHERE project=? AND sid=? AND seq=?').get(this.p,sid,u.seq);
    if(prior&&(prior.role!=='user'||prior.digest!==digest))return 0;
    const insert=(m,role)=>this.db.prepare('INSERT OR IGNORE INTO archive(project,id,sid,seq,userSeq,role,ts,day,text,digest) VALUES(?,?,?,?,?,?,?,?,?,?)').run(this.p,'arc-'+randomUUID(),sid,m.seq,u.seq,role,m.ts,localDay(m.ts),m.text,hash(m.text)).changes;
    // Bind the one-turn grace to a position, never a count of callbacks. Replays cannot spend it.
    this.db.prepare('UPDATE archive_reply_fence SET following=? WHERE project=? AND sid=? AND following IS NULL AND cut<?').run(u.seq,this.workspace,sid,u.seq);
    let n=insert(u,'user');if(!a||!pos(a.seq)||a.seq<=u.seq||!pos(a.ts)||a.ts<u.ts||a.ts>Date.now()||!eligible(a.text,'assistant'))return n;
    if(st.assistantGuarded||this.db.prepare('SELECT 1 FROM archive_reply_fence WHERE project=? AND sid=? AND (following IS NULL OR following>=?)').get(this.workspace,sid,u.seq))return n; // A backward clock or delayed finalize is not a lineage proof.
    // A committed user append licenses at most one final message. A late or
    // conflicting second final is never an opportunity to expand the archive.
    if(!this.db.prepare("SELECT 1 FROM archive WHERE project=? AND sid=? AND userSeq=? AND role='assistant'").get(this.p,sid,u.seq))n+=insert(a,'assistant');return n;
  }
  list({from,to,role,page=1,excludeCurrent}){if(!validDate(from)||!validDate(to)||from>to||!pos(page)||page<1||page>10000000||role!==undefined&&!['user','assistant'].includes(role))throw TypeError('Invalid archive range, role or page');
    const rows=this.db.prepare(`SELECT id,sid,seq,day,ts,role FROM archive a WHERE project=? AND day BETWEEN ? AND ? ${role?'AND role=?':''} ${excludeCurrent?'AND NOT (sid=? AND seq=?)':''} AND ${visible} ORDER BY day,ts,id LIMIT 4 OFFSET ?`).all(this.p,from,to,...role?[role]:[],...excludeCurrent?[excludeCurrent.sid,excludeCurrent.seq]:[],(page-1)*3);
    return {items:rows.slice(0,3).map(({sid,seq,...r})=>({...r,source:{sessionId:sid,seq}})),page,nextPage:rows.length>3?page+1:null};}
  held(id){return !!this.db.prepare('SELECT 1 FROM archive_model_hold h JOIN archive a USING(id) WHERE a.project=? AND h.id=?').get(this.p,id);}
  source(id,model=false){if(typeof id!=='string'||!/^arc-[a-f0-9-]{36}$/.test(id))return null;
    return this.db.prepare(`SELECT id,sid,seq,userSeq,role,ts,day,text,digest FROM archive a WHERE project=? AND id=? AND ${model?'NOT EXISTS(SELECT 1 FROM archive_model_hold h WHERE h.id=a.id) AND ':''}${visible}`).get(this.p,id)??null;}
}
module.exports={ArchiveStore};
