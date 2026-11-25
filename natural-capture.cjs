'use strict';

// Precision-oriented supplement for a single Chinese self-report. The caller
// still owns consent, private-content screening, deduplication and expiry.
const re = source => new RegExp(source, 'u');
const self = '(?:我(?:自己|个人|这人|本人)?|本人)';
const days = '[一二三四五六日天]';
const whenPast = `(?:昨天|前天|前晚|上周末|上(?:个)?(?:周|星期|礼拜|月)(?:${days})?|上次|去年|前年|前几天|前些天|前阵子|前段时间|小时候|读大学时|毕业那年|以前|之前|曾经|曾)`;
const whenNext = `(?:明天|后天|明早|明晚|今晚|明年|下周末|下(?:个)?(?:周|星期|礼拜|月)(?:${days})?|这周末|这个周末|本周${days}|周${days}|星期${days}|[一二三四五六七八九十\\d]{1,3}月[一二三四五六七八九十廿\\d]{1,3}[日号])`;
const repeated = `(?:平常|平日里?|平时|日常|通常|一般|向来|一向|从来|常常|经常|老是|总是|基本上?|习惯于?|每天|每日|每晚|每早|每逢|每次|每(?:个)?(?:周|星期|礼拜)(?:末|${days})?|每(?:个)?(?:工作日|休息日|月))`;
const context = '(?:点(?:外卖|菜|单|咖啡|饮料|奶茶)|买(?:票|菜|书|衣服)|选(?:座|位置)|吃(?:早饭|午饭|晚饭|面|火锅)|喝(?:茶|咖啡|奶茶)|坐(?:车|飞机|火车|高铁)|通勤|上班|下班|出门|旅行|出差|出游|看电影|睡觉|睡前|饭后|周末|工作日|早餐|午餐|晚餐)(?:时(?:候)?|的?时候|路上|以后|之后|之前|前|后)?';
const choices = '(?:挑|选|点|要|买|订|穿|用|喝|吃|坐)';
const action = '(?:先|再|在|到|去|来|回|从|沿|把|搭|乘|骑|走|跑|散步|锻炼|练|读|看|听|做|写|画|背|学|打|逛|爬|游|刷|整理|收拾|带|泡|起床|睡|留|记|存|洗|换|蒸|煮|烤|开|参加|报名|出发|出差|出门|拍|播放|坐|吃|喝|点|选|买|订|穿|用)';
const descriptor = '[\\p{Script=Han}A-Za-z0-9]{1,36}';
const front = (token) => re(`^(?:${token}[，,]?${self}|${self}${token})`);
const past = front(whenPast), future = front(whenNext), frequency = front(repeated);
const owned = re(`^${self}`), topic = front(context);
const pref = re(`^(?:(?:一直|向来|一向|还是|比较|特别|最|更|挺|不太|不怎么|不)?(?:喜欢|爱吃|爱看|爱听|爱喝|偏爱|偏好|讨厌)|首选|只(?:认|爱|喜欢)|更(?:爱|愿意|倾向于)|最中意)${descriptor}$`);
const choice = re(`^(?:${context})?(?:一般|通常|平时|基本上?|每次|向来|一向|一直|固定|从来)?(?:都|就)?(?:(?:只|优先)${choices}|首选|认准)${descriptor}$`);
// The object can introduce the scope of a choice before its frequency cue.
// Require the owner (in the caller), recurring cue and explicit selection;
// preserve the entire quote rather than replacing it with the chosen attribute.
const scopedChoice = re(`^(?:挑|选|买|订)[\\p{Script=Han}A-Za-z0-9]{1,12}(?:时|的时候)?(?:一向|向来|一直|通常|每次)(?:都)?(?:只|优先)(?:挑|选|买|订|用)${descriptor}$`);
const usual = re(`^(?:${context})?(?:都|就|也)?(?:会|要)?(?:固定)?${action}[\\p{Script=Han}A-Za-z0-9]{0,36}$`);
// A generic order with an explicit preparation rule expresses a preference;
// a single completed transaction (只买了一份) does not.
const preparation = /^(?:从来|向来|一直|通常|一般|只)?(?:不加|不放|少放|少加|要去|只加|只放)(?:冰|糖|奶|葱|姜|蒜|香菜|辣椒|奶精|酱料)$/u;
const singleChoice = /(?:这次|今天|这回|刚才|刚刚|这一下|先凑合|了|过一次)/u;
const repeatedChoice = re(`^(?:每次|通常|一般|基本上?|一向|向来|一直|固定)(?:都|会|就){0,2}${choices}${descriptor}$`);
const recurringFrame = re(`^${self}(?:每次|每逢)${context}[，,]?(?:都|就)(?:会)?${action}${descriptor}$`);
const routineInContext = re(`^(?:${context})?(?:都(?:会)?|总(?:会|要|是)|必(?:定|须)?|一定会|习惯(?:于)?|固定会)${action}[\\p{Script=Han}A-Za-z0-9]{0,36}$`);
const event = '(?:去|来|逛|游|爬|住|吃|喝|试|看|听|读|做|学|上|参加|跑|骑|搭|坐|走|买|拍|体验|探访|参观|拜访|搬|练|完成|报名|学会|拿到|抵达|走完|读完|看完)';
const eventBody = re(`^(?:第一次|头一次|独自|自己|亲自|还|刚|专门|特意)?(?:在${descriptor}?)?${event}(?:了|过)${descriptor}$`);
const retrospective = re(`^(?:第一次|头一次|独自|亲自|专门|特意)(?:去|跑|骑|参加|体验|参观|学会|走完|读完)${descriptor}$`);
const perfect = re(`^(?:以前|之前|曾经|还|已经)?(?:在${descriptor}?)?${event}(?:过|完了)${descriptor}$`);
const booking = /^(?:已经|早就|刚刚|刚)?(?:约好|订好|定好|安排好|敲定|约了|预约了|报了名|订了|定了|买好|买了).{1,44}$/u;
const futureBody = re(`^(?:早上|上午|中午|下午|晚上|一早|一大早)?(?:已经|确定|肯定|准时)?(?:要|就要|就|会|将)?(?:(?:去|参加|坐|搭|搬|回|飞往|考)${descriptor}|(?:出发|出差|报到|启程|开会|上课|看展|爬山|跑步)(?:${descriptor})?)$`);
// Exclude framing whose truth/owner/scope cannot safely be inferred. Never
// split off the first clause of an opt-out or reported utterance.
const unsafe = /[\u0000-\u001f\u007f。.!！?？;；:“”「」『』《》"'`<>\[\]{}]|(?:你|您|他们|她们|我俩|我们|咱们|同事|朋友|室友|家人|老板|客户|同学|对象|媳妇|老公|老婆|弟弟|妹妹|哥哥|姐姐|爸爸|妈妈|他说|她说|听说|据说|转述|开玩笑|举例|比如|假设|要是|要不|如果|哪怕|万一|好像|仿佛|大概|可能|似乎|或许|也许|不一定|还没|尚未|暂时|目前|这会儿|这一刻|一时兴起|突然|今天只|这次只|想要|本来|原本|本想|本打算|差点|差一点|没能|并没|并非|取消|没去成|忘了|忘记|搞不清|记不清|不记得|犹豫|纠结|考虑|未定|没定|再说|没想好|说不准|不确定|不代表|不等于|开玩笑|随口|假装|装作|模拟|听人说|听别人说|转发|不要|别记|别存|别把|不用记|无需记|请勿|不许|别再|不想让)|[吗么嘛呢吧]$/u;
const ambiguous = /(?:不成|不了|不到|不动|没法|未必|不能|看起来|看上去|看似|看来|以为|竟以为|才怪|想象|做梦|那句话|这句话|不是|打个比方|不算|只好|只能|不得不|为什么|怎么|什么|是否|能否|哪[里个种款]|是不是|[想去买喝选吃要会]不[想去买喝选吃要会]|但是|不过|其实不是|的(?:人|事|时候|那天|消息|理由|原因|故事|说法|可能性|计划|安排)$)/u;
function inferNaturalType(s) {
  if (typeof s !== 'string' || s.length > 160) return null;
  s = s.trim().replace(/[。！!]$/u, '').replace(/[ \u3000]/gu, '');
  if (s.length < 4 || unsafe.test(s) || ambiguous.test(s)) return null;
  // A comma is accepted only at a recognized topic/subject boundary.
  const tail = rx => { const m = rx.exec(s); return m ? s.slice(m[0].length).replace(/^[，,]/u,'') : null; };
  const personal = tail(owned), framed = tail(topic), next = tail(future), prev = tail(past), freq = tail(frequency);
  if (next !== null && (futureBody.test(next) || booking.test(next) && !/[，,]/u.test(next))) return 'plan';
  if (personal && booking.test(personal) && re(whenNext).test(personal) && !/[，,]/u.test(personal)) return 'plan';
  if ((prev !== null && (eventBody.test(prev) || retrospective.test(prev))) || (personal && perfect.test(personal))) return 'experience';
  if (personal && !singleChoice.test(personal) && scopedChoice.test(personal)) return 'preference';
  for (const body of [personal, framed, freq]) if (body && !singleChoice.test(body) && (pref.test(body) || choice.test(body))) return 'preference';
  if (framed && !singleChoice.test(framed) && (repeatedChoice.test(framed) || preparation.test(framed))) return 'preference';
  if(personal&&!singleChoice.test(personal)&&!/(?:不|没|想|要|请|命令|假|说|别人|希望|应该)/u.test(personal)&&/^(?:在[\p{Script=Han}]{2,18}时用|的[\p{Script=Han}]{2,18}一直拿)[\p{Script=Han}]{1,10}$/u.test(personal))return 'habit';
  if(personal&&!singleChoice.test(personal)&&require('./value-frame.cjs').conditioned(s))return 'habit';
  if(freq&&!singleChoice.test(freq)&&!/(?:不|没|想|假|别人|要求|命令|说|告诉|希望|应该)/u.test(freq)&&/^[\p{Script=Han}]{2,16}(?:的时候|时)都(?:垫|贴|加|拿)[\p{Script=Han}]{1,12}$/u.test(freq))return 'habit';
  if(freq && /^(?:给|对|为)[\p{Script=Han}]{2,24}(?:使用|用)[\p{Script=Han}]{1,16}$/u.test(freq) && !singleChoice.test(freq))return 'habit';
  if ((freq && usual.test(freq)) || (framed && routineInContext.test(framed)) || recurringFrame.test(s)) return 'habit';
  return null;
}
module.exports = { inferNaturalType };
