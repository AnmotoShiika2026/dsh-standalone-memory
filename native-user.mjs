import {types} from 'node:util';

// The host's optional transport metadata is not an authorization token and is
// never copied into a quote. Only accept ordinary serialized data properties.
function record(value, required, optional = []) {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return required.every(k => Object.hasOwn(value, k)) && Reflect.ownKeys(value).every(k => {
    if (!required.includes(k) && !optional.includes(k)) return false;
    const d = Object.getOwnPropertyDescriptor(value, k);
    return d.enumerable && Object.hasOwn(d, 'value');
  });
}
const cleanString = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/u.test(v);
function nativeSource(src) {
  return record(src, ['kind'], ['rpcId', 'clientTimeZone']) && src.kind === 'user' &&
    (!Object.hasOwn(src, 'rpcId') || cleanString(src.rpcId, 512)) &&
    (!Object.hasOwn(src, 'clientTimeZone') || cleanString(src.clientTimeZone, 128));
}
function onlyItem(a) {
  if (!Array.isArray(a) || types.isProxy(a) || Object.getPrototypeOf(a) !== Array.prototype || a.length !== 1 || Reflect.ownKeys(a).length !== 2) return null;
  const d = Object.getOwnPropertyDescriptor(a,'0');
  if (!d?.enumerable || !Object.hasOwn(d, 'value')) return null;
  return d.value;
}
const envelope = m => record(m, ['id','role','source','content']) && m.role === 'user' && typeof m.id === 'string' && !!m.id;
export function nativeUserText(m) {
  if (!envelope(m) || !nativeSource(m.source)) return null;
  const b=onlyItem(m.content);
  return record(b, ['type','text']) && b.type === 'text' && typeof b.text === 'string' ? b.text : null;
}
// A time snapshot may coexist with an authenticated owner turn, but cannot
// grant a claim itself. Compare structure and content, not a prefix of prose.
export function timeSnapshot(e) {
  if (!nativeUserAppend(e) || !envelope(e.data)) return false;
  const {source,content}=e.data;
  if (!record(source,['kind','form','sections']) || source.kind!=='time-context' || source.form!=='snapshot') return false;
  const section=onlyItem(source.sections), block=onlyItem(content);
  return record(section,['name','text']) && section.name==='time-context' && typeof section.text==='string' && record(block,['type','text']) && block.type==='text' && block.text===section.text;
}
export const nativeUserAppend = e => e?.type === 'user/message' && e.surfaceOp === 'append' && e.sourceEventSeqs === undefined;
