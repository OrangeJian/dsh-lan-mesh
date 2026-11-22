import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMessage, projectMessageText } from '../lib/project-discussion.mjs';
import { roomMessageText } from '../lib/service.mjs';

const id = '13579000-0000-4000-8000-000000000001';
test('ordinary chat, real tasks and topic replies remain distinguishable after persistence', () => {
  assert.equal(projectMessage('普通消息').kind,'chat');
  for (const kind of ['task','discussion','reply']) {
    const text = '第一行\n第二行';
    const stored = JSON.parse(JSON.stringify(projectMessageText(kind,id,text)));
    assert.deepEqual(projectMessage(stored),{kind,id,text});
  }
  assert.throws(()=>projectMessageText('reply','bad','text'));
});

test('agent wake-up directs replies to this topic within its parent project', () => {
  const room = {id:'room-a',name:'项目'};
  for (const kind of ['discussion','reply']) {
    const prompt=roomMessageText(room,'Owner',projectMessageText(kind,id,'请讨论交付时间'),'human');
    assert.ok(prompt.includes('room-a#discussion/'+id));
    assert.ok(prompt.includes('请讨论交付时间'));
    assert.ok(!prompt.includes('[LAN'));
  }
});
