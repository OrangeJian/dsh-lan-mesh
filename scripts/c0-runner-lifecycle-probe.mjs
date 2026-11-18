import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
let resolve=createRequire(new URL('../package.json',import.meta.url));
try {resolve.resolve('@deepseek-ai/dsh/package.json');} catch {
 const root=execFileSync(process.platform==='win32'?(process.env.ComSpec||'cmd.exe'):'npm',process.platform==='win32'?['/d','/s','/c','npm root -g']:['root','-g'],{encoding:'utf8',timeout:10000,windowsHide:true}).trim();
 resolve=createRequire(join(root,'__c0__.cjs'));
}
const fromHost=createRequire(resolve.resolve('@deepseek-ai/dsh/package.json'));
const {Context}=await import(pathToFileURL(fromHost.resolve('@deepseek-ai/cordis')).href);
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const load=name=>import(pathToFileURL(fromHost.resolve('@deepseek-ai/'+name)).href);
const [stage,root]=process.argv.slice(2);
const sessionId='session-runner-probe';
async function verifyCancellation(agent){
  const stop=Promise.withResolvers();
  const entered=Promise.withResolvers();
  const task=agent.runMaintenance(async signal=>{
    entered.resolve(signal);
    await stop.promise;
    signal.throwIfAborted();
  });
  const outcome=task.then(()=>({ok:true}),error=>({ok:false,error}));
  const signal=await entered.promise;
  try{
    let idle=false;
    const quiescence=agent.whenIdle().then(()=>{idle=true;});
    agent.cancel({kind:'user'});
    assert.equal(signal.aborted,true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(idle,false,'cancellation is not proof of quiescence');
    stop.resolve();
    const result=await outcome;
    assert.equal(result.ok,false);
    assert.equal(result.error,signal.reason);
    await quiescence;
    assert.equal(agent.status,'idle');
  }finally{
    stop.resolve();
    await outcome;
  }
}
if(stage==='create'||stage==='resume'){
  const ctx=new Context();
  for(const [pkg,service] of [
    ['dsh-session','SessionStore'],['dsh-agent','AgentRegistry'],['dsh-llm','LlmRuntime'],
    ['dsh-tools','ToolsService'],['dsh-system-prompt','SystemPrompt'],
    ['dsh-session-projection','SessionProjectionRegistry'],['dsh-agent-loop','AgentLoop'],
  ]){
    ctx.plugin((await load(pkg))[service],{});
  }
  await (await load('dsh-session-persistence-jsonl')).apply(ctx,{root:join(root,'storage')});
  const cwd=join(root,'workspace');
  if(stage==='create'){
    const empty=await ctx.agents.create({sessionId:'session-empty-probe',meta:{cwd}});
    await empty.dispose();
  }else{
    await assert.rejects(ctx.agents.resume({resumeSessionId:'session-empty-probe'}),{name:'SessionPersistenceNotFoundError'});
  }
  const handle=stage==='create'
    ?await ctx.agents.create({sessionId,meta:{cwd}})
    :await ctx.agents.resume({resumeSessionId:sessionId});
  try{
    assert.equal(handle.agent.id,sessionId);
    assert.equal(handle.agent.status,'idle');
    assert.equal(ctx.agents.get(sessionId),handle.agent);
    await handle.agent.whenIdle();
    if(stage==='create'){
      await verifyCancellation(handle.agent);
      handle.agent.session.append('session/title',{title:'Probe',messageSeqs:[],source:{kind:'user'}});
      assert.equal(await ctx.sessions.flush(handle.agent.session),true);
    }
    const stored=(await ctx.sessionPersistence.list()).find(row=>row.header.id===sessionId);
    assert.equal(stored?.header.cwd,cwd);
  }finally{
    await handle.dispose();
  }
  assert.equal(ctx.agents.get(sessionId),undefined);
}else{
  const directory=await mkdtemp(join(tmpdir(),'dsh-runner-lifecycle-'));
  try{
    await mkdir(join(directory,'workspace'));
    for(const phase of ['create','resume']){
      execFileSync(process.execPath,[fileURLToPath(import.meta.url),phase,directory],{timeout:15000,windowsHide:true});
    }
    console.log(JSON.stringify({status:'PASS',scope:'installed DSH services in two isolated processes',cases:['create and release','flush and resume with same cwd','empty session cannot resume','maintenance cancellation and separate quiescence'],notRun:['model turn cancellation','external process cancellation','crash during wake','worktree isolation','multi-host']},null,2));
  }finally{
    await rm(directory,{recursive:true,force:true});
  }
}
