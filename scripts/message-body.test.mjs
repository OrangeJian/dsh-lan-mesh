import test from 'node:test';
import assert from 'node:assert/strict';
import { messageBodyView, copyMessageSource } from '../ui/models/message-body.mjs';
test('body view retains exact source and does not collapse short text or attachment-only messages',()=>{
 for(const text of ['', 'hello\nworld', 'short **Markdown**']){const view=messageBodyView(text);assert.equal(view.source,text);assert.equal(view.collapsible,false);}
});
test('long text and code use separate preview heights without truncating source or fences',()=>{
 const prose=Array(9).fill('line').join('\n');assert.equal(messageBodyView(prose).collapsible,true);assert.equal(messageBodyView('x'.repeat(901)).collapsible,true);
 const code='```js\n'+Array(13).fill('const x=1;').join('\n')+'\n```';const result=messageBodyView(code);assert.equal(result.collapsible,true);assert.equal(result.previewLines,12);assert.equal(result.source,code);
 assert.equal(messageBodyView('```js\nconst x=1;\n```').collapsible,false);
});
test('copy sends exact original text with bound clipboard receiver',async()=>{
 const source='Hello\n\n```js\nconst x=1;\n```';const calls=[];const clipboard={writeText(text){assert.equal(this,clipboard);calls.push(text);return Promise.resolve();}};
 assert.equal((await copyMessageSource(source,clipboard)).status,'copied');assert.deepEqual(calls,[source]);
});
test('clipboard failure or missing permission never reports success and may retry',async()=>{
 assert.equal((await copyMessageSource('a',undefined)).status,'unavailable');assert.equal((await copyMessageSource('a',{writeText:async()=>{throw Error('denied');}})).status,'failed');
 assert.equal((await copyMessageSource('a',{writeText:async()=>{}})).status,'copied');
});
