import test from 'node:test';
import assert from 'node:assert/strict';
import { workbenchIdentityView } from '../ui/models/workbench-identity.mjs';
import { WorkbenchReturnButton,WorkbenchHeader } from '../ui/shell/workbench-header.mjs';
const h=(type,props,...children)=>({type,props:props??{},children:children.flat()});
const text=node=>typeof node==='string'?node:(node?.children??[]).map(text).join(' ');
test('return action names the native conversation and invokes only the existing callback',()=>{let exits=0;const row=WorkbenchReturnButton({h,onExit:()=>exits++,label:'返回对话',hint:'回到 DSH 原生对话'});assert.equal(row.type,'button');assert.equal(row.props['aria-label'],'返回对话');assert.match(text(row),/返回对话/);assert.equal(row.props.type,'button');row.props.onClick();assert.equal(exits,1);});
test('identity view keeps runtime versions separate and does not infer connection health',()=>{const model=workbenchIdentityView({nodeId:'node-a',name:'Device',secured:true},'0.4.6','0.4.4');assert.equal(model.versionMismatch,true);assert.equal(model.nodeId,'node-a');assert.equal(model.uiVersion,'0.4.6');assert.equal(model.hostVersion,'0.4.4');assert.equal(model.connectionHealth,'unknown');const missing=workbenchIdentityView(undefined,'0.4.6');assert.equal(missing.hostVersion,null);assert.equal(missing.versionMismatch,false);assert.equal(missing.nodeId,'');});
test('header has an independent return entry and inspectable version details',()=>{const model=workbenchIdentityView({nodeId:'node-a',name:'Device'},'0.4.6','0.4.4');const row=WorkbenchHeader({h,model,title:'LAN Mesh',subtitle:'局域网协作工作台',backLabel:'返回对话',backHint:'回到 DSH 原生对话',onExit:()=>{}});const flatten=n=>[n,...(n.children??[]).filter(x=>x&&typeof x==='object').flatMap(flatten)];const all=flatten(row);assert.equal(all.filter(n=>n.type==='details').length,1);assert.ok(all.some(n=>n.props?.role==='status'));assert.match(text(row),/0\.4\.6/);assert.match(text(row),/0\.4\.4/);assert.match(text(row),/node-a/);});

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('published client embeds the current UI source without runtime relative imports',()=>{assert.match(execFileSync(process.execPath,[fileURLToPath(new URL('./build-client.mjs',import.meta.url)),'--check'],{encoding:'utf8'}),/match source/);});
