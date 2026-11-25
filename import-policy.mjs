import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

// Profile settings apply to every workspace, including one never opened while
// archive was off. Keep only an import watermark, never text or session IDs.
export function profileImportPolicy(profile,enabled){
  if(typeof profile!=='string'||!profile.trim())throw Error('Missing profile identity');
  const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
  if(!path.isAbsolute(home))throw Error('Absolute DSH_HOME required');
  const dir=path.join(home,'data','dsh-standalone-memory'),file=path.join(dir,'import-'+createHash('sha256').update(profile).digest('hex')+'.policy');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  let created=false;
  try{fs.closeSync(fs.openSync(file,'wx',0o600));created=true;}catch(e){if(e.code!=='EEXIST')throw e;}
  const db=new DatabaseSync(file);
  try{
    db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');
    if(created){
      db.exec('CREATE TABLE policy(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),since INTEGER NOT NULL CHECK(since>=0)) STRICT');
      db.prepare('INSERT INTO policy VALUES(1,?,0)').run(+enabled);
    }else{
      const row=db.prepare('SELECT enabled,since FROM policy WHERE id=1').get();
      if(!row||![0,1].includes(row.enabled)||!Number.isSafeInteger(row.since)||row.since<0)throw Error('Invalid import policy');
      if(row.enabled!==+enabled)db.prepare('UPDATE policy SET enabled=?,since=max(since,?) WHERE id=1').run(+enabled,Date.now());
    }
    db.exec('COMMIT');
  }finally{db.close();}
  return ()=>{const db=new DatabaseSync(file,{readOnly:true});try{const row=db.prepare('SELECT enabled,since FROM policy WHERE id=1').get();return row?.enabled===1&&Number.isSafeInteger(row.since)&&row.since>=0?row.since:Infinity;}finally{db.close();}};
}
