/** Pure surface components. Data access and navigation stay with the existing controller. */
export function WorkspaceReadState({h,model,onRetry,labels={}}) {
 const copy={loading:'正在读取协作工作台…',failed:'暂时无法读取本机协作数据',stale:'连接或读取失败，当前显示上次成功读取的数据',hint:'这不表示消息或项目已被清空。请检查本机服务或重试。',retry:'重试',...labels};
 if(model.kind==='ready')return null;
 if(model.kind==='loading')return h('section',{className:'lm-shellReadState',role:'status'},h('h2',null,copy.loading),h('div',{className:'lm-shellSkeleton','aria-hidden':true}),h('div',{className:'lm-shellSkeleton','aria-hidden':true}));
 return h('section',{className:model.kind==='stale'?'lm-shellStale':'lm-shellReadState',role:'alert'},h('strong',null,model.kind==='stale'?copy.stale:copy.failed),model.kind==='failed'?h('p',null,copy.hint):null,model.error?h('p',{className:'lm-shellErrorText'},model.error):null,model.observedAt?h('p',{className:'lm-muted'},model.observedAt):null,h('button',{className:'lm-btn lm-shellRetry',type:'button',onClick:onRetry},copy.retry));
}
export function NetworkWorkspace({h,model,onRefresh,labels={}}) {
 const copy={title:'网络总览',refresh:'刷新',intro:'当前展示本机和最近发现的设备，不推断其他设备之间的连接。',local:'本机',peer:'发现记录',unknown:'未核对',sessions:'目录会话',running:'本机执行中',identity:'节点身份',empty:'尚未发现其他设备。请确认另一端 DSH 和插件均已启动。',time:'秒前观测',stale:'历史快照 · 当前状态待核对',permissions:'设备可见、会话存活与允许派发是不同状态；派发仍按现有权限核对。',...labels};
 return h('section',{className:'lm-workspacePage lm-networkWorkspace'},h('header',{className:'lm-workspacePageHead'},h('div',null,h('h1',null,copy.title),h('p',null,copy.intro)),h('button',{type:'button',className:'lm-btn',onClick:onRefresh},copy.refresh)),model.stale?h('p',{className:'lm-workspaceHint'},copy.stale):null,
 h('div',{className:'lm-deviceList'},model.nodes.map(node=>h('article',{className:'lm-deviceRow',key:node.id},h('div',{className:'lm-deviceIdentity'},h('strong',null,node.name),h('span',{className:'lm-badge'},node.local?copy.local:copy.peer),h('p',{className:'lm-deviceId'},`${copy.identity} · ${node.id}`)),h('dl',{className:'lm-deviceFacts'},h('dt',null,copy.sessions),h('dd',null,model.stale||node.sessions===null?copy.unknown:String(node.sessions)),h('dt',null,node.local?copy.running:copy.peer),h('dd',null,model.stale?copy.unknown:node.local?(node.running===null?copy.unknown:String(node.running)):(node.ageSeconds===null?copy.unknown:`${node.ageSeconds} ${copy.time}`)))))),model.peerCount===0?h('p',{className:'lm-workspaceHint'},copy.empty):null,h('p',{className:'lm-workspaceHint'},copy.permissions));
}
export function ManagementWorkspace({h,self,uiVersion,hostVersion,onOpenAgents,labels={}}) {
 const copy={title:'管理与诊断',intro:'本机身份与已公开的配置状态。',node:'节点身份',name:'本机名称',ui:'界面版本',host:'服务端版本',secret:'群组密钥',autoWake:'自动唤醒',configured:'已配置',notConfigured:'未配置',enabled:'已开启',disabled:'已关闭',unknown:'未知',agents:'会话管理',diagnostics:'诊断说明',diagnosticHint:'只读诊断报告需在本机生成。此页面不会执行系统命令；未检查的连接、授权和传输状态均不视为正常。',nickname:'本机显示名可在侧栏底部点击修改。',...labels};
 const flag=value=>value===true?copy.enabled:value===false?copy.disabled:copy.unknown;
 return h('section',{className:'lm-workspacePage lm-managementWorkspace'},h('header',{className:'lm-workspacePageHead'},h('div',null,h('h1',null,copy.title),h('p',null,copy.intro))),h('dl',{className:'lm-managementFacts'},...[[copy.name,self?.selfName||self?.name||copy.unknown],[copy.node,self?.nodeId||copy.unknown],[copy.ui,uiVersion||copy.unknown],[copy.host,hostVersion||copy.unknown],[copy.secret,self?.secured===true?copy.configured:self?.secured===false?copy.notConfigured:copy.unknown],[copy.autoWake,flag(self?.autoWake)]].flatMap(([label,value])=>[h('dt',{key:label+'-label'},label),h('dd',{key:label},value)])),h('p',{className:'lm-workspaceHint'},copy.nickname),h('button',{type:'button',className:'lm-btn lm-managementAgents',onClick:onOpenAgents},copy.agents),h('details',{className:'lm-diagnosticHelp'},h('summary',null,copy.diagnostics),h('p',null,copy.diagnosticHint)));
}

export function AgentRegistryPane({h,React,call,self,localAgents=[]}) {
  const [rows,setRows]=React.useState(null);
  const [name,setName]=React.useState('');
  const [selected,setSelected]=React.useState('');
  const [session,setSession]=React.useState('');
  const [message,setMessage]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  const running=React.useRef(false);
  const retry=React.useRef(null);
  const current=rows?.find(row=>row.agentId===selected);
  const bound=new Set((rows??[]).flatMap(row=>row.bindings.map(binding=>binding.sessionId)));
  async function refresh(){
    const result=await call('agentRegistry',{});
    if(!Array.isArray(result?.agents))throw new Error('无法读取 Agent 身份');
    setRows(result.agents);
  }
  async function run(action){
    if(running.current)return;
    running.current=true;
    setBusy(true);
    setMessage('');
    try{await action();}
    catch(error){setMessage(error?.code==='CONFLICT'||error?.message==='CONFLICT'?'记录已变更，请刷新后核对再试。':String(error?.message??error));}
    finally{running.current=false;setBusy(false);}
  }
  React.useEffect(()=>{void run(refresh);},[call]);
  function submit(command){
    void run(async()=>{
      const key=JSON.stringify(command);
      if(retry.current?.key!==key)retry.current={key,requestId:crypto.randomUUID()};
      await call('agentRegistryCommand',{command,requestId:retry.current.requestId});
      retry.current=null;
      setName('');
      setSession('');
      await refresh();
      setMessage('已保存');
    });
  }
  const button=(label,onClick,disabled=false)=>h('button',{type:'button',className:'lm-btn',onClick,disabled:busy||disabled},label);
  const nameInput=h('input',{value:name,maxLength:120,disabled:busy,'aria-label':'Agent 名称',placeholder:'Agent 名称',onChange:event=>setName(event.target.value)});
  return h('section',{className:'lm-workspacePage','aria-label':'本机 Agent 身份'},
    h('header',{className:'lm-workspacePageHead'},h('h2',null,'本机 Agent 身份'),button('刷新',()=>void run(refresh))),
    h('p',{className:'lm-muted'},self?.selfName||self?.name||self?.nodeId||'本机'),
    h('p',{role:'status'},message|| (busy?'处理中…':'')),
    rows===null?null:h('div',null,
      h('select',{value:selected,disabled:busy,'aria-label':'选择 Agent',onChange:event=>{setSelected(event.target.value);setName('');setSession('');}},
        h('option',{value:''},'新建 Agent'),...rows.map(row=>h('option',{key:row.agentId,value:row.agentId},row.name+' · '+row.agentId))),
      nameInput,
      current?button('重命名',()=>submit({type:'rename',agentId:current.agentId,expectedRevision:current.revision,name:name.trim()}),!name.trim()):
        button('创建',()=>submit({type:'define',agentId:retry.current?.createName===name.trim()?retry.current.agentId:prepareAgentId(name.trim()),name:name.trim()}),!name.trim()),
      current?h('div',null,
        h('p',{className:'lm-muted'},current.authorityNodeId+' · 版本 '+current.revision),
        h('select',{value:session,disabled:busy,'aria-label':'选择本机会话',onChange:event=>setSession(event.target.value)},
          h('option',{value:''},'选择本机会话'),...localAgents.filter(row=>row.cwd&&!bound.has(row.id)).map(row=>h('option',{key:row.id,value:row.id},(row.name||row.id)+' · '+row.id))),
        button('绑定会话',()=>submit({type:'bind',agentId:current.agentId,expectedRevision:current.revision,sessionId:session}),!session),
        h('ul',null,...current.bindings.map(binding=>h('li',{key:binding.sessionId},binding.sessionId,' ',button('解除绑定',()=>submit({type:'unbind',agentId:current.agentId,expectedRevision:current.revision,sessionId:binding.sessionId})))))):null));
  function prepareAgentId(createName){
    const agentId='agent-'+crypto.randomUUID();
    const key=JSON.stringify({type:'define',agentId,name:createName});
    retry.current={key,requestId:crypto.randomUUID(),agentId,createName};
    return agentId;
  }
}

export function OwnerTeamOverview({h,React,call,roomId,selectedResults=[],onSelectResult}) {
  const [attempt,setAttempt]=React.useState(0);
  const [result,setResult]=React.useState(null);
  React.useEffect(()=>{
    let current=true;
    setResult(null);
    Promise.resolve().then(()=>call('teamOverview',{roomId})).then(
      value=>{if(current)setResult({value});},
      error=>{if(current)setResult({error:error?.code==='FORBIDDEN'?'当前无权查看 Team 概览。':'暂时无法读取 Team 概览。'});},
    );
    return ()=>{current=false;};
  },[call,roomId,attempt]);

  const states={absent:'本机暂无 Team 记录',active:'活动中',paused:'已暂停',archived:'已归档'};
  const labels={planned:'已计划',ready:'就绪',active:'进行中',review:'待审查',accepted:'已验收',blocked:'受阻',failed:'失败',cancelled:'已取消',queued:'排队中',acknowledged:'已确认',running:'运行中',uncertain:'待人工核对',succeeded:'已提交结果'};
  const value=result?.value;
  let summary='正在读取 Team 概览…';
  if(result?.error)summary=result.error;
  else if(result&&!value?.known)summary=value?.reason==='TEAM_DISABLED'?'本机未启用 Team 执行。':'本机 Team 状态暂不可用。';
  else if(value?.known)summary=states[value.status]??'未知状态';
  const counts=(title,items)=>h('div',null,h('strong',null,title),h('ul',null,...Object.entries(items).map(([state,count])=>h('li',{key:state},(labels[state]??state)+' '+count)),Object.keys(items).length?null:h('li',null,'暂无记录')));
  return h('section',{className:'lm-task lm-ownerTeamOverview','aria-label':'Team 概览'},
    h('div',{className:'lm-workspacePageHead'},h('h3',null,'Team 概览 · 本机'),h('button',{type:'button',className:'lm-btn',disabled:result===null,onClick:()=>{setResult(null);setAttempt(value=>value+1);}},'刷新概览')),
    h('p',{role:'status'},summary),
    onSelectResult&&value?.known?value.resultRefs?.map(ref=>{
      const selected=selectedResults.some(row=>row.executionId===ref.executionId&&row.resultHash===ref.resultHash);
      return h('div',{key:ref.executionId},
        h('span',null,ref.executionId+' · '+(labels[ref.reviewStatus]??ref.reviewStatus)+' · '+ref.resultHash.slice(0,12)+' '),
        h('button',{type:'button',className:'lm-btn lm-selectTaskResult','aria-pressed':selected,disabled:!selected&&selectedResults.length>=8,onClick:()=>onSelectResult(ref)},selected?'取消引用':'引用成果'));
    }):null,
    value?.known&&value.status!=='absent'&&value.taskCounts&&value.executionCounts?h('div',null,counts('任务状态',value.taskCounts),counts('执行状态',value.executionCounts)):null,
    value?.known&&value.status!=='absent'&&value.status!=='archived'&&Number.isSafeInteger(value.generation)?h(OwnerPlanPanel,{key:roomId,h,React,call,roomId,model:ownerPlanPanelModel,newRequestId:rpcId}):null,
    value?.known&&value.status!=='absent'&&value.status!=='archived'&&Number.isSafeInteger(value.generation)?h(OwnerResultPanel,{key:'result:'+roomId,h,React,call,roomId,model:ownerResultPanelModel,newRequestId:rpcId}):null);
}
