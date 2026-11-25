'use strict';
const {createHash} = require('node:crypto');

// Exact Chinese topic and value spans; no domain dictionary or pronoun resolution.
const topicGroup = '(?<topic>[\\p{Script=Han}]{2,16}?)';
const valueGroup = '(?<value>[\\p{Script=Han}]{1,12}?)';
const preference = '(?:偏好|偏爱|喜欢|首选)';
const statement = body => new RegExp(`^${body}[。！!]?$`, 'u');
const contrast = `(?:以前|之前|原先)${preference}(?<previous>[\\p{Script=Han}]{1,12}?)[，,](?:我)?现在(?:更)?${preference}${valueGroup}`;
const statements = [
  [statement(`我的${topicGroup}(?:一直|平时|通常|一向)${preference}${valueGroup}`), false],
  [statement(`我的${topicGroup}现在(?:改成|改为)(?:更)?${preference}${valueGroup}(?:了)?`), true],
  [statement(`我的${topicGroup}${contrast}`), true],
  [statement(`${topicGroup}我${contrast}`), true]
];
const questions = [
  new RegExp(`^我的${topicGroup}现在(?:更)?${preference}(?:什么|哪种|哪款)[？?]?$`, 'u'),
  new RegExp(`^我现在(?:更)?${preference}什么样的${topicGroup}[？?]?$`, 'u')
];
const framing = /不|没|别|勿|未|无须|除非|仅|临时|这次|今天|偶尔|暂时|可能|也许|大概|好像|似乎|或许|猜|考虑|犹豫|还是|或|和|以及|如果|假|但|却|才怪|开玩笑|角色|扮演|台词|故事|剧本|示例|举例|比如|据|说|转述|复述|别人|对方|我|你|他|她|咱|朋友|同事|老板|家人|妈妈|爸爸|弟弟|姐姐|要求|命令|希望|喜欢|偏爱|偏好|以前|现在|一直|通常|改为|改成|的时|的话|时候|时才|而非|以外|以为|而是|确实吗|吗|吧|呢|是否|什么|哪种|哪款/u;

function frame(text) {
  if (typeof text !== 'string' || text.length > 100) return null;
  for (const [pattern, change] of statements) {
    const match = pattern.exec(text);
    if (!match) continue;
    const {topic, value, previous} = match.groups;
    if ([topic, value, previous || ''].some(s => framing.test(s)) || value === previous) return null;
    return {topic, value, change};
  }
  return null;
}

function key(topic) {
  return 'sp1-' + createHash('sha256').update(topic).digest('hex').slice(0,40);
}

function item(text, created) {
  const fact = frame(text);
  if (!fact) return null;
  const {topic, value, change} = fact;
  const slot = key(topic);
  return {text, summary:text, keywords:[topic], type:'preference', concepts:[slot], slot, created,
    evidence:{subject:'self', conditions:{topic:[topic]}, property:'preference', value}, replace:change};
}

function question(text) {
  for (const pattern of questions) {
    const topic = pattern.exec(text)?.groups.topic;
    if (topic && !framing.test(topic)) return topic;
  }
  return null;
}

function recall(db, topic, now) {
  const hits = db.conceptCandidates([key(topic)], 20);
  if (!hits.length) return null; // Old databases lack this projection.
  if (hits.length >= 20) return [];
  const active = hits.filter(hit => hit.state === 'active');
  if (active.length !== 1) return [];
  const [hit] = active;
  const row = db.read(hit.id, 0, 160);
  const fact = frame(row?.text);
  const source = row?.source;
  if (!fact || fact.topic !== topic || !hit.summary || hit.type !== 'preference' ||
      row.claimStatus || row.nextOffset !== null || row.text !== hit.summary ||
      row.evidence?.value !== fact.value || hit.expires && hit.expires <= now ||
      source?.kind !== 'host-user-quote' || source.block !== 0 || source.utf16Offset !== 0 ||
      source.utf16Length !== row.text.length || !db.historyAllowed(source.sessionId, source.seq, row.text)) return [];
  return [{id:hit.id, type:hit.type, summary:row.text, currentValue:fact.value, source}];
}
module.exports = {item, question, recall, frame};
