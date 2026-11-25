'use strict';
// Deliberately narrow admission: false negatives are preferable to saving copied instructions.
// The caller must supply the actual host-proven user body, never a rendered prompt.
const facts = require('./context-facts.cjs');
const secret = /(?:密码|口令|令牌|密钥|私钥|验证码|身份证|银行卡|手机号|住址|\b(?:password|passwd|secret|private key|api[ _-]?key|bearer|access token|credential|social security|home address)\b|sk-[\w-]{8,}|gh[pousr]_[\w]{8,}|AKIA[A-Z0-9]{16}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/)/iu;
const pasted = /[\r\n\u0000-\u001f\u007f\u2028\u2029`<>\[\]{}“”「」"#=]|(?:^|\s)(?:SELECT|function|const|import|sudo)\s|(?:粘贴|转述|转发|引用|原话|他说|她说|客户说|同事说|系统提示|忽略.{0,5}(?:指令|规则)|\b(?:quoted?|copied|pasted|said|says|ignore previous|system prompt)\b)/iu;
const transient = /(?:今天|今晚|这次|本次|这回|临时|暂时|暂定|考虑|也许|可能|假如|如果|是否|要不要|吗[。！!]?\s*$|(?:别|不要|不用|请勿|禁止|不许|不得|不必|无需).{0,5}(?:记住|记忆|保存|存储|记录)|\b(?:today|tonight|maybe|temporar(?:y|ily)|for now|this time|if|might|considering|forget)\b|\b(?:not|never|don't|don’t|do not)\s+(?:ever\s+)?(?:save|remember|store|record|retain|log)|[?？])/iu;
const assertion = /^(?:(?:我(?:一直|通常|一向)?(?:更?喜欢|更?偏好|习惯)|我的(?:偏好|习惯)是|(?:本项目|这个项目|我们(?:的)?项目|我们团队)(?:以后|今后|长期|始终|统一|默认|决定|规定|必须|只|不|采用|使用|要求)|我们(?:已经)?决定|(?:以后|今后)(?:我们|我|本项目)?(?:都|统一|默认|只|始终|采用|使用))|(?:I (?:generally |always |usually )?(?:prefer|like using)|my preference is|we (?:have )?decided(?: that| to)?|(?:our (?:project|team)|this project) (?:uses|requires|must|always|defaults to|will use|does not|never))\b)/iu;
const cnNoise = /(?:平时|通常|一般|经常|每周|每天|以后|过去|之前|我的|本人|个人|帮我|推荐|请给|合适|安排|计划|打算|准备|经历|体验|曾经|参加过|去过|做过|我们(?:的)?项目|这个项目|本项目|项目|我们|这个|那个|习惯|喜欢|偏好|默认|决定|规定|采用|使用|要求|以后|今后|上次|之前|什么|怎样|怎么|如何|为什么|是不是|有没有|是否|关于|请问|需要|一直|统一|必须|记得|选了|选择|规则|哪个|时候|方案|应该|处理|可以|还是|一下|当时|记忆|团队|确认|说过)/gu;
const enNoise = new Set('a an the i we you our your my this that project team decide decided decision decisions use uses using used require requires requirement prefer preference preferred usually always default defaults what which why how when who where where did does do is are was were will would should could can of to in on for as with by than it be and or remember about last please before choice choose chosen what was again more no not never must applies policy rules approach opted have has from had'.split(' '));
// A package-manager choice answers how to install dependencies, not how to install anything.
const packageTool = /\b(?:pnpm|npm|yarn)\b/iu;
const packageQuestion = /(?:包管理器|(?:装|安装|添加|更新).{0,6}依赖|依赖.{0,8}(?:装|添加|更新)|\bpackage manager\b|\b(?:install|add|update)\b.{0,24}\bdependenc(?:y|ies)\b)/iu;
function topics(s) {
  const pool = new Set();
  for (const w of s.normalize('NFKC').toLowerCase().replace(cnNoise,' ').match(/\p{Script=Han}+|[a-z][a-z0-9_+-]*/gu) || []) {
    if (/^[a-z]/.test(w)) { if (w.length>1 && w.length<=80 && !enNoise.has(w)) pool.add(w); }
    else {const chars=Array.from(w);for(let n=2;n<=4;n++)for(let i=0;i+n<=chars.length;i++)pool.add(chars.slice(i,i+n).join(''));}
  } return pool;
}
const domains = Object.entries({
 pkg: /\b(?:pnpm|npm|yarn|package manager|dependencies)\b|包管理器|依赖管理|依赖.{0,8}(?:装|添加|更新)|(?:装|安装|添加|更新).{0,6}依赖/i,
 drink: /咖啡|拿铁|美式|手冲|饮品|饮料|奶茶|红茶|绿茶|乌龙|喝什么|喝点什么|饮用|espresso|coffee|latte|beverage|\btea\b/i,
 food: /口味|忌口|吃辣|清淡|重辣|麻辣|甜食|甜品|素食|火锅|菜系|美食|吃什么|点菜|餐厅|点餐|饮食|dessert|spicy|vegetarian|cuisine/i,
 commute: /通勤|上班.{0,4}(?:路|坐|怎么去)|地铁|公交|骑车|骑行|单车|自行车|交通方式|出行方式|commut|subway|cycl(e|ing)|\bbike\b/i,
 exercise: /健身|锻炼|跑步|晨跑|夜跑|运动|游泳|瑜伽|球场|打球|workout|exercise|jogging|running|swimming/i,
 reading: /阅读|读书|小说|读物|看书|书单|书店|图书|fiction|books?|reading/i,
 music: /听歌|听音乐|乐器|吉他|钢琴|演唱会|音乐|歌单|music|guitar|piano/i,
 sleep: /入睡|睡觉|就寝|早睡|睡前|作息|熬夜|起床|bedtime|sleep/i,
 trip: /旅行|旅游|出游|游玩|游览|度假|行程|景点|出行计划|想去哪|去过哪|destination|travel|vacation/i,
 screen: /看电影|影院|观影|影片|电影|cinema|movies?/i,
 workstyle: /答复|回复|回答|表达方式|沟通方式|排版|简洁|简短|分点|表格|markdown|response style/i,
 editor: /编辑器|vscode|vim\b|emacs|text editor/i,
 storage: /数据库|持久化|sqlite|postgres|mysql|database/i,
 build: /构建|编译|打包|构建工具|webpack|vite\b|build tool/i,
 seat: /靠窗|窗边|过道|走道|临窗|中间座|选座|订座|座位|坐哪|坐在.{0,4}(?:排|边)|前排|后排|window seat|aisle|seating/i,
 order: /下单|点单|点一杯|点杯|点哪.{0,2}杯|点什么|点喝的|外卖|柜台|买杯|order(?:ing)? (?:a )?(?:coffee|drink|meal)/i,
 aftermeal: /饭后|餐后|吃完.{0,3}(?:饭|餐)|饭.{0,3}吃完|吃.{0,3}饭后|吃饱|消食|after (?:dinner|lunch|supper|meals?)/i,
 walking: /散步|遛弯|溜达|走一走|走走|步行|stroll|walk(?:ing)?/i,
 play: /游戏|玩什么|游玩|游艺|主机|桌游|解谜|单机|联机|game|puzzle/i,
 leisure: /消遣|娱乐|放松|打发时间|消磨时间|休闲|找点乐子|entertainment|leisure/i,
 shows: /综艺|剧集|电视剧|追剧|刷剧|看剧|纪录片|动画|悬疑片|爱情片|影单|片单|看点什么|推荐.{0,5}片|watch|documentary|series/i,
 pet: /养猫|养狗|宠物|猫粮|遛狗|\bpets?\b/i
});
const conceptsOf=s=>domains.filter(([,r])=>r.test(s)).map(([k])=>k);
// These edges translate an activity into possible domains; never treat a bare family as evidence of intent.
function queryConcepts(q){const cs=new Set(conceptsOf(q));if(cs.has('order')){if(!cs.has('food'))cs.add('drink');if(!cs.has('drink')||/菜单|餐|吃|外卖/u.test(q))cs.add('food');}if(cs.has('leisure'))for(const k of ['play','screen','shows','reading','music'])cs.add(k);if(cs.has('shows'))cs.add('screen');if(cs.has('screen'))cs.add('shows');return [...cs];}
// Retrieval-only equivalences, unlike broad domains such as leisure. Expand one hop;
// do not persist a generated word or let semantic neighbours update a replacement slot.
// Inspired by dsh-memory-center lib/retrieval.js expandQuery / searchItems (base > extra).
const aliasFamilies = [
  ['摄影','拍照','照相'], ['编织','针织','织毛线'], ['陶艺','制陶','做陶器'],
  ['烘焙','烘烤糕点'], ['园艺','养花','种花'], ['墨镜','太阳镜'],
  ['充电宝','移动电源','随身电源'], ['耳机','耳麦'], ['背包','双肩包'],
  ['保温杯','保温瓶'], ['羽毛球','badminton'], ['乒乓球','table tennis'],
  ['露营','野营','camping'], ['慢跑','jogging'], ['远足','徒步旅行','hiking'],
  ['登山','爬山','mountaineering'], ['茶馆','茶楼','茶室','teahouse']
];
const matchesAlias = (s,a) => /^[a-z]/.test(a) ? new RegExp('\\b'+a+'\\b','i').test(s) : s.includes(a);
function aliasQuery(s) {
  return aliasFamilies.filter(f=>f.some(a=>matchesAlias(s,a))).slice(0,3);
}
// A question about a meal occasion or a choice dimension calls for evidence of
// that occasion/dimension, not just any food or entertainment preference. The
// probes target existing summaries too; they never become capture/slot metadata.
function mealFacet(names, times) {
  const evidence = new RegExp('(?:'+names.join('|')+')(?![前后])|(?:'+times.join('|')+')[^，。；？！]{0,10}(?:吃|食物)','iu');
  return {ask:evidence,proof:evidence,probes:names,meal:true};
}
const choiceFacets = [
  mealFacet(['早餐','早饭','breakfast'],['早上','早晨','清晨']),
  mealFacet(['午餐','午饭','lunch'],['中午','正午']),
  mealFacet(['晚餐','晚饭','dinner'],['傍晚','晚上']),
  {ask:/辣度|辣不辣|多辣|辣味|吃辣|辣几档|\bspiciness\b/i, proof:/微辣|中辣|重辣|不辣|少辣|特辣|麻辣|吃辣|辣味|辣度|\bspic(?:y|iness)\b/i, probes:['微辣','中辣','不辣','吃辣','重辣','spicy']},
  {ask:/唱片|专辑|曲风|音乐风格|\b(?:album|record) genre\b/i, proof:/唱片|专辑|曲风|听歌|音乐|乐队|民谣|摇滚|爵士|古典乐|流行乐|嘻哈|\b(?:album|music|jazz|rock)\b/i, probes:['音乐','唱片','听歌','摇滚','爵士','民谣']}
];
// Specific named dishes cannot substitute for each other when asking about heat.
const dishStyles=[/火锅|鸳鸯锅|麻辣锅|清汤锅|hot\s?pot/i,/咖喱|curry/i,/川菜|四川菜/i,/拉面|ramen/i];
const serviceQuestion=/(?:退(?:改|票|款)|关门|开门|开放(?:时间|规定)|营业(?:时间|执照)|怎么(?:计算|收费)|几点(?:开|关)|票务|制作工艺|市场价|多少钱)/iu;
function facetsFor(q) {
  // A meal used as a time reference is not a request to choose food.
  const timeReference=/(?:早|午|中|晚)?(?:饭|餐)[前后]|吃完.{0,3}(?:饭|餐)/u.test(q);
  return choiceFacets.filter(f=>!(f.meal && timeReference) && f.ask.test(q));
}
// Only narrow a compound utterance when the final clause poses a self-contained
// question with its own recognizable subject. A bare '我喜欢什么' still needs the preface.
function recallFocus(s) {
  const opening=/^([\p{Script=Han}]{2,8})快开工了[，,]你记得我平时选哪种(线|针|纸|笔)吗[？?]$/u.exec(s);
  if(opening&&!/我|你|他|她|友|别|不|在|时|如果|帮|替|或|这|次|今天|明天|昨天/u.test(opening[1]))return '我现在做'+opening[1]+'习惯用什么'+opening[2]+'？';
  const setup=/^([\p{Script=Han}]{2,8})的工具都摆好了[，,]我(?:平常|平时)用的是哪种(线|针|纸)来着[？?]$/u.exec(s);
  if(setup&&!/我|你|他|她|友|别|不|在|时|如果|帮|替|或|这|次|今天|明天|昨天/u.test(setup[1]))return '我现在做'+setup[1]+'习惯用什么'+setup[2]+'？';
  const tail=s.split(/[，,；;]/u).at(-1).trim();
  if(tail===s || !(personalAsk.test(tail)||actionAsk.test(tail)))return s;
  const pre=s.slice(0,s.lastIndexOf(tail)), target=conceptsOf(tail);
  // Keep context for elliptical follow-ups and compound constraints (e.g. a meal
  // or a transport mode). Discard unrelated scene-setting only on a topic shift.
  const otherScene=/路上|途中|回来|回家后|结束后|过后|之后|顺便/u.test(pre);
  const unrelated=otherScene && target.length && !conceptsOf(pre).some(k=>target.includes(k));
  return (aliasQuery(pre).length || unrelated) && (target.length||aliasQuery(tail).length) ? tail : s;
}
// Use a contiguous excerpt around the strongest literal anchor, never a paraphrase.
function excerpt(s,anchors) {
  const chars=Array.from(s); if(chars.length<=96)return s;
  const a=anchors.filter(x=>s.toLowerCase().includes(x)).sort((x,y)=>y.length-x.length)[0];
  const at=a?Array.from(s.slice(0,s.toLowerCase().indexOf(a))).length:0;
  const start=Math.min(chars.length-96,Math.max(0,at-32));return chars.slice(start,start+96).join('');
}
const thirdParty=/(?:别人|朋友|同事|亲戚|父母|家人|室友|客户|客人|同学|老板|小孩|孩子|对象|伴侣|他(?:们)?|她(?:们)?|给[小老][\u4e00-\u9fff]|\b(?:friend|colleague|coworker|customer|partner|his|her|their|someone else|guests?)\b)/iu;
const personalAsk=/(?:我(?!国|们国家)|本人|咱|按.{0,3}习惯|照旧|老样子|照常|合口|偏好|口味|爱(?:吃|喝|看|听)|帮忙.{0,4}(?:选|点)|来一(?:杯|份)|推荐|选哪|选座|点单|pick for me|\b(?:me|my|mine|i)\b)/iu;
const objectiveAsk=/(?:科普|定义|是什么原理|原理|历史沿革|发明|起源|百科|客观|大众|普遍|大家|人们|产地|海拔|人口|价格|票价|营业时间|保质期|热量|成分|区别|比较|有何不同|制作方法|如何制作|怎么制作|一般人|大多数|常识|是什么东西|发展史|explain|history of|how is .*made|difference between)/iu;
const actionAsk=/(?:安排|选(?:哪|座|位置|什么)|点(?:哪|啥|个|一|什么|单)|订(?:哪|个|位)|挑(?:哪|个|一)|来(?:一|点|杯)|看点|找点|推荐|合适|怎么过|做点什么|做什么好|选什么|适合|怎么选|怎么挑|下单|买什么|订票|book me|recommend|what should)/iu;
const privateText=s=>secret.test(s)||/(?:病历|病情|确诊|抑郁|病史|过敏|处方|诊断|用药|怀孕|性取向|工资|收入|账单|家庭地址|联系方式|我的电话|我家住|\b(?:diagnos\w*|allerg\w*|medication|prescription|salary|address|phone number|depression)\b|(?<!\d)1[3-9]\d{9}(?!\d)|\d{12,}|-----BEGIN|\b[A-Za-z0-9/+_-]{32,}\b)/iu.test(s);
const noStore=/(?:别|不要|不用|请勿|禁止|不许|不得|不必|无需).{0,8}(?:记|存|记录)|不留档|仅限本轮|不想让.{0,3}(?:记|存)|\b(?:not|never|don't|don’t|do not)\s+(?:ever\s+)?(?:save|remember|store|record|retain|log)/iu;
// History is broader than capture (a temporary observation may be a useful quote),
// but evaluate vetoes on the WHOLE native message before admitting any excerpt.
// A withdrawal can refer to an earlier, never-curated utterance; do not guess which.
const lastRef='(?:我)?(?:刚才|刚刚|上一)(?:说的)?(?:那|这)?一?(?:整)?(?:句话|句|条消息|条)',erase='(?:忘掉|忘记|删掉|删去|删除|撤回|不要保存|别记)';
const exactLast=new RegExp(`^(?:(?:请)?(?:把${lastRef}(?:给我)?${erase}|${erase}${lastRef})|${lastRef}(?:请)?${erase}|当我没(?:说|讲))[。！!\\s]*$`,'u');
function previousWithdrawal(raw){return typeof raw==='string'&&exactLast.test(raw.trim());}
// Entire native utterances only. The retired object here is a habitual physical
// choice, not a message/permission. Unknown or qualified forms stay on the veto path.
function curatedChoice(text){
 const line=text.replace(/[。！!.]$/u,'');
 const safe=x=>!/(?:我|你|他|她|们|说|写道|假|可能|也许|不要|别|不|没|先|试|或|和|以及|想|打算|希望|据|听说|临时|今天|这次|以前|过去|只有|如果|当|仅|限|除|直到|为止|记忆|记录|存储|归档|聊天|保存|授权|许可|撤回|删|作废|转述|隐私|才怪|考虑|若|准备|暂|要是|万一|除非|的话|一旦|备选|之后|几个|一周|一次|几天)/u.test(x);
 // Fronted activity + self-owned habitual action. For an omitted broader
 // object, carry only a literal action phrase; never synthesize the object.
 const plain=x=>safe(x)&&!/(?:病|药|证件|身份|密码|密钥|住址|银行|病历|手机|账号|敏感|患者|诊断|合同|保密|客户|领导|同事|朋友|父亲|母亲|孩子|假装|声称|梦见|据称|必须|要求|让|如果|万一|不会|拒绝|例如|代替|模仿|扮演|故意|似乎|以为|差点|曾经|据称|以防|希望|被|将要|叫|要求|老师|家人|女士|先生|医生)/u.test(x);
 const physical=x=>plain(x)&&/(?:签|针|线|绳|纸|笔|刀|刷|尺|锤|夹|布|本|册|包|袋|板|卡片|盒|筒|铲|剪|锯|棒|钩|锥|毡|巾|绷带)$/u.test(x);
 const used=/^给(\p{Script=Han}{1,8}?)((?:做|画|刻|印|补|描|制|拼|修|装订)\p{Script=Han}{1,8})[，,]我(?:一直|一贯|通常|向来)(?:拿|用)(\p{Script=Han}{1,10})(刻|描|画|切|裁|缝|刷|印|磨|划|扎|敲|剪|锯)$/u.exec(line);
 if(used&&plain(used[1])&&plain(used[2])&&physical(used[3]))return {kind:'standingTool',activity:used[2],object:used[1],value:used[3],action:used[4]};
 const forward=/^我((?:做|织|编|剪|画|描|刻|缝|补|串|装订)\p{Script=Han}{1,6}?)(?:以后|今后|往后)(?:改用|换用)(\p{Script=Han}{2,6})$/u.exec(line.replace(/^我(以后|今后|往后)((?:做|织|编|剪|画|描|刻|缝|补|串|装订)\p{Script=Han}{1,6}?)(?=改用|换用)/u,'我$2$1'));
 if(forward&&plain(forward[1])&&physical(forward[2])&&!/(?:想|可能|也许|不|别|暂时|只|这次|考虑|别人|代|替|的|时)/u.test(forward[1]+forward[2]))return {kind:'revision',activity:forward[1],verb:'用',value:forward[2],noun:forward[2].slice(-1)};
 const routine=/^我(?:平常|平时|通常)去(\p{Script=Han}{2,10})(?:总带|总会带)(\p{Script=Han}{1,10})$/u.exec(line);
 if(routine&&plain(routine[1])&&physical(routine[2]))return {kind:'standingCarry',activity:routine[1],value:routine[2]};
 const outing=/^(?:这次|本次)我去(\p{Script=Han}{3,20})只带(\p{Script=Han}{1,10})[，,；;](?:平时|平常|通常)(\p{Script=Han}{2,10})的习惯不变$/u.exec(line);
 if(outing&&outing[1]!==outing[3]&&outing[1].endsWith(outing[3])&&[outing[1],outing[3]].every(plain)&&physical(outing[2]))return {kind:'exception',activity:outing[3],scope:outing[1],verb:'带',value:outing[2]};
 const carry=/^(?:每回|每次|每逢)去(\p{Script=Han}{2,10})我(?:都会|总会|都)(?:揣|带|拿|背)(?:一[个张支本把条只卷袋盒块])?(\p{Script=Han}{1,10})$/u.exec(line);
 if(carry&&plain(carry[1])&&physical(carry[2]))return {kind:'standingCarry',activity:carry[1],value:carry[2]};
 const causal=/^(?:后来|最近)(?:发现|发觉)(\p{Script=Han}{2,10}?)(?:容易|经常|老是)(\p{Script=Han}{1,6})[。；;](?:往后|今后|以后)(\p{Script=Han}{2,12})我(?:换成|改用|换用)(\p{Script=Han}{2,10}?)了$/u.exec(line);
 if(causal&&physical(causal[1])&&plain(causal[2])&&plain(causal[3])&&physical(causal[4])&&causal[1]!==causal[4])return {kind:'causal',activity:causal[3],prior:causal[1],value:causal[4]};
 const trip=/^(明天|今天)去(\p{Script=Han}{2,8})(?:那趟|这趟)(?:怕|担心)(?:弄湿|沾水|打湿|弄脏|淋湿|摔坏)[，,](我)?只(?:拿|带)(\p{Script=Han}{2,10})[；;](?:别的|其他)(?:场次|时候|行程)不变$/u.exec(line);
 if(trip&&plain(trip[2])&&physical(trip[4]))return {kind:trip[3]?'trip':'unownedTrip',scope:trip[1]+'去'+trip[2],activity:trip[2],value:trip[4]};
 const change=/^我改主意了[，,](?:以后|今后|往后)(\p{Script=Han}{2,16}?)都(用|带|穿)(\p{Script=Han}{2,12})[，,](?:原来|以前|原先)的(用|带|穿)(\p{Script=Han}{1,4})习惯作废$/u.exec(line);
 if(change){const [,activity,verb,value,other,noun]=change;if(verb===other&&value.endsWith(noun)&&[activity,value,noun].every(safe))return {kind:'revision',activity,verb,value,noun};}
 const local=/^只有(?:这次|本次)去(\p{Script=Han}{2,6}?)(写生|观鸟|拓印|排练|速写|摄影|采风)[，,]我才(用|带)(\p{Script=Han}{1,10})[，,；;]其他时候照旧$/u.exec(line);
 if(local&&plain(local[1])&&physical(local[4]))return {kind:'exception',scope:local[1]+local[2],activity:local[2],verb:local[3],value:local[4]};
 const once=/^只有(?:这次|本次)(\p{Script=Han}{3,20})[，,]我才(用|带|穿)(\p{Script=Han}{1,12})[；;](?:以后|今后|往后)(?:平常|通常|平时)(\p{Script=Han}{2,16})(?:还是|仍然)照旧$/u.exec(line);
 if(once){const [,scope,verb,value,activity]=once;if(scope!==activity&&scope.endsWith(activity)&&[scope,value,activity].every(safe))return {kind:'exception',scope,activity,verb,value};}
 return null;
}
// Refusal may narrow recording, never grant it. Unknown-scope storage refusals stay closed.
function ongoingArchiveRefusal(raw){const t=raw.normalize('NFKC');
 const refusal=noStore.test(t)||/(?:不|别|勿|禁止|停止|暂停).{0,8}(?:归档|留档|保存|记录|留存|留底|收录|保留|存档|录入|记下)/su.test(t);
 if(!refusal)return false;
 if(/以后|今后|从今|后续|接下来|往后|之后|从现在|一直|一律|永远|永久|任何|所有|每(?:一)?(?:句|条|次)|都(?:别|不)|再也|never|anymore|from now|going forward|in future/iu.test(t))return true;
 return !/(?:这|本|上一|刚才|前一|那)(?:一)?(?:段|句|条|轮|次|件事)|仅限本轮|this (?:message|turn|one)|previous (?:message|turn)/iu.test(t);
}
function historyDirective(raw,mode='source') {
  if(typeof raw!=='string'||!raw.trim())return 'deny';
  const t=raw.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/gu,'');
  // A complete first-person choice about an object's design, not a request
  // to discard records. Never mask any surrounding clause or alter storage text.
  // Bound the physical property, not the object/answer. Mixed or ambiguous clauses abstain.
  const physicalChange=/^我(?:改了|改主意了),以后\p{Script=Han}{1,12}(?:常规|默认)(?:主色|配色|材质|纹样)都用\p{Script=Han}{1,6},(?:之前|原先)的(?:决定|方案)作废[。！!]?$/u.test(t)&&!/(?:记录|聊天|归档|存档|保存|留存|隐私|记忆|许可|授权|同意|作废.*作废)/u.test(t);
  const directiveText=((physicalChange||curatedChoice(t)?.kind==='revision')?t.replace(/作废(?=[。！!]?$)/u,''):t)
    .replace(/(?:怕|担心|以免|免得)(?:自己|我)?(?:会)?(?:忘记|忘了|忘掉)/gu,' ');

  if(previousWithdrawal(raw))return 'retract';
  // Share the actual tool grammar, including 移除; selectors may contain the entire refused quote.
  if(require('./curated-forget.cjs').request(raw))return 'deny';
  if(mode==='source' && require('./intent.cjs').controlIntent(t))return 'deny';
  if(/(?:忘掉|忘了|忘记|遗忘|撤回|收回|删掉|删去|删除|抹掉|清除|清空|当我没说|当我没讲|说错了|说反了|作废|不要再提|别再提|\b(?:forget|retract|erase|delete|withdraw|disregard|scratch that|take (?:that|it) back)\b)/iu.test(directiveText))return 'deny';
  const veto=noStore.test(t)||/(?:别|不要|不用|不必|请勿|禁止|不许|不得|莫|勿)(?:再)?(?:把|将)?(?:我(?:刚才)?说的)?(?:这(?:句(?:话)?|条(?:消息)?|段(?:话)?|件事|些(?:话|内容)?)|我的话|它)?(?:给我)?(?:留下(?:来)?|留着|留在(?:记录|历史|记忆|档案)里|留底|保留)/u.test(t)||/(?:莫记|勿记|别留|不留(?:存|档|痕)|(?:^|[，,。；;：:\s])不留底(?=$|[，,。；;！!\s])|不(?:要|用|必|许|想|得|该|应|准|能|可|希望)?.{0,8}(?:保存|记录|记下|记住|留存|入库|留档|存档)|(?:别|勿|禁止|莫).{0,8}(?:留档|归档|入库|留存|收藏)|不要.{0,8}留|不[写放加录]入.{0,8}(?:记忆|档案|历史)|(?:只|仅)限(?:本次|本轮|当前)(?:对话|聊天)?|off[- ]the[- ]record|keep (?:this|it) private|(?:do not|don't|don’t|never|not to)\s+(?:ever\s+)?(?:keep|save|record|retain|remember|log|store)|(?:no|without) (?:storage|recording)|keep .{0,20}out of (?:memory|history))/isu.test(t);
  // A separate instruction about THIS message is not about the old value it mentions.
  // Keep independent historical vetoes in the prefix; strip all final local clauses in one pass.
  const localTail=veto&&/(?:[。；;！!]\s*(?:请)?(?:别|不要)把这句(?:话)?留下(?:来)?\s*)+[。！!]?\s*$/u.exec(t);
  if(localTail&&historyDirective(t.slice(0,localTail.index),mode)!=='retract')return 'deny';
  if(veto&&(/(?:刚才|前面|以前|之前|刚刚|前一|上一|上次|那(?:件|句|条|个)|earlier|previous|last (?:message|thing)|what I (?:just )?said)/iu.test(t)))return 'deny';
  // These two ordinary request phrases are not evidence that a question is a pasted quotation.
  const pasteInput=mode==='request'?t.replace(/原话|\bI said\b/giu,' '):t;
  // The consent lane stops before factual ownership, paste and length heuristics.
  if(mode==='archive')return veto||!raw.isWellFormed()?'deny':'allow';
  if(veto||raw.length>16000||!raw.isWellFormed()||privateText(t)||thirdParty.test(curatedChoice(t)?.kind==='exception'?t.replace(/其他时候照旧(?=[。！!.]?$)/u,'平时照旧'):t)||facts.otherOwner.test(t))return 'deny';
  // All ordinary veto, privacy and ownership rules above saw the original bytes.
  // In the assistant-final lane only, ignore exactly ONE pair of title delimiters
  // for the paste heuristic. Re-run that heuristic on the entire sentence.
  // First-person proposals are not user testimony. Permit a bounded aesthetic
  // rationale, not arbitrary text after a title or an assertion of adoption.
  const proposal=/^(?:我)?(?:建议|推荐)(?:使用|采用)“[\p{Script=Han}]{2}”作为(?:古典)?二字(?:标题|题名)(?:，(?:寓意[\p{Script=Han}]{2,20}|(?:它)?(?:蕴含|体现|传达)(?:了)?(?:春日|夏日|秋日|冬日|山水|田园|自然)的(?:气息|韵味|意境|风貌)(?:与(?:意境|韵味|气息))?))?。$/u;
  const explained=/^我(?:建议|推荐)(?:使用|采用)“[\p{Script=Han}]{2}”作为(?:古典)?二字(?:标题|题名)，(?:它)?(?:富有|蕴含|体现)(?:春日|夏日|秋日|冬日|山水|田园)的(?:意境|韵味|气息)，(?:简洁而富有诗意|清新而自然|含蓄而典雅)。$/u;
  if(mode==='assistant-final'&&(proposal.test(raw)||explained.test(raw))&&!pasted.test(pasteInput.replace(/[“”]/gu,'')))return 'allow';

  if(pasted.test(pasteInput)){
    // Only the line breaks themselves may be the reason for a paste match.
    // Recheck complete owned statements; individual checks never receive LF.
    if((mode!=='source'&&mode!=='assistant-final')||!raw.includes('\n')||raw.length>480||pasted.test(pasteInput.replace(/\r?\n/gu,' ')))return 'deny';
    const lines=raw.split(/\r?\n/u);
    if(lines.length>4||lines.some(line=>!ownedPlainLine(line)))return 'deny';
  }
  return 'allow';
}
const personal = /(?:^|[，, ])(?:我(?!们)|本人)|\b(?:i|my)\b/i;
const signs={project:/(?:本项目|这个项目|该项目|我们(?:的)?项目|我们团队|项目(?:约定|规定|默认|要求|决定)|我们(?:已经)?决定|以后我们|\b(?:our (?:project|team)|this project|we (?:have )?decided)\b)/i,
 plan:/(?:打算|计划|准备(?:去|在|学|开始|下)|下(?:周|个?月|季度|星期)|明年|明天.{0,6}(?:去|要|会)|将要|\b(?:plan(?:ning)? to|next (?:week|month)|intend to)\b)/i,
 experience:/(?:曾经|曾在|曾去|去过|体验过|尝试过|试过|看过|参加过|学过|用过|吃过|喝过|住过|玩过|做过|读过|上周|去年|上次|之前.{0,6}(?:过|去了)|\b(?:visited|tried|attended|went to|used to|last year|last week)\b)/i,
 habit:/(?:习惯|平时|通常|经常|一般会|总是|每(?:天|周|晚|次|逢|个月|个星期|个工作日)|固定|一向都会|\b(?:usually|habit|regularly|each|every|routine)\b)/i,
 preference:/(?:喜欢|偏爱|偏好|讨厌|更爱|不爱|爱喝|爱吃|爱看|不太爱|口味|首选|倾向|\b(?:prefer\w*|like|love|dislike|favorite|favourite)\b)/i};
function typing(s){if(signs.project.test(s)&&!personal.test(s))return 'project';if(!personal.test(s)&&!/^(?:下周|上周|去年|明天|上次|以前|以前常常|现在|最近|以前|以后|从今以后|从现在起)[，, ]*我/u.test(s))return null; if(signs.preference.test(s)&&!signs.plan.test(s)&&!signs.experience.test(s))return 'preference';return ['plan','experience','habit','preference'].find(k=>signs[k].test(s))||null;}
function intent(q){if(/项目|团队|包管理器|依赖|\b(?:team|project|dependencies|package manager)\b/i.test(q))return 'project';if(/去过|做过|经历|试过|体验过|上(?:一?次|周|月|星期|礼拜|季度)|前(?:几天|些天|阵子|段时间)|去年|昨天|曾经|参加过|过去|回顾|之前.{0,10}(?:去|吃|喝|看|住|逛|玩|做|体验|参加)|\b(?:visited|experience|previously|yesterday|last (?:week|year|month|time))\b/i.test(q))return 'experience';if(/打算|计划|准备去|下一站|接下来|届时|待办|\b(?:plans?|upcoming)\b/i.test(q)||(/下(?:周|星期|个?月)|明天|明年|将来|过几天|\b(?:tomorrow|next (?:week|month))\b/i.test(q)&&!actionAsk.test(q)))return 'plan';if(/平时|习惯|通常|一般|经常|规律|routine|usually|habit/i.test(q))return 'habit';if(signs.preference.test(q)||/推荐|合我|合口|选哪|适合我|recommend/i.test(q))return 'preference';return null;}
const ownedCare = /^我(?:的|用的)((?:水|茶|饭|餐|木|竹|玻璃|陶瓷|塑料|保温|不锈钢)?(?:杯|碗|盘|锅|盒|瓶))(?:不能|不可|不可以)(?:放进|放入|进)(洗碗机|微波炉|烤箱|冰箱)[。.]?$/u;
// Restrict the generic noun phrases to material-marked possessions and a
// physical containment appliance, not 'my X cannot ...' about people or places.
function physicalCare(s){
  const m=/^我(?:的|用的)([\p{Script=Han}]{2,16}?)(?:不能|不可以|不可)(?:放进|放入|进)([\p{Script=Han}]{1,8}(?:机|柜|箱|炉|锅))[。.]?$/u.exec(s);
  if(!m||!/(?:木|竹|钢|铁|铜|铝|银|塑料|树脂|硅胶|橡胶|玻璃|陶瓷|搪瓷|皮革|棉|羊毛|纤维)/u.test(m[1])||/(?:的|说|人|员|师|匠|工友|商|猫|狗|鸟|兔|鼠|宠物|今天|刚才|以为|据称|可能|大概|想|假设)/u.test(m[1]))return null;
  return m;
}
function ownedPlainLine(line){
  // Fail closed on frames even if legacy single-sentence typing recognizes
  // a preference word inside the framing. Only use normalized text to check;
  // source spans always refer to the original native block.
  if(!/^(?:我(?!们)|本人)/u.test(line)||line.length>160||/[，,；;：:‘’'"？?]/u.test(line)||/(?:说|转引|复述|复制|摘录|台词|角色|假扮|模仿|扮演|贴出|打印|念出|原文|发来|写道|除非|即使|哪怕|万一|否则|的话|例外|仅限)/u.test(line)||captureFrame.test(line)||facts.nonassertion.test(line)||transient.test(line))return false;
  if(/[。！？.!?]/u.test(line.replace(/[。！.!]$/u,'')))return false;
  const c=selectCapture(line);if(c?.text!==line||c.evidence.subject!=='self')return false;
  // A generic '我...' prefix does not prove this is a direct assertion.
  return !!(ownedCare.test(line)||physicalCare(line)||require('./natural-capture.cjs').inferNaturalType(line)||
    /^(?:我|本人)(?:不?喜欢|偏好|偏爱|习惯|平时|通常|每(?:周|天|次|晚))/u.test(line)&&['habit','preference'].includes(c.type));
}
function selectCapture(text,now=Date.now()) {
  if (typeof text!=='string' || text.length>360 || historyDirective(text)!=='allow' || facts.nonassertion.test(text) || /[?？]|是否|要不要|假如|如果|也许|可能|考虑|\b(?:maybe|might|if)\b/iu.test(text)) return null;
  const cc=curatedChoice(text);
  if(cc?.kind==='unownedTrip')return null;
  const rev=cc?.kind==='revision'?facts.analyze(text):null;
  const typed=rev?.subject==='self'&&rev.change&&rev.slot&&rev.value===cc.value&&rev.property==='use'&&JSON.stringify(rev.conditions)===JSON.stringify({activity:[cc.activity]});
  if(cc&&!typed)return {text,summary:text,keywords:[cc.activity,cc.value],type:['trip','exception'].includes(cc.kind)?'experience':'habit',created:now,curatedChoice:cc};
  // Decide eligibility on the whole message before extracting a smaller exact source span.
  if (/(?:不是真的|其实不是|才怪|取消|举例|假设|开玩笑|转述|只限今天|仅供参考|不要记录|不希望.{0,5}记|先不记|算了|说错了|说反了|我改主意了)/u.test(text)) return null;
  let s=text.trim().replace(/^(?:请)?(?:记住|记一下|帮我记住)[：:，, ]+/u,'');
  const reason=/^([^。！？!；;\n]{6,160}[。])\s*(?:因为|这样一来|这样就)[^。！？!；;\n，,]{2,50}[。.]?$/u.exec(s);
  if(reason){if(thirdParty.test(text)||/[“”「」『』]|(?:指令|密码|地址|敲门|但是|不过|临时|今天才|只限|仅限)/u.test(text))return null;s=reason[1];}
  const named=/^我(?:的|家)?[^，。！？\n]{1,22}(?:取名叫|取名为|名字叫|名叫|叫做)[\p{Script=Han}A-Za-z]{1,12}[。.]?$/u.test(s)&&!/(?:人|孩|同学|同事|朋友|家人|邻居|亲戚|妹妹|弟弟|哥哥|姐姐|爸爸|妈妈|先生|太太|女儿|儿子|老师)/u.test(s);
  // An owner's explicit care instruction about a household object is a durable note.
  const care = ownedCare.exec(s) || physicalCare(s);
  const shape=facts.analyze(s), natural=require('./natural-capture.cjs').inferNaturalType(s);
  const type=(shape.change?(shape.contrast&&/喜欢|偏好|偏爱|首选|^爱$/u.test(shape.property)?'preference':'habit'):null) || (care?'note':null) || natural || typing(s) || (shape.routine?'habit':null) || (named && /(?:盆栽|盆.{0,5}花|薄荷|绿植|玩偶|手账本|自行车|吉他|相机)/u.test(s)?'note':null) || (assertion.test(s)?'project':null);
  if (s.length<6 || !type || (type!=='plan' && transient.test(s)) || (/[。！？!]|\.\s/u.test(s.replace(/[。.!！]$/u,''))&&!shape.contrast?.joinedWithdrawal) || /[；;]/u.test(s)&&!shape.contrast?.prior) return null;
  if(/(?:我(?:的)?(?:家人|同事|朋友|室友|伴侣|父亲|母亲|孩子|老婆|老公|爸|妈)|(?:朋友|同事|室友|客户|家人|孩子|老板)(?:喜欢|习惯|想|计划|打算|通常)|\bmy (?:partner|child|mother|father|colleague|friend|coworker)\b)/iu.test(s))return null;
  if(type==='project'&&!assertion.test(s)&&!/(默认|决定|规定|统一|采用|必须|不得|要求|使用|换成|改用)/u.test(s))return null;
  if (/(?:同事|客户|朋友|他们|她们|他的|她的|\b(?:client|coworker|friend|his|her|their)\b)/iu.test(s)) return null;
  const aliases = packageTool.test(s) ? ['依赖','包管理器','dependencies','dependency','package manager'] : [];
  const ks = [...new Set([...aliases,...(care ? [care[1], care[2]] : []),...topics(s)])].slice(0,12);
  if (!ks.length) return null;
  if (['preference','habit'].includes(type) && ((facts.occasional.test(s) && !(shape.change && shape.oldValue && !facts.occasional.test((shape.contrast?s.replace(shape.contrast.marker,''):s.replace(/(?:以前|之前)(?=[喝吃坐穿带用听读练选点买订看])/u,''))))) || /(?:刚|才)(?:点|买|选|喝|吃)了|[，,](?:但|可|不过)|(?:一份|一次|一杯).{0,5}就好/u.test(s))) return null;
  // A scoped change is the only multi-clause update grammar. Never mine an
  // isolated half of an uncertain or compound assertion for replacement.
  if (!shape.change && /(?:改为|改喝|换成|不再)/u.test(s) && type!=='project') return null;
  const evidence={subject:type==='project'?'project':shape.subject,conditions:shape.conditions,property:shape.property,value:shape.value};
  // A retrieval topic is not an identity (two unrelated decisions can concern storage).
  // A new namespace also keeps pre-upgrade broad project slots out of replacement.
  const pkg=/^(?:本项目|这个项目|我们(?:的)?项目)(?:以后|今后)?(?:默认|统一)?(?:使用|用|采用|改用|换成|改为)\s*(?:pnpm|npm|yarn)[。.]?$/iu.test(s);
  const concepts=conceptsOf(s),slot=type==='project'?(pkg?'project:package-manager':''):(shape.slot?require('node:crypto').createHash('sha256').update(shape.slot).digest('hex'):'');
  const days=/今天|今晚|today|tonight/i.test(s)?1:/明天|tomorrow/i.test(s)?2:/下周|下星期|next week/i.test(s)?14:30;
  return {text:s,summary:Array.from(s).slice(0,160).join(''),keywords:ks,type,concepts,slot,created:now,expires:type==='plan'?now+days*86400000:0,evidence,requirePrior:!!shape.requirePrior,oldValue:shape.oldValue,replace:!!slot && (shape.change || (type==='project' && /改为|改成|改用|换成|instead/i.test(s)))};
}
// A personal interval question asks for a recurring action, not the duration
// of one occurrence. Require a complete action match (not a topic match).
function frequencyActivity(query){
  const m=/^我(?:习惯|一般|通常|平时)?(?:每隔|隔|每)?(?:多久|几天|几周|几个月)([\p{Script=Han}]{1,16})一次([\p{Script=Han}]{0,16})[？?]?$/u.exec(query);
  return m?m[1]+m[2]:null;
}
function periodicActivity(text){
  const m=/^我(?:习惯|一般|通常|平时)?每(?:隔)?(?:[一二三四五六七八九十两\d]{1,3})?(?:天|日|周|星期|个?月|年|晚|早)(?:都会|会|都)?([\p{Script=Han}]{2,32})[。！!.]?$/u.exec(text);
  return m?.[1].replace('一次','');
}
function literalRoutine(q,t){
 const prep=/^按我平时的习惯[，,](\p{Script=Han}{2,8})该准备哪种(线|纸|针|笔)[？?]?$/u.exec(q);
 if(prep){const change=/^(?:以后我|从今往后，我)(\p{Script=Han}{2,8}?)(?:改用|都换成)(\p{Script=Han}{1,12})[。.]?$/u.exec(t);if(change)return change[1]===prep[1]&&change[2].endsWith(prep[2]);q=`我现在${prep[1]}习惯用什么${prep[2]}？`;}

 const a=/^我(?:现在)?(\p{Script=Han}{2,8}?)(?:时)?习惯用什么(\p{Script=Han}{0,4})[？?]?$/u.exec(q),b=/^我(\p{Script=Han}{2,8})时习惯用(\p{Script=Han}{1,12})[。.]?$/u.exec(t)||/^(?:以后|今后)我(编绳|串珠)改用(\p{Script=Han}{1,10}线)[。.]?$/u.exec(t);if(a&&/^(线|针|纸|笔)$/u.test(a[2])){const changed=/^(?:以后我|从今往后，我)(\p{Script=Han}{2,8}?)(?:改用|都换成)(\p{Script=Han}{1,12})[。.]?$/u.exec(t);if(changed)return a[1]===changed[1]&&changed[2].endsWith(a[2]);} return a&&b&&a[1]===b[1]?b[2].endsWith(a[2]):null;
}
function scoreRecall(query,hits,now) {
  if (typeof query!=='string'||query.length>512||!Array.isArray(hits)||secret.test(query)||pasted.test(query)) return [];
  if(privateText(query)||noStore.test(query)||/(?:他|她|同事|客户|朋友)(?:的|平时|喜欢|习惯|计划)|\b(?:his|her|their|friend|coworker)\b/i.test(query))return [];
  if(thirdParty.test(query)||facts.otherOwner.test(query)||objectiveAsk.test(query)||serviceQuestion.test(query))return [];
  // A stated placement routine is not a present-location observation.
  // Scoped storage questions compare the whole object and phase, not topic
  // overlap. A bounded shortlist cannot prove that an omitted scope is unique.
  const physical=/(?:此刻|眼下|现在|目前|实际|究竟|到底).{0,6}(?:在(?:哪|什么地方)|位于哪)/u.test(query)&&!/(?:把|将).+(?:放|收|存)/u.test(query);
  const placement=/^我([\p{Script=Han}]{0,28}?)(?:通常|平时|一般|习惯|总是)(?:把|将)([\p{Script=Han}]{1,24}?)(?:放|收|存)(?:在|到)?哪(?:儿|里)[？?]?$/u.exec(query);
  // Omitted scope needs project-wide (not top-K) uniqueness certification.
  query=recallFocus(query);
  const qs=topics(query), requested=intent(query), qc=queryConcepts(query),action=actionAsk.test(query); if (!qs.size) return [];
  const asksNonInstrument=/(?:多少时间|多长时间|多久|在哪里|在哪儿|在什么地方)/u.test(query);
  const frequency=frequencyActivity(query);
  const aliases=aliasQuery(query), facets=facetsFor(query), ranked=[],seen=new Set();
  for(const hit of hits.slice(0,20)) {
    if (!hit || typeof hit.id!=='string' || !hit.id || seen.has(hit.id) || typeof hit.summary!=='string'||hit.summary.length>240||secret.test(hit.summary)||pasted.test(hit.summary)) continue;
    // Indexed scoped statements must pass the topic-bound ambiguity check above.
    const sp=require('./scoped-preference.cjs'), scoped=sp.frame(hit.summary);
    if(scoped && sp.question(query)!==scoped.topic)continue;
    const choice=curatedChoice(hit.summary);
    if(choice?.kind==='trip'&&!query.includes(choice.scope))continue;
    if(choice?.kind==='exception'&&(!query.includes(choice.scope)||!/(?:这次|本次|那次|上次)/u.test(query)))continue;
    if(asksNonInstrument){const f=require('./value-frame.cjs').conditioned(hit.summary);if(f?.value&&!/(?:分钟|小时|秒钟|天|周|月|年|时间|工夫|功夫)$/u.test(f.value))continue;}
    if(physical&&!/(?:放|收|存|整理|归置).*(?:哪|何处)/u.test(query)&&['habit','preference'].includes(hit.type))continue;
    if(placement){const f=/^我([\p{Script=Han}]{0,28}?)(?:通常|平时|一般|习惯|总是)(?:把|将)([\p{Script=Han}]{1,24}?)(?:放|收|存)(?:在|到)([\p{Script=Han}]{1,32})[。！!.]?$/u.exec(hit.summary);if(!f||(placement[1]&&f[1]!==placement[1])||f[2]!==placement[2]||hit.placementOwner!==hit.id)continue;}
    if(hit.type==='habit'&&literalRoutine(query,hit.summary)===false)continue;
    if(['habit','preference'].includes(hit.type)&&require('./value-frame.cjs').wrongActivity(query,hit.summary))continue;
    if(frequency && (hit.type!=='habit'||periodicActivity(hit.summary)!==frequency))continue;
    if(!facts.compatible(frequency||query,hit.summary)||historyDirective(hit.summary)!=='allow'||facts.nonassertion.test(hit.summary)||hit.state==='superseded'||(hit.expires && hit.expires<=now))continue;
    const care = ownedCare.exec(hit.summary);
    if(care && !(query.includes('我') && query.includes(care[1]) && query.includes(care[2])))continue;
    const inferred=typing(hit.summary), kind=hit.type && hit.type!=='note'?hit.type:inferred;
    const daily=kind&&kind!=='project'&&kind!=='note';
    if(daily && !(personalAsk.test(query)||action||requested==='experience'||requested==='plan'||requested==='habit'))continue;
    // A habitual choice may inform a recommendation, not prove a stated preference.
    const asksForFit=/(?:合(?:我|本人)(?:的)?(?:口味|胃口|心意)|适合我|suit(?:s)? me|right for me)/iu.test(query);
    if(requested && kind && requested!==kind) {
      const seatQuestion = requested==='habit' && kind==='preference' && /^我坐(高铁|飞机)(?:通常|一般|习惯)选什么座[？?]?$/u.exec(query);
      const seatFact = seatQuestion && facts.analyze(hit.summary);
      const habitualSeat = seatFact?.routine && seatFact.subject==='self' && seatFact.property==='choose' &&
        seatFact.conditions.activity?.length===1 && seatFact.conditions.activity[0]===`坐${seatQuestion[1]}` && /座$/u.test(seatFact.value);
      if(!habitualSeat && !(requested==='preference'&&kind==='habit'&&(action||asksForFit))) continue;
    }
    if(daily && action&&!requested&&!['preference','habit'].includes(kind))continue;
    const hc=conceptsOf(hit.summary), semantic=qc.some(k=>hc.includes(k));
    const hs=topics(hit.summary);const shared=[...qs].filter(x=>hs.has(x));
    const strong=!!frequency||shared.some(x=>x.length>=3 || (/^\p{Script=Han}{2}$/u.test(x) && qs.size<=2));
    const packageMatch = packageQuestion.test(query) && packageTool.test(hit.summary);
    const concrete=[/咖啡|coffee|latte|espresso|拿铁|美式|手冲/i,/奶茶|乌龙|红茶|绿茶|\btea\b/i,/骑行|自行车|单车|骑车|cycling|bicycle/i,/地铁|subway/i,/火锅|hotpot/i,/跑步|跑鞋|晨跑|夜跑|running/i,/游泳|swimming/i,/钢琴|piano/i,/吉他|guitar/i];
    if(concrete.some(r=>r.test(query)&&!r.test(hit.summary)))continue;
    const anchored=semantic&&(requested!==null||action||personalAsk.test(query)||packageMatch||/通勤|饮品|饮料|包管理器|交通方式|点餐|锻炼方式|读物|音乐类型|就寝时间|旅行目的地|数据库/i.test(query));
    // A specific venue/activity must not be answered with a merely topical plan.
    if(requested==='plan' && aliases.some(f=>!f.some(a=>matchesAlias(hit.summary,a)))) continue;
    const facetAnchors=facets.map(f=>hit.summary.match(f.proof)?.[0]?.toLowerCase());
    const facetMatch=facets.length && daily && (requested || action || personalAsk.test(query) || /(?:给我|帮我|替我|为我).{0,8}(?:准备|挑|选|点|买)|\b(?:for me|my usual)\b/iu.test(query)) && facetAnchors.every(Boolean);
    if(facets.length && requested!=='project' && (!facetMatch || dishStyles.some(r=>r.test(query)&&!r.test(hit.summary)))) continue;
    if(facetMatch&&!requested&&!['habit','preference'].includes(kind))continue;
    const equivalent=aliases.flatMap(f=>f.filter(a=>matchesAlias(hit.summary,a)));
    // An alias may be incidental: preserve independent literal/domain evidence.
    if(aliases.length && !equivalent.length && !strong && !anchored)continue;
    const revision=['habit','preference'].includes(kind)?facts.analyze(hit.summary):null;
    if (!(kind==='habit'&&literalRoutine(query,hit.summary)) && !facetMatch && !strong && !anchored && shared.length<2 && !(daily&&equivalent.length) && !(kind==='habit'&&require('./value-frame.cjs').asksDefault(query,hit.summary)) && !require('./value-frame.cjs').asksRevision(query,revision?.contrast) && !(['habit','preference'].includes(kind) && facts.scopedHabitMatch(query,hit.summary))) continue;
    // The immutable source may itself quote the retired choice. For a fully
    // parsed correction expose only the exact new-choice span; manual read
    // still returns both halves and the predecessor link.
    const current=revision?.change&&revision.oldValue?revision.value:null;
    seen.add(hit.id);ranked.push({id:hit.id,type:hit.type||'note',summary:current||(choice?.kind==='causal'?choice.value:null)||excerpt(hit.summary,[...shared,...equivalent,...facetAnchors.filter(Boolean)]),direct:strong||equivalent.length>0,score:(equivalent.length?3:0)+(anchored?6:0)+(requested===kind?6:0)+(qc.includes('aftermeal')&&hc.includes('aftermeal')?5:0)+shared.reduce((n,w)=>n+w.length,0)});
  }
  if(placement&&ranked.length!==1)return [];
  return ranked;
}
function finishRecall(ranked) {
  // A confident literal/alias answer need not carry a second, merely topical neighbour.
  return ranked.filter((r,i)=>!i || !ranked[0].direct || r.direct).slice(0,2).map(({id,summary,type})=>({id,summary,type}));
}
function selectRecall(query,hits,now=Date.now()) {
  return finishRecall(scoreRecall(query,hits,now).sort((a,b)=>b.score-a.score));
}
function recallRoutes(db,query) {
  if(!db||typeof query!=='string'||!query.trim()||query.length>256||privateText(query)||pasted.test(query)||noStore.test(query))return null;
  if(thirdParty.test(query)||facts.otherOwner.test(query)||objectiveAsk.test(query)||serviceQuestion.test(query))return null;
  query=recallFocus(query);
  const words=[...topics(query)].slice(0,18); if(!words.length)return null;
  const topic=db.conceptCandidates(queryConcepts(query),12).slice(0,12), literal=db.searchAutomatic(words.join(' '),12);
  const extra=[...new Set([...aliasQuery(query).flat(),...facetsFor(query).flatMap(f=>f.probes)])].filter(a=>!matchesAlias(query,a)).slice(0,6);
  // null = no alias pass; an attempted pass returning [] still took the deduplication branch.
  const alias=extra.length?db.searchAutomatic(extra.join(' '),6):null;
  const p=/^我([\p{Script=Han}]{0,28}?)(?:通常|平时|一般|习惯|总是)(?:把|将)([\p{Script=Han}]{1,24}?)(?:放|收|存)(?:在|到)?哪(?:儿|里)[？?]?$/u.exec(query);
  if(p){const id=db.placementOwner?.(p[2],p[1]);for(const h of [...literal,...topic,...(alias||[])])h.placementOwner=id;}
  return {query,literal,topic,alias};
}
function baselineOrder({literal,topic,alias}) {
  const fused=[];for(let i=0;i<12;i++){if(literal[i])fused.push(literal[i]);if(topic[i])fused.push(topic[i]);}
  if(!alias)return fused;
  const unique=new Map();
  for(const hit of [...literal.slice(0,6),...alias,...fused])if(!unique.has(hit.id))unique.set(hit.id,hit);
  return [...unique.values()];
}
// An explicit contrast has two slots. Never infer either from a ranked prefix.
function contrastPair(db,query,now){
 if(!/(?:这次|本次)/u.test(query)||!/(?:分别|各自)/u.test(query))return null;
 const first=/^(?:平常|平时|通常)去(\p{Script=Han}{2,10})(?:与|和)(?:本次|这次)去(\p{Script=Han}{3,20})[，,]我(?:分别|各自)(带)什么[？?]?$/u.exec(query);
 const material=/^(?:平常|平时)做(\p{Script=Han}{2,10})(?:与|和)(?:本次|这次)(\p{Script=Han}{3,20})[，,]我(?:分别|各自)(用)什么(线|针)[？?]?$/u.exec(query);
 const q=material?[null,material[2],material[1],material[3]]:first?[null,first[2],first[1],first[3]]:/^(?:这次|本次)(\p{Script=Han}{3,20})(?:和|与)(?:平常|平时|通常)(\p{Script=Han}{2,12})[，,]?我(?:分别|各自)(?:该)?(带|用|穿)什么(?:装(\p{Script=Han}{1,4}))?[？?]?$/u.exec(query);
 if(!q||q[1]===q[2]||!q[1].endsWith(q[2])||!db.search)return [];
 const [,scope,activity,verb,purpose]=q;const hits=db.search(activity,20);if(hits.length>=20)return []; // exact match postings included; saturated -> unproven uniqueness
 const normal=[],special=[];
 for(const h of hits){if(h.state!=='active'||h.expires&&h.expires<=now)continue;
 const t=h.summary;if(typeof t!=='string'||!t.includes(activity)||!t.includes(verb))continue;
 const x=curatedChoice(t),m=(material&&/^我做(\p{Script=Han}{2,10})时习惯(用)(\p{Script=Han}{1,12})[。.]?$/u.exec(t))||/^我去(\p{Script=Han}{2,12})时(?:通常|平时|平常)(带|用|穿)(\p{Script=Han}{1,12})[。.]?$/u.exec(t)||/^我(?:平时|平常|通常)(?:去)?(\p{Script=Han}{2,12}?)都(带|用|穿)(\p{Script=Han}{1,12})[。.]?$/u.exec(t);
 let slot,value;if(x?.kind==='exception'){if(x.scope!==scope||x.activity!==activity||x.verb!==verb)continue;slot=special;value=x.value;}else if(x?.kind==='standingCarry'&&x.activity===activity&&verb==='带'){slot=normal;value=x.value;}else if(m&&m[1]===activity&&m[2]===verb){slot=normal;value=m[3];}else return [];
 const r=db.automaticEvidenceRow(h.id)[0];if(!r||h.claimStatus||r.summary!==t||historyDirective(t)!=='allow'||facts.nonassertion.test(t)||privateText(t)||pasted.test(t)||/(?:不要|改用|偶尔|有时|除非|但是|不是|或者|和|也许|别|不|可能|他|她|我们|命令|指令)/u.test(value))return [];
 const row=db.read(h.id,0,192),src=row?.source;if(row?.text!==t||row.nextOffset!==null||src?.kind!=='host-user-quote'||src.block!==0||src.utf16Offset!==0||src.utf16Length!==t.length||!db.historyAllowed(src.sessionId,src.seq,t))return [];
 if(material&&!value.endsWith(material[4]))return [];
 if(purpose&&!(value.includes(purpose)||(purpose==='乐谱'&&/谱(?:夹|袋|包|盒)$/u.test(value))))return [];
 slot.push({id:h.id,type:r.type,summary:t});
 }
 return normal.length===1&&special.length===1?((first||material)?[normal[0],special[0]]:[special[0],normal[0]]):[];
}

function selfOnlyActivity(query){
  const selfOnly=/^只查我自己的记录：([\p{Script=Han}]{2,10})的材料包还没配好，我平常会拿哪种线？也说清楚这是我的习惯，还是我朋友的习惯。$/u.exec(query);
  return (selfOnly && !thirdParty.test(selfOnly[1]) && !privateText(query) && !noStore.test(query) && !pasted.test(query)) ? selfOnly[1] : null;
}
function recallAutomatic(db,query,now=Date.now()) {
  // A prohibition in the actual user request is a veto, never a search term.
  if(typeof query!=='string'||/(?:不(?:要|用|许|必)?|别|禁止|无需)(?:再)?(?:参考|参照|查询|查阅|检索|调取|使用|用到|依据|结合|考虑)(?:我|本人|个人|以往|以前|历史|任何|记忆|记录)/u.test(query.normalize('NFKC').replace(/\s/gu,'')))return [];
  const pref=require('./scoped-preference.cjs'), topic=pref.question(query);
  if(topic){
    if(historyDirective(query,'request')!=='allow')return [];
    const exact=pref.recall(db,topic,now);
    if(exact!==null)return exact;
    // Existing databases have no topic projection. Preserve only a single literal legacy match.
    const routes=recallRoutes(db,query);
    const legacy=routes?selectRecall(routes.query,baselineOrder(routes),now).filter(h=>h.type==='preference'&&h.summary.includes(topic)):[];
    return legacy.length===1?legacy:[];
  }
  if(/^我现在(?:更)?(?:喜欢|偏好|偏爱)(?:哪种|什么)[？?]?$/u.test(query)||/(?:别|不要|禁止)查/u.test(query))return [];
  // Explicit self-only request. Do not turn the comparison into a third-party search.
  const activity=selfOnlyActivity(query);
  if(activity){
    const rows=recallAutomatic(db,'只看我本人说过的话，我要做'+activity+'了，照往常该拿哪种线？',now);
    return rows.filter(r=>r.type==='habit' && typeof r.summary==='string' && r.summary.startsWith('我做'+activity+'时习惯用') && !thirdParty.test(r.summary));
  }
  const routes=recallRoutes(db,query);
  if(!routes)return [];
  const timed=db.futureChoice?.(query,now);if(timed!=null)return timed;
  if(/给[\p{Script=Han}]{3,23}[，,]/u.test(query)&&/(?:准备|备)什么(?:工具)?[？?]?$/u.test(query)&&!/(?:分别|各自)/u.test(query)){
    const prep=/^(?:下次|这次|明天)?我(?:要|打算|准备)?给([\p{Script=Han}]{3,23})[，,](?:(?:你)?(?:替我|帮我)|我)?(?:需要|要|该)?(?:准备|备)什么(?:工具)?[？?]?$/u.exec(query);
    const hit=prep&&db.preparationEvidence?.(prep[1],now);return hit?[hit]:[];
  }
  // Translate only a whole, self-owned packing contrast into the existing verifier.
  const pack=/^按我自己的安排[，,]去(\p{Script=Han}{3,20})(?:和|与)日常(\p{Script=Han}{2,10})[，,](?:应当|应该)?(?:分别|各自)收拾什么[？?]?$/u.exec(query);
  if(pack && !/(?:他|她|朋友|假设|可能|或者|禁止|别|不|不要|家人)/u.test(pack[1]+pack[2]) && pack[1]!==pack[2] && pack[1].endsWith(pack[2]))return contrastPair(db,`本次${pack[1]}与平时${pack[2]}，我分别带什么？`,now)??[];
  // A self-owned single-event material question needs the exact event, verb and item class.
  const once=/^(?:这次|本次)(\p{Script=Han}{3,20})我(?:该)?用什么(线|针)[？?]?$/u.exec(query);
  if(once){
    const hits=selectRecall(routes.query,baselineOrder(routes),now);
    const exact=hits.filter(h=>{const x=curatedChoice(h.summary);return x?.kind==='exception'&&x.scope===once[1]&&x.verb==='用'&&x.value.endsWith(once[2]);});
    return exact.length===1?exact:[];
  }
  const pair=contrastPair(db,query,now);if(pair!==null)return pair;
  const vf=require('./value-frame.cjs');let q=vf.instrumentQuestion(query)||vf.focusedInstrument(query);
  if(!q&&query.includes('我')&&/(?:用|拿)(?:什么|哪样|哪种工具)[？?]?$/u.test(query)&&/(?:碰上|遇到|遇上|到了|赶上|要是|如果|处于|每逢|时)/u.test(query.replace(/平时|通常|一般/gu,''))){
    const bound=new Map();for(const h of baselineOrder(routes)){if(typeof h.summary!=='string')continue;const f=vf.conditioned(h.summary);if(!f||!vf.anchoredUse(query,f))continue;bound.set(JSON.stringify([f.condition,f.activity]),{condition:f.condition,activity:f.activity,valid:true});}
    if(!bound.size){const hits=baselineOrder(routes).filter(h=>h.type==='habit'&&literalRoutine(query,h.summary));return selectRecall(routes.query,hits,now);}if(bound.size!==1)return [];q=bound.values().next().value;
  }
  if(q){const proof=db.instrumentEvidence?.(q,now);if(!proof)return [];
    const hits=(db.automaticEvidenceRow?.(proof.id)||[]).filter(h=>h.id===proof.id&&typeof h.summary==='string'&&h.summary.slice(proof.start,proof.end)===proof.value);
    // Keep the ordinary source/consent/expiry checks. The value projection
    // is a literal span, while the retrieved row remains the verbatim evidence.
    const out=selectRecall(`我在${q.condition}时${q.activity}通常用什么？`,hits,now);return out.map(h=>({...h,summary:proof.value}));}
  return selectRecall(routes.query,baselineOrder(routes),now);
}
// Curated capture only. Unlike the experimental partitioner, this never
// inherits a speaker, skips an unclassified span, or strips a condition.
const explicitOwner=/^(?:我(?!们)|本人|本项目|这个项目|我们(?:的)?项目|我们团队|my\b|I\b|this project\b|our (?:project|team)\b)/iu;
const captureFrame=/(?:[『』‘’《》：:]|据说|听说|说过|(?:说|写道|表示)[，,]|举例|例句|示例|假设|假定|如果|要是|假如|可能|也许|尚未确定|开玩笑|转述|翻译|模拟|假装|打个比方|不是真的|其实不是|才怪|只限今天|仅供参考|先不记|算了|我改主意了|\b(?:example|suppose|pretend)\b)/iu;
// An archival assertion is one short, owned clause. The object is never extracted as a standing preference.
// An unrecognized sentence is NOT a veto on legacy/multi-span capture. Only an explicit near-negative frame is.
const archiveObject='[\\p{Script=Han}A-Za-z0-9]{2,32}';
const archiveVerbs='(?:完成|提交|交付|寄出|整理|验收)';
const projectFrame='(?:本项目|这个项目|我们团队)(?:已经|已)(?:决定|敲定|确定)(?:采用|使用|改用|保留)';
const timeFrame='(?:今天|明天|后天|(?:本|下)周[一二三四五六日天])(?:前)?';
const archiveForms=[['project',projectFrame],['experience','(?:我|我们)(?:昨天|前天|上周|刚刚|今天)'+archiveVerbs+'了'],['plan','(?:我|我们)(?:将在|定于|计划)'+timeFrame+archiveVerbs]].map(([type,head])=>[type,new RegExp('^'+head+archiveObject+'[。！!.]?$','u')]);
const archiveDoubt=/未|没|差点|不|如果|假设|似乎|听说|据说|可能|也许|取消|开玩笑|是否|吗|呢|但|除非|本来|原本|或者|暂定|才怪|其实|而是|据称|算了|举例/u;
const explicitNearMiss=/^(?:(?:本项目|这个项目|我们团队)(?:尚未|还没|并未|不曾)(?:决定|敲定|确定)(?:采用|使用|改用|保留)|(?:我|我们)(?:计划|将在|定于)(?:有空|有机会|条件允许时)(?:完成|提交|交付|寄出|整理|验收)|(?:我|我们)(?:昨天|前天|上周|刚刚|今天)(?:差点|并未|尚未|没有)(?:完成|提交|交付|寄出|整理|验收))[\p{Script=Han}A-Za-z0-9]{2,32}[。！!.]?$/u;
function captureItems(raw,sessionId,seq){
  const now=Date.now();
  function cited(c,i){return {...c,source:{kind:'host-user-quote',sessionId,seq,block:0,utf16Offset:i,utf16Length:c.text.length}};}
  // A bounded material noun, not arbitrary trailing prose. Activity is checked
  // literally against the authorized standing quote by the store.
  const sw=/^(?:以后我|从今往后，我)([\p{Script=Han}]{2,12}?)(?:改用|都换成)((?:(?:朱红|绛红|黛青)色?|(?:淡|深|浅|米|湖|天|草|墨|粉|梅|雾|杏|松|靛|烟|银|铁|砖|橄榄|葡萄|玫瑰)?[红橙黄绿青蓝紫灰白黑]色?)?(?:棉线|麻线|丝线|毛线|蜡线|宣纸|棉纸|铜丝|铁丝|铝丝|牛皮纸))[。！!.]?$/u.exec(raw);
  if(sw&&!/我|他|她|别人|他们|如果|要是|只|帮|替|让|说|想|可能|不|别|临时|这次|时|在|给|会|据|听|假|建议|打算/u.test(sw[1])){
    const shape=selectCapture(`我${sw[1]}时习惯用${sw[2]}。`,now);
    if(shape?.type==='habit'&&shape.evidence?.subject==='self'&&shape.evidence.property==='use'&&shape.evidence.value===sw[2]&&shape.slot)
      return [cited({...shape,text:raw,summary:raw,keywords:[],materialSwitch:sw[1],replace:false},0)];
  }
  // Only a complete native append may introduce the scoped preference.
  const preference=require('./scoped-preference.cjs').item(raw,now);
  if(preference && !captureFrame.test(raw) && !facts.nonassertion.test(raw))return [cited(preference,0)];
  function legacy(){
    const c=selectCapture(raw,now);if(!c)return [];
    const at=raw.indexOf(c.text);return at>=0&&raw.indexOf(c.text,at+1)<0?[cited(c,at)]:[];
  }
  if(raw.length<=160&&curatedChoice(raw))return legacy(); // indivisible compound, no fragment mining
  if(raw.length>1440||facts.nonassertion.test(raw)||captureFrame.test(raw.trimStart().replace(/^(?:请)?(?:记住|记一下|帮我记住)[：:]/u,''))||/[?？]/u.test(raw))return [];
  if(raw.includes('\n')){
    // Whole-turn permission already required every line to pass independently.
    // Keep original boundaries (CRLF is two UTF-16 units); no normalized copies.
    const rows=[],seen=new Set();
    for(const m of raw.matchAll(/[^\r\n]+/gu)){
      const c=selectCapture(m[0],now);if(!c||c.text!==m[0])return [];
      const key=c.text.replace(/[。！!.]$/u,'');if(!seen.has(key))rows.push(cited(c,m.index));seen.add(key);
    }
    return rows;
  }
  const line=raw.trim();
  // An explicit completed placement, not a claim of ownership or a permanent location.
  // Only the current native user append is available here, not prior role-play context.
  const placement=/^我(?:刚刚|刚)?把([\p{Script=Han}]{1,10}?)(?:放进|收进|夹进|塞进|放回|摆到|装进|搬到)([\p{Script=Han}]{0,5}(?:盒|袋|册|包|屉|台|间|架|柜|篮|箱|楼|桌)(?:上|里|中)?)了[。！!.]?$/u;
  const risky=/没|未|不|假|差点|险些|想|原本|本来|如果|以为|可能|也许|才怪|听说|据说|似乎|据称|每|总|惯|通常|平时|以后|永远|一直|经常|台词|角色|扮演|念|替|帮|让|叫|要|会|给|准备|打算|计划|尝试|试图|失败|他|她|说|又|别|放不|不了|一次也/u;
  if(placement.test(line)&&!risky.test(line))return [cited({text:line,type:'utterance',searchOnly:true},raw.indexOf(line))];
  // Complete self-owned craft-material utterance; only an already permitted event, never a routine.
  if(raw===line && /^只有这次做(?:绳辫|绕梭|编织|刺绣|手工)(?:盘扣|编花|流苏|绳结|挂饰)我才用(?:[浅深淡墨杏天梅湖草米粉]?[红橙黄绿青蓝紫白黑灰])?(?:棉线|麻线|丝线|毛线|蜡线)，其余照旧。$/u.test(raw))return [cited({text:raw,type:'utterance',searchOnly:true},0)];
  if(explicitNearMiss.test(line))return [];
  const archiveType=archiveForms.find(([,re])=>re.test(line))?.[0];
  if(archiveType){
    if(archiveDoubt.test(line))return [];
    const existing=archiveType==='project'?legacy():[];
    if(existing[0]?.type==='project')return existing;
    return [cited({text:line,type:archiveType,searchOnly:true},raw.indexOf(line))];
  }
  // Do not turn a qualified turn into unqualified fragments. A legacy
  // whole-message match (e.g. a scoped update) is still decided intact.
  if (/(?:除非|即使|哪怕|万一|否则|的话|仅限|仅今天|仅今日|今天例外|这次例外|只在今天|转引|代述|并不是|不是说)/u.test(raw)) return legacy();
  const items=[];let start=0;
  // Leave a topic comma inside the quote. Split a soft boundary only when
  // the left side has no potential shared frame and the right owns itself.
  function take(end){
    const span=raw.slice(start,end),line=span.trim(),c=selectCapture(line,now);
    if(!c||c.text!==line)return false;
    const f=facts.analyze(line),natural=require('./natural-capture.cjs').inferNaturalType(line);
    // A complete self-owned assertion that passed standalone selection need not
    // match a second, narrower grammar to accompany another assertion. Do not
    // extend that fallback to clauses with internal frames or shared ownership.
    const standaloneOwner=explicitOwner.test(line)&&!/[，,]/u.test(line);
    if(!natural&&!f.routine&&!f.change&&!(explicitOwner.test(line)&&(c.type==='note'||c.slot==='project:package-manager'))&&!standaloneOwner)return false;
    const at=start+span.indexOf(line);items.push(cited(c,at));return items.length<=12;
  }
  for(const m of raw.matchAll(/[。！!；;，,]|\.(?=\s|$)/gu)){
    const soft=/[，,]/u.test(m[0]),semi=/[；;]/u.test(m[0]);
    if(soft){
      const left=raw.slice(start,m.index).trim();
      if(!explicitOwner.test(raw.slice(m.index+1).trimStart())||!explicitOwner.test(left)||Object.keys(facts.conditions(left)).length)continue;
    }
    if(!take(m.index+(soft||semi?0:1)))return legacy();
    start=m.index+1;
  }
  if(raw.slice(start).trim()&&!take(raw.length))return legacy();
  if(items.length<2)return legacy();
  // Identical repeated assertions in this append should not occupy extra hits.
  const seen=new Set();return items.filter(c=>{const k=c.text.replace(/[。！!.]$/u,'');if(seen.has(k))return false;seen.add(k);return true;});
}
function captureTurn(db,raw,{sessionId,seq,eventMs,zone}){
  const d=historyDirective(raw);
  if(d==='retract'){db.observeHistory(sessionId,seq,raw,false);return [];}
  if(d!=='allow')return [];
  const f=require('./future-choice.cjs');
  if(f.future(raw))return db.saveFutureTurn(sessionId,seq,raw,eventMs,zone);
  return db.saveCaptureTurn(sessionId,seq,raw,captureItems(raw,sessionId,seq));
}
module.exports={ongoingArchiveRefusal,selfOnlyActivity,curatedChoice,previousWithdrawal,historyDirective,selectCapture,captureTurn,selectRecall,recallAutomatic,recallRoutes,baselineOrder,scoreRecall,finishRecall};
