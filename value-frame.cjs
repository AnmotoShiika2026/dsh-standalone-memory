'use strict';
// A small contrast grammar, not a list of things the user might choose. Both
// arguments of a predicate are literal; never cut a value at a common prefix.
const token = '[\\p{Script=Han}A-Za-z0-9_-]{1,36}';
const past = /^(以前|之前|原来|过去|从前)/u;
const freq = /^(?:平时|平常|通常|一般|一直|一向|经常|总是|向来|固定)(?:都|会)?/u;
const scope = /^([\p{Script=Han}A-Za-z0-9]{1,20}?(?:的时候|时|期间))[，,]?/u;
const choice = /^(更喜欢|最喜欢|喜欢|偏爱|偏好|首选|习惯于|习惯|爱|挑选|选择|采用|使用|选用|选|用|喝|吃|听|读|穿|戴|拿|挑|点|带|坐|买|订|看|练)/u;
const field = new RegExp(`^(${token}?)(?:(?:一直|通常|一向))?是(${token})$`,'u');
const valid = new RegExp(`^${token}$`,'u');
const unsafe = /[“”‘’「」『』《》:："'`?？]|说过|讲过|提过|写过|说的是|据说|听说|好像|似乎|或许|不确定|打算|打比方|想试|试试|试一下|试一试|试试看|试一下子|先试|尝试|体验一下|先凑合|一阵|一段时间|破例|偶一|权宜|应急|轮到|不得已|不得不|说自己|写下|念出|声称|那句|这句|只是|暂且|暂时|暂用|先用|仅仅|只限|仅限|偶尔|偶然|例外|眼下|这阵|最近|这几天|这段|这周|本周|今天|今晚|明天|这次|这回|一次|临时|一时|但|不过|而非|也会|并非|因为|要是|还没|可能|考虑|也许|如果|换着|轮流|或者|有时|而已|而不是|不是|[吗呢吧]$/u;
function safeArg(x){return valid.test(x)&&!/[我你他她]|说|讲|以为|觉得|仅|暂|不再|还是|原来|以前|现在|改为|改成|换成|而且|然后|一下|了$/u.test(x);}
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
function predicate(body,open=true){
  body=body.replace(freq,'');const familiar=choice.exec(body)?.[0];
  // For an unfamiliar action we need an independent word boundary on both
  // sides (and in the earlier quote). Never infer it from shared characters.
  let verb=familiar || (open && segmenter.segment(body)[Symbol.iterator]().next().value?.segment);
  if(familiar && /喜欢|^偏爱$|^爱$|^习惯/u.test(familiar)){
    const nested=choice.exec(body.slice(familiar.length));if(nested)verb+=nested[0];
  }
  if(!verb||!/^\p{Script=Han}{1,4}$/u.test(verb)||!safeArg(verb)||/^(?:不|没|想|先|只|就|更|要|仅|试|暂|也|偶|正|因|将|准备|打算)/u.test(verb))return null;
  const value=body.slice(verb.length);return safeArg(value)?{predicate:verb,value}:null;
}
// An unmarked topic is identifiable when followed by a recurring cue or a
// parallel predicate. Reject multiple possible predicate boundaries.
function framed(body){
  const splits=[];
  for(let i=1;i<body.length;i++){
    const head=body.slice(0,i), tail=body.slice(i);
    if(!safeArg(head)||freq.test(head)||/[的说写讲给替帮让]/u.test(head))continue;
    if(!freq.test(tail)&&!choice.test(tail))continue;
    if(i>1&&(freq.test(body.slice(i-1))||choice.test(body.slice(i-1))))continue;
    const p=predicate(tail);if(p)splits.push({ctx:head,p});
  }
  // A frequency cue belongs to the predicate, never the identity of the topic.
  const exact=splits.filter(s=>!/(?:平时|平常|通常|一般|一直|一向|经常|总是|向来|固定)(?:都|会)?$/u.test(s.ctx));
  return exact.length===1?exact[0]:null;
}
function identity(kind,context,prop){return JSON.stringify(['self',kind,context,prop]);}
// Reverse contrast: an explicit standing switch followed by a denial of the
// former choice. Keep the literal activity; neither semantic neighbours nor a
// shared object suffix can prove identity. Predicate aliases are grammatical,
// not names of objects. An omitted complement is proved by the earlier quote.
const act='(?:使用|采用|选用|选择|放在|放进|放入|搭乘|乘坐|喝|吃|坐|搭|乘|穿|带|用|听|读|练|选|点|买|订|看|放|装|收|拿|戴|写|垫|贴|加)';
const han='[\\p{Script=Han}A-Za-z0-9]{1,28}';
const verbKey=x=>({搭乘:'坐',乘坐:'坐',搭:'坐',乘:'坐',使用:'用',放在:'放'}[x]||x);
const routineCue='(?:每次|每逢|每天|每周|平日|平时|平常|通常|一般|一直|一向|经常|总是|向来|固定|习惯于|习惯)';
const future='(?:从现在起|从今以后|从今往后|今后|以后|往后|现在)';
const reverse=new RegExp(`^(?:${future}我|我${future})(${han}?)(?:改为|改成|换成|换为|改|换)(${act})(${han})[，,](?:以后)?(?:不再|不)(${act})(${han}?)(?:了)?$`,'u');
const ctxKey=s=>s.replace(/都$/u,'').replace(/(?:的时候|时)$/u,'');
function safeContext(s){return safeArg(s)&&!/(?:自己说|室友|家人|朋友|同事|同学|邻居|别人|替|帮|要求|建议|命令|练习说|叫我|应该|听说|例如|没|不|别|希望|打算|想|要是|是否|除非|只有|只要)/u.test(s);}
// An explicit denial supplies the old argument; a prospective marker and an
// overt parallel action supply the replacement. Independently segment unknown
// predicates on both sides and later re-parse the authorized prior assertion.
const denyFirst=new RegExp(`^我(?:现在|如今)?(${han}?)(?:不再|不)(${han}?)(?:了)?[，,](?:我${future}|${future}我?)(?:都|固定)?(?:改为|改成|换成|换为|改|换)?(${han})$`,'u');
function actionParts(body){
 const known=new RegExp('^'+act,'u').exec(body)?.[0];const p=known?{predicate:known,value:body.slice(known.length)}:predicate(body);
 return p&&safeArg(p.value)?{property:verbKey(p.predicate),value:p.value}:null;
}
function denialFrame(line){
 const m=denyFirst.exec(line);if(!m||!safeContext(m[1]))return null;
 const a=actionParts(m[2]),b=actionParts(m[3]);if(!a||!b||a.property!==b.property||a.value===b.value)return null;
 const ctx=ctxKey(m[1]),property=a.property;return {kind:'reverse',ctx,property,key:identity('scoped-action',ctx,property),prior:a.value,current:b.value,marker:''};
}
function qualifiedChoice(x){return /(?:时|时候|期间|的话|除外|例外|视情况|看情况|备用|应急|救急|过渡|为止)$|直到|直至|截至|截止|仅在|限于|临时|暂作/u.test(x);}
// A complaint about a named item is not by itself a statement of an old
// default. Only the existing reverse-link proof (same owner/activity, 用,
// complete old value, one authorized predecessor) can establish that link.
const reasonedSwitch=/^(?:因为)?([\p{Script=Han}]{1,12}?)(?:总是|老是|总|经常|容易|易于)([\p{Script=Han}]{1,8})[，,](?:我(?:以后|今后|往后)|(?:以后|今后|往后)我)([\p{Script=Han}]{2,20}?)(?:就)?(?:改用|换用|换成|换)([\p{Script=Han}]{1,12}?)(?:了)?$/u;
function reasonedFrame(line){
 const m=reasonedSwitch.exec(line);if(!m)return null;
 const [,prior,complaint,activity,current]=m;
 // Do not interpret embedded speech, trial choices, conditional alternatives
 // or another action as an instrument. Keep the full source as the quote.
 const qualified=/(?:换|改|试|凑合|照旧|依旧|照常|为主|之一|有空|或|和|以及|还是|除外|之前|以后|临时|先|别|让|想|只|希望|为止|过渡|备用|看情况|视情况|用完|之后|再|[一二两三四五六七八九十几半数]+个?(?:回|天|夜|周|星期|月|年|小时|礼拜))/u;
 if(unsafe.test(line.replace(/^因为/u,''))||!safeContext(activity)||!safeContext(complaint))return null;
 if(![prior,current].every(x=>safeContext(x)&&!qualifiedChoice(x)&&!qualified.test(x))||/^(?:成|为|用|去|把|在|不|没|说|叫|给)/u.test(current)||prior===current)return null;
 const ctx=ctxKey(activity),property='用';return {kind:'reverse',ctx,property,key:identity('scoped-action',ctx,property),prior,current,marker:''};
}
function reverseFrame(line){
 // Fronted activity and possessed-object topics retain the same literal scope.
 line=line.replace(new RegExp(`^(${han})[，,]我(${future})`,'u'),'我$2$1').replace(new RegExp(`^我的(${han}?)(${future})(?:都)?(?=放)`,'u'),'我$2把$1改');
 line=line.replace(new RegExp(`^(${future})(${han})[，,]我(?:都|固定)(${act})`,'u'),'我$1$2改$3').replace(new RegExp(`^(${future})我的(${han}?)(?=(?:改|换)放)`,'u'),'我$1把$2');
 line=line.replace(/^(原先|从前|以前|原来)我/u,'我$1').replace(/[;；](?=(?:从今往后|今后|往后|以后))/u,'，').replace(/，从今往后/u,'，往后');
 const destination=new RegExp(`^我把(${han}?)的(?:日常|通常|固定)?(?:存放处|收纳处|存放位置)从(${han}?)改成了?(${han})$`,'u').exec(line);if(destination)line=`我以后把${destination[1]}改放${destination[3]}，不再放${destination[2]}`;
 const tool=new RegExp(`^(${han}?)的(${han}?)我${future}不再用(${han})[，,]改用(${han})$`,'u').exec(line);if(tool&&safeContext(tool[1])&&safeContext(tool[2])&&safeArg(tool[3])&&safeArg(tool[4])&&tool[3]!==tool[4]){const ctx=tool[2]+tool[1];return {kind:'reverse',ctx,property:'用',instrument:true,key:identity('scoped-action',ctx,'用'),prior:tool[3],current:tool[4],marker:''};}
 const priorFirst=new RegExp(`^我(?:原先|从前|以前|原来)(${han}?)(${act})(${han})[，,](?:往后|以后|今后)(?:改成|换成)(${han})$`,'u').exec(line);if(priorFirst&&safeContext(priorFirst[1])&&safeArg(priorFirst[3])&&safeArg(priorFirst[4])&&priorFirst[3]!==priorFirst[4]){const ctx=ctxKey(priorFirst[1]),property=verbKey(priorFirst[2]);return {kind:'reverse',ctx,property,key:identity('scoped-action',ctx,property),prior:priorFirst[3],current:priorFirst[4],marker:'原先'};}
 const material=new RegExp(`^(${han})的(?:材料|用料)[，,]我从(${han}?)换成(${han}?)了$`,'u').exec(line);if(material&&safeContext(material[1])&&safeArg(material[2])&&safeArg(material[3])&&material[2]!==material[3]){const parts=[...segmenter.segment(material[1])].map(x=>x.segment);if(parts.length>=2&&parts.length<=4){const ctx=parts.slice(1).join('')+parts[0];return {kind:'reverse',ctx,property:'用',key:identity('scoped-action',ctx,'用'),prior:material[2],current:material[3],marker:''};}}
 line=line.replace(new RegExp(`^我(${han}?时)习惯(${act})`,'u'),'我今后$1改$2');
 const m=reverse.exec(line);if(!m||!safeContext(m[1])||!safeArg(m[3])||!safeArg(m[5])||m[3]===m[5]||verbKey(m[2])!==verbKey(m[4]))return null;
 const ctx=ctxKey(m[1]),property=verbKey(m[2]);return {kind:'reverse',ctx,property,key:identity('scoped-action',ctx,property),prior:m[5],current:m[3],marker:''};
}
// Match a prior complete assertion against the *parsed* new frame, not a
// prefix of an arbitrary prior value. The destination/locative complement
// must be explicit and shared with the new choice (or old value is exact).
function reversePrior(raw,f){
 const text=raw.trim().replace(/[。！!.]$/u,'');if(unsafe.test(text))return false;
 const scoped=new RegExp(`^我在(${han}?)(?:的时候|时)(${routineCue})?(?:都)?(${act})(${han})$`,'u').exec(text);if(scoped&&scoped[1]===f.ctx&&verbKey(scoped[3])===f.property&&scoped[4]===f.prior)return true;
 const m=new RegExp(`^我(${routineCue})?(${f.ctx})(?:的时候|时)?(${routineCue})?(?:都会|都|会)?(${han})$`,'u').exec(text);
 if(f.instrument && new RegExp(`^我${routineCue}(?:都)?用${f.prior}${f.ctx}$`,'u').test(text))return true;
 if(!m||!(m[1]||m[3]))return false;
 const p=actionParts(m[4]);if(p?.property!==f.property)return false;
 const value=p.value;if(value===f.prior)return true;
 if(!value.startsWith(f.prior))return false;const tail=value.slice(f.prior.length);
 return /^(?:里|中|内|上|下|回[\p{Script=Han}]{1,6}|去[\p{Script=Han}]{1,6})$/u.test(tail)&&f.current.endsWith(tail);
}
function parseValueFrame(text){
  const line=text.trim().replace(/[。！!.]$/u,'');if(line.length>160)return null;
  const reasoned=/^(?:因为)?[^，,]+[，,](?:我(?:以后|今后|往后)|(?:以后|今后|往后)我)/u.test(line)&&reasonedFrame(line);if(reasoned)return reasoned;
  if(unsafe.test(line))return null;
  // Both declarations and corrections must expose the same nonempty owner,
  // scope and named attribute. Equal values alone never constitute identity.
  const attr=/^我([\p{Script=Han}]{1,16}?)的([\p{Script=Han}]{1,12}?)(?:固定为([\p{Script=Han}]{1,16})|从([\p{Script=Han}]{1,16}?)改为([\p{Script=Han}]{1,16}))$/u.exec(line);
  if(attr){const [,ctx,property,defaultValue,prior,revised]=attr,current=defaultValue||revised;if(![ctx,property].every(x=>safeContext(x)&&!/[或和及的与]/u.test(x))||![current,...(prior?[prior]:[])].every(x=>safeArg(x)&&!qualifiedChoice(x))||prior===current)return null;return {ctx,property,key:identity('scoped-field',ctx,property),current,...(prior?{prior,marker:'从'}:{})};}
  const clauses=line.split(/[。，,；;]/u);if(clauses.length===2&&line.includes('不再是')){for(let i=0;i<2;i++){
    const claim=clauses[i];if(!claim.includes('固定为'))continue;const base=parseValueFrame(claim);if(!base||JSON.parse(base.key)[1]!=='scoped-field'||base.prior)continue;
    const withdrawal=clauses[1-i],prefix=`我${base.ctx}的${base.property}不再是`;let prior;if(withdrawal.startsWith(prefix))prior=withdrawal.slice(prefix.length);else if(i===0&&/[，,]/u.test(line)&&withdrawal.startsWith('不再是'))prior=withdrawal.slice(3);else continue;
    if(safeArg(prior)&&!qualifiedChoice(prior)&&prior!==base.current)return {...base,prior,marker:'不再是',joinedWithdrawal:true};}}
  const backward=reverseFrame(line)||denialFrame(line);if(backward)return qualifiedChoice(backward.prior)||qualifiedChoice(backward.current)?null:backward;
  const parts=line.split(/[，,](?=(?:我)?(?:现在|如今|从现在起|今后|以后))/u);if(parts.length>2)return null;
  let [left,right]=parts, marker='',ctx='',p,nominal=false;
  // The owner must be explicit; the second clause can inherit it but not change it.
  left=left.replace(/^(以前|之前|原来|过去|从前)我/u,'我$1');
  if(!left.startsWith('我'))return null;left=left.slice(1);
  const takePast=()=>{const m=past.exec(left);if(m){marker=m[0];left=left.slice(marker.length);}};
  takePast();
  if(left.startsWith('的')){
    nominal=true;left=left.slice(1);
    const m=new RegExp(`^(${token}?)(以前|之前|原来|过去|从前)是(${token})$`,'u').exec(left);
    if(m){marker=m[2];left=m[1]+'是'+m[3];}
    const f=field.exec(left);if(!f||!safeArg(f[1])||!safeArg(f[2]))return null;
    ctx=f[1];p={predicate:'是',value:f[2]};
  }else{
    left=left.replace(freq,'');const s=scope.exec(left);
    if(s){ctx=s[1];if(!safeArg(ctx)||/以前|过去|之前/u.test(ctx))return null;left=left.slice(s[0].length);takePast();}
    p=predicate(left,false);
    if(!p&&!ctx){const f=framed(left);if(f){ctx=f.ctx;p=f.p;}}
    if(!p)p=predicate(left);
    if(!p)return null;
  }
  const key=identity(nominal?'field':'choice',ctx,p.predicate);
  if(right===undefined)return marker?null:{key,current:p.value,ctx,property:nominal?ctx:p.predicate};
  if(!marker)return null;
  right=right.replace(/^(?:我)?(?:从现在起|现在|如今|今后|以后)(?:我)?/u,'');
  if(ctx && right.startsWith(ctx))right=right.slice(ctx.length);
  const to=/^(?:改成了?|改为了?|换成了?|换为了?)/u.exec(right);
  if(to)right=right.slice(to[0].length);else if(right.startsWith('改'+p.predicate))right=right.slice(1);
  const next=nominal?(right.startsWith('是')?right.slice(1):to?right:null):
    (predicate(right,!to || right.startsWith(p.predicate)) || (to && safeArg(right)?{predicate:p.predicate,value:right}:null));
  // A switch-complement inherits the old predicate; an overt new predicate
  // must agree instead. Ordinary 现在 alone never supplies a missing predicate.
  if(!next||!nominal&&next.predicate!==p.predicate)return null;
  const current=nominal?next:next.value;if(!safeArg(current)||current===p.value)return null;
  return {key,ctx,property:nominal?ctx:p.predicate,prior:p.value,current,marker};
}
// Exact current-question evidence for a parsed revision (never a topical
// boost): require the entire activity and the same predicate before the WH.
function asksRevision(query,frame){
 if(frame?.kind!=='reverse')return false;
 const object=/^我(?:现在|如今|目前)?把([\p{Script=Han}]{1,18}?)(?:收|存|放|放置|存放|收纳)(?:在|到)?哪(?:里|儿)[？?]?$/u.exec(query);
 if(object){const storage=/^(?:整理|收纳|存放|保存|归置|收拾|收存|存储|收(?:好|起|拢|妥)|放(?:好|妥))(.+)$/u.exec(frame.ctx);return /^(?:收|放|放入|放进)$/.test(frame.property)&&storage?.[1]===object[1];}
 const m=/^我(?:现在|如今|目前)(.+?)(?:什么|哪(?:种|个|里|儿|样))[？?]?$/u.exec(query);
 if(!m||!m[1].startsWith(frame.ctx))return false;
 const p=m[1].slice(frame.ctx.length).replace(/^(?:的时候|时)/u,'').replace(/^(?:通常|一般|会)/u,'');return verbKey(p)===frame.property;
}
function asksDefault(query,text){
 const m=/^我(?:现在|如今|目前|平时|通常|一般)([\p{Script=Han}]{1,20}?)(?:的时候|时)?(?:通常|一般|习惯|会)?(用|使用|坐|穿|喝|吃|听|读|拿|带)(?:什么|哪种)[？?]?$/u.exec(query);if(!m||!safeContext(m[1]))return false;
 const p=new RegExp(`^我(?:${routineCue})?${m[1]}(?:的时候|时)?(?:${routineCue})(?:都会|会|都)?(${act})(${han})[。！!.]?$`,'u').exec(text);return !!p&&verbKey(p[1])===verbKey(m[2])&&safeArg(p[2]);
}
// Derive candidate denial keys from whole, authorized quotes only. The
// original matcher remains the proof; this only locates overflow guards.
function denialKeys(text){
 const line=text.trim().replace(/[。！!.]$/u,'');if(line.length>160||unsafe.test(line)||!line.startsWith('我'))return [];
 const past=parseValueFrame(line);const keysFor=(key,value)=>[value,...Array.from(value.matchAll(/(?:里|中|内|上|下|回[\p{Script=Han}]{1,6}|去[\p{Script=Han}]{1,6})$/gu),m=>value.slice(0,m.index))].filter(Boolean).map(v=>JSON.stringify([key,v]));
 if(past?.kind==='reverse')return keysFor(past.key,past.current);
 const body=line.slice(1),stripped=body.replace(new RegExp(`^${routineCue}`,'u'),'');const keys=new Set();
 const instrument=new RegExp(`^${routineCue}(?:都)?用(${han})$`,'u').exec(body);if(instrument){const phrase=instrument[1];for(let i=1;i<phrase.length;i++){const v=phrase.slice(0,i),ctx=phrase.slice(i);if(safeArg(v)&&safeContext(ctx))keys.add(JSON.stringify([identity('scoped-action',ctx,'用'),v]));}}
 for(const s of new Set([body,stripped]))for(let i=1;i<=Math.min(28,s.length-1);i++){
   const ctx=ctxKey(s.slice(0,i));if(!safeContext(ctx))continue;
   const tail=s.slice(i).replace(new RegExp(`^(?:${routineCue})?(?:都会|都|会)?`,'u'),'');const p=actionParts(tail);if(!p)continue;
   const key=identity('scoped-action',ctx,p.property);if(reversePrior(line,{ctx,property:p.property,prior:p.value,current:''}))for(const k of keysFor(key,p.value))keys.add(k);
 }return [...keys];
}
// A concrete self-owned activity or object in a question excludes candidates
// with a different proven activity. Never grant admission on this test alone.
function conditioned(text,question=false){
 const H='[\\p{Script=Han}]{1,24}?', owner='我(?:平时|通常|一般|平日|现在)?', use=question?'(?:一般|通常)?用(?:什么|哪种)[\\p{Script=Han}]{0,5}[？?]?$':'(?:通常|一般)?用([\\p{Script=Han}]{1,24})[。！!]?$';
 const patterns=[[`^${owner}在(${H})(?:的时候|时)(${H})`,1,2],[`^(${H})(?:的时候|时)${owner}(${H})`,1,2],[`^(${H})[，,](${H})(?:的时候|时)${owner}`,2,1],[`^${owner}给(${H}(?:里|内|外|旁|上|下))的(${H})`,1,2],[`^(${H})(?:这件事)?[，,]在(${H}(?:里|内|外|旁|上|下))${owner}`,2,1]];
 for(const [pat,c,a] of patterns){const m=new RegExp(pat+use,'u').exec(text);if(m&&safeContext(m[c])&&safeContext(m[a]))return {condition:m[c],activity:m[a],value:question?null:m.at(-1)};}return null;
}
// Read-only projection. The write grammar deliberately stays narrower.
function readConditioned(text,question){
 const ordinary=conditioned(text,question);if(ordinary)return ordinary;
 const chars='[\\p{Script=Han}]{1,24}?',cue='(?:平时|通常|一般|平日|现在)?';
 const forms=question?[[`^(${chars})[，,]我(?:在)?(${chars})(?:的时候|时)${cue}用(?:什么|哪种)[？?]?$`,2,1],[`^(${chars})(?:这件事)?[，,]在(${chars})我${cue}用(?:什么|哪种)[？?]?$`,2,1]]:[[ `^我给(${chars})的(${chars})(?:的时候|时)${cue}用[\\p{Script=Han}]{1,24}[。！!]?$`,1,2]];
 for(const [pattern,c,a] of forms){const m=new RegExp(pattern,'u').exec(text);if(m&&safeContext(m[c])&&safeContext(m[a]))return {condition:m[c],activity:m[a]};}return null;
}
// Read a marked question as unordered role spans. Every non-grammatical
// character belongs to exactly one activity or condition; no topical fallback.
function roleQuestion(text){
 if(!text.includes('我')||!/(?:用|使用)(?:什么|哪样|哪种)[？?]?$/u.test(text))return null;
 if(!/(?:碰上|遇到|遇上|到了|赶上|要是|如果|处于)/u.test(text))return null;
 const fields=text.replace(/(?:使用|用)(?:什么|哪样|哪种)[？?]?$/u,'').split(/[，,]/u);let activity='',condition='',invalid=false;
 for(let piece of fields){piece=piece.replace(/我/g,'').replace(/(?:平时|通常|一般|往往|现在|会)+$/u,'').replace(/^(?:要是|如果|当)/u,'');if(!piece)continue;
 const marker=/^(说到|谈到|提到|关于|做|进行|碰上|遇到|遇上|到了|赶上|处于|在)/u.exec(piece)?.[0];const isScope=marker&&/^(碰上|遇到|遇上|到了|赶上|处于|在)$/u.test(marker)||/(?:的时候|时)$/u.test(piece);
 const value=piece.slice(marker?.length||0).replace(/(?:这件事|这一项|的时候|时)$/u,'');if(!safeContext(value)){invalid=true;continue;}
 if(isScope){if(condition)invalid=true;condition=value;}else{if(activity)invalid=true;activity=value;}}
 return {activity,condition,invalid:invalid||!activity||!condition};
}
// Candidate-local proof: remove two unique disjoint literal spans; every
// residual token must be grammatical, with temporal/location marking the
// condition (not the action). No permission or content survives this call.
function anchoredUse(q,s){
 const valueAsk=/(?:使用|用|拿)(?:什么|哪样|哪个|哪种|哪一[种个样])[？?]?$/u.exec(q);
 if(!s||!q.includes('我')||!valueAsk)return null;
 const {condition:c,activity:a}=s,ci=q.indexOf(c),ai=q.indexOf(a);if(ci<0||ai<0)return false;
 if(q.indexOf(c,ci+c.length)>=0||q.indexOf(a,ai+a.length)>=0||!(ci+c.length<=ai||ai+a.length<=ci)||q.indexOf('我')!==q.lastIndexOf('我'))return false;
 let t=q.slice(0,valueAsk.index);
 t=ci<ai?t.slice(0,ci)+'①'+t.slice(ci+c.length,ai)+'②'+t.slice(ai+a.length):t.slice(0,ai)+'②'+t.slice(ai+a.length,ci)+'①'+t.slice(ci+c.length);
 if(/[①②]/u.test(q))return false;
 const locative=/给①的②/u.test(t);
 if(!locative&&!/(?:碰上|遇到|赶上|到了|在|当|处于|正值)①|①(?:时|期间|阶段|这一步|的时候|那会儿|之际|环节)/u.test(t)||/(?:在|当|到了|若是|要是|如果)②|②(?:时|期间|阶段|这一步|的时候)/u.test(t))return false;
 if(locative)t=t.replace('给①的②','①②');
 return /^(?:①|②|我|[，,：:]|每当|每逢|若是|要是|如果|当|在|处于|正值|碰上|遇到|赶上|到了|的时候|那会儿|这一步|这件事|这一项|这个环节|阶段|期间|时|环节|之际|说到|谈到|关于|进行|做|给|平时|平日|通常|一般|习惯|惯常|会|都|该)+$/u.test(t);
}
function conditionedMatch(query,text){const role=roleQuestion(query),s=readConditioned(text,false);const anchored=anchoredUse(query,s);if(anchored!==null)return anchored;if(role)return !!s&&!role.invalid&&role.condition===s.condition&&role.activity===s.activity;if(!s)return null;const q=readConditioned(query,true);if(q)return q.condition===s.condition&&q.activity===s.activity;
 const omitted=/^我(?:平时|通常|一般)?(?:给)?(.+?)(?:通常|一般)?用(?:什么|哪种)[？?]?$/u.exec(query);return omitted?.[1]===s.activity?false:null;
}
// Exact current instrument family. Queries and declarations share the same
// owner/condition/activity roles; its value hole is never filled by relevance.
// Typed instrument focus: consume local constituents, not a bag of words.
// Remove exactly one marked time adjunct; the remaining predicate must bind
// its actor and instrument hole in grammatical order. Unconsumed words veto.
function focusedInstrument(text){
 const focus=/(?:哪(?:一)?[件种个]|什么)工具/gu,all=[...text.matchAll(focus)];if(!all.length)return null;
 const invalid={valid:false};if(all.length!==1||!text.includes('我')||/(?:别人|同事|朋友|他|她|替|帮|借给|要不要|不|没|才好|或者|或|还是|只有|假设|谁|哪里|多久|多少|[“”‘’「」])/u.test(text))return invalid;
 const tokens=text.replace(/[？?]$/u,'').replace(focus,'◇').split(/[，,]/u);if(tokens.length>2)return invalid;
 let condition='',activity='',subject=0,slot=0;
 for(let part of tokens){
   part=part.replace(/^我指的是/u,()=>{subject++;return ''});
   // An adjunct starts its clause, or follows owner in a cleft; never infer
   // its role from a noun shared by an unrelated recommendation or quotation.
   const m=/(?:^|(?<=我))在?([\p{Script=Han}]{1,18}?)时/u.exec(part);if(m){if(condition)return invalid;condition=m[1];part=part.slice(0,m.index)+part.slice(m.index+m[0].length);}
   if(!part)continue; if(activity)return invalid;
   const heads=[['我用◇',''],['◇是我用来','的'],['','用的是什么工具'],['','用的是◇']];
   let parsed=false;for(const [head,tail] of heads){if(!part.startsWith(head)||!part.endsWith(tail))continue;const a=part.slice(head.length,tail?part.length-tail.length:undefined);if(!safeContext(a))continue;subject+=head.includes('我')?1:0;activity=a;slot++;parsed=true;break;}if(!parsed)return invalid;
 }return subject===1&&slot===1&&safeContext(condition)&&safeContext(activity)?{valid:true,condition,activity}:invalid;
}
function instrumentQuestion(text){
 const h='([\\p{Script=Han}]{1,24}?)',suffix='(?:通常|一般|平时)?用(?:什么|哪种工具)[？?]?$';
 const direct=new RegExp(`^我在${h}时${h}${suffix}`,'u').exec(text),topic=new RegExp(`^说到${h}[，,]我在${h}时${suffix}`,'u').exec(text);if(!direct&&!topic)return null;
 const condition=direct?direct[1]:topic[2],activity=direct?direct[2]:topic[1];return {condition,activity,valid:safeContext(condition)&&safeContext(activity)&&!unsafe.test(text.replace(/[？?]$/u,''))};
}
function wrongActivity(query,text){
 query=query.replace(/^(现在|如今|目前|平时|通常|一般)我/u,'我$1');
 const match=conditionedMatch(query,text);if(match!==null)return !match;
 const topic=/^([\p{Script=Han}]{1,24})[，,]说到([\p{Script=Han}]{1,12})[，,]我/u.exec(query);if(topic){const frame=parseValueFrame(text);if(frame?.instrument)return frame.ctx!==topic[2]+topic[1];const i=text.indexOf(topic[2]);if(i>=0&&/^我(?:通常|一般|平时)用/u.test(text))return text.slice(i+topic[2].length).replace(/[。！!]$/u,'')!==topic[1];}
 const place=/^([\p{Script=Han}]{1,24})的(?:日常)?(?:存放处|存放位置|收纳处)[，,]/u.exec(query);if(place){const obj=/把([\p{Script=Han}]{1,24}?)(?:放在|的(?:日常)?(?:存放处|收纳处|存放位置))/u.exec(text)?.[1];if(obj)return obj!==place[1];}
 const stored=/^(?:平常|通常|平时)?我的([\p{Script=Han}]{1,24})放(?:在)?哪(?:儿|里)[？?]?$/u.exec(query);
 if(stored){const obj=/^我(?:通常|平时|一般)把([\p{Script=Han}]{1,24}?)放在/u.exec(text)?.[1]||/^我的([\p{Script=Han}]{1,24}?)(?:以后|今后|往后)/u.exec(text)?.[1];return !!obj&&obj!==stored[1];}
 let a=/^我(?:现在|如今|目前|平时|平常|通常|一般)?(.+?)(?:时)?(?:通常|一般|习惯)?用(?:什么|哪[个种把])[\p{Script=Han}]{0,8}[？?]?$/u.exec(query)?.[1];
 const front=/^([\p{Script=Han}]{2,28})时我(?:通常|一般)用哪[个种把]/u.exec(query)?.[1];if(!a&&!front)return false;
 const f=parseValueFrame(text);let scope=f?.ctx?.replace(/^(?:每次|每逢|平日|平常)/u,'').replace(/都$/u,'').replace(/(?:的时候|时)$/u,'');
 if(!scope)scope=/^我(?:每逢|每次|平日|平常)(.+?)(?:都)?用/u.exec(text)?.[1];if(!scope)return false;
 if(front){const segments=[...segmenter.segment(scope)].map(x=>x.segment);const verb=segments[0];if(!verb||!front.endsWith(verb)||scope===front)return false;return scope.slice(verb.length)!==front.slice(0,-verb.length);}
 return scope!==a;
}
module.exports={focusedInstrument,anchoredUse,instrumentQuestion,parseValueFrame,reversePrior,asksRevision,asksDefault,denialKeys,wrongActivity,conditioned,conditionedMatch};
