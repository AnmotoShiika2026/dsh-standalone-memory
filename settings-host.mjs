import z from './vendor/schemastery.mjs';
const optIn = new Set(['sessionIsolation']);
export const keys = Object.freeze(['conversationArchive','autoCapture','autoRecall','historyLookup','legacyImport',...optIn]);
// rc.5 discovers volatile entry Config fields and writes overrides through configEditor.
export const Config = z.object({...Object.fromEntries(keys.map(k => [k,z.boolean().default(!optIn.has(k)).volatile()])),futureTimeZone:z.string()});
// 0.6.0 binds hooks/tool availability at startup; never coerce a ref object into true.
export function readStartupConfig(settings, entry = {}) {
  settings.configure({auto:false});
  return {...entry,...Object.fromEntries(keys.map(k=>{const ref=entry[k],v=typeof ref?.get==='function'?ref.get():ref; if(v!==undefined && typeof v!=='boolean') throw Error('Invalid '+k);return [k,v ?? !optIn.has(k)];}))};
}
