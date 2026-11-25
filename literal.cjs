'use strict';
// A user's quotation is a selector, never an instruction to execute its contents.
// No automatic deletion from free-form topics: ask the user for a literal selector.
function request(s){if(typeof s!=='string'||s.length>320||/[\r\n\u0000-\u001f\u007f]/u.test(s))return null;
 const prefix='忘记这条记忆：';if(s.startsWith(prefix)){const raw=s.slice(prefix.length);if(require('./future-choice.cjs').future(raw))return {futureLiteral:raw,label:raw};}
 let m=/^(?:请)?(?:删除|忘掉|忘记|移除)(?:我)?(?:之前|先前|以前)?(?:保存|记录|说过)?的?(?:那条|这条)?(?:记忆|原话|记录)[:：]\s*「([^「」]{4,160})」[。！!]?$/u.exec(s);if(m)return {literal:m[1],label:m[1]};
 m=/^(?:请)?把(?:包含|含有)「([^「」]{4,160})」的那条(?:记忆|记录)(?:删掉|忘掉|删除)[。！!]?$/u.exec(s);if(m)return {fragment:m[1],label:m[1]};
 m=/^(?:请)?(?:忘掉|删除|移除|忘记)(?:我)?(?:之前|以前|先前)?(?:保存|记录|说过)?的?(?:那条|这条)?(?:关于|有关)([\p{Script=Han}\p{L}\p{N} ·-]{1,40})的(?:记忆|记录)[。！!]?$/u.exec(s);return m?{clarify:true,label:m[1]}:null;}
function resolve(db,project,t){if(t.futureLiteral){
  // Check all exact source rows first, not just eligible ones: never guess between sources.
  const rows=db.prepare('SELECT id,rowid r FROM mem WHERE project=? AND raw=? LIMIT 2').all(project,Buffer.from(t.futureLiteral));
  if(rows.length!==1)return {deleted:false,status:rows.length?'ambiguous':'not_found'};
  const {id,r}=rows[0];const proof=db.prepare(`SELECT h.digest FROM mem_future_v1 f JOIN mem_visible_v3 m ON m.rowid=f.revision JOIN history_permit_v2 h ON h.project=m.project AND h.sid=json_extract(m.source,'$.sessionId') AND h.seq=json_extract(m.source,'$.seq') JOIN mem_search_only g ON g.id=m.id WHERE f.revision=? AND m.project=? AND json_extract(m.source,'$.kind')='host-user-quote' AND json_extract(m.source,'$.utf16Offset')=0 AND json_extract(m.source,'$.utf16Length')=?`).get(r,project,t.futureLiteral.length);
  return proof?.digest===require('node:crypto').createHash('sha256').update(t.futureLiteral).digest('hex')?{id}:{deleted:false,status:'not_found'};
 }if(t.clarify)return {deleted:false,status:'clarify_with_literal'};const needle=t.literal??t.fragment;if(!needle)return null;
 // Completeness before uniqueness: size and all matches are checked in the same transaction.
 const rows=db.prepare('SELECT m.rowid r,m.id FROM mem m INDEXED BY mem_organize_project WHERE project=? ORDER BY rowid LIMIT 129').all(project);if(rows.length>128)return {deleted:false,status:'budget_exceeded'};const query=db.prepare(`SELECT CAST(m.raw AS TEXT) AS raw FROM mem m JOIN mem_consent_v2 g ON g.r=m.rowid LEFT JOIN history_permit_v2 h ON h.project=m.project AND h.sid=json_extract(m.source,'$.sessionId') AND h.seq=json_extract(m.source,'$.seq') JOIN mem_meta a ON a.r=m.rowid WHERE m.project=? AND m.rowid=? AND json_extract(m.source,'$.kind')='host-user-quote' AND (a.expires=0 OR a.expires>?) AND (h.seq IS NOT NULL OR (?=1 AND a.type='note'))`);let found=null;for(const {r,id} of rows){const row=query.get(project,r,Date.now(),t.literal?1:0);if(row&&(t.literal?row.raw===needle:row.raw.includes(needle))){if(found)return {deleted:false,status:'ambiguous'};found=id;}}return found?{id:found}:{deleted:false,status:'not_found'};}
module.exports={request,resolve};
