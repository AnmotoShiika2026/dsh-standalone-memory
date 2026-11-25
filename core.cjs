'use strict';
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomUUID } = require('node:crypto');

function disputeLabel(disputed) {return disputed?{claimStatus:'disputed',meaning:'原话可核对，但有未解决的更正，不能据此确定当前值。'}:{};}
function string(v, name, max, allowEmpty = false) {
  if (typeof v !== 'string' || (!allowEmpty && !v.trim()) || v.length > max || !v.isWellFormed()) throw new TypeError(`Invalid ${name}`);
  return v;
}
function integer(v, min, max) {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new RangeError(`Expected integer ${min}..${max}`);
  return v;
}
function tags(v = []) {
  if (!Array.isArray(v) || v.length > 32) throw new TypeError('Invalid keywords');
  return [...new Set(v.map(x => string(x, 'keyword', 80).trim()))];
}
function label(v) { return string(v, 'summary', 240).replace(/[\u0000-\u001F]/g,' ').trim(); }
function normalized(s) { return s.normalize('NFKC').toLowerCase(); }
// Pre-tokenize in JS so a two-character Han query remains indexable. Values entering
// MATCH consist exclusively of letters, digits, and combining marks, never FTS syntax.
function tokens(s, indexing = false) {
  const out = new Set();
  for (const m of normalized(s).matchAll(/\p{Script=Han}+|(?:(?!\p{Script=Han})[\p{L}\p{M}\p{N}])+/gu)) {
    const w = m[0];
    if (/^\p{Script=Han}/u.test(w)) {
      const cs = Array.from(w);
      if (indexing || cs.length === 1) for (const c of cs) out.add(c);
      for (let i = 1; i < cs.length; i++) out.add(cs[i-1] + cs[i]);
    } else out.add(w);
  }
  return [...out];
}
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])]));
  return x;
}
// SQL fragment for the trusted `m` table alias, never built from caller input.
const visibleV2 = `(coalesce(json_extract(m.source,'$.kind'),'')<>'host-user-quote' OR EXISTS(SELECT 1 FROM mem_consent_v2 v WHERE v.r=m.rowid))`;
// A pending reverse claim casts doubt on this exact slot, independent of
// shortlist size, insertion order or the number of siblings. Deletion removes
// just that claimant. An indexed EXISTS never treats a truncated list as unique.
const unblockedSlot = `(NOT EXISTS(SELECT 1 FROM mem_reverse_pending p WHERE p.slot=a.slot) AND NOT EXISTS(SELECT 1 FROM mem_future_v1 t WHERE t.slot=a.slot))`;
function sessionProject(workspace,id){return 'session:'+createHash('sha256').update(JSON.stringify([workspace,id])).digest('hex');}
class Store {
  #path; #db; #project; #workspace; #sid; #archive; #insideTransaction=false;
  constructor(dbPath, project, {sessionId=null,actorId=null}={}) {
    this.#workspace=string(project,'project',4096);
    this.#sid=sessionId===null?null:string(sessionId,'session',512);
    // Not an absolute path: cannot collide with a host canonical workspace key.
    this.#project=this.#sid===null?project:sessionProject(project,this.#sid);
    this.#path=dbPath;this.#db = new DatabaseSync(dbPath);
    try {
      this.#db.exec('PRAGMA busy_timeout=3000');const iso=require('./session-isolation.cjs');iso.install(this.#db);
      if(actorId!==null&&iso.selected(this.#db,project,string(actorId,'session',512))){this.#sid=actorId;this.#project=iso.domain(project,actorId);}
      this.#db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS mem (
          rowid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, project TEXT NOT NULL,
          dedup TEXT NOT NULL, raw BLOB NOT NULL, summary TEXT NOT NULL, tags TEXT NOT NULL,
          source TEXT NOT NULL, UNIQUE(project,dedup));
        CREATE VIRTUAL TABLE IF NOT EXISTS mem_idx USING fts5(scope,summary,keywords,body);
        CREATE TABLE IF NOT EXISTS mem_meta(r INTEGER PRIMARY KEY,type TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,state TEXT NOT NULL,slot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS mem_topic(project TEXT NOT NULL,topic TEXT NOT NULL,r INTEGER NOT NULL,PRIMARY KEY(project,topic,r)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS mem_topic_r ON mem_topic(r);
        CREATE TABLE IF NOT EXISTS mem_fact(r INTEGER PRIMARY KEY,subject TEXT,conditions TEXT NOT NULL,property TEXT,value TEXT);
        CREATE TABLE IF NOT EXISTS mem_consent_v2(r INTEGER PRIMARY KEY);
        CREATE VIEW IF NOT EXISTS mem_visible_v2 AS SELECT m.rowid AS rowid,m.* FROM mem m WHERE ${visibleV2};
        CREATE TABLE IF NOT EXISTS mem_search_only(id TEXT PRIMARY KEY NOT NULL);
        CREATE VIEW IF NOT EXISTS mem_visible_v3 AS SELECT * FROM mem_visible_v2 UNION ALL
          SELECT m.rowid AS rowid,m.* FROM mem_search_only q JOIN mem m ON m.id=q.id
          JOIN history_permit_v2 h ON h.project=m.project AND h.sid=json_extract(m.source,'$.sessionId') AND h.seq=json_extract(m.source,'$.seq');
        CREATE TABLE IF NOT EXISTS mem_auto_hold(r INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS mem_reverse_overflow(project TEXT NOT NULL,denial TEXT NOT NULL,r INTEGER NOT NULL,PRIMARY KEY(project,denial,r)) WITHOUT ROWID;
        CREATE TRIGGER IF NOT EXISTS mem_reverse_cleanup AFTER DELETE ON mem BEGIN DELETE FROM mem_reverse_overflow WHERE r=OLD.rowid AND project=OLD.project; END;
        CREATE INDEX IF NOT EXISTS mem_reverse_cleanup_r ON mem_reverse_overflow(r);
        CREATE TABLE IF NOT EXISTS mem_disputed(prior INTEGER NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(prior,revision)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS mem_disputed_revision ON mem_disputed(revision);
        CREATE TRIGGER IF NOT EXISTS mem_disputed_cleanup AFTER DELETE ON mem BEGIN
          DELETE FROM mem_disputed WHERE prior=OLD.rowid OR revision=OLD.rowid;
        END;
        -- No backfill. A pending marker is a veto, not a grant. Only holds
        -- owned exclusively by a missing predecessor can ever be released.
        CREATE TABLE IF NOT EXISTS mem_reverse_pending(r INTEGER PRIMARY KEY,slot TEXT NOT NULL,retry INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS mem_reverse_pending_slot ON mem_reverse_pending(slot,r);
        CREATE TRIGGER IF NOT EXISTS mem_reverse_pending_forget AFTER DELETE ON mem BEGIN DELETE FROM mem_reverse_pending WHERE r=OLD.rowid; END;
        CREATE TRIGGER IF NOT EXISTS mem_reverse_pending_keep BEFORE INSERT ON mem_auto_hold BEGIN UPDATE mem_reverse_pending SET retry=0 WHERE r=NEW.r; END;
        CREATE TABLE IF NOT EXISTS mem_future_v1(prior INTEGER NOT NULL,revision INTEGER PRIMARY KEY,slot TEXT NOT NULL,event_ms INTEGER NOT NULL,effective_ms INTEGER NOT NULL,zone TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS mem_future_slot ON mem_future_v1(slot);
        CREATE INDEX IF NOT EXISTS mem_future_prior ON mem_future_v1(prior);
        CREATE TRIGGER IF NOT EXISTS future_forget_v1 AFTER DELETE ON mem BEGIN DELETE FROM mem_future_v1 WHERE prior=OLD.rowid OR revision=OLD.rowid; END;
        CREATE TABLE IF NOT EXISTS mem_change(old INTEGER PRIMARY KEY,new INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS mem_change_new ON mem_change(new);
        CREATE INDEX IF NOT EXISTS mem_meta_slot ON mem_meta(slot,state,r);
        CREATE INDEX IF NOT EXISTS mem_quote_tail ON mem(project,substr(rtrim(CAST(raw AS TEXT),'。！!.'),-1));
        CREATE TABLE IF NOT EXISTS history_permit_v2(project TEXT NOT NULL,sid TEXT NOT NULL,seq INTEGER NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(project,sid,seq)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS history_denied(project TEXT NOT NULL,sid TEXT NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(project,sid,seq)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS history_resolved(project TEXT NOT NULL,sid TEXT NOT NULL,seq INTEGER NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(project,sid,seq)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS history_gap_v1(project TEXT NOT NULL,sid TEXT NOT NULL,lo INTEGER NOT NULL,hi INTEGER NOT NULL,PRIMARY KEY(project,sid,hi)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS history_floor(project TEXT NOT NULL,sid TEXT NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(project,sid)) WITHOUT ROWID;`);
      // Older readers consult mem_auto_hold. Track only holds created by the
      // dispute projection. Any independent hold request relinquishes ownership.
      if (!this.#db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='dispute_project_v1'").get()) this.#tx(() => {
        this.#db.exec(`CREATE TABLE IF NOT EXISTS dispute_owned_hold(r INTEGER PRIMARY KEY);
          INSERT OR IGNORE INTO dispute_owned_hold SELECT DISTINCT prior FROM mem_disputed
            WHERE prior NOT IN (SELECT r FROM mem_auto_hold);
          INSERT OR IGNORE INTO mem_auto_hold SELECT r FROM dispute_owned_hold WHERE r NOT IN (SELECT r FROM mem_auto_hold);
          CREATE TRIGGER IF NOT EXISTS dispute_independent_hold BEFORE INSERT ON mem_auto_hold BEGIN
            DELETE FROM dispute_owned_hold WHERE r=NEW.r;
          END;
          CREATE TRIGGER IF NOT EXISTS dispute_project_v1 AFTER INSERT ON mem_disputed
          WHEN NOT EXISTS(SELECT 1 FROM mem_auto_hold WHERE r=NEW.prior) BEGIN
            INSERT INTO mem_auto_hold VALUES(NEW.prior);
            INSERT INTO dispute_owned_hold VALUES(NEW.prior);
          END;
          CREATE TRIGGER IF NOT EXISTS dispute_release_v1 AFTER DELETE ON mem_disputed
          WHEN NOT EXISTS(SELECT 1 FROM mem_disputed WHERE prior=OLD.prior) BEGIN
            DELETE FROM mem_auto_hold WHERE r=OLD.prior AND r IN (SELECT r FROM dispute_owned_hold WHERE r=OLD.prior);
            DELETE FROM dispute_owned_hold WHERE r=OLD.prior;
          END;`);
      });
      this.#db.exec('CREATE TABLE IF NOT EXISTS session_domains(scope TEXT PRIMARY KEY, workspace TEXT NOT NULL, sid TEXT NOT NULL) WITHOUT ROWID');
      if(this.#sid)this.#db.prepare('INSERT OR IGNORE INTO session_domains VALUES(?,?,?)').run(this.#project,this.#workspace,this.#sid);
      this.#archive=new (require('./archive-store.cjs').ArchiveStore)(this.#db,this.#project,this.#workspace);
      require('./capture-maintenance.cjs').install(this.#db);
      // Old readers also consult consent/FTS: remove the grants and derived
      // data in the DB, not merely in one reader's WHERE clause. Unknown
      // targets remain sealed in mem until an explicit forget/wipe.
      if(!this.#db.prepare("SELECT 1 FROM sqlite_master WHERE name='curated_floor_v1'").get())this.#tx(()=>{
        const matches=(sid,seq,op)=>`project=NEW.project AND json_extract(source,'$.kind')='host-user-quote' AND json_extract(source,'$.sessionId')=${sid} AND json_extract(source,'$.seq')${op}${seq}`;
        const seal=(op)=>`INSERT OR IGNORE INTO mem_sealed_v1 SELECT rowid FROM mem WHERE ${matches('NEW.sid','NEW.seq',op)};`;
        this.#db.exec(`CREATE TABLE IF NOT EXISTS mem_sealed_v1(r INTEGER PRIMARY KEY);
          CREATE TRIGGER IF NOT EXISTS curated_hide_v1 AFTER INSERT ON mem_sealed_v1 BEGIN
            DELETE FROM mem_consent_v2 WHERE r=NEW.r;
            DELETE FROM mem_search_only WHERE id=(SELECT id FROM mem WHERE rowid=NEW.r);
            DELETE FROM mem_idx WHERE rowid=NEW.r;
            DELETE FROM mem_fact WHERE r=NEW.r;
            DELETE FROM mem_topic WHERE r=NEW.r;
            DELETE FROM mem_reverse_pending WHERE r=NEW.r;
            DELETE FROM mem_reverse_overflow WHERE r=NEW.r;
            DELETE FROM mem_change WHERE old=NEW.r OR new=NEW.r;
            DELETE FROM mem_disputed WHERE prior=NEW.r OR revision=NEW.r;
            DELETE FROM mem_auto_hold WHERE r=NEW.r;
            DELETE FROM mem_meta WHERE r=NEW.r;
          END;
          CREATE TRIGGER IF NOT EXISTS curated_unseal_deleted_v1 AFTER DELETE ON mem BEGIN DELETE FROM mem_sealed_v1 WHERE r=OLD.rowid; END;
          CREATE TRIGGER IF NOT EXISTS curated_floor_v1 AFTER INSERT ON history_floor BEGIN ${seal('<=')} END;
          CREATE TRIGGER IF NOT EXISTS curated_floor_update_v1 AFTER UPDATE OF seq ON history_floor BEGIN ${seal('<=')} END;
          CREATE TRIGGER IF NOT EXISTS curated_denied_v1 AFTER INSERT ON history_denied BEGIN ${seal('=')} END;
          INSERT OR IGNORE INTO mem_sealed_v1 SELECT m.rowid FROM mem m WHERE json_extract(m.source,'$.kind')='host-user-quote' AND (
            EXISTS(SELECT 1 FROM history_floor h WHERE h.project=m.project AND h.sid=json_extract(m.source,'$.sessionId') AND h.seq>=json_extract(m.source,'$.seq')) OR
            EXISTS(SELECT 1 FROM history_denied h WHERE h.project=m.project AND h.sid=json_extract(m.source,'$.sessionId') AND h.seq=json_extract(m.source,'$.seq')));
          DELETE FROM history_permit_v2 WHERE EXISTS(SELECT 1 FROM history_floor h WHERE h.project=history_permit_v2.project AND h.sid=history_permit_v2.sid AND h.seq>=history_permit_v2.seq) OR EXISTS(SELECT 1 FROM history_denied h WHERE h.project=history_permit_v2.project AND h.sid=history_permit_v2.sid AND h.seq=history_permit_v2.seq);`);
      });
      // One-time, transactional quarantine for this workspace, before any read.
      // A historical row grant is not evidence for the *whole* source event.
      this.#db.exec('CREATE TABLE IF NOT EXISTS curated_policy_epoch_v1(project TEXT PRIMARY KEY) WITHOUT ROWID');
      const done=this.#db.prepare('SELECT 1 FROM curated_policy_epoch_v1 WHERE project=?');
      if(!done.get(this.#project))this.#tx(()=>{
        if(done.get(this.#project))return;
        const rows=this.#db.prepare(`SELECT m.rowid r,m.raw,m.source,h.digest FROM mem m LEFT JOIN history_permit_v2 h ON h.project=m.project AND h.sid=json_extract(m.source,'$.sessionId') AND h.seq=json_extract(m.source,'$.seq') WHERE m.project=? AND m.rowid>? AND json_extract(m.source,'$.kind')='host-user-quote' ORDER BY m.rowid LIMIT 32`);
        const seal=this.#db.prepare('INSERT OR IGNORE INTO mem_sealed_v1 VALUES(?)');let cursor=0;
        for(;;){const batch=rows.all(this.#project,cursor);if(!batch.length)break;for(const row of batch){cursor=row.r;const p=JSON.parse(row.source),raw=Buffer.from(row.raw).toString('utf8');
          if(!this.#validPosition(p.sessionId,p.seq)||p.block!==0||p.utf16Offset!==0||p.utf16Length!==raw.length||row.digest!==createHash('sha256').update(raw).digest('hex')||!this.historyAllowed(p.sessionId,p.seq,raw)||this.#behindFloor(p.sessionId,p.seq))seal.run(row.r);
        }}this.#db.prepare('INSERT INTO curated_policy_epoch_v1 VALUES(?)').run(this.#project);
      });
    } catch (e) { this.#db.close(); throw e; }
  }
  get isolated(){return this.#sid!==null;}
  sessionSelected(id){return require('./session-isolation.cjs').selected(this.#db,this.#workspace,id);}
  setSessionIsolation(members,enabled){
    // Run the ordinary per-domain legacy quarantine BEFORE admitting verified new rows.
    if(enabled)for(const {id} of members)new Store(this.#path,this.#workspace,{sessionId:id}).close();
    return this.#tx(()=>require('./session-isolation.cjs').set(this.#db,this.#workspace,members,enabled));}
  #tx(fn) {
    if(this.#insideTransaction)return fn(); // nested synchronous writes belong to the batch
    this.#db.exec('BEGIN IMMEDIATE'); this.#insideTransaction=true;
    try { const r = fn(); this.#db.exec('COMMIT'); return r; }
    catch(e) { this.#db.exec('ROLLBACK'); throw e; }
    finally { this.#insideTransaction=false; }
  }
  // No backfill: old databases may have physically deleted forgotten source pointers.
  // Only an independently observed, exact committed append can mint a new permit.
  #validPosition(sid,seq) { return typeof sid==='string' && !!sid.length && sid.length<=512 && Number.isSafeInteger(seq) && seq>=0; }
  #behindFloor(sid,seq) {
    if(this.#sid!==null && sid!==this.#sid)return true;
    if(this.#sid===null&&(this.sessionSelected(sid)||this.#db.prepare('SELECT 1 FROM shared_source_cut_v1 WHERE workspace=? AND sid=? AND cut>=?').get(this.#workspace,sid,seq)))return true;
    // Revocations are keyed by the native event, not by the mode used to read it.
    const p=this.#workspace;
    return !!this.#db.prepare('SELECT 1 FROM history_gap_v1 WHERE project=? AND sid=? AND ? BETWEEN lo AND hi UNION ALL SELECT 1 FROM history_floor WHERE project=? AND sid=? AND seq>=? UNION ALL SELECT 1 FROM history_denied WHERE project=? AND sid=? AND seq=? LIMIT 1').get(p,sid,seq,p,sid,seq,p,sid,seq);
  }
  #coverThrough(sid,seq) {
    this.#archive.deny(sid,seq,true);
    this.#db.prepare("INSERT OR IGNORE INTO mem_auto_hold SELECT rowid FROM mem WHERE project=? AND json_extract(source,'$.kind')='host-user-quote' AND json_extract(source,'$.sessionId')=? AND json_extract(source,'$.seq')<=?").run(this.#project,sid,seq);
    this.#db.prepare('INSERT INTO history_floor VALUES(?,?,?) ON CONFLICT(project,sid) DO UPDATE SET seq=max(history_floor.seq,excluded.seq)').run(this.#project,sid,seq);
    this.#db.prepare('DELETE FROM history_permit_v2 WHERE project=? AND sid=? AND seq<=?').run(this.#project,sid,seq);
  }
  // A history permit pins the entire native append. Claim it exactly once in
  // the same transaction as all quotes, index rows and supersession links.
  saveCaptureTurn(sid,seq,raw,items) {
    if(!this.#validPosition(sid,seq)||!Array.isArray(items)||items.length>12)throw Error('Invalid capture batch');
    const {historyDirective}=require('./auto-policy.cjs');
    if(historyDirective(raw)!=='allow')return [];
    return this.#tx(()=>{
      if(this.#db.prepare('SELECT 1 FROM history_permit_v2 WHERE project=? AND sid=? AND seq=?').get(this.#project,sid,seq)||!this.observeHistory(sid,seq,raw))return [];
      let end=0;
      return items.map(c=>{
        const {kind,sessionId,seq:sourceSeq,block,utf16Offset:i,utf16Length:n}=c.source;
        if(kind!=='host-user-quote'||sessionId!==sid||sourceSeq!==seq||block!==0||!Number.isSafeInteger(i)||i<end||!Number.isSafeInteger(n)||n<=0||i+n>raw.length||raw.slice(i,i+n)!==c.text||historyDirective(c.text)!=='allow')throw Error('Invalid capture span');
        end=i+n;
        if(c.materialSwitch){
          const slot=`${this.#scope()}:personal-choice:${c.slot}`;
          const rows=this.#db.prepare("SELECT m.rowid r,m.raw,a.expires,f.value,f.conditions,f.property,f.subject FROM mem m JOIN mem_meta a ON a.r=m.rowid LEFT JOIN mem_fact f ON f.r=m.rowid WHERE m.project=? AND a.slot=? AND a.state='active' LIMIT 2").all(this.#project,slot);
          if(rows.length!==1||c.text!==raw||i!==0||n!==raw.length)return null;
          const p=rows[0],proof=this.#futureClean(p,Date.now()),old=Buffer.from(p.raw).toString('utf8').replace(/[。！!.]$/u,'');
          if(!proof||this.#behindFloor(proof.pos.sessionId,proof.pos.seq)||proof.pos.sessionId===sid&&proof.pos.seq>=seq||p.subject!=='self'||p.property!=='use'||p.conditions!==JSON.stringify(c.evidence.conditions)||old!==`我${c.materialSwitch}时习惯用${p.value}`||p.value===c.evidence.value||this.#db.prepare(`SELECT 1 FROM mem_meta a WHERE a.r=? AND NOT ${unblockedSlot}`).get(p.r))return null;
          const dest=this.save(c,raw);if(!dest.created)throw Error('Unexpected material switch replay');
          this.#link(p.r,this.#db.prepare('SELECT rowid r FROM mem WHERE project=? AND id=?').get(this.#project,dest.id).r);return dest;
        }
        if(c.requirePrior){
          const key=`${this.#scope()}:personal-choice:${c.slot}`;
          const matched=this.#db.prepare("SELECT a.r FROM mem_meta a JOIN mem_visible_v2 m ON m.rowid=a.r JOIN mem_fact f ON f.r=a.r WHERE m.project=? AND a.slot=? AND a.state='active' AND f.subject='self' AND f.property=? AND f.value=? AND substr(rtrim(CAST(m.raw AS TEXT),'。！!.'),-length(?))=? LIMIT 2").all(this.#project,key,c.evidence?.property,c.oldValue,c.oldValue,c.oldValue);
          if(matched.length!==1)return null;
          const prior=matched[0].r;
          const held=this.#db.prepare('SELECT 1 FROM mem_auto_hold WHERE r=? UNION ALL SELECT 1 FROM mem_disputed WHERE prior=? OR revision=? LIMIT 1').get(prior,prior,prior);
          if(held)return null;
        }
        const saved=this.save(c,raw);
        // Elliptical replacement: the user named a category, not the old
        // value. Never invent it. Close only a unique whole, permitted routine.
        const parse=require('./auto-policy.cjs').curatedChoice;
        const f=saved.created&&c.type==='habit'&&c.curatedChoice&&raw===c.text&&parse(raw);
        if(f?.kind==='revision'||f?.kind==='causal'){
          const words=tokens(f.activity);
          const probe=words.map(w=>`body:"${w}"`).join(' AND ');
          const rows=this.#db.prepare(`SELECT m.rowid r,m.raw FROM mem_idx JOIN mem_visible_v2 m ON m.rowid=mem_idx.rowid JOIN mem_meta a ON a.r=m.rowid WHERE mem_idx MATCH ? AND m.project=? AND m.id<>? AND a.state='active' AND a.type='habit' LIMIT 65`).all(`scope:"${this.#scope()}" AND ${probe}`,this.#project,saved.id);
          const stem=new RegExp(`^我(?:(?:平时|通常|一般)${f.activity}都|${f.activity}时(?:通常|平时|一般))${f.verb}(\\p{Script=Han}{1,12})[。！!.]?$`,'u');
          const prior=rows.filter(x=>{const q=Buffer.from(x.raw).toString('utf8'),past=parse(q);if(f.kind==='causal')return past?past.activity===f.activity:q.includes(f.activity);return stem.test(q)||(past?.kind==='revision'&&past.activity===f.activity&&past.verb===f.verb);});
          const dest=this.#db.prepare('SELECT rowid r FROM mem WHERE project=? AND id=?').get(this.#project,saved.id).r;
          if(rows.length<65&&prior.length===1){const x=prior[0],q=Buffer.from(x.raw).toString('utf8'),prev=parse(q),v=stem.exec(q)?.[1]||prev?.value,proof=this.#wholeQuote(x.r);
            if(proof&&(f.kind==='causal'?['standingTool','causal'].includes(prev?.kind)&&v===f.prior:v?.endsWith(f.noun))&&v!==f.value&&(proof.pos.sessionId===sid?proof.pos.seq<seq:(!prev||prev.kind==='standingTool'))&&!this.#db.prepare('SELECT 1 FROM mem_auto_hold WHERE r=? UNION ALL SELECT 1 FROM mem_disputed WHERE prior=? OR revision=? LIMIT 1').get(x.r,x.r,x.r)){this.#link(x.r,dest);return saved;}}
          if(rows.length===65||prior.length)this.#db.prepare('INSERT INTO mem_auto_hold VALUES(?)').run(dest);
        }
        return saved;
      }).filter(Boolean);
    });
  }
  #futureSlot(activity){
    // Compute the existing self/use slot via the same canonical evidence encoder.
    const base=require('./auto-policy.cjs').selectCapture(`我${activity}时习惯用绿丝线。`);
    return base?.slot&&`${this.#scope()}:personal-choice:${base.slot}`;
  }
  #futureRoots(slot){return this.#db.prepare(`SELECT m.rowid r,m.id,m.raw,a.expires FROM mem_meta a JOIN mem m ON m.rowid=a.r WHERE m.project=? AND a.slot=? AND a.state='active' LIMIT 2`).all(this.#project,slot);}
  #futureClean(r,now){return (!r.expires||r.expires>now)&&!this.#db.prepare('SELECT 1 FROM mem_auto_hold WHERE r=? UNION ALL SELECT 1 FROM mem_disputed WHERE prior=? OR revision=? LIMIT 1').get(r.r,r.r,r.r)&&this.#wholeQuote(r.r);}
  saveFutureTurn(sid,seq,raw,eventMs,zone){
    const f=require('./future-choice.cjs'),p=f.future(raw),at=f.monday(eventMs,zone);
    if(!p||at===null)return this.saveCaptureTurn(sid,seq,raw,[]);
    return this.#tx(()=>{
      const slot=this.#futureSlot(p.activity),roots=slot&&this.#futureRoots(slot),old=roots?.length===1&&roots[0];
      const prev=old&&f.standing(Buffer.from(old.raw).toString('utf8')),proof=prev&&this.#futureClean(old,eventMs);
      const pending=old&&this.#db.prepare('SELECT 1 FROM mem_future_v1 WHERE prior=?').get(old.r);
      if(!proof||prev.activity!==p.activity||prev.value===p.value||(proof.pos.sessionId===sid&&proof.pos.seq>=seq)||(!pending&&!this.automaticEvidenceRow(old.id)[0]?.summary))return this.saveCaptureTurn(sid,seq,raw,[]);
      const rows=this.saveCaptureTurn(sid,seq,raw,[{text:raw,summary:raw,type:'plan',searchOnly:true,source:{kind:'host-user-quote',sessionId:sid,seq,block:0,utf16Offset:0,utf16Length:raw.length}}]);
      if(rows.length!==1||!rows[0].created||!this.historyAllowed(sid,seq,raw))return [];
      const revision=this.#db.prepare('SELECT rowid FROM mem WHERE id=?').get(rows[0].id).rowid;
      if(pending){ // A second promise is not an ordered replacement of the first.
        this.#db.prepare('INSERT INTO mem_disputed VALUES(?,?)').run(old.r,revision);
      }else this.#db.prepare('INSERT INTO mem_future_v1 VALUES(?,?,?,?,?,?)').run(old.r,revision,slot,eventMs,at,zone);
      return rows;
    });
  }
  futureChoice(query,now){
    const f=require('./future-choice.cjs'),q=f.question(query);if(!q)return null;
    const slot=this.#futureSlot(q.activity);if(!slot)return null;
    const edges=this.#db.prepare('SELECT * FROM mem_future_v1 WHERE slot=? LIMIT 2').all(slot);if(!edges.length)return this.#futureRoots(slot).length>1?[]:null;
    if(edges.length!==1||!Number.isSafeInteger(now))return [];const e=edges[0],olds=this.#futureRoots(slot),old=olds[0];
    if(olds.length!==1||old.r!==e.prior||!this.#futureClean(old,now)||e.effective_ms!==f.monday(e.event_ms,e.zone))return [];
    const next=this.#db.prepare(`SELECT m.rowid r,m.id,m.raw,m.source,m.summary,a.state,a.expires FROM mem m JOIN mem_search_only g ON g.id=m.id JOIN mem_meta a ON a.r=m.rowid WHERE m.project=? AND m.rowid=? AND NOT EXISTS(SELECT 1 FROM mem_auto_hold WHERE r=m.rowid) AND NOT EXISTS(SELECT 1 FROM mem_disputed WHERE prior=m.rowid OR revision=m.rowid) AND NOT EXISTS(SELECT 1 FROM mem_reverse_pending WHERE slot=?)`).get(this.#project,e.revision,slot);
    if(!next||next.state!=='active'||next.expires&&next.expires<=now)return [];
    const s=JSON.parse(next.source),raw=Buffer.from(next.raw).toString('utf8'),p=f.future(raw),prior=f.standing(Buffer.from(old.raw).toString('utf8'));
    if(!p||!prior||p.activity!==q.activity||prior.activity!==q.activity||next.summary!==raw||s.kind!=='host-user-quote'||s.block!==0||s.utf16Offset!==0||s.utf16Length!==raw.length||!this.historyAllowed(s.sessionId,s.seq,raw))return [];
    const due=now>=e.effective_ms;return [{id:due?next.id:old.id,type:'habit',summary:due?p.value:prior.value}];
  }
  #matchesPrevious(sid,seq,raw,project=this.#project){
    if(typeof raw!=='string')return false;
    const permit=this.#db.prepare('SELECT digest FROM history_permit_v2 WHERE project=? AND sid=? AND seq=?').get(project,sid,seq);
    if(permit)return permit.digest===createHash('sha256').update(raw).digest('hex');
    const archived=this.#db.prepare("SELECT digest FROM archive WHERE project=? AND sid=? AND seq=? AND role='user'").get(project,sid,seq);
    if(archived)return archived.digest===createHash('sha256').update(raw).digest('hex');
    // A manually saved excerpt need not have permission to search the entire event.
    const rows=this.#db.prepare("SELECT source,raw FROM mem WHERE project=? AND json_extract(source,'$.kind')='host-user-quote' AND json_extract(source,'$.sessionId')=? AND json_extract(source,'$.seq')=?").all(project,sid,seq);
    return rows.length>0&&rows.every(r=>{const p=JSON.parse(r.source),i=p.utf16Offset,n=p.utf16Length;return p.block===0&&Number.isSafeInteger(i)&&i>=0&&Number.isSafeInteger(n)&&n>0&&i+n<=raw.length&&Buffer.from(raw.slice(i,i+n)).equals(r.raw);});
  }
  #denyEvent(sid,seq,ts){
    // Revoke the same native source in both key spaces; never copy its contents.
    const other=sessionProject(this.#workspace,sid),known=this.#db.prepare('SELECT 1 FROM session_domains WHERE scope=?').get(other);
    for(const p of known?[this.#workspace,other]:[this.#workspace]){
      if(!this.#db.prepare('SELECT 1 FROM history_denied WHERE project=? AND sid=? AND seq=?').get(p,sid,seq)){
        this.#archive.denyIn(p,sid,seq,false);
        this.#db.prepare('INSERT INTO history_denied VALUES(?,?,?)').run(p,sid,seq);
      }
      this.#db.prepare('DELETE FROM history_permit_v2 WHERE project=? AND sid=? AND seq=?').run(p,sid,seq);
    }
  }
  resolvedWithdrawal(sid,seq,raw){return !!this.#db.prepare('SELECT 1 FROM history_resolved WHERE project=? AND sid=? AND seq=? AND digest=?').get(this.#project,sid,seq,createHash('sha256').update(raw).digest('hex'));}
  withdrawPreceding(sid,seq,raw,previous){
    if(!this.#validPosition(sid,seq)||!require('./auto-policy.cjs').previousWithdrawal(raw))return false;
    return this.#tx(()=>{this.#denyEvent(sid,seq);
      if(this.resolvedWithdrawal(sid,seq,raw))return true;
      if(!previous||!this.#validPosition(sid,previous.seq)||previous.seq>=seq||![this.#workspace,sessionProject(this.#workspace,sid)].some(p=>this.#matchesPrevious(sid,previous.seq,previous.raw,p)))return false;
        const pos=previous.seq;
        const rows=this.#db.prepare("SELECT id FROM mem WHERE project=? AND json_extract(source,'$.kind')='host-user-quote' AND json_extract(source,'$.sessionId')=? AND json_extract(source,'$.seq')=?").all(this.#project,sid,pos);
        const prior=rows.length===1?this.#rollbackPrior(rows[0].id):null;
        for(const row of rows)this.forget(row.id);this.#denyEvent(sid,pos);
        if(prior!==null)this.#db.prepare("UPDATE mem_meta SET state='active' WHERE r=? AND state='superseded'").run(prior);
        this.#db.prepare('INSERT OR IGNORE INTO history_resolved VALUES(?,?,?,?)').run(this.#project,sid,seq,createHash('sha256').update(raw).digest('hex'));
      return true;
    });
  }
  observeHistory(sid,seq,raw,admit=true){
    if(!this.#validPosition(sid,seq))throw Error('Invalid history position');
    const d=require('./auto-policy.cjs').historyDirective(raw);
    if(d!=='allow'){this.archiveVeto({sid,seq,text:raw});return false;}
    if(!admit)return false;
    const digest=createHash('sha256').update(raw).digest('hex');
    return this.#tx(()=>{
      if(this.#behindFloor(sid,seq))return false;
      this.#db.prepare('INSERT OR IGNORE INTO history_permit_v2 VALUES(?,?,?,?)').run(this.#project,sid,seq,digest);
      return true;
    });
  }
  // Enumerate only the current profile/project's previously observed permits. Never list global logs.
  historySessions(except,limit) {
    integer(limit,1,32);
    return this.#db.prepare('SELECT DISTINCT sid FROM history_permit_v2 WHERE project=? AND sid<>? ORDER BY sid LIMIT ?').all(this.#project,except,limit).map(r=>r.sid);
  }
  historyAnnotation(sid,seq,raw,start,length,verified=[],locate=false){
    if(!this.#validPosition(sid,seq)||!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||length<=0||start<0||start+length>raw.length)return null;
    if(!this.historyAllowed(sid,seq,raw))return null;
    const source=JSON.stringify(canonical({kind:'host-user-quote',sessionId:sid,seq,block:0,utf16Offset:start,utf16Length:length})),text=raw.slice(start,start+length);
    const hash=createHash('sha256').update(source).update('\0').update(text).digest('hex');
    // Indexed exact lookup; a stale superseded flag with no remaining link proves nothing.
    // Never load the replacement body/summary or expose its identity. Abstain if its permit is gone.
    const row=this.#db.prepare(`SELECT n.source destination,n.dedup destinationDigest FROM mem_visible_v2 m JOIN mem_meta a ON a.r=m.rowid JOIN mem_change c ON c.old=m.rowid JOIN mem_visible_v2 n ON n.rowid=c.new AND n.project=m.project JOIN history_permit_v2 hp ON hp.project=n.project AND hp.sid=json_extract(n.source,'$.sessionId') AND hp.seq=json_extract(n.source,'$.seq') WHERE m.project=? AND m.dedup=? AND m.source=? AND m.raw=? AND a.state='superseded' AND json_extract(n.source,'$.kind')='host-user-quote' `).get(this.#project,hash,source,Buffer.from(text));
    if(!row)return null;const p=JSON.parse(row.destination);
    if(locate==='direct-span')return p; if(locate)return {id:p.sessionId,seq:p.seq};
    if(p.sessionId!==sid){const c=verified.find(v=>v.id===p.sessionId&&v.seq===p.seq);if(!c||!this.historyAllowed(c.id,c.seq,c.raw)||p.block!==0||p.utf16Offset<0||p.utf16Length<=0||p.utf16Offset+p.utf16Length>c.raw.length)return null;
      const digest=createHash('sha256').update(row.destination).update('\0').update(c.raw.slice(p.utf16Offset,p.utf16Offset+p.utf16Length)).digest('hex');if(digest!==row.destinationDigest)return null;}
    return {state:'superseded'};
  }
  historyAllowed(sid,seq,raw) {
    if(!this.#validPosition(sid,seq)||require('./auto-policy.cjs').historyDirective(raw)!=='allow')return false;
    return !!this.#db.prepare('SELECT 1 FROM history_permit_v2 WHERE project=? AND sid=? AND seq=? AND digest=?').get(this.#project,sid,seq,createHash('sha256').update(raw).digest('hex'));
  }
  #scope() { return createHash('sha256').update(this.#project).digest('hex'); }
  #index(rowid, text, summary, ks, searchOnly=false) {
    this.#db.prepare('INSERT INTO mem_idx(rowid,scope,summary,keywords,body) VALUES (?,?,?,?,?)').run(rowid,searchOnly?'archive'+this.#scope():this.#scope(),tokens(summary,true).join(' '),tokens(ks.join(' '),true).join(' '),tokens(text,true).join(' '));
  }
  save({text,summary,keywords,source = {kind:'note'},type='note',concepts=[],slot='',replace=false,evidence=null,oldValue=null,created=Date.now(),expires=0,searchOnly=false},wholeMessage) {
    if(type==='utterance' && !searchOnly)throw Error('Utterances require search-only storage');
    if (!['utterance','note','preference','habit','project','experience','plan'].includes(type)) throw Error('Invalid memory type');
    integer(created,0,Number.MAX_SAFE_INTEGER);integer(expires,0,Number.MAX_SAFE_INTEGER); string(slot,'slot',128,true); concepts=tags(concepts);
    string(text, 'text', 200000);
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('Invalid source');
    const src = string(JSON.stringify(canonical(source)), 'source', 8192), ks = tags(keywords);
    const title = label(summary ?? Array.from(text.trim()).slice(0,80).join(''));
    const hash = createHash('sha256').update(src).update('\0').update(text).digest('hex');
    return this.#tx(() => {
      if(source.kind==='host-user-quote' && this.#validPosition(source.sessionId,source.seq) && this.#behindFloor(source.sessionId,source.seq))throw Object.assign(Error('Source withdrawn or forgotten.'),{code:'STM_PRIVACY_BOUNDARY'});
      const prev = this.#db.prepare('SELECT id FROM mem WHERE project=? AND dedup=?').get(this.#project,hash);
      if (prev) return {id:prev.id,created:false};
      const id = randomUUID();
      const r = this.#db.prepare('INSERT INTO mem(id,project,dedup,raw,summary,tags,source) VALUES(?,?,?,?,?,?,?)').run(id,this.#project,hash,Buffer.from(text),title,JSON.stringify(ks),src);
      const verified=source.kind==='host-user-quote' && typeof wholeMessage==='string' && require('./auto-policy.cjs').historyDirective(wholeMessage)==='allow' && wholeMessage.slice(source.utf16Offset,source.utf16Offset+source.utf16Length)===text;
      if(searchOnly){
        // Separate grant: even an RC7 reader on a downgraded database cannot promote this to curated recall.
        if(!verified || !this.historyAllowed(source.sessionId,source.seq,wholeMessage) || slot || replace || evidence || concepts.length)throw Error('Invalid search-only capture');
        this.#db.prepare('INSERT INTO mem_search_only VALUES(?)').run(id);
      }else if(verified)this.#db.prepare('INSERT INTO mem_consent_v2 VALUES(?)').run(r.lastInsertRowid);
      const family=evidence?.subject==='self' && ['habit','preference'].includes(type)?'personal-choice':type;
      const key=slot ? `${this.#scope()}:${family}:${slot}` : '';
      if(evidence) this.#db.prepare('INSERT INTO mem_fact VALUES(?,?,?,?,?)').run(r.lastInsertRowid,evidence.subject,JSON.stringify(evidence.conditions),evidence.property,evidence.value);
      let repair=null;
      if(key && replace){
        // No last-write-wins on an ambiguous slot: close just one identified predecessor.
        const parsed=family==='personal-choice' && require('./value-frame.cjs').parseValueFrame(text);
        const contrast=parsed?.key && createHash('sha256').update(parsed.key).digest('hex')===slot ? parsed : null;
        const prior=contrast?.prior ? this.#contrastPredecessor(contrast,r.lastInsertRowid) : this.#db.prepare("SELECT a.r FROM mem_meta a JOIN mem_visible_v2 m ON m.rowid=a.r LEFT JOIN mem_fact f ON f.r=a.r WHERE slot=? AND state='active' AND (? IS NULL OR (f.value=? AND substr(rtrim(CAST(m.raw AS TEXT),'。！!.'),-length(?))=?)) LIMIT 2").all(key,oldValue,oldValue,oldValue,oldValue);
        // Count held matches when detecting ambiguity, but never let a held quote certify a successor.
        const reverse=contrast?.kind==='reverse';
        const granted=reverse && verified && this.historyAllowed(source.sessionId,source.seq,wholeMessage);
        const priorQuote=reverse && prior.length===1 && this.#wholeQuote(prior[0].r);
        // Separate sessions have no comparable clocks. An explicit replacement
        // can identify a standing default, but cannot order two revision events.
        const ordered=!reverse || (granted && priorQuote && (source.sessionId===priorQuote.pos.sessionId ? source.seq>priorQuote.pos.seq : priorQuote.frame?.kind!=='reverse'));
        if(prior.length===1 && ordered && !this.#db.prepare('SELECT 1 FROM mem_auto_hold WHERE r=? UNION ALL SELECT 1 FROM mem_disputed WHERE prior=? OR revision=? LIMIT 1').get(prior[0].r,prior[0].r,prior[0].r)){
          this.#link(prior[0].r,r.lastInsertRowid);
          if(granted)repair=contrast;
        }
        else if(oldValue || contrast?.prior){
          // Keep the authorized quote for deliberate reading, not as an automatic current value.
          this.#db.prepare('INSERT INTO mem_auto_hold VALUES(?)').run(r.lastInsertRowid);
          if(granted){
            const overflow=this.#db.prepare('SELECT 1 FROM mem_reverse_overflow WHERE project=? AND denial=? AND r=?').get(this.#project,JSON.stringify([contrast.key,contrast.prior]),r.lastInsertRowid);
            this.#db.prepare('INSERT INTO mem_reverse_pending VALUES(?,?,?)').run(r.lastInsertRowid,key,Number(!overflow && !prior.length));
            // A standing default can have a different slot from the revision.
            // Also veto its exact denied value if that default arrives later.
            this.#db.prepare('INSERT OR IGNORE INTO mem_reverse_overflow VALUES(?,?,?)').run(this.#project,JSON.stringify([contrast.key,contrast.prior]),r.lastInsertRowid);
          }
          // Only suppress positively identified alternatives, never a guessed legacy row.
          if(verified && contrast?.prior && (prior.length>1 || (granted && prior.length===1 && !ordered))){const mark=this.#db.prepare('INSERT INTO mem_disputed VALUES(?,?)');for(const p of prior)mark.run(p.r,r.lastInsertRowid);}
        }
      }
      this.#db.prepare('INSERT INTO mem_meta VALUES(?,?,?,?,?,?)').run(r.lastInsertRowid,type,created,expires,'active',key);
      for(const c of concepts)this.#db.prepare('INSERT INTO mem_topic VALUES(?,?,?)').run(this.#project,c,r.lastInsertRowid);
      this.#index(r.lastInsertRowid,text,title,ks,searchOnly);
      if(repair)this.#repairReverse(r.lastInsertRowid,key,repair);
      return {id,created:true};
    });
  }
  // Roll back only a verified same-session revision→revision edge at its tip.
  // A bare forget, holding a quote, or finding an older similar sentence is not proof.
  #rollbackPrior(id){
    const edge=this.#db.prepare(`SELECT c.old p,c.new n,a.slot FROM mem_visible_v3 m JOIN mem_meta a ON a.r=m.rowid JOIN mem_change c ON c.new=m.rowid JOIN mem_visible_v3 prior ON prior.rowid=c.old AND prior.project=m.project JOIN mem_meta b ON b.r=c.old WHERE m.project=? AND m.id=? AND a.state='active' AND b.state='superseded' AND b.slot=a.slot AND a.slot<>'' AND NOT EXISTS(SELECT 1 FROM mem_change WHERE old=c.new) AND NOT EXISTS(SELECT 1 FROM mem_meta WHERE slot=a.slot AND state='active' AND r<>c.new) AND NOT EXISTS(SELECT 1 FROM mem_auto_hold WHERE r IN(c.old,c.new)) AND NOT EXISTS(SELECT 1 FROM mem_disputed WHERE prior IN(c.old,c.new) OR revision IN(c.old,c.new)) LIMIT 2`).all(this.#project,id);
    if(edge.length!==1)return null;const {p,n}=edge[0],b=this.#wholeQuote(p),c=this.#wholeQuote(n);
    return b?.frame?.kind==='reverse'&&c?.frame?.kind==='reverse'&&b.frame.key===c.frame.key&&b.frame.current===c.frame.prior&&b.pos.sessionId===c.pos.sessionId&&b.pos.seq<c.pos.seq?p:null;
  }
  #link(old,next){
    this.#db.prepare("UPDATE mem_meta SET state='superseded' WHERE r=?").run(old);
    this.#db.prepare('INSERT INTO mem_change VALUES(?,?)').run(old,next);
  }
  #wholeQuote(r){
    const x=this.#db.prepare('SELECT m.raw,m.source,m.summary FROM mem m JOIN mem_consent_v2 g ON g.r=m.rowid WHERE m.rowid=? AND m.project=?').get(r,this.#project);
    if(!x)return null;
    const pos=JSON.parse(x.source),raw=Buffer.from(x.raw).toString('utf8');
    if(pos.kind!=='host-user-quote'||pos.block!==0||pos.utf16Offset!==0||pos.utf16Length!==raw.length||x.summary!==raw||!this.historyAllowed(pos.sessionId,pos.seq,raw))return null;
    return {pos,frame:require('./value-frame.cjs').parseValueFrame(raw)};
  }
  #repairReverse(row,slot,frame){
    // Only an isolated, strictly later, whole-append successor may discharge
    // its own hold. LIMIT 2 detects non-uniqueness without truncating to one.
    const xs=this.#db.prepare(`SELECT a.r,p.retry FROM mem_meta a LEFT JOIN mem_reverse_pending p ON p.r=a.r WHERE a.slot=? AND a.state='active' AND a.r<>? LIMIT 2`).all(slot,row);
    if(xs.length!==1||!xs[0].retry)return;
    const next=xs[0].r,x=this.#wholeQuote(next),cur=this.#wholeQuote(row);
    if(!cur||!x||x.pos.sessionId!==cur.pos.sessionId||x.pos.seq<=cur.pos.seq||x.frame?.kind!=='reverse'||x.frame.key!==frame.key||x.frame.prior!==frame.current)return;
    if(this.#db.prepare('SELECT 1 FROM mem_disputed WHERE prior IN (?,?) OR revision IN (?,?) LIMIT 1').get(row,next,row,next))return;
    const candidates=this.#contrastPredecessor(x.frame,next);
    if(candidates.length!==1||candidates[0].r!==row)return;
    this.#link(row,next);
    this.#db.prepare('DELETE FROM mem_reverse_overflow WHERE r=?').run(next);
    this.#db.prepare('DELETE FROM mem_reverse_pending WHERE r=?').run(next);
    this.#db.prepare('DELETE FROM mem_auto_hold WHERE r=?').run(next);
  }
  #contrastPredecessor(frame,currentRow) {
    if(frame.kind==='reverse'){
      // Literal prior argument or an omitted, shared complement: both end
      // characters are known before lookup. Do not scan the project corpus.
      const probe=[...new Set([...tokens(frame.ctx),...tokens(frame.prior)])].map(t=>`body:"${t}"`).join(' AND ');
      const rows=this.#db.prepare(`SELECT m.rowid r,m.raw,a.type,a.state FROM mem_idx JOIN mem m ON m.rowid=mem_idx.rowid JOIN mem_meta a ON a.r=m.rowid JOIN mem_consent_v2 g ON g.r=m.rowid WHERE mem_idx MATCH ? AND m.project=? AND a.state='active' AND a.type IN ('habit','preference') AND m.rowid<>? LIMIT 65`).all(`scope:"${this.#scope()}" AND ${probe}`,this.#project,currentRow);
      const overflow=()=>{if(this.#db.prepare('SELECT 1 FROM mem_consent_v2 WHERE r=?').get(currentRow))this.#db.prepare('INSERT OR IGNORE INTO mem_reverse_overflow VALUES(?,?,?)').run(this.#project,JSON.stringify([frame.key,frame.prior]),currentRow);return [];};
      if(rows.length>64)return overflow();
      const {reversePrior,parseValueFrame}=require('./value-frame.cjs');
      const matches=rows.filter(row=>row.state==='active'&&['habit','preference'].includes(row.type)&&reversePrior(Buffer.from(row.raw).toString('utf8'),frame));
      // A previous contrast ends in the *retired* value, so the tail index
      // cannot enumerate chains. Independently probe the exact activity slot.
      const scoped=this.#db.prepare(`SELECT m.rowid r,m.raw FROM mem_meta a JOIN mem m ON m.rowid=a.r JOIN mem_consent_v2 g ON g.r=a.r WHERE a.slot=? AND a.state='active' AND m.project=? AND a.type IN ('habit','preference') LIMIT 65`).all(`${this.#scope()}:personal-choice:${createHash('sha256').update(frame.key).digest('hex')}`,this.#project);
      if(scoped.length>64)return overflow();
      for(const row of scoped){const p=parseValueFrame(Buffer.from(row.raw).toString('utf8'));if(p?.key===frame.key&&p.current===frame.prior&&!matches.some(x=>x.r===row.r))matches.push(row);}
      return matches;
    }
    // Use a project-local suffix bucket. Overflow is uncertainty, never an
    // excuse to assume that the first N happen to contain the only match.
    const rows=this.#db.prepare(`SELECT m.rowid r, m.raw,m.source,a.type,a.state FROM mem m
      INDEXED BY mem_quote_tail LEFT JOIN mem_meta a ON a.r=m.rowid
      WHERE m.project=? AND ${visibleV2} AND substr(rtrim(CAST(m.raw AS TEXT),'。！!.'),-1)=? AND m.rowid<>? LIMIT 65`).all(this.#project,Array.from(frame.prior).at(-1),currentRow);
    if(rows.length>64)return [];
    return rows.filter(row=>{
      if(row.state!=='active'||!['preference','habit'].includes(row.type)||JSON.parse(row.source).kind!=='host-user-quote')return false;
      const raw=Buffer.from(row.raw).toString('utf8');if(!raw.replace(/[。！!.]$/u,'').endsWith(frame.prior))return false;
      const prior=require('./value-frame.cjs').parseValueFrame(raw);
      return prior?.key===frame.key && prior.current===frame.prior;
    });
  }
  consolePage(page=1){integer(page,1,100000);const hits=this.#db.prepare('SELECT DISTINCT id FROM mem_visible_v3 WHERE project=? ORDER BY id LIMIT 21 OFFSET ?').all(this.#project,(page-1)*20);return {page,nextPage:hits.length>20?page+1:null,items:hits.slice(0,20).map(({id})=>{const {type,state,summary,claimStatus}=this.read(id,0,1);return {id,type,state,summary,claimStatus};})};}
  clearConsoleSession(sid,last){string(sid,'session',512);integer(last,-1,Number.MAX_SAFE_INTEGER);if(this.#sid&&sid!==this.#sid)throw Error('Scope');return this.#tx(()=>{const rows=this.#db.prepare("SELECT id FROM mem WHERE project=? AND json_extract(source,'$.sessionId')=?").all(this.#project,sid);for(const r of rows)this.forget(r.id);if(last>=0){for(const p of [this.#workspace,sessionProject(this.#workspace,sid)]){this.#db.prepare('INSERT INTO history_floor VALUES(?,?,?) ON CONFLICT(project,sid) DO UPDATE SET seq=max(seq,excluded.seq)').run(p,sid,last);this.#db.prepare('DELETE FROM history_permit_v2 WHERE project=? AND sid=? AND seq<=?').run(p,sid,last);this.#archive.denyIn(p,sid,last,true);}}return {cleared:true,removedMemories:rows.length};});}
  search(query, limit = 5) {
    string(query,'query',1024); integer(limit,1,20);
    const words = tokens(query).slice(0,48);
    if (!words.length) return [];
    const match = `(scope:"${this.#scope()}" OR scope:"archive${this.#scope()}") AND {summary keywords body}:(${words.map(w => `"${w}"`).join(' OR ')})`;
    return this.#db.prepare(`SELECT (EXISTS(SELECT 1 FROM mem_disputed d WHERE d.prior=m.rowid OR d.revision=m.rowid) OR (a.state='active' AND NOT ${unblockedSlot})) disputed,m.id,m.summary,coalesce(a.type,'note') type,coalesce(a.state,'active') state,coalesce(a.expires,0) expires FROM mem_idx JOIN mem_visible_v3 m ON m.rowid=mem_idx.rowid LEFT JOIN mem_meta a ON a.r=m.rowid WHERE mem_idx MATCH ? AND m.project=? ORDER BY bm25(mem_idx,0,4,6,1),m.rowid DESC LIMIT ?`).all(match,this.#project,limit).map(({disputed,...row})=>({...row,...disputeLabel(disputed)}));
  }
  // Automatic admission only. Manual search() keeps full-corpus BM25 ranking.
  // Sample each posting list independently so an old unique term survives common terms.
  // On saturated lists, deliberately prefer recently inserted rows over exhaustive ranking.
  // Enumerate object postings within a project, independently of ranking.
  // Overflow is unknown, not evidence that a short top-K list is unique.
  preparationEvidence(work,now){
    if(!/^[\p{Script=Han}]{3,23}$/u.test(work))return null;
    const probe=tokens(work.slice(-2)).map(t=>`body:"${t}"`).join(' AND ');if(!probe)return null;
    const rows=this.#db.prepare(`SELECT m.rowid r,m.id,m.raw,a.state,a.expires FROM mem_idx JOIN mem m ON m.rowid=mem_idx.rowid JOIN mem_meta a ON a.r=m.rowid JOIN mem_consent_v2 g ON g.r=m.rowid WHERE mem_idx MATCH ? AND m.project=? AND a.type='habit' LIMIT 65`).all(`scope:"${this.#scope()}" AND ${probe}`,this.#project);if(rows.length>64)return null;
    const {curatedChoice}=require('./auto-policy.cjs');const roots=[];
    for(const r of rows){const f=curatedChoice(Buffer.from(r.raw).toString('utf8'));if(f?.kind==='standingTool'&&(work===f.object+f.activity||f.activity.startsWith('做')&&work===f.object+f.action+f.activity.slice(1)))roots.push({r,f});}
    if(roots.length!==1)return null;let {r,f}=roots[0];if(!this.#wholeQuote(r.r))return null;
    if(r.state==='superseded'){const next=this.#db.prepare('SELECT m.rowid r,m.id,m.raw,a.state,a.expires FROM mem_change c JOIN mem m ON m.rowid=c.new JOIN mem_meta a ON a.r=c.new WHERE c.old=? AND m.project=?').get(r.r,this.#project);if(!next||!this.#wholeQuote(next.r))return null;const changed=curatedChoice(Buffer.from(next.raw).toString('utf8'));if(changed?.kind!=='causal'||changed.activity!==f.activity||changed.prior!==f.value)return null;r=next;f=changed;}
    if(r.state!=='active'||r.expires&&r.expires<=now)return null;
    const [h]=this.automaticEvidenceRow(r.id);return h?.summary===Buffer.from(r.raw).toString('utf8')?{id:h.id,type:h.type,summary:f.value}:null;
  }
  placementOwner(object,ctx){
    if(!/^[\p{Script=Han}]{1,24}$/u.test(object))return null;
    const probe=tokens(object).map(t=>`body:"${t}"`).join(' AND ');
    const rows=this.#db.prepare(`SELECT m.id,m.raw,EXISTS(SELECT 1 FROM mem_auto_hold h WHERE h.r=m.rowid) held FROM mem_idx JOIN mem m ON m.rowid=mem_idx.rowid JOIN mem_meta a ON a.r=m.rowid JOIN mem_consent_v2 g ON g.r=m.rowid WHERE mem_idx MATCH ? AND m.project=? AND a.state='active' AND a.type IN ('habit','preference') LIMIT 65`).all(`scope:"${this.#scope()}" AND ${probe}`,this.#project);if(rows.length>64)return null;
    const matches=rows.filter(r=>{const f=/^我([\p{Script=Han}]{0,28}?)(?:通常|平时|一般|习惯|总是)(?:把|将)([\p{Script=Han}]{1,24}?)(?:放|收|存)(?:在|到)([\p{Script=Han}]{1,32})[。！!.]?$/u.exec(Buffer.from(r.raw).toString('utf8'));return f&&f[2]===object&&(!ctx||ctx===f[1]);});return matches.length===1&&!matches[0].held?matches[0].id:null;
  }
  instrumentEvidence(q,now){
    if(!q?.valid)return null;
    const probe=tokens(q.activity).map(t=>`body:"${t}"`).join(' AND ');if(!probe)return null;
    const rows=this.#db.prepare(`SELECT m.id,m.summary,m.raw,a.state,a.type,a.expires FROM mem_idx JOIN mem m ON m.rowid=mem_idx.rowid JOIN mem_meta a ON a.r=m.rowid WHERE mem_idx MATCH ? AND ${visibleV2} AND m.project=? AND a.state='active' AND a.type IN ('habit','preference') LIMIT 65`).all(`scope:"${this.#scope()}" AND ${probe}`,this.#project);if(rows.length>64)return null;
    const {conditioned}=require('./value-frame.cjs');let unique=null;
    for(const r of rows){const raw=Buffer.from(r.raw).toString('utf8'),f=conditioned(raw);if(!f||f.activity!==q.activity||f.condition!==q.condition)continue;if(unique||raw!==r.summary||!f.value||r.expires&&r.expires<=now)return null;const end=raw.replace(/[。！!]$/u,'').length,start=end-f.value.length;if(raw.slice(start,end)!==f.value)return null;unique={id:r.id,value:f.value,start,end};}return unique;
  }
  #overflowSafe(hits){
    if(!this.#db.prepare('SELECT 1 FROM mem_reverse_overflow WHERE project=? LIMIT 1').get(this.#project))return hits;
    const {denialKeys,reversePrior,parseValueFrame}=require('./value-frame.cjs');
    const stmt=this.#db.prepare(`SELECT m.raw FROM mem_reverse_overflow o JOIN mem m ON m.rowid=o.r JOIN mem_consent_v2 g ON g.r=o.r JOIN history_permit_v2 h ON h.project=m.project AND h.sid=json_extract(m.source,'$.sessionId') AND h.seq=json_extract(m.source,'$.seq') WHERE o.project=? AND m.project=o.project AND o.denial=? LIMIT 9`);
    return hits.map(hit=>{if(!hit.summary||!['habit','preference'].includes(hit.type))return hit;
      for(const key of denialKeys(hit.summary)){const rows=stmt.all(this.#project,key);if(rows.length>8||rows.some(row=>{const f=parseValueFrame(Buffer.from(row.raw).toString('utf8')),p=parseValueFrame(hit.summary);return f?.kind==='reverse'&&(reversePrior(hit.summary,f)||p?.key===f.key&&p.current===f.prior);}))return {...hit,summary:null};}return hit;});
  }
  searchAutomatic(query,limit=12) {
    string(query,'query',1024); integer(limit,1,20);
    const words=tokens(query).slice(0,48), pool=new Map(), cap=24;
    const stmt=this.#db.prepare('SELECT rowid FROM mem_idx WHERE mem_idx MATCH ? ORDER BY rowid DESC LIMIT ?');
    const scope=this.#scope();
    for(const word of words){
      const rows=stmt.all(`scope:"${scope}" AND {summary keywords body}:"${word}"`,cap+1);
      const weight=1/Math.sqrt(Math.max(1,rows.length));
      for(const {rowid} of rows.slice(0,cap))pool.set(rowid,(pool.get(rowid)||0)+weight);
    }
    if(!pool.size)return [];
    const ids=[...pool.keys()].sort((a,b)=>pool.get(b)-pool.get(a)||b-a);
    // Only hydrate the scored prefix, rechecking project ownership on the principal table.
    const shortlist=ids.slice(0,limit*2);
    return this.#automaticRows(shortlist).sort((a,b)=>pool.get(b.rowid)-pool.get(a.rowid)||b.rowid-a.rowid).slice(0,limit).map(({rowid,...hit})=>hit);
  }
  automaticEvidenceRow(id){
    const found=this.#db.prepare(`SELECT m.rowid FROM mem m WHERE m.project=? AND m.id=? AND ${visibleV2} AND EXISTS(SELECT 1 FROM mem_consent_v2 g WHERE g.r=m.rowid)`).get(this.#project,id);
    if(!found)return [];return this.#automaticRows([found.rowid]).map(({rowid,...hit})=>hit);
  }
  #automaticRows(shortlist){
    const sql=`SELECT m.rowid,m.id,CASE WHEN NOT EXISTS(SELECT 1 FROM mem_auto_hold h WHERE h.r=m.rowid) AND NOT EXISTS(SELECT 1 FROM mem_disputed d WHERE d.prior=m.rowid) AND ${unblockedSlot} AND m.summary=substr(CAST(substr(m.raw,1,960) AS TEXT),1,length(m.summary)) THEN m.summary END summary,coalesce(a.type,'note') type,coalesce(a.state,'active') state,coalesce(a.expires,0) expires FROM mem m${shortlist.length>=24?' NOT INDEXED':''} LEFT JOIN mem_meta a ON a.r=m.rowid WHERE ${visibleV2} AND m.project=? AND m.rowid IN (${shortlist.map(()=>'?').join(',')})`;
    return this.#overflowSafe(this.#db.prepare(sql).all(this.#project,...shortlist));
  }
  // Bounded pool of curated rows, not archives, search-only items, or imported notes.
  semanticPool(limit=64) {
    integer(limit,1,256);
    const rows=this.#db.prepare(`SELECT m.rowid FROM mem m JOIN mem_consent_v2 g ON g.r=m.rowid JOIN history_permit_v2 h ON h.project=m.project AND h.sid=json_extract(m.source,'$.sessionId') AND h.seq=json_extract(m.source,'$.seq') WHERE m.project=? AND json_extract(m.source,'$.kind')='host-user-quote' AND NOT EXISTS(SELECT 1 FROM mem_search_only q WHERE q.id=m.id) ORDER BY m.rowid DESC LIMIT ?`).all(this.#project,limit);
    if(!rows.length)return [];
    return this.#automaticRows(rows.map(r=>r.rowid)).filter(r=>r.summary&&r.state==='active'&&(!r.expires||r.expires>Date.now())).map(r=>r.id);
  }
  conceptCandidates(concepts,limit=12) {
    const results=new Map(); integer(limit,1,20);
    for(const c of tags(concepts).slice(0,4))for(const h of this.#db.prepare(`SELECT m.id,CASE WHEN NOT EXISTS(SELECT 1 FROM mem_auto_hold h WHERE h.r=m.rowid) AND NOT EXISTS(SELECT 1 FROM mem_disputed d WHERE d.prior=m.rowid) AND ${unblockedSlot} AND m.summary=substr(CAST(substr(m.raw,1,960) AS TEXT),1,length(m.summary)) THEN m.summary END summary,a.type,a.expires,a.state FROM mem_topic t JOIN mem_visible_v2 m ON t.r=m.rowid JOIN mem_meta a ON a.r=t.r WHERE t.project=? AND t.topic=? AND m.project=? ORDER BY t.r DESC LIMIT ?`).all(this.#project,c,this.#project,limit)) results.set(h.id,{...h});
    return this.#overflowSafe([...results.values()]);
  }
  read(id, offset = 0, limit = 1000) {
    integer(offset,0,Number.MAX_SAFE_INTEGER); integer(limit,1,4000);
    const r = this.#db.prepare(`SELECT (EXISTS(SELECT 1 FROM mem_disputed d WHERE d.prior=m.rowid OR d.revision=m.rowid) OR (a.state='active' AND NOT ${unblockedSlot})) disputed,m.raw,m.summary,m.tags,m.source,coalesce(a.type,'note') type,coalesce(a.state,'active') state,coalesce(a.expires,0) expires FROM mem_visible_v3 m LEFT JOIN mem_meta a ON a.r=m.rowid WHERE m.project=? AND m.id=?`).get(this.#project,string(id,'id',128));
    if (!r) return null;
    const chars = Array.from(Buffer.from(r.raw).toString('utf8'));
    const fact=this.#db.prepare('SELECT f.* FROM mem_fact f JOIN mem_visible_v2 m ON m.rowid=f.r WHERE m.project=? AND m.id=?').get(this.#project,id);
    const evidence=fact?{subject:fact.subject,conditions:JSON.parse(fact.conditions),property:fact.property,value:fact.value}:null;
    const links=this.#db.prepare('SELECT p.id previous,n.id current FROM mem_change c JOIN mem_visible_v2 p ON p.rowid=c.old JOIN mem_visible_v2 n ON n.rowid=c.new WHERE (c.old=? OR c.new=?) AND p.project=? AND n.project=?').all(fact?.r??-1,fact?.r??-1,this.#project,this.#project);
    return {id,...disputeLabel(r.disputed),evidence,links:links.map(x=>({...x})),type:r.type,state:r.state,expires:r.expires,summary:r.summary,keywords:JSON.parse(r.tags),source:JSON.parse(r.source),text:chars.slice(offset,offset+limit).join(''),offset,nextOffset:offset+limit<chars.length?offset+limit:null,total:chars.length};
  }
  correct(id, {summary, keywords}) {
    if (summary === undefined && keywords === undefined) throw new TypeError('No correction supplied');
    return this.#tx(() => {
      const r = this.#db.prepare('SELECT rowid,summary,tags,raw,EXISTS(SELECT 1 FROM mem_search_only q WHERE q.id=mem_visible_v3.id) searchOnly FROM mem_visible_v3 WHERE project=? AND id=?').get(this.#project,string(id,'id',128));
      if (!r) return false;
      const title = summary===undefined?r.summary:label(summary), ks = keywords===undefined?JSON.parse(r.tags):tags(keywords);
      if(title!==r.summary)this.#db.prepare('INSERT OR IGNORE INTO mem_auto_hold VALUES(?)').run(r.rowid);
      this.#db.prepare('UPDATE mem SET summary=?,tags=? WHERE rowid=?').run(title,JSON.stringify(ks),r.rowid);
      this.#db.prepare('DELETE FROM mem_idx WHERE rowid=?').run(r.rowid);
      this.#index(r.rowid,Buffer.from(r.raw).toString('utf8'),title,ks,r.searchOnly); return true;
    });
  }
  maintainCapture(limit=8){return this.#tx(()=>require('./capture-maintenance.cjs').run(this.#db,this.#project,limit));}
  purgeArchiveSession(sid){return this.#tx(()=>{
    if(!this.#validPosition(sid,0)||(this.#sid!==null&&sid!==this.#sid))throw Error('Invalid session');
    const privateScope=sessionProject(this.#workspace,sid);const r=this.#db.prepare('SELECT max(seq) seq FROM archive WHERE project IN (?,?) AND sid=?').get(this.#workspace,privateScope,sid);
    if(r.seq===null)return false;
    for(const p of [this.#workspace,privateScope]){
      this.#db.prepare('INSERT INTO history_floor VALUES(?,?,?) ON CONFLICT(project,sid) DO UPDATE SET seq=max(seq,excluded.seq)').run(p,sid,r.seq);
      this.#db.prepare('DELETE FROM history_permit_v2 WHERE project=? AND sid=? AND seq<=?').run(p,sid,r.seq);
      this.#archive.denyIn(p,sid,r.seq,true);
    }return true;
  });}
  resumeArchiveReplies(){return this.#tx(()=>this.#archive.resume());}
  archiveStatus(){return this.#archive.status();}
  setArchiveEnabled(on){return this.#tx(()=>this.#archive.set(on));}
  archiveImportTurns({epoch,sid,turns,since=0}){return this.#tx(()=>{
    const st=this.archiveStatus();if(!st.enabled||st.epoch!==epoch||!this.#validPosition(sid,0)||(this.#sid&&sid!==this.#sid)||!Array.isArray(turns))throw Error('Archive import authorization changed.');
    if(!Number.isSafeInteger(since)||since<0)throw Error('Invalid import policy');
    return turns.reduce((n,t)=>t.user?.ts>since?n+this.archiveTurn({epoch,sid,user:t.user,assistant:t.assistant}):n,0);
  });}
  archiveList(q){return this.#archive.list(q);}
  
  archiveSource(id){return this.#archive.source(id);}
  archiveModelSource(id){return this.#archive.source(id,true);}
  archiveModelHeld(id){return this.#archive.held(id);}
  archiveVeto({sid,seq,text,ts}){
    if(!this.#validPosition(sid,seq)||require('./auto-policy.cjs').historyDirective(text,'archive')==='allow')return false;
    return this.#tx(()=>{if(this.#db.prepare('SELECT 1 FROM history_denied WHERE project=? AND sid=? AND seq=?').get(this.#project,sid,seq))return false;
      this.#denyEvent(sid,seq,ts);return true;});
  }
  archiveTurn(t){return this.#tx(()=>{
    if(t.user&&typeof t.user.text==='string'&&require('./auto-policy.cjs').historyDirective(t.user.text,'archive')!=='allow'){
      this.archiveVeto({sid:t.sid,...t.user});return 0;
    }if(t.user&&this.#validPosition(t.sid,t.user.seq)&&this.#behindFloor(t.sid,t.user.seq))return 0;
    return this.#archive.turn(t);
  });}
  wipeProject(){return this.#tx(()=>{
    // Keep only non-content fences. Removing a grant alone would permit a
    // delayed handler to mint it again from the still-existing native log.
    this.#db.prepare(`INSERT INTO history_floor(project,sid,seq) SELECT project,sid,max(seq) FROM (
      SELECT project,sid,seq FROM history_permit_v2 WHERE project=? UNION ALL SELECT project,sid,seq FROM archive WHERE project=?
      ) GROUP BY project,sid ON CONFLICT(project,sid) DO UPDATE SET seq=max(history_floor.seq,excluded.seq)`).run(this.#project,this.#project);
    for(const r of this.#db.prepare('SELECT id FROM mem WHERE project=?').all(this.#project))this.forget(r.id);
    for(const table of ['archive','archive_setting','history_resolved','history_permit_v2','organize_event_v1','organize_dirty_v1'])this.#db.prepare(`DELETE FROM ${table} WHERE project=?`).run(this.#project);
    this.#archive.guard();this.#archive.set(false);return true;
  });}
  forget(id) {
    return this.#tx(() => {
      if(typeof id==='string'&&id.startsWith('arc-')){
        const r=this.archiveSource(id);if(!r)return false;
        if(r.role==='assistant'){this.#archive.fence(r.sid,r.userSeq);return true;}
        const related=this.#db.prepare("SELECT id FROM mem WHERE project=? AND json_extract(source,'$.kind')='host-user-quote' AND json_extract(source,'$.sessionId')=? AND json_extract(source,'$.seq')=?").all(this.#project,r.sid,r.seq);
        for(const m of related)this.forget(m.id);
        this.#denyEvent(r.sid,r.seq,r.ts);return true;
      }
      const r = this.#db.prepare('DELETE FROM mem WHERE project=? AND id=? RETURNING rowid,source').get(this.#project,string(id,'id',128));
      if (!r) return false;
      this.#db.prepare('DELETE FROM mem_search_only WHERE id=?').run(id);
      const p=JSON.parse(r.source);
      if(p.kind==='host-user-quote' && this.#validPosition(p.sessionId,p.seq)) this.#denyEvent(p.sessionId,p.seq);
      else this.#archive.guard(); // No source position to bound possible assistant quotations.
      this.#db.prepare('DELETE FROM mem_idx WHERE rowid=?').run(r.rowid);
      this.#db.prepare('DELETE FROM mem_topic WHERE r=?').run(r.rowid);
      this.#db.prepare('DELETE FROM mem_change WHERE old=? OR new=?').run(r.rowid,r.rowid);
      this.#db.prepare('DELETE FROM mem_consent_v2 WHERE r=?').run(r.rowid);
      this.#db.prepare('DELETE FROM mem_auto_hold WHERE r=?').run(r.rowid);
      this.#db.prepare('DELETE FROM mem_disputed WHERE prior=? OR revision=?').run(r.rowid,r.rowid);
      this.#db.prepare('DELETE FROM mem_fact WHERE r=?').run(r.rowid);
      this.#db.prepare('DELETE FROM mem_meta WHERE r=?').run(r.rowid);return true;
    });
  }
  historyLiteralTarget(raw){
    const digest=createHash('sha256').update(raw).digest('hex');
    const hits=this.#db.prepare('SELECT sid,seq FROM history_permit_v2 WHERE project=? AND digest=? LIMIT 2').all(this.#project,digest);
    if(hits.length>1)return {status:'ambiguous',deleted:false};
    if(!hits.length)return null;
    const {sid,seq}=hits[0];
    const linked=this.#db.prepare(`SELECT id,raw,source,rowid FROM mem WHERE project=? AND json_extract(source,'$.sessionId')=? AND json_extract(source,'$.seq')=? LIMIT 2`).all(this.#project,sid,seq);
    let linkedId=null;
    if(linked.length){
      if(!raw.startsWith('请记住：'))return null; // preserve existing exact-body deletion policy
      if(linked.length!==1)return {deleted:false,status:'ambiguous'};
      const row=linked[0],p=JSON.parse(row.source),body=raw.slice(4);
      if(!body||p.kind!=='host-user-quote'||p.block!==0||p.utf16Offset!==4||p.utf16Length!==body.length||!Buffer.from(row.raw).equals(Buffer.from(body))||!this.#db.prepare('SELECT 1 FROM mem_consent_v2 WHERE r=?').get(row.rowid)||!this.historyAllowed(sid,seq,raw))return {deleted:false,status:'unavailable'};
      if(this.#db.prepare('SELECT 1 FROM mem WHERE project=? AND raw=? AND id<>? LIMIT 1').get(this.#project,Buffer.from(body),row.id)||this.#db.prepare('SELECT 1 FROM archive WHERE project=? AND role=? AND digest=? LIMIT 1').get(this.#project,'user',createHash('sha256').update(body).digest('hex')))return {deleted:false,status:'ambiguous'};
      linkedId=row.id;
    }
    if(this.#db.prepare('SELECT 1 FROM mem WHERE project=? AND raw=?').get(this.#project,Buffer.from(raw))||this.#db.prepare('SELECT 1 FROM archive WHERE project=? AND digest=? AND NOT(sid=? AND seq=?) LIMIT 1').get(this.#project,digest,sid,seq))return {status:'ambiguous',deleted:false};
    const a=this.#db.prepare('SELECT id,userSeq,role,text,digest,ts FROM archive WHERE project=? AND sid=? AND seq=?').get(this.#project,sid,seq);
    if(a&&(a.userSeq!==seq||a.role!=='user'||a.digest!==digest))return {status:'unavailable',deleted:false};
    return {sid,seq,archiveId:a?.id??null,archiveTime:a?.ts??null,...(linkedId?{linkedId}:{})};
  }
  revokeVerifiedLiteral(raw,sid,seq,archiveId,archiveTime,linkedId){return this.#tx(()=>{const again=this.historyLiteralTarget(raw);if(again?.sid!==sid||again?.seq!==seq||again.archiveId!==archiveId||again.archiveTime!==archiveTime||again.linkedId!==linkedId||!this.historyAllowed(sid,seq,raw))return {deleted:false,status:'unavailable'};if(linkedId&&!this.forget(linkedId))throw Error('stale verified target');this.#denyEvent(sid,seq,archiveTime??Date.now());return {deleted:true,status:'deleted'};});}
  forgetConsoleLiteral(raw,sid,seq){return this.#tx(()=>{const found=require('./literal.cjs').resolve(this.#db,this.#project,{literal:raw});if(!found.id)return found;const r=this.read(found.id,0,1);if(r?.source?.sessionId!==sid||r.source.seq!==seq)return {deleted:false,status:'unavailable'};return {deleted:this.forget(found.id),status:'deleted'};});}
  forgetRequested(raw){const rules=require('./curated-forget.cjs'),t=rules.request(raw);if(!t)return {deleted:false,status:'not_requested'};return this.#tx(()=>{const found=t.id?t:rules.resolve(this.#db,this.#project,t);if(!found.id)return found;const deleted=this.forget(found.id);return {deleted,status:deleted?'deleted':'not_found'};});}
  close() { this.#db.close(); }
}
module.exports = {Store};
