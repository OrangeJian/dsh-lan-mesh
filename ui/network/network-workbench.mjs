/** Read-only projections of observed node records; never conveys dispatch authority. */
export function NetworkWorkbench(props) {
 const {h,React}=props,model=props.model??{},stale=model.stale===true;
 const source=Array.isArray(model.nodes)?model.nodes:[],seen=new Set();
 const nodes=source.filter(n=>n&&typeof n.id==='string'&&n.id&&!seen.has(n.id)&&(seen.add(n.id),true));
 const [modeChoice,setMode]=React.useState(null);
 const mode=modeChoice??(nodes.length>10?'list':'topology');
 const [query,setQuery]=React.useState('');
 const [selectedId,setSelectedId]=React.useState(()=>nodes.find(n=>n.local)?.id||nodes[0]?.id||'');
 const clean=value=>typeof value==='string'?value:'';
 const numeric=value=>Number.isFinite(value)&&value>=0?String(Math.trunc(value)):null;
 const matching=nodes.filter(n=>(clean(n.name)+' '+n.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const selected=nodes.find(n=>n.id===selectedId)||nodes.find(n=>n.local)||nodes[0];
 const local=nodes.find(n=>n.local),chart=matching.slice(0,10),remoteChart=chart.filter(n=>!n.local);
 const position=n=>n.local?{x:50,y:50}:(()=>{const i=remoteChart.indexOf(n),angle=-Math.PI/2+2*Math.PI*i/Math.max(1,remoteChart.length);return {x:50+36*Math.cos(angle),y:50+36*Math.sin(angle)};})();
 const sessions=n=>stale?'数量未核对':numeric(n.sessions)===null?'目录会话未核对':'目录会话 '+numeric(n.sessions);
 const age=n=>stale?'当前可见性未核对':n.local?'本机记录':Number.isFinite(n.ageSeconds)&&n.ageSeconds>=0?'约 '+Math.floor(n.ageSeconds)+' 秒前观测':'最近观测时间未知';
 const nodeButton=(n,topology)=>{const p=position(n);return h('button',{type:'button',key:n.id,className:'lm-networkNode'+(selected?.id===n.id?' lm-networkNodeSelected':''),'aria-pressed':selected?.id===n.id,onClick:()=>setSelectedId(n.id),style:topology?{left:p.x+'%',top:p.y+'%'}:undefined},h('strong',null,clean(n.name)||n.id),h('span',{className:'lm-networkNodeId'},n.id),h('span',{className:'lm-networkNodeFact'},n.local?'本机':age(n)),h('span',{className:'lm-networkNodeFact'},sessions(n)));};
 const label=(key,fallback)=>clean(props.labels?.[key])||fallback;
 return h('section',{className:'lm-networkWorkbench','aria-label':'网络总览'},
  h('header',{className:'lm-networkHeader'},h('div',null,h('h1',null,label('title','网络总览')),h('p',null,'节点发现、会话目录和执行状态分别核对。')),h('button',{type:'button',className:'lm-btn lm-networkRefresh',onClick:props.onRefresh},label('refresh','刷新'))),
  stale?h('div',{className:'lm-networkStale',role:'status'},'快照已过期：数量未核对，以下为上次读取的记录。'):null,
  h('div',{className:'lm-networkSummary'},h('span',null,stale?'节点数量未核对':'本机记录 '+(local?'1':'未核对')),h('span',null,stale?'发现数量未核对':'发现节点 '+(numeric(model.peerCount)??'未核对')),h('span',null,'派发权限未核对')),
  h('div',{className:'lm-networkToolbar'},h('input',{type:'search',className:'lm-networkSearch','aria-label':'搜索设备名称或节点ID',placeholder:'搜索设备名称或节点 ID',value:query,onChange:event=>setQuery(event.target.value)}),h('div',{role:'group','aria-label':'网络显示方式'},h('button',{type:'button',className:'lm-networkModeTopology','aria-pressed':mode==='topology',onClick:()=>setMode('topology')},'拓扑'),h('button',{type:'button',className:'lm-networkModeList','aria-pressed':mode==='list',onClick:()=>setMode('list')},'列表'))),
  h('div',{className:'lm-networkLayout'},h('div',{className:'lm-networkPrimary'},
   mode==='list'?h('div',{className:'lm-networkList'},...matching.map(n=>nodeButton(n,false))):h('div',{className:'lm-networkTopology'},
    h('svg',{className:'lm-networkEdges',viewBox:'0 0 100 100',preserveAspectRatio:'none','aria-hidden':'true'},...(local&&chart.some(n=>n.id===local.id)?remoteChart:[]).map(n=>{const p=position(n);return h('line',{key:n.id,className:'lm-networkSpoke',x1:50,y1:50,x2:p.x,y2:p.y});})),...chart.map(n=>nodeButton(n,true))),
   mode==='topology'?h('p',{className:'lm-networkCompactNotice'},'小窗以节点排列显示；节点详情和列表入口保持可用。'):null,
   matching.length===0?h('p',{className:'lm-networkHint'},nodes.length?'没有匹配的设备记录。':'暂无设备记录，请刷新后核对。'):null,
   mode==='topology'&&matching.length>10?h('p',{className:'lm-networkHint'},'拓扑仅展示当前匹配的前10个节点；请切换列表查看全部 '+matching.length+' 个。'):null,
   !local?h('p',{className:'lm-networkHint'},'本机身份尚未读取；不绘制中心连接。'):null,
   h('p',{className:'lm-networkHint'},'连线仅表示本机发现节点的观测关系，不代表传输健康、Peer之间互联或可向Agent派发任务。')),
   selected?h('aside',{className:'lm-networkDetail','aria-label':'所选节点详情'},h('h2',null,clean(selected.name)||selected.id),h('p',{className:'lm-networkDetailId'},selected.id),h('dl',null,h('dt',null,'来源'),h('dd',null,selected.local?'本机':'发现记录'),h('dt',null,'最近观测'),h('dd',null,age(selected)),h('dt',null,'目录会话'),h('dd',null,sessions(selected)),h('dt',null,'执行状态'),h('dd',null,stale?'执行状态未核对':selected.local&&numeric(selected.running)!==null?'正在运行 '+numeric(selected.running):selected.local?'本机执行状态未知':'远端执行状态未知'),h('dt',null,'授权'),h('dd',null,'派发权限未核对')),h('p',{className:'lm-networkHint'},'目录可能不完整；未找到会话不能直接视为零。')):null));
}
