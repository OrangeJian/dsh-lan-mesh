import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkWorkbench} from '../ui/network/network-workbench.mjs';
const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)});
const walk=n=>n&&typeof n==='object'?[n,...n.children.flatMap(walk)]:[];
const text=n=>n&&typeof n==='object'?n.children.map(text).join(' '):String(n??'');
const model=count=>({nodes:Array.from({length:count},(_,i)=>({id:'node-'+i,name:i<3?'Same':'Device '+i,local:i===0,ageSeconds:i?2:null,sessions:i===0?2:null,running:i===0?1:null})),peerCount:count-1,stale:false});
function app(value){const state=[];let cursor=0,refresh=0;const React={useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],next=>state[i]=typeof next==='function'?next(state[i]):next];}};return {render(){cursor=0;return NetworkWorkbench({h,React,model:value,onRefresh:()=>refresh++});},refresh:()=>refresh};}
const by=(tree,cls)=>walk(tree).filter(n=>(n.props.className??'').split(' ').includes(cls));
test('small topology draws only observed local spokes and exact same-name identities',()=>{const tree=app(model(3)).render();assert.equal(by(tree,'lm-networkSpoke').length,2);assert.equal(by(tree,'lm-networkNode').length,3);assert.match(text(tree),/不代表传输健康/);assert.match(text(tree),/node-2/);});
test('30 nodes default to complete searchable list and allow topology switch',()=>{const a=app(model(30));let tree=a.render();assert.equal(by(tree,'lm-networkList').length,1);assert.equal(by(tree,'lm-networkNode').length,30);by(tree,'lm-networkSearch')[0].props.onChange({target:{value:'node-29'}});tree=a.render();assert.equal(by(tree,'lm-networkNode').length,1);assert.match(text(tree),/node-29/);});
test('same-name selection shows exact device and remote execution and permissions stay unknown',()=>{const a=app(model(3));let tree=a.render();by(tree,'lm-networkNode')[2].props.onClick();tree=a.render();assert.match(text(by(tree,'lm-networkDetail')[0]),/node-2/);assert.match(text(tree),/远端执行状态未知/);assert.match(text(tree),/派发权限未核对/);assert.equal(by(tree,'lm-networkNode')[2].props['aria-pressed'],true);});
test('stale snapshot never presents live counts or verified execution status',()=>{const value=model(3);value.stale=true;const tree=app(value).render();assert.match(text(tree),/快照已过期/);assert.doesNotMatch(text(tree),/正在运行 1/);assert.match(text(tree),/数量未核对/);});
test('missing data, long names and IDs do not invent local center or endpoint addresses',()=>{const value={nodes:[{id:'x'.repeat(600),name:'长名字'.repeat(100),local:false}],peerCount:null};const tree=app(value).render();assert.equal(by(tree,'lm-networkSpoke').length,0);assert.match(text(tree),/本机身份尚未读取/);assert.match(text(tree),/目录会话未核对/);assert.doesNotMatch(text(tree),/undefined|NaN/);});
test('refresh action remains explicit and list/topology switching preserves selection',()=>{const a=app(model(1));let tree=a.render();by(tree,'lm-networkRefresh')[0].props.onClick();assert.equal(a.refresh(),1);by(tree,'lm-networkModeList')[0].props.onClick();tree=a.render();assert.equal(by(tree,'lm-networkList').length,1);assert.match(text(by(tree,'lm-networkDetail')[0]),/node-0/);});
test('10 nodes retain complete topology while 30-node topology explicitly points to full list',()=>{const small=app(model(10)).render();assert.equal(by(small,'lm-networkNode').length,10);assert.equal(by(small,'lm-networkSpoke').length,9);const a=app(model(30));let tree=a.render();by(tree,'lm-networkModeTopology')[0].props.onClick();tree=a.render();assert.equal(by(tree,'lm-networkNode').length,10);assert.match(text(tree),/查看全部 30 个/);});
test('a late large snapshot defaults to list until user explicitly chooses a mode',()=>{const value=model(1),a=app(value);a.render();value.nodes=model(30).nodes;value.peerCount=29;assert.equal(by(a.render(),'lm-networkList').length,1);});

import {networkWorkspaceView} from '../ui/models/workspace-surfaces.mjs';
test('local running count stays unknown unless every catalogue state is explicitly running or idle',()=>{
 const project=local=>networkWorkspaceView({self:{nodeId:'local'},agents:{local},agentsStatus:'ready'}).nodes[0];
 for(const local of [[{}],[{status:''}],[{status:'running'},{}],[{status:'busy'}]])assert.equal(project(local).running,null);
 assert.equal(project([]).running,0);assert.equal(project([{status:'idle'},{status:'running'}]).running,1);
});
test('topology exposes narrow-container arrangement notice without relying on window geometry',()=>{const tree=app(model(10)).render();assert.equal(by(tree,'lm-networkCompactNotice').length,1);assert.match(text(by(tree,'lm-networkCompactNotice')[0]),/小窗.*节点排列/);assert.equal(by(tree,'lm-networkNode').length,10);});

// A10 state evidence. The discovery protocol has no authoritative offline signal:
// a peer carries only lastSeen-derived ageSeconds, and `stale` means a snapshot
// read failed so the previous data is retained. These pin the honest wording so
// missing/stale/aged data can never be presented as a definite offline device.
test('an old observation stays an observation and never becomes an offline verdict',()=>{
 const value=model(3);value.nodes[1].ageSeconds=86400;value.nodes[2].ageSeconds=604800;
 const tree=app(value).render();
 assert.match(text(tree),/约 86400 秒前观测/);
 assert.match(text(tree),/约 604800 秒前观测/);
 assert.match(text(tree),/发现节点 2/);
 assert.doesNotMatch(text(tree),/离线|offline/i);
});
test('a stale snapshot with aged peers explains 未核对 without claiming offline',()=>{
 const value=model(3);value.stale=true;value.nodes.forEach(n=>{n.ageSeconds=86400;});
 const tree=app(value).render();
 assert.match(text(tree),/快照已过期/);
 assert.match(text(tree),/当前可见性未核对/);
 assert.match(text(tree),/数量未核对/);
 assert.doesNotMatch(text(tree),/正在运行 1/);
 assert.doesNotMatch(text(tree),/离线|offline/i);
});
test('a missing observation time reads 未知, not offline or a zero-age reading',()=>{
 const value=model(3);value.nodes[1].ageSeconds=null;value.nodes[2].ageSeconds=undefined;
 const tree=app(value).render();
 assert.match(text(tree),/最近观测时间未知/);
 assert.doesNotMatch(text(tree),/约 0 秒前观测/);
 assert.doesNotMatch(text(tree),/离线|offline/i);
});
test('a partial catalogue leaves remote sessions and execution 未核对, not offline',()=>{
 const value=model(3);value.nodes.forEach(n=>{if(!n.local){n.sessions=null;n.running=null;}});
 const a=app(value);let tree=a.render();
 by(tree,'lm-networkNode')[1].props.onClick();tree=a.render();
 const detail=text(by(tree,'lm-networkDetail')[0]);
 assert.match(detail,/目录会话未核对/);
 assert.match(detail,/远端执行状态未知/);
 assert.doesNotMatch(text(tree),/离线|offline/i);
});
test('a missing peer count reads 未核对 rather than an offline or zero conclusion',()=>{
 const value=model(3);delete value.peerCount;
 const tree=app(value).render();
 assert.match(text(tree),/发现节点 未核对/);
 assert.doesNotMatch(text(tree),/离线|offline/i);
});
