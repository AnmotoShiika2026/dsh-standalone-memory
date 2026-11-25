'use strict';
// Read-time constraints and a deliberately smaller write grammar. A condition is
// observed, never filled with a default. In particular a topic is not a slot.
const groups = {
  meal: {breakfast:/早餐|早饭|早膳|breakfast/i,lunch:/中饭|中餐|午餐|午饭|lunch/i,dinner:/晚餐|晚饭|晚膳|dinner/i},
  day: {weekday:/工作日|平日|weekday/i,weekend:/周末|双休日|weekend/i,...Object.fromEntries([... '一二三四五六日'].map((d,i)=>[String(i+1),new RegExp('(?:周|星期|礼拜)'+(i===6?'[日天]':d))]))},
  time: {morning:/清晨|早晨|早上|上午|一早/,afternoon:/下午/,evening:/晚上|傍晚|夜里/},
  weather: {rain:/下雨|雨天|雨季/,sun:/晴天|天晴/},
  vehicle: {plane:/飞机|航班/,rail:/高铁|动车/,bus:/公交|公车/,metro:/地铁/},
  place: {home:/在家|居家/,office:/在公司|办公室/,trip:/出差/},
};
function conditions(s){const c={};for(const [k,g] of Object.entries(groups)){const v=Object.keys(g).filter(x=>g[x].test(s));if(v.length)c[k]=v;}return c;}
const attributes={fee:/学费|课时费|报名费|课程费用|收费|费用|花费|预算|多少钱/,equipment:/装备|器材|用品|用具|工具|带什么/,venue:/地点|地址|场地|在哪里上课/,duration:/时长|多久|多长时间/};
function compatible(q,s,cond){const ask=conditions(q), got=cond||conditions(s);
 // An explicitly current action question names its scope before the predicate.
 // Compare that literal activity with the actual quote; a shared verb/value
 // must not make a neighbour from another activity evidence for this query.
 const askAction=/^我(?:现在|如今|目前)([\p{Script=Han}]{2,24}?)(?:时|的时候)?(?:会|通常|一般|习惯)?(?:使用|采用|选择|选用|用|放|坐|搭|穿|喝|吃|带|听|读|练|选|点|买|订|看)(?:在|哪|什么|怎样|怎么)/u.exec(q);
 if(askAction && !s.includes(askAction[1])){const vf=require('./value-frame.cjs');if(!vf.asksRevision(q,vf.parseValueFrame(s)))return false;}
 // In a bounded habitual-action question the literal activity is evidence,
 // not a substring: e.g. a preparation BEFORE an activity is not its default.
 const bounded=/^我(?:现在|平时|目前)?([\p{Script=Han}]{1,24}?)(?:的时候|时)(?:通常|一般|习惯|会)?(?:用|喝|吃|带|坐|听|读|穿)(?:什么|哪种)[？?]?$/u.exec(q);
 if(bounded){const frame=require('./value-frame.cjs').parseValueFrame(s),activity=frame?.kind==='reverse'?frame.ctx:/^我(?:每次|每天|平时)?([\p{Script=Han}]{1,24}?)(?:的时候|时)?(?:通常|一般|习惯|一向|每次|每天|平时|总是|都)(?:会)?(?:用|喝|吃|带|坐|听|读|穿)/u.exec(s)?.[1];if(activity&&activity!==bounded[1])return false;}
 const prep=/^按我平时的习惯[，,]\s*(做[\p{Script=Han}]{2,14})该准备哪种(?:线|针)[？?]?$/u.exec(q);
 const wanted=prep||activity.exec(q.replace(/^我/u,''));
 if(wanted && !knownScope.test(wanted[1])){const frame=revisionFrame(s.trim().replace(/[。！!.]$/u,''));if(frame?.conditions.activity && frame.conditions.activity[0]!==wanted[1])return false;}
 for(const [k,vs] of Object.entries(ask)){if(!got[k])continue;
   // An explicitly named day is not interchangeable with a weekend label.
   if(vs.some(v=>!got[k].includes(v)))return false;
 }
 return Object.entries(attributes).every(([name,re])=>!re.test(q)||re.test(s)||(name==='equipment' && scopedHabitMatch(q,s)));
}
const C='(?:早餐|早饭|早膳|午餐|午饭|中饭|晚餐|晚饭|晚膳|工作日|周末|双休日|平日|(?:周|星期|礼拜)[一二三四五六日天]|下雨天?|雨天|晴天|在家|在公司|出差|通勤|上班|下班|早上|清晨|上午|下午|晚上|睡前|饭后)';
const F='(?:一般|平时|平常|通常|往往|每天|每次|每逢|每个|每到|每|一向|一直|总是|固定|习惯|照例|常常|经常)';
const item='[\\p{Script=Han}A-Za-z0-9]{1,20}';
const mods=`(?:${F}|${C}(?:时|的时候|后)?|[，,]|都|总|会|只|就|爱|喜欢|偏爱|偏好|更喜欢|还是|优先|自己|个人){0,9}`;
const start=`(?:我${mods}|(?:${C}|${F}){1,3}[，,]?我${mods})`;
const choice=new RegExp(`^${start}(喝|吃|坐|穿|带|用|听|读|练|选|点)(${item})$`,'u');
const changed=new RegExp(`^(?:我(?:以后|从现在起|今后)?|(?:以后|从现在起|今后)(?:我)?)((?:${C}(?:时)?){1,3})(?:都|固定|只)?(?:改为|改成|改|换成)(喝|吃|坐|穿|带|用|听|读|练|选|点)(${item}?)(?:[，,](${item})(?:喝腻了|吃腻了|用腻了|不再用了))?$`,'u');
// Generic recurring cue + explicit personal action; a single event lacks the cue.
const paired=new RegExp(`^(?:一到|每到|每逢|每次)(${C})(?:时|的时候)?[，,]?我(?:就|都会|总会|都)(喝|吃|坐|穿|带|用|听|读|练|选|点)(${item})$`,'u');
const possession=new RegExp(`^我的(通勤方式|通勤工具|早餐饮品|午餐饮品|晚餐饮品|睡前读物)(?:一直|通常|一向)?是(${item})$`,'u');
const possessiveVerbs={通勤方式:'坐',通勤工具:'坐',早餐饮品:'喝',午餐饮品:'喝',晚餐饮品:'喝',睡前读物:'读'};
const aspect={喝:'drink',吃:'eat',坐:'ride',穿:'wear',带:'carry',用:'use',听:'listen',读:'read',练:'practice',选:'choose',点:'order'};
// Do not treat a transient choice, report, comparison, example or suggestion as a stable profile.
const nonassertion=/(?:[『』‘’「」“”《》]|我(?:的|家)?(?:姐姐?|妹妹?|哥哥?|弟弟?|爸爸?|妈妈?|爷爷?|奶奶?|姑姑?|舅舅?|姨妈?|叔叔?|邻居|同桌|队友|老师|学生|妻子|丈夫|男友|女友|侄[子女]|外婆|外公|表[哥弟姐妹]|堂[哥弟姐妹])|给(?:别人|人家|小[\p{Script=Han}])|听人说|听说|据说|有人说|别人说|据我所知|例如|例句|示例|举例|比如|假定|好像|似乎|大概|想象|要是|还没定|不确定|不一定|没想好|没决定|差点|只好|只能|不得不|只剩|凑合|临时|一时兴起|随口|翻译|你觉得|我觉得.{0,8}(?:爱|喜欢|习惯)|能不能|可不可以|帮我(?:写|编|模拟)|(?:要|想|打算|计划)不要|[吗呢吧][。！!]?\s*$)/u;
const otherOwner=/(?:我(?:的|家)?(?:姐|妹|哥|弟|爸|妈|爷|奶奶|姑|舅|姨|叔|伯父|伯母|邻居|同桌|队友|老师|学生|妻子|丈夫|男友|女友|侄子|侄女|外婆|外公|表[哥弟姐妹]|堂[哥弟姐妹])|(?:姐姐?|妹妹?|哥哥?|弟弟?|爸爸?|妈妈?|邻居|队友|同桌|室友|家属)(?:最?爱|更?喜欢|通常|习惯|总是|偏好|说|打算)|\bmy (?:sister|brother|aunt|uncle|cousin|neighbou?r|teacher|wife|husband|parent|grandparent)\b)/iu;
const occasional=/刚才|刚刚|昨天|前天|上次|这回|这次|这一次|那天|那次|这阵子|今天|一回|一次|过去|曾经|以前|之前|当时|一度|小时候|上周|上个月/;
// Parse both sides against the same frame. Unknown activity names are literal
// identities (never fuzzy keywords); a missing subject/context cannot be filled
// from the nearest stored fact. Keep the legacy key for simple known scopes.
const rx=s=>new RegExp(s,'u');
const atom='[\\p{Script=Han}A-Za-z0-9]{1,20}', action='(喝|吃|坐|穿|带|用|听|读|练|选|点|买|订|看)', switchTo='(?:改成|改为|换成|换为|改|换)了?';
const namedFrame=rx(`^我的([\\p{Script=Han}A-Za-z]{1,10}(?:型号|颜色|尺寸|方式|工具|读物|饮品))`);
const familiar=rx(`^((?:${C}){1,3})(?:时|的时候)?[，,]?`);
const activity=rx('^([\\p{Script=Han}]{2,14}?)(?:的时候|时)[，,]?');
const now='(?:从现在起|从今以后|今后|以后|现在)', steady='(?:通常|平时|平常|一般|一直|一向|习惯|固定|每次|经常|总是|向来|喜欢|偏好|首选)';
// An unmarked activity needs both a predicate and a following structural
// boundary. Never treat a bare topic as a missing scope.
const bareActivity=rx(`^((?:坐|乘|喝|吃|买|点|订|选|去|看|听|读|练|整理)[\\p{Script=Han}]{1,8}?)(?=${steady}|不再|${now}|${switchTo})`);
const oldNew=rx(`^(?:不再|不|原来|以前|之前)${action}(${atom}?)(?:了)?[，,](?:${now})?${switchTo}${action}(${atom})$`);
const fromTo=rx(`^从${action}(${atom}?)${switchTo}${action}(${atom})$`);
const newOnly=rx(`^(?:${now})?(?:都|固定|只)?${switchTo}${action}(${atom})$`);
const habitual=rx(`^(?:${steady}(?:都|只|会)?|都会|都|只)${action}(${atom})$`);
const nominalFrom=rx(`^(?:${now})?从(${atom}?)${switchTo}(${atom})$`),nominalNew=rx(`^(?:${now})?${switchTo}(${atom})$`),nominalBase=rx(`^(?:${steady})是(${atom})$`);
// Do not turn a sentence embedded in an apparent value/frame into a choice.
const unsafePart=/[我你他她谁]|(?:不是|不会|不想|不再|没有|还没|取消|暂时|这次|偶尔|要是|假装|听说|说过|提到|觉得|以为|可能|或者|还是|但|不过|除非|改成|换成|改用|仅限|才怪|而非|也会|因为|的话|了$)/u;
const ownerPrefix=rx(`^(?:${now})?(我)?(?:${now})?`), knownScope=rx(`^(?:${C}){1,3}$`);
function revisionFrame(line){
 let rest=line, frame, rawScope='', exact='', nominal=false;
 const d=namedFrame.exec(rest);
 if(d){nominal=true;frame=d[1];rest=rest.slice(d[0].length);if(unsafePart.test(frame))return null;}
 else {
   // Frame before or after the owner; a leading future marker also permits
   // the conventional subject-elided “以后早餐改喝…” update, not a baseline.
   const prefix=ownerPrefix.exec(rest);rest=rest.slice(prefix[0].length);
   const craft=prefix[1] && /^(我(?:以后|今后)|(?:以后|今后)我)$/u.test(prefix[0]) && /^((?:(?:装订|缝制|编织|修补)[\p{Script=Han}]{1,6}?|串珠|编绳))(?=改用)/u.exec(rest);
   const m=familiar.exec(rest)||activity.exec(rest)||bareActivity.exec(rest)||(craft&&!/(?:朋友|家人|别人|同事|如果|可能|暂时|只有|这次|不要|不用|只要|建议|据说)/u.test(rest)?craft:null);if(!m||unsafePart.test(m[1]))return null;
   frame=m[1];rawScope=m[1];rest=rest.slice(m[0].length);const hasOwner=!!prefix[1]||rest.startsWith('我');if(!hasOwner&&!prefix[0])return null;
   rest=rest.replace(/^我/u,'');if(!hasOwner&&!newOnly.test(rest)&&!oldNew.test(rest))return null;
   if(!knownScope.test(frame))exact=frame;
 }
 let verb, value, oldValue=null, change=false;
 if(nominal){const a=nominalFrom.exec(rest),b=nominalNew.exec(rest),c=nominalBase.exec(rest);if(!a&&!b&&!c)return null;
   value=a?.[2]||b?.[1]||c[1];oldValue=a?.[1]||null;change=!!(a||b);verb=possessiveVerbs[frame];rawScope=verb?frame:'';exact=verb?'':frame;
 }else {const a=oldNew.exec(rest)||fromTo.exec(rest),b=newOnly.exec(rest),c=habitual.exec(rest);if(!a&&!b&&!c||a&&a[1]!==a[3])return null;
   verb=a?.[3]||b?.[1]||c[1];value=a?.[4]||b?.[2]||c[2];oldValue=a?.[2]||null;change=!!(a||b);
 }
 if(unsafePart.test(value)||oldValue&&unsafePart.test(oldValue)||oldValue===value)return null;
 const scope=conditions(rawScope),qualifiers=rawScope.match(/通勤|上班|下班|睡前|饭后/gu)||[];
 // The literal frame carries evidence absent from the read-time vocabulary.
 if(exact && !nominal)scope.activity=[exact];
 if(Object.values(scope).some(v=>v.length!==1))return null;
 if(exact)qualifiers.push(exact);
 const property=aspect[verb]||verb||`setting:${frame}`;
 return {subject:'self',conditions:scope,property,value,slot:JSON.stringify([property,scope,qualifiers]),oldValue,change,routine:!change};
}
const denyLeft=rx(`^(.{1,28}?)(?:${now})?(?:不再|不)${action}(${atom}?)(?:了)?$`);
const affirmRight=rx(`^(?:${now})?(?:改|换)?(?:都|只)?${action}(${atom})$`);
const ellipsis=rx(`^(?:${now})?(?:换成|改成|改为)(${atom})$`);
function inheritedChoice(line){
  const parts=line.split(/[，,]/u);if(parts.length!==2)return null;
  const a=denyLeft.exec(parts[0]),b=affirmRight.exec(parts[1]),c=ellipsis.exec(parts[1]);
  if(!a||!b&&!c||b&&b[1]!==a[2])return null;
  const prefix=a[1],owner=prefix.match(/我/gu);if(owner?.length!==1||!/^我|我$/u.test(prefix))return null;
  const frame=prefix.replace(/^我|我$/u,'');
  if(!knownScope.test(frame)&&!rx(`^(?:坐|乘|喝|吃|买|点|订|去|看|听|读|练|整理)[\\p{Script=Han}]{1,8}$`).test(frame))return null;
  const value=b?.[2]||c[1],old=a[3];
  if(unsafePart.test(frame)||unsafePart.test(old)||unsafePart.test(value)||old===value||c&&rx(`^${action}`).test(value))return null;
  const f=revisionFrame(`我${frame}通常${a[2]}${old}`);if(!f||!f.slot||f.value!==old)return null;
  return {...f,value,oldValue:old,change:true,routine:false,requirePrior:true};
}
function analyze(s,type){const line=s.replace(/[。！!.]$/u,'').trim();const contrast=require('./value-frame.cjs').parseValueFrame(line);
 // Preserve established typed identities for known inherited frames instead
 // of re-keying them under the newer open-action representation.
 if(contrast?.kind==='reverse'&&knownScope.test(contrast.ctx)){const inherited=inheritedChoice(line);if(inherited)return inherited;}
 if(contrast?.prior)return {subject:'self',conditions:contrast.ctx?{activity:[contrast.ctx]}:{},property:contrast.property,value:contrast.current,slot:contrast.key,oldValue:contrast.prior,change:true,contrast};
 const inherited=inheritedChoice(line);if(inherited)return inherited;
  const revision=revisionFrame(line);if(revision)return revision;
 if(contrast && /^我的.{1,36}(?:一直|一向|通常)是/u.test(line))return {subject:'self',conditions:{},property:contrast.property,value:contrast.current,slot:contrast.key,change:false,routine:true};
 const m=changed.exec(line), b=m?null:choice.exec(line);
 const p=paired.exec(line), d=possession.exec(line);
 const verb=m?.[2]||b?.[1]||p?.[2]||possessiveVerbs[d?.[1]], value=m?.[3]||b?.[2]||p?.[3]||d?.[2];const cond=conditions(line);
 const subject=type==='project'?'project':/(?:我|本人|\b(?:my|I)\b)/iu.test(line)||m?'self':null;
 const property=aspect[verb]||null;
 // Link only fully parsed clauses whose entire context can be represented.
 const frame=m?m[1]:b?line.slice(0,line.length-b[2].length-b[1].length):p?p[1]:d?d[1]:'';
 const qualifiers=frame.match(/通勤|上班|下班|睡前|饭后/gu)||[];
 const scope=conditions(frame);
 const slot=subject==='self'&&property&&(Object.keys(scope).length||qualifiers.length)&&!Object.values(scope).some(v=>v.length!==1)&&!/(?:之后|以前|的时候|(?:早餐|午餐|晚餐|早饭|午饭|晚饭)后)/u.test(frame) ? JSON.stringify([property,scope,qualifiers]):null;
 const routine=!!p || !!d || !!b&&(new RegExp(F).test(line)||/都|总会|照例|雷打不动/.test(line));
 return {subject,conditions:cond,property,value:value||null,slot,oldValue:m?.[4]||null,change:!!m,routine};
}
const scopedQuestion = new RegExp(`^我(${C})(?:一般|通常|习惯)(喝|吃|带|用|听|读|穿)什么[？?]?$`, 'u');
function scopedHabitMatch(query, summary) {
 const match = scopedQuestion.exec(query);
 if (!match) return false;
 const ask = conditions(match[1]);
 if (Object.keys(ask).length !== 1) return false;
 const fact = analyze(summary);
 return fact?.subject === 'self' && fact.property === aspect[match[2]] &&
   !!fact.slot && (fact.routine || fact.change) &&
   fact.slot === JSON.stringify([fact.property, ask, []]);
}
module.exports={compatible,conditions,analyze,scopedHabitMatch,nonassertion,otherOwner,occasional};
