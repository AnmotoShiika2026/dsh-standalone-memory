window.__ModuleLoader__.load({ id: 'dsh-standalone-memory', factory: (require) => {
  const React = require('react');
  const h = React.createElement;
  const fields = [
    ['conversationArchive', '对话归档', '保存符合条件的用户原文和已完成的助手可见回复。工作区已关闭时，打开这里也不会恢复归档。'],
    ['autoCapture', '自动收录', '从符合条件的新消息收录精选记忆；关闭不删除已有笔记。'],
    ['autoRecall', '自动召回', '在适用的问题中提示助手查找已有记忆。'],
    ['historyLookup', '历史回查', '允许主动查找以前说过的话，包括按日期和角色回查。'],
    ['legacyImport', '允许导入旧会话', '默认开启。在「导入旧对话」页选择会话并确认后才会导入，不会自动复制历史聊天。'],
    ['sessionIsolation', '全局会话隔离', '开启时每个会话只用自己的记忆；关闭时仍遵守「会话记忆隔离」页中单独开启的隔离。']
  ];
  function valid(data) {
    if (!data || !fields.every(([key]) => typeof data[key] === 'boolean')) throw new Error('宿主未返回完整配置');
    return Object.fromEntries(fields.map(([key]) => [key, data[key]]));
  }
  // Only catalog metadata loads automatically. Data actions do not run on mount, selection, tab changes or input edits.
  const groups = {
    '工作区归档': ['status','archiveOn','archiveOff','archiveResume'],
    '精选记忆': ['memories','search','read','save','correct','forget','current','semantic'],
    '历史记录': ['archive','archiveGet','history'],
    '清理数据': ['forgetExact','archiveForget','clear']
  };
  const actions = {
    status:['查看归档状态'], archiveOn:['开启工作区归档',[], '从现在起允许工作区归档；不补录关闭期间的对话。'],
    archiveOff:['关闭工作区归档',[], '停止这个工作区的后续归档。'], archiveResume:['恢复未来助手归档',[], '允许后续符合条件的助手回复进入归档；不补旧记录。'],
    import:['导入所选旧会话',[],'复制这个原会话中符合条件的可见原文到本地归档，不写精选记忆。'],
    memories:['浏览记忆',['page']],search:['搜索记忆',['query']], read:['读取记忆原文',['id','offset']],
    save:['收录原话',['text','summary','keywords'],'只收录宿主能在所选会话核验的用户原话。'],
    correct:['修改记忆',['id','summary','keywords'],'修改这条记忆的摘要或关键词，保留来源原话。'],
    forget:['删除记忆',['id'],'删除指定 ID 的精选记忆；不删除 DSH 聊天。'],
    current:['查当前偏好',['query']],semantic:['语义检索',['query']],
    archive:['按日期查归档',['from','to','role','page']], archiveGet:['展开归档原文',['id','from','to','role','offset']], history:['搜索历史原话',['query']],
    archiveForget:['删除归档记录',['id','from','to','role'],'删除指定的已验证归档原文；DSH 自身聊天仍然保留。'],
    forgetExact:['按完整原话删除',['text'],'仅在所选会话的完整用户原话唯一匹配时删除对应记录。'],
    clear:['清除数据',[],'删除所选会话在本插件中的资料；此操作不可撤销，不删除 DSH 聊天或系统备份。']
  };
  const labels={id:'记录 ID',offset:'正文起点（从 0 开始）',page:'页码（从 1 开始）',query:'检索词',text:'用户原话',summary:'摘要',keywords:'关键词（用逗号分隔）',from:'起始日期',to:'结束日期',role:'说话人'};
  const panelStyle={border:'1px solid var(--line)',borderRadius:12,padding:'12px',margin:'12px 0'};
  const outputStyle={whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'20em',overflow:'auto',margin:0};
  // Only data meant for a person (quotes, summaries, dates, IDs) crosses this boundary.
  const uncertain='未能确认这次操作的结果。请先查看当前状态，再决定是否重试。';
  const partial='回执不完整，只显示能确认的内容。';
  const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const count=v=>Number.isSafeInteger(v)&&v>=0;
  const text=v=>typeof v==='string'&&v.length>0;
  const identifier=v=>text(v)&&v.length<=512&&!/[\r\n{}]/u.test(v);
  const lookup=(map,key)=>typeof key==='string'&&Object.hasOwn(map,key)?map[key]:undefined;
  const reasons={disabled:'功能未启用。请核对已生效的配置和工作区归档状态。',not_found:'找不到可核验的记录。请核对所选会话和记录。',invalid_request:'请检查必填内容、编号和输入长度。',invalid_query:'请换一个简短、明确且允许查找的检索词。',invalid_range:'请填写有效日期，结束日期不能早于起始日期。',privacy_boundary:'按当前隐私规则，这次操作未执行。',stale_session:'会话已经变化，请重新列出并选择。',session_unavailable:'所选会话不可用，请重新列出会话。',unverified_source:'无法核验原话来源，请回到原会话核对。',unavailable:'暂时无法完成操作，请先核对当前状态。',select_session:'请先选择操作会话。',confirmation_required:'请再次确认后执行。',not_saved:'原话未收录，请核对完整原话。',rank_unavailable:'暂时无法比较候选原话，请稍后再查。',ambiguous:'有多条可能的记录，无法唯一确定目标。请核对记录编号。',limit:'会话内容超过本次导入上限，未导入。',budget_exceeded:'超过本次核验范围，请核对原话或按编号操作。',clarify_with_literal:'请填写要删除的完整原话。'};
  class DisplayError extends Error {}
  const safeMessage=e=>e instanceof DisplayError?e.message:uncertain;
  function recordLines(r,op,sourceName){
    if(!obj(r))return [partial];
    const lines=[],src=obj(r.source)?r.source:{};
    if(identifier(r.id))lines.push('记录编号：'+r.id);
    if(typeof r.day==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(r.day))lines.push('归档日期：'+r.day);
    if(text(r.text)){
      const speaker=lookup({user:'用户',assistant:'助手'},r.role)??(!r.role&&src.kind==='host-user-quote'?'用户':null);
      lines.push((speaker?speaker+'原话':'原文')+'：'+r.text);
    }
    if(text(r.summary))lines.push('摘要：'+r.summary);
    if(text(r.currentValue))lines.push('当前偏好：'+r.currentValue);
    if(Array.isArray(r.keywords)&&r.keywords.every(text)&&r.keywords.length)lines.push('关键词：'+r.keywords.join('、'));
    if(identifier(src.sessionId))lines.push(sourceName(src.sessionId));
    if(count(src.seq))lines.push('消息编号：'+src.seq);
    const kind=lookup({utterance:'发言引文',habit:'习惯',preference:'偏好',plan:'计划',project:'项目',experience:'经历',note:'笔记'},r.type);
    if(kind)lines.push('类型：'+kind);
    const state=lookup({active:'有效记录',superseded:'这是旧说法，后来有过更正。'},r.state);
    if(state)lines.push(state);
    const claim=lookup({not_established:'这只是发言证据，不证明现实情况或长期习惯。',disputed:'这条原话还有未解决的更正，不能据此确定当前值。'},r.claimStatus);
    if(claim)lines.push(claim);
    const check=lookup({verified:'原话与来源一致。',unavailable:'来源暂时无法核验。',mismatch:'保存的原话与来源不一致。'},r.sourceStatus);
    if(check)lines.push(check);
    if(Array.isArray(r.links))for(const link of r.links)if(identifier(link?.previous)&&identifier(link?.current))lines.push('更正前的记录：'+link.previous+'；更正后的记录：'+link.current);
    if(!lines.length||(['read','archiveGet','history','semantic','archive'].includes(op)&&typeof r.text!=='string')||(r.claimStatus&&!claim)||(r.sourceStatus&&!check)||(r.role&&!['user','assistant'].includes(r.role)))lines.push(partial);
    return lines;
  }
  function receipt(op,d,recordId,sourceName){
    if(op==='save'&&identifier(d))return ['记录编号：'+d,'是否为本次新增，尚未确认。'];
    if(!obj(d))return [uncertain];
    if(Object.hasOwn(d,'status')&&!['history','semantic','import'].includes(op)&&!(op==='forgetExact'&&d.status==='deleted'))return [uncertain];
    if(['status','archiveOn','archiveOff','archiveResume'].includes(op)){
      const lines=[];let missing=false;
      for(const [key,label,on,off] of [['enabled','工作区归档','已开启','已关闭'],['profileEnabled','归档总开关','已开启','已关闭'],['assistantGuarded','后续助手回复','暂停归档','未单独暂停归档'],['importEnabled','旧会话导入','已允许','未允许'],['isolated','记忆范围','仅本会话','同一工作区共享']]){
        if(typeof d[key]==='boolean')lines.push(label+'：'+(d[key]?on:off));else missing=true;
      }
      if(op==='archiveResume'){if(d.resumed===true)lines.push('已恢复后续助手回复归档，不补录旧回复。');else if(d.resumed===false)lines.push('本次没有恢复归档，请核对以上状态。');else missing=true;}
      if(!lines.length)return [uncertain];if(missing)lines.push(partial);return lines;
    }
    const lists={memories:'本页没有精选记忆。',search:'没有找到匹配的精选记忆。',archive:'本页没有可查看的归档原话。',history:'在本次查找范围内没有找到匹配的原话。',current:'没有找到能确定当前偏好的记录。',semantic:'没有找到可核验的候选原话。'};
    if(Object.hasOwn(lists,op)){
      if(!Array.isArray(d.items))return [uncertain];
      const lines=[];const history={partial_search:'只查了所选会话的一部分。需要更早的内容，请打开原会话核对。',ambiguous:'有多条可能的原话，请结合来源核对。',unavailable:'暂时无法核验历史原话。',clarify:'请说明要查找的事情，并换用更具体的检索词。',not_requested:'未执行这次历史查找。'};
      const special=op==='history'&&(d.truncated===true?history.partial_search:lookup(history,d.status));
      if(special)lines.push(special);
      else if(d.status&&!(op==='history'&&['found','not_found_in_range'].includes(d.status)||op==='semantic'&&d.status==='no_verified_candidates'))lines.push(uncertain);
      else if(!d.items.length)lines.push(lists[op]);
      if(op==='semantic'&&d.items.length)lines.push('以下只是候选原话，不能据此确定当前偏好。');
      if(count(d.page)&&d.page>0)lines.push('第 '+d.page+' 页');
      if(d.items.length){lines.push('本页 '+d.items.length+' 条');for(const r of d.items){const parts=recordLines(r,op,sourceName);lines.push(h('span',null,...parts.flatMap((part,i)=>i?['\n',part]:[part])));}}return lines;
    }
    if(op==='read'||op==='archiveGet')return recordLines(d,op,sourceName);
    if(op==='import')return d.status==='ok'&&count(d.inserted)?['本次新增 '+d.inserted+' 条归档原文；未写入精选记忆。']:[uncertain];
    if(op==='save'&&identifier(d.id))return [d.created===true?'已收录这条原话。':d.created===false?'这条原话已收录过，本次未重复新增。':'是否为本次新增，尚未确认。','记录编号：'+d.id];
    if(op==='clear'&&d.cleared===true)return ['已清除所选会话的插件资料。',count(d.removedMemories)?'删除了 '+d.removedMemories+' 条精选记忆。':partial,'DSH 自身的聊天记录未删除。'];
    const target=identifier(recordId)?['记录编号：'+recordId]:[];
    if(op==='correct'&&typeof d.updated==='boolean')return [d.updated?'已修改记忆，来源原话未变。':'记忆未修改。',...target];
    if(['forget','forgetExact','archiveForget'].includes(op)&&typeof d.deleted==='boolean')return [d.deleted?'已删除相应的插件记录，DSH 聊天原文仍然保留。':'未删除记录。',...target];
    return [uncertain];
  }
  function DataActions({invoke,catalog}) {
    const [sid,setSid]=React.useState(''),[name,setName]=React.useState(''),[workspace,setWorkspace]=React.useState('');
    const [group,setGroup]=React.useState('工作区归档'), [op,setOp]=React.useState('status'), [form,setForm]=React.useState({});
    const [pending,setPending]=React.useState(null), [out,setOut]=React.useState(null), [err,setErr]=React.useState(''), [busy,setBusy]=React.useState(false);
    const seq=React.useRef(0), lock=React.useRef(false);
    React.useEffect(()=>()=>{++seq.current},[]);
    const reset=()=>{setPending(null);setOut(null);setErr('')};
    const changeOp=value=>{reset();setOp(value);setForm({})};
    const choose=id=>{reset();setSid(id);setForm({})};
    const button=(title,fn,disabled=false)=>h('button',{type:'button',disabled:busy||disabled,onClick:fn},title);
    async function dispatch(req){
      if(lock.current)return; lock.current=true; const run=++seq.current;
      reset();setBusy(true);
      try{
        const data=await invoke(req);
        if(seq.current!==run)return;
        setOut(data);
      }catch(e){if(seq.current===run)setErr(safeMessage(e))}
      finally{if(seq.current===run){lock.current=false;setBusy(false)}}
    }
    const [title,keys=[],warning]=actions[op];
    const args=()=>Object.fromEntries(keys.filter(k=>form[k]!==undefined&&form[k]!=='').map(k=>[k,k==='keywords'?form[k].split(/[,，]/).map(s=>s.trim()).filter(Boolean):['page','offset'].includes(k)?Number(form[k]):form[k]]));
    function begin(){const req={op,sessionId:sid,args:args()};reset();if(warning)setPending(req);else dispatch(req)}
    function pickRecord(id,next){const a=op==='archive'?Object.fromEntries(['from','to','role'].filter(k=>form[k]).map(k=>[k,form[k]])):{};changeOp(next);setForm({...a,id})}
    const recordRows=Array.isArray(out?.items)&&['memories','search','archive','semantic','current'].includes(op)?out.items.filter(x=>typeof x?.id==='string'):[];
    const all=catalog.flatMap(w=>w.items),matches=filtered(catalog,name,workspace).flatMap(w=>w.items);
    const target=matches.find(x=>x.id===sid);
    const sourceName=id=>{const row=all.find(x=>x.id===id);return row?h('span',{title:row.cwd},'来源会话：'+row.label+' · '+row.displayName):'来源会话：不在当前目录'};
    const lines=out===null?[]:receipt(op,out,form.id,sourceName);
    function field(k){const props={'aria-label':labels[k],value:form[k]||'',onChange:e=>{let v=e.target.value;reset();setForm({...form,[k]:v})},style:{display:'block',maxWidth:'100%',width:'30em'}};
      return h('label',{key:k,style:{display:'block',marginBottom:8}},labels[k],
        k==='role'?h('select',props,...[['','全部'],['user','用户'],['assistant','助手']].map(([value,t])=>h('option',{key:value,value},t))):
        k==='text'?h('textarea',{...props,rows:3}):h('input',{...props,type:['from','to'].includes(k)?'date':['page','offset'].includes(k)?'number':'text',min:k==='page'?1:0,placeholder:k==='page'?'1':k==='offset'?'0':undefined}));}
    return h('section',{'aria-label':'单会话数据操作'},
      h('p',null,'先按名称选择会话，再执行一项功能。工作区归档开关影响所选会话所在的整个工作区。'),
      filterFields(name,workspace,v=>{choose('');setName(v)},v=>{choose('');setWorkspace(v)},()=>{choose('');setName('');setWorkspace('')},busy),
      h('p',null,h('label',null,'操作会话 ',h('select',{'aria-label':'操作会话',title:target?.cwd,disabled:busy,value:sid,onChange:e=>choose(e.target.value),style:{maxWidth:'100%'}},
        h('option',{value:''},matches.length?'请选择会话':'没有匹配会话'),...matches.map(s=>h('option',{key:s.key,value:s.id,title:s.cwd},s.label+' · '+s.displayName))))),
      target&&h('p',null,'当前范围：',target.label,' · ',workspaceName(target)),
      target&&h('fieldset',{disabled:busy,style:panelStyle},h('legend',null,'所选范围的操作'),
        h('label',null,'功能 ',h('select',{'aria-label':'功能',value:group,onChange:e=>{const g=e.target.value;setGroup(g);changeOp(groups[g][0])}},...Object.keys(groups).map(g=>h('option',{key:g},g)))), ' ',
        h('label',null,'操作 ',h('select',{'aria-label':'操作',value:op,onChange:e=>changeOp(e.target.value)},...groups[group].map(x=>h('option',{key:x,value:x},actions[x][0])))),
        h('div',{style:{margin:'12px 0'}},...keys.map(field)),button(title,begin,!!pending),
        pending&&h('div',{role:'group','aria-label':'二次确认',style:panelStyle},h('strong',null,'请再次确认：',title),h('p',null,warning),h('p',null,'工作区：',workspaceName(target),'；所选会话：',target.label),pending.args.id&&h('p',null,'记录 ID：',pending.args.id),button('取消',()=>setPending(null)),' ',button('确认执行',()=>dispatch({...pending,confirm:true})))),
      busy&&h('p',{role:'status'},'正在等待宿主回执…'),err&&h('p',{role:'alert'},'未能确认操作：',err),
      out!==null&&h('section',{'aria-label':'宿主回执',style:panelStyle},h('strong',null,'宿主回执'),h('div',{style:outputStyle},...lines.map((line,i)=>h('p',{key:i},line))),...recordRows.map(row=>h('div',{key:row.id,style:{margin:'6px 0',overflowWrap:'anywhere'}},row.id,' ',button('选取并查看',()=>pickRecord(row.id,op==='archive'?'archiveGet':'read')),op!=='archive'&&button('选取并修改',()=>pickRecord(row.id,'correct')),op!=='archive'&&button('选取并删除',()=>pickRecord(row.id,'forget')))),Number.isSafeInteger(out.nextPage)&&button('下一页结果',()=>{const a={...args(),page:out.nextPage};setForm({...form,page:out.nextPage});dispatch({op,sessionId:sid,args:a})}),Number.isSafeInteger(out.nextOffset)&&button('继续读取正文',()=>{const a={...args(),offset:out.nextOffset};setForm({...form,offset:out.nextOffset});dispatch({op,sessionId:sid,args:a})}),button('隐藏回执',()=>setOut(null))));
  }
  const tabTitles={home:'主页',settings:'常规设置',legacy:'导入旧对话',isolation:'会话记忆隔离',main:'查询及其他'};
  const purposes={legacy:'import',isolation:'isolation'};
  const blockedLabels={profile_unverified:'不能核验为当前配置的会话',derived_session:'派生会话不支持此操作',unsupported_session:'这种会话不支持此操作',workspace_unavailable:'工作区不可用',ambiguous_session:'会话身份不唯一'};
  const pageInfo={settings:['配置范围','选择今后要启用的记忆功能。'],legacy:['历史迁移','把所选旧会话的可见原文复制到本地归档。'],isolation:['隐私范围','决定哪些会话需要单独保存和查找记忆。'],main:['资料查阅','先选择会话，再读取、核对或维护其中的记录。']};
  function Home(){return h('article',null,h('header',{className:'stm-hero'},h('span',{className:'stm-kicker'},'使用指南'),h('h3',null,'让记忆回到原话'),h('p',null,'保存值得留下的说法，需要时回到出处核对。')),
    h('h4',null,'主要功能'),h('div',{className:'stm-cards'},...[['01','精选记忆','收录有用的原话、偏好和更正，保留它们来自哪段对话。'],['02','对话归档','按日期和说话人回查已归档的原文；旧会话可由你选择导入。'],['03','会话隔离','让指定会话只使用自己的记忆，避免与同一工作区内的其他对话混用。']].map(([i,t,d])=>h('div',{className:'stm-card',key:i},h('span',{className:'stm-kicker'},i),h('h5',null,t),h('p',null,d)))),
    h('h4',null,'使用方法'),h('ol',{className:'stm-guide'},h('li',null,'在「常规设置」选择需要的功能，保存后重启 DSH。'),h('li',null,'想补录旧内容或单独保护某个会话时，在对应页面勾选会话，核对范围后再确认。'),h('li',null,'在对话中说「记住这句话」，或在「查询及其他」选中会话，查看记忆和归档原文。')))}
  const css=`
  .stm-studio{--line:var(--dsw-alias-border-l2,rgba(128,128,128,.35));--muted:var(--dsw-alias-label-secondary,currentColor);--wash:rgba(128,128,128,.075);color:var(--dsw-alias-label-primary,inherit);width:100%;max-width:860px;min-width:0;line-height:1.55;overflow-wrap:anywhere;container-type:inline-size}
  .stm-studio *{box-sizing:border-box}.stm-studio h2,.stm-studio h3,.stm-studio h4,.stm-studio h5{margin:0;font-weight:650}.stm-studio h2{font-size:19px}.stm-studio h3{font-size:21px;line-height:1.4}.stm-studio h4{font-size:15px;margin:20px 0 9px}.stm-studio h5{font-size:14px;margin:4px 0}.stm-studio p{margin:6px 0 12px}.stm-studio small,.stm-kicker,.stm-hero p,.stm-card p{color:var(--muted)}.stm-kicker{font-size:11px;font-weight:650;letter-spacing:.09em}
  .stm-tabs,.stm-cards{display:grid;gap:5px}.stm-tabs{grid-template-columns:repeat(auto-fit,minmax(min(100%,7.5rem),1fr));border:1px solid var(--line);border-radius:14px;background:var(--wash);padding:5px;margin:12px 0 16px}.stm-studio button,.stm-studio select,.stm-studio input:not([type=checkbox]),.stm-studio textarea{max-width:100%;min-width:0;border:1px solid var(--line);background:var(--dsw-alias-bg-base,transparent);color:inherit;border-radius:8px;font:inherit;padding:5px 9px}.stm-studio button:not(:disabled){cursor:pointer}.stm-studio button:disabled{opacity:.55}.stm-studio button:hover:not(:disabled){border-color:currentColor}.stm-tabs button{border-color:transparent;background:transparent;font-size:13px}.stm-tabs button[aria-selected=true]{font-weight:700;background:var(--dsw-alias-brand-primary,CanvasText);color:var(--dsw-alias-label-primary-foreground,Canvas);border-color:transparent}.stm-studio :focus-visible{outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:2px}
  .stm-hero,.stm-card,.stm-guide,.stm-box{border:1px solid var(--line);border-radius:14px;padding:14px 16px}.stm-hero{background:linear-gradient(115deg,var(--wash),transparent);padding:20px}.stm-hero p,.stm-card p{margin-bottom:0}.stm-cards{grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr));gap:9px}.stm-guide{padding-left:36px}.stm-guide li+li{margin-top:6px}.stm-studio fieldset{min-inline-size:0}.stm-box{margin:10px 0}.stm-setting{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}.stm-setting input{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary,auto)}.stm-setting small{display:block;font-size:12px}.stm-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.stm-studio [role=alert]{color:var(--dsw-alias-state-error-primary,currentColor)}
  @container(max-width:420px){.stm-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.stm-hero,.stm-card,.stm-box{padding:12px}.stm-tabs button{min-height:36px}}`;

  const scopeKey=(w,id)=>JSON.stringify([w,id]);
  const layout={display:'flex',flexWrap:'wrap',alignItems:'center',gap:8};
  const catalogError=()=>new DisplayError('会话清单已变化或不完整，请刷新后再选择。');
  async function fetchCatalog(invoke,alive,purpose){
    async function pages(op,args){
      const rows=[];let page=1;
      for(;;){
        if(!alive())throw catalogError();
        const d=await invoke({op,args:{...args,page,...(purpose?{purpose}:{})}});
        if(d?.page!==page||!Array.isArray(d.items)||d.items.length>20||(args.workspaceId&&args.workspaceId!==d.workspaceId))throw catalogError();
        rows.push(...d.items);if(d.nextPage==null)return rows;
        if(d.nextPage!==page+1||d.nextPage>1000000||!d.items.length)throw catalogError();page=d.nextPage;
      }
    }
    const workspaces=await pages('workspaces',{}),seen=new Set(),ids=new Set(),result=[];
    for(const w of workspaces){
      if(!identifier(w?.workspaceId)||!text(w.cwd)||!text(w.displayName)||!count(w.count)||seen.has(w.workspaceId))throw catalogError();seen.add(w.workspaceId);
      const items=w.count?await pages('workspaceSessions',{workspaceId:w.workspaceId}):[];
      for(const s of items){const key=purpose?scopeKey(w.workspaceId,s?.id):s?.id;
        if(!identifier(s?.id)||ids.has(key)||(purpose&&typeof s.actionable!=='boolean')||((!purpose||s.actionable)&&['sessionIsolated','globalIsolated','isolated'].some(k=>typeof s[k]!=='boolean')))throw catalogError();ids.add(key)}
      if(items.length!==w.count)throw catalogError();
      const counts=new Map(),indices=new Map(),used=new Set();
      const titles=items.map(s=>typeof s.title==='string'&&s.title.trim()&&s.title.trim()!==s.id?s.title.trim():'未命名会话');
      for(const title of titles)counts.set(title,(counts.get(title)||0)+1);
      result.push({...w,items:items.map((s,i)=>{const title=titles[i],index=(indices.get(title)||0)+1;indices.set(title,index);
        let label=counts.get(title)>1?title+'（'+index+'）':title;while(used.has(label))label+='（另一会话）';used.add(label);
        return {...s,cwd:w.cwd,displayName:w.displayName,label,key:scopeKey(w.workspaceId,s.id)};})});
    }
    return result;
  }
  const workspaceName=w=>h('span',{title:w.cwd},w.displayName);
  function filtered(catalog,name,workspace){
    const contains=(s,q)=>s.toLowerCase().includes(q.trim().toLowerCase());
    return catalog.filter(w=>contains(w.displayName,workspace)||contains(w.cwd,workspace)).map(w=>({...w,items:w.items.filter(s=>contains(s.label,name))})).filter(w=>w.items.length||!name.trim());
  }
  function filterFields(name,workspace,setName,setWorkspace,clear,disabled){
    const field=(t,v,set)=>h('label',{style:{minWidth:0}},t,h('input',{'aria-label':t,type:'search',placeholder:t==='筛选工作区'?'名称或路径':undefined,value:v,disabled,onChange:e=>set(e.target.value),style:{display:'block',maxWidth:'100%',width:'13em'}}));
    return h('div',{style:layout},field('筛选工作区',workspace,setWorkspace),field('筛选会话名称',name,setName),(name||workspace)&&h('button',{type:'button',disabled,onClick:clear},'清除筛选'));
  }
  function SessionChooser({catalog,selected,expanded,onExpand,onCheck,disabled,isolation,filtering}){
    const all=catalog.flatMap(w=>w.items),available=all.filter(s=>s.actionable);
    function box(label,rows,caption,title){
      rows=rows.filter(s=>s.actionable);const n=rows.reduce((sum,s)=>sum+Number(selected.has(s.key)),0),mixed=n>0&&n<rows.length;
      return h('label',{title,style:{minWidth:0,overflowWrap:'anywhere'}},h('input',{title,type:'checkbox','aria-label':label,checked:n>0&&n===rows.length,'aria-checked':mixed?'mixed':n>0,
        ref:node=>{if(node)node.indeterminate=mixed},disabled:disabled||!rows.length,onChange:e=>onCheck(rows,e.target.checked)}),' ',caption);
    }
    return h('div',null,box('全选会话',available,filtering?'选择全部匹配会话':'全选会话'),h('span',null,' · 当前列表 '+all.length+' 个，已勾选 '+all.filter(s=>selected.has(s.key)).length+' 个（全部已勾选 '+selected.size+' 个）'),
      !all.length&&h('p',null,filtering?'没有匹配会话。可清除筛选，或刷新目录。':'当前目录没有会话。'),
      ...catalog.map(w=>h('section',{key:w.workspaceId,style:{...panelStyle,minWidth:0}},h('div',{style:layout},
        filtering?h('strong',{title:w.cwd},w.displayName):h('button',{title:w.cwd,type:'button','aria-expanded':expanded.has(w.workspaceId),onClick:()=>onExpand(w.workspaceId),style:{maxWidth:'100%',overflowWrap:'anywhere'}},(expanded.has(w.workspaceId)?'收起 ':'展开 ')+w.displayName),
        box('工作区 '+w.displayName,w.items,(filtering?'选择此工作区内匹配的会话（':'选择此工作区（')+w.items.length+' 个会话）',w.cwd)),
        (expanded.has(w.workspaceId)||filtering)&&h('ul',{style:{paddingInlineStart:'1rem',listStyle:'none'}},...w.items.map(s=>h('li',{key:s.key},box('会话 '+s.label,[s],s.label),!s.actionable&&h('small',null,' · '+(lookup(blockedLabels,s.reason)||'无法核验操作资格')) ,isolation&&s.actionable&&s.globalIsolated&&h('small',null,' · 已受全局隔离保护')))))));
  }
  function Console({invoke,request}){
    const [tab,setTab]=React.useState('home'),[catalog,setCatalog]=React.useState(null),[ready,setReady]=React.useState(false);
    const [base,setBase]=React.useState(new Set()),[iso,setIso]=React.useState(new Set()),[imports,setImports]=React.useState(new Set());
    const [expanded,setExpanded]=React.useState({isolation:new Set(),legacy:new Set()}),[pending,setPending]=React.useState(null);
    const [busy,setBusy]=React.useState(false),[message,setMessage]=React.useState('');
    const [catalogIssue,setCatalogIssue]=React.useState('');
    const lock=React.useRef(false),seq=React.useRef(0);React.useEffect(()=>()=>{++seq.current;lock.current=false},[]);
    const [name,setName]=React.useState(''),[workspace,setWorkspace]=React.useState('');
    const filtering=!!(name.trim()||workspace.trim());
    const clear=()=>{setName('');setWorkspace('');setPending(null);setMessage('')};
    const previous=React.useRef({}), writing=React.useRef(false);
    const isolation=tab==='isolation',selected=isolation?iso:imports,setSelected=isolation?setIso:setImports;
    async function refresh(t=tab){
      if(lock.current)return;lock.current=true;const run=++seq.current;setBusy(true);setPending(null);setMessage('');setCatalogIssue('');setReady(false);
      try{
        const next=await fetchCatalog(invoke,()=>seq.current===run,purposes[t]);if(seq.current!==run)return;
        const nextBase=new Set(),nextIso=new Set(),nextImport=new Set();
        const known=new Set((previous.current[t]||[]).flatMap(w=>w.items.map(s=>s.key)));
        for(const w of next)for(const s of w.items){
          if(!s.actionable)continue;
          if(s.sessionIsolated)nextBase.add(s.key);
          const dirty=known.has(s.key)&&base.has(s.key)!==iso.has(s.key);
          if(dirty?iso.has(s.key):s.sessionIsolated)nextIso.add(s.key);
          if(imports.has(s.key))nextImport.add(s.key);
        }
        if(t==='isolation'){setBase(nextBase);setIso(nextIso)}if(t==='legacy')setImports(nextImport);previous.current[t]=next;setCatalog(next);setReady(true);
      }catch(e){if(seq.current===run)setCatalogIssue(safeMessage(e))}finally{if(seq.current===run){setBusy(false);lock.current=false}}
    }
    function switchTab(t){if(writing.current||t===tab)return;++seq.current;lock.current=false;setReady(false);setCatalog(null);setBusy(false);setCatalogIssue('');setTab(t);clear();if(t==='main'||purposes[t])refresh(t)}
    function check(rows,on){setPending(null);setMessage('');setSelected(prev=>{const next=new Set(prev);for(const s of rows)if(on)next.add(s.key);else next.delete(s.key);return next})}
    function plan(){
      const result=[];for(const w of catalog||[]){const rows=w.items.filter(s=>s.actionable&&(isolation?base.has(s.key)!==iso.has(s.key):imports.has(s.key)));if(rows.length)result.push({...w,items:rows})}return result;
    }
    async function submit(){
      if(filtering||!pending||!ready||lock.current)return;writing.current=true;lock.current=true;const run=++seq.current;setBusy(true);setPending(null);setMessage('');
      const nextBase=new Set(base),remaining=new Set(imports),errors=new Map();let success=0,failed=0,inserted=0;
      function fail(w,why,n){failed+=n;const k=JSON.stringify([w.workspaceId,why]);errors.set(k,{w,why,n:(errors.get(k)?.n||0)+n})}
      try{for(const w of pending){for(const enabled of isolation?[true,false]:[null]){
        const rows=isolation?w.items.filter(s=>iso.has(s.key)===enabled):w.items;
        for(let i=0;i<rows.length;i+=20){if(seq.current!==run)return;const chunk=rows.slice(i,i+20),sessionIds=chunk.map(s=>s.id);
          try{const data=await invoke({op:isolation?'setSessionIsolation':'importSessions',args:{workspaceId:w.workspaceId,sessionIds,...(isolation?{enabled}:{})},confirm:true});
            if(isolation){if(data.updated!==chunk.length||typeof data.globalIsolated!=='boolean')throw new DisplayError(uncertain);
              for(const s of chunk)if(enabled)nextBase.add(s.key);else nextBase.delete(s.key);success+=chunk.length;
            }else{
              if(!Array.isArray(data.items)||data.items.length!==chunk.length||new Set(data.items.map(r=>r?.id)).size!==chunk.length||data.items.some(r=>!sessionIds.includes(r?.id)))throw new DisplayError(uncertain);
              if(!count(data.inserted)||data.items.some(r=>r.status==='ok'&&!count(r.inserted))||data.items.reduce((n,r)=>n+(r.status==='ok'?r.inserted:0),0)!==data.inserted)throw new DisplayError(uncertain);
              for(const s of chunk){const r=data.items.find(x=>x.id===s.id);
                if(r.status==='ok'&&count(r.inserted)){success++;inserted+=r.inserted;remaining.delete(s.key)}else fail(w,lookup(reasons,r.status)||uncertain,1)}
            }
          }catch(e){fail(w,safeMessage(e),chunk.length)}
        }
      }}if(seq.current!==run)return;
        setBase(nextBase);setImports(remaining);setMessage(h('span',null,'成功 '+success+' 个会话'+(isolation?'。':'，本次新增 '+inserted+' 条归档原文。'),failed?'\n'+failed+' 个会话未能确认；已保留待处理项。请先核对状态。':'',...[...errors].map(([key,{w,why,n}])=>h('span',{key,title:w.cwd},'\n'+n+' 个 · '+w.displayName+'：'+why))));
      }finally{if(seq.current===run){writing.current=false;lock.current=false;setBusy(false)}}
    }
    const work=plan(),size=work.reduce((n,w)=>n+w.items.length,0);
    const btn=(t,fn,disabled)=>h('button',{type:'button',onClick:fn,disabled:busy||!!disabled},t);
    const chooser=(isolation||tab==='legacy')&&catalog&&ready&&h(SessionChooser,{catalog:filtered(catalog,name,workspace),selected,expanded:expanded[tab],disabled:busy,isolation,filtering,onCheck:check,onExpand:id=>setExpanded(prev=>{const next=new Set(prev[tab]);if(next.has(id))next.delete(id);else next.add(id);return {...prev,[tab]:next}})});
    const grouped=tab==='isolation'||tab==='legacy';
    return h('section',{'aria-label':'原话记忆',className:'stm-studio'},
      h('style',null,css),h('h2',null,'原话记忆'),h('div',{role:'tablist','aria-label':'原话记忆导航',className:'stm-tabs'},...Object.entries(tabTitles).map(([key,title],i,entries)=>h('button',{key,type:'button',role:'tab',id:'stm-tab-'+key,'aria-controls':'stm-tabpanel','aria-selected':tab===key,tabIndex:tab===key?0:-1,disabled:writing.current,onClick:()=>switchTab(key),onKeyDown:e=>{const n=entries.length,j={ArrowLeft:(i+n-1)%n,ArrowRight:(i+1)%n,Home:0,End:n-1}[e.key];if(j===undefined)return;e.preventDefault();e.currentTarget.parentNode.children[j].focus();switchTab(entries[j][0])}},title))),
      h('div',{role:'tabpanel',id:'stm-tabpanel','aria-labelledby':'stm-tab-'+tab},
        tab==='home'?h(Home):h('section',null,h('header',{className:'stm-hero'},h('span',{className:'stm-kicker'},pageInfo[tab][0]),h('h3',null,tabTitles[tab]),h('p',null,pageInfo[tab][1])),
          tab==='settings'?h(Settings,{request}):h('div',{className:'stm-box'},h('p',null,grouped?'列出宿主登记的全部工作区与会话，包括不能操作的项目；目录不读取聊天正文。':'仅列出当前配置下可核验的会话。选择会话不会自动读取聊天正文。'),btn('刷新会话清单',()=>refresh()),tab==='main'&&ready&&h(DataActions,{invoke,catalog}))),
        grouped&&h('section',null,h('p',null,isolation?'勾选需要单独保存记忆的会话。保存只修改有变化的会话；全局隔离开启时仍优先生效。':'选择要复制可见原文的旧会话。只写入本地归档，不写精选记忆。'),
          filterFields(name,workspace,v=>{setPending(null);setName(v)},v=>{setPending(null);setWorkspace(v)},clear,busy),
          filtering&&h('p',{role:'status'},'仅显示匹配会话；全选及工作区勾选只影响匹配项。请清除筛选并核对全部选择后提交。'),
          h('div',{style:{maxHeight:'min(40vh,22rem)',overflowY:'auto',margin:'8px 0'}},chooser),
          btn(isolation?'保存隔离':'确认导入',()=>{if(!filtering){setMessage('');setPending(work)}},!ready||!size||pending||filtering),
        pending&&h('div',{role:'group','aria-label':'二次确认',style:panelStyle},h('strong',null,'请再次确认：'+(isolation?'保存隔离':'导入旧会话')),
          h('p',null,pending.length+' 个工作区，'+size+' 个会话'),...pending.map(w=>h('p',{key:w.workspaceId,title:w.cwd},w.displayName+' · '+w.items.length+' 个会话'+(isolation?'（开启 '+w.items.filter(s=>iso.has(s.key)).length+'，取消 '+w.items.filter(s=>!iso.has(s.key)).length+'）':''))),
          h('details',null,h('summary',null,'核对所选会话'),h('div',{style:{maxHeight:'12rem',overflowY:'auto'}},...pending.map(w=>h('section',{key:w.workspaceId},h('strong',{title:w.cwd},w.displayName),h('ul',null,...w.items.map(s=>h('li',{key:s.key},s.label,isolation?(iso.has(s.key)?' · 开启隔离':' · 取消隔离'):''))))))),
          h('p',null,isolation?'开启会将该会话可核验的旧记忆移入私域，不能确认的部分封存。取消只影响以后的读写，不会把原有私域记录放回共享范围。':'仅复制所选旧会话中符合条件的原文，不修改 DSH 自身聊天。'),
          h('div',{style:layout},btn('取消',()=>setPending(null)),btn(isolation?'确认保存隔离':'开始导入',submit)))),
        busy&&h('p',{role:'status'},'正在等待宿主回执…'),catalogIssue&&h('p',{role:'alert'},catalogIssue),message&&h('p',{role:'status',style:outputStyle},message)))
  }
  function Settings({ request }) {
    const [saved, setSaved] = React.useState(null), [draft, setDraft] = React.useState(null);
    const [busy, setBusy] = React.useState(true), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
    const seq = React.useRef(0);
    async function sync(save) {
      const run = ++seq.current;
      setBusy(true); setError(''); setNotice('');
      try {
        if (save) await request('save', { expected: saved, values: draft });
        const actual = await request('read');
        if (seq.current !== run) return;
        setSaved(actual); setDraft(actual);
        if (save) {
          if (fields.some(([k]) => actual[k] !== draft[k])) throw new Error('读回配置与提交值不一致；请重新读取');
          setNotice('已保存并读回。请重启此 profile 的 DSH 实例，使修改生效。');
        }
      } catch (e) {
        if (seq.current !== run) return;
        setError((save ? '未能确认保存：' : '未能读取配置：') + (e instanceof DisplayError ? e.message : '未收到有效回执'));
        // Reject stale values, particularly when a write may have succeeded before disconnect.
        setSaved(null); setDraft(null);
      } finally { if (seq.current === run) setBusy(false); }
    }
    React.useEffect(() => { sync(false); return () => { ++seq.current; }; }, [request]);
    const dirty = !!saved && fields.some(([k]) => saved[k] !== draft[k]);
    return h('section',{className:'stm-box'},
      h('p', null, '以下是已保存的配置；更改后须重启此 profile 的 DSH 实例才生效。配置适用于当前 DSH profile 的所有工作区。设置不会覆盖单个工作区的关闭决定。'),
      saved && !saved.writable && h('p', {role:'status'}, '此宿主没有可写的配置文档。只能查看，不能保存。'),
      h('fieldset', { disabled: busy || !saved?.writable, style: { border: 0, padding: 0, margin: 0 } },
        h('legend', null, '插件开关'),
        ...(saved ? fields.map(([key, title, help]) => h('label', { key,className:'stm-setting' },h('span',null,h('strong',null,title),h('small',null,help,' 宿主配置：',saved[key]?'开':'关')),
          h('input', { type:'checkbox','aria-label':title,checked:draft[key],onChange:e=>{const checked=e.target.checked;setDraft(d=>({...d,[key]:checked}));setNotice('')} })))
          : [])),
      h('div',{className:'stm-toolbar'},h('button', { type: 'button', disabled: busy || !saved?.writable || !dirty, onClick: () => sync(true) }, '保存更改'), ' ',
      h('button', { type: 'button', disabled: busy, onClick: () => sync(false) }, dirty ? '放弃更改并重新读取' : '重新读取')),
      h('p', { role: 'status' }, busy ? '正在与宿主同步…' : notice || (dirty ? '有尚未保存的更改。' : '')),
      error && h('p', { role: 'alert' }, error, '。请重新读取后再试。'));
  }
  return { inject: ['slots', 'connection', 'remote', 'remote.settings'], apply(ctx) {
    const slots = ctx.get('slots');
    const ns = 'dsh-standalone-memory';
    function unwrap(reply) {
      if (reply?.ok !== true) throw new DisplayError('未收到有效回执');
      return reply.value;
    }
    const request = async (op, payload = {}) => {
      const connection = ctx.get('connection');
      if (!connection.isLoopback) throw new Error('仅允许从本机 DSH 读取或更改配置');
      const api = ctx.remote.settings;
      if (op === 'save') {
        const patch = Object.fromEntries(fields.filter(([key]) => payload.values[key] !== payload.expected[key]).map(([key]) => [key, payload.values[key]]));
        const ops = Object.entries(patch).map(([key, value]) => ({op:'set', path:[key], value}));
        return unwrap(await api.mutate(ns, ops, payload.expected.revision));
      }
      const descriptor = unwrap(await api.describe());
      const section = descriptor.namespaces.find(s => s.ns === ns);
      if (!section) throw new Error('宿主未注册原话记忆配置');
      if (!Number.isSafeInteger(section.revision)) throw new Error('缺少配置版本，不能安全保存');
      return { ...valid(section.value), revision: section.revision, writable: descriptor.writable === true && descriptor.hasDocument === true };
    };
    async function invoke(req){
      if(!ctx.get('connection').isLoopback) throw new Error('仅允许在本机 DSH 控制台操作');
      const method='dispatch', rpcId=crypto.randomUUID();
      const response=await fetch('/standalone-memory-console/dispatch',{method:'POST',mode:'same-origin',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload:req})});
      if(!response.ok)throw new DisplayError('请求未得到有效回应。请检查本机连接，再核对当前状态。');
      const envelope=await response.json();
      if(envelope.type!=='server-response'||envelope.rpcId!==rpcId)throw new Error('宿主回执与请求不符');
      const reply=unwrap(envelope.result);
      if(reply?.ok!==true || reply.data==null){
        const code=typeof reply?.error==='string'?reply.error:'';
        throw new DisplayError(lookup(reasons,code)||uncertain);
      }
      return reply.data;
    }
    slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: 'standalone-memory', label: '原话记忆', order: 35 }, () => h(Console, { request, invoke })));
  } };
} });
