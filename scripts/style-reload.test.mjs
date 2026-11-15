import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../client.js',import.meta.url),'utf8');
const styleId='dsh-lan-mesh-styles';
function fixture({old,dom=true}={}) {
 let loaded;const nodes=new Map(),appended=[];
 if(old!==undefined)nodes.set(styleId,{id:styleId,tagName:'STYLE',textContent:old,dataset:{}});
 const document={documentElement:{lang:'zh',dataset:{}},getElementById:id=>nodes.get(id)??null,createElement:tag=>({tagName:tag.toUpperCase(),textContent:'',dataset:{}}),head:{appendChild(node){nodes.set(node.id,node);appended.push(node);}}};
 const window={__ModuleLoader__:{load:d=>loaded=d}};
 const context={window,console,...(dom?{document}:{})};
 vm.runInNewContext(source.replace('    function installStyles() {','    window.__styleTest={install:installStyles,css:CSS,version:PLUGIN_VERSION};\n    function installStyles() {'),context);
 loaded.factory(name=>{if(name==='react')return {createElement(){}};throw Error('Optional module absent');});
 return {api:window.__styleTest,nodes,appended};
}
test('hot reload replaces obsolete plugin CSS in place and stamps current version',()=>{const f=fixture({old:'.lm-brand{display:flex;flex-direction:row}'}),existing=f.nodes.get(styleId);f.api.install();assert.equal(existing.textContent,f.api.css);assert.equal(f.nodes.get(styleId),existing);assert.equal(f.appended.length,0);assert.equal(existing.dataset.lanMeshVersion,f.api.version);});
test('first install creates one stylesheet and repeated installs do not duplicate it',()=>{const f=fixture();f.api.install();f.api.install();assert.equal(f.appended.length,1);assert.equal(f.nodes.get(styleId).textContent,f.api.css);assert.equal(f.nodes.get(styleId).dataset.lanMeshVersion,f.api.version);});
test('stylesheet installation is optional when no DOM exists',()=>{const f=fixture({dom:false});assert.doesNotThrow(()=>f.api.install());});
