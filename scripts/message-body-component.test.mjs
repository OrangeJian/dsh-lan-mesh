import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageBody } from '../ui/room/message-body.mjs';
import { messageBodyView, copyMessageSource } from '../ui/models/message-body.mjs';
const h=(type,props,...children)=>({type,props:props??{},children:children.flat()});
function harness(text,clipboard){let states=[],cursor=0,effects=[];const React={useState(initial){const at=cursor++;if(!(at in states))states[at]=initial;return [states[at],value=>states[at]=typeof value==='function'?value(states[at]):value];},useEffect(fn){effects.push(fn);},useRef(value){const at=cursor++;if(!(at in states))states[at]={current:value};return states[at];}};const render=()=>{cursor=0;effects=[];const tree=MessageBody({h,React,text,viewOf:messageBodyView,copySource:copyMessageSource,clipboard});effects.forEach(fn=>fn());return tree;};return {render};}
const nodes=tree=>!tree||typeof tree!=='object'?[]:[tree,...(tree.children??[]).flatMap(nodes)];
test('long message toggles full source without truncation and exposes expanded state',()=>{
 const text=Array(20).fill('original line').join('\n');const app=harness(text);let tree=app.render();let list=nodes(tree);
 assert.ok(list.some(n=>n.props.className?.includes('lm-messageTextCollapsed')));const toggle=list.find(n=>n.props.className==='lm-messageExpand');assert.equal(toggle.props['aria-expanded'],false);toggle.props.onClick();
 list=nodes(app.render());assert.equal(list.find(n=>n.props.className==='lm-messageExpand').props['aria-expanded'],true);assert.ok(list.some(n=>n.children?.includes(text)));assert.ok(!list.some(n=>n.props.className?.includes('lm-messageTextCollapsed')));
});
test('copy failure keeps full source and retry reports actual success',async()=>{
 let fail=true,copied;const source='a\nb';const app=harness(source,{async writeText(text){if(fail)throw Error('denied');copied=text;}});
 let button=nodes(app.render()).find(n=>n.props.className==='lm-messageCopy');await button.props.onClick();assert.ok(nodes(app.render()).some(n=>n.children?.includes('复制失败，请重试')));
 fail=false;button=nodes(app.render()).find(n=>n.props.className==='lm-messageCopy');await button.props.onClick();assert.equal(copied,source);assert.ok(nodes(app.render()).some(n=>n.children?.includes('已复制全文')));
});
test('empty attachment message has no text actions and unavailable clipboard gives useful feedback',async()=>{
 assert.equal(harness('').render(),null);const app=harness('text');await nodes(app.render()).find(n=>n.props.className==='lm-messageCopy').props.onClick();assert.ok(nodes(app.render()).some(n=>n.children?.includes('当前环境不支持复制，请手动选择正文')));
});

test('collapsed rich preview is inert with a readable summary so hidden links cannot take keyboard focus',()=>{
 const app=harness(Array(20).fill('[link](https://example.com)').join('\n'));const list=nodes(app.render());
 const preview=list.find(n=>n.props.className?.includes('lm-messageTextCollapsed'));assert.equal(typeof preview.props.ref,'function');const element={inert:false};preview.props.ref(element);assert.equal(element.inert,true);
 assert.ok(list.some(n=>n.props.className==='lm-messageSummary'&&n.children.some(text=>String(text).includes('展开全文'))));
});
