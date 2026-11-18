import {prepareRunnerWorkspace,verifyRunnerWorkspace} from '../lib/runner-workspace.mjs';
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
import {mkdtemp,mkdir,rm,readFile,writeFile,realpath} from 'node:fs/promises';
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
  const cwd=await realpath(join(root,'workspace'));
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
      await writeFile(join(cwd,'tracked.txt'),'worker edit\n');
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
    const repo=join(directory,'source');
    const workspace=join(directory,'workspace');
    const hooks=join(directory,'empty-hooks');
    await Promise.all([mkdir(repo),mkdir(hooks)]);
    const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',timeout:15000,windowsHide:true}).trim();
    git(repo,'init','--quiet');
    const tracked=join(repo,'tracked.txt');
    await writeFile(tracked,'baseline\n');
    git(repo,'add','--','tracked.txt');
    git(repo,'-c','user.name=Runner Probe','-c','user.email=runner-probe@example.invalid','-c','commit.gpgsign=false','-c',`core.hooksPath=${hooks}`,'commit','--quiet','-m','baseline');
    const base=git(repo,'rev-parse','HEAD');
    await writeFile(tracked,'source edit\n');
    const binding={repoId:'probe-repo',root:repo};
    const prepare={binding,repoId:binding.repoId,baseCommit:base,resourceRoot:directory};
    await assert.rejects(prepareRunnerWorkspace({...prepare,resourceRoot:repo}),{code:'WORKSPACE_INSIDE_SOURCE'});
    await assert.rejects(prepareRunnerWorkspace({...prepare,baseCommit:'0'.repeat(base.length)}),{code:'BASE_COMMIT_MISMATCH'});
    assert.equal((await prepareRunnerWorkspace(prepare)).workspace,await realpath(workspace));
    await assert.rejects(prepareRunnerWorkspace(prepare),{code:'WORKSPACE_EXISTS'});
    const check={binding,repoId:binding.repoId,baseCommit:base,workspace};
    assert.equal((await verifyRunnerWorkspace(check)).baseCommit,base);
    await assert.rejects(verifyRunnerWorkspace({...check,repoId:'foreign'}),{code:'REPO_MISMATCH'});
    const foreign=join(directory,'foreign');
    await mkdir(foreign);
    git(foreign,'init','--quiet');
    git(foreign,'-c','user.name=Runner Probe','-c','user.email=runner-probe@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath='+hooks,'commit','--quiet','--allow-empty','-m','foreign');
    await assert.rejects(verifyRunnerWorkspace({...check,workspace:foreign}),{code:'REPO_MISMATCH'});
    await assert.rejects(verifyRunnerWorkspace({...check,baseCommit:'0'.repeat(base.length)}),{code:'BASE_COMMIT_MISMATCH'});
    await assert.rejects(verifyRunnerWorkspace({...check,workspace:repo}),{code:'WORKTREE_REQUIRED'});
    assert.equal(git(workspace,'rev-parse','HEAD'),base);
    assert.match(await readFile(join(workspace,'tracked.txt'),'utf8'),/^baseline\r?\n$/);
    for(const phase of ['create','resume']){
      execFileSync(process.execPath,[fileURLToPath(import.meta.url),phase,directory],{timeout:15000,windowsHide:true});
    }
    assert.equal(await readFile(tracked,'utf8'),'source edit\n');
    assert.equal(await readFile(join(workspace,'tracked.txt'),'utf8'),'worker edit\n');
    assert.equal(git(repo,'rev-parse','HEAD'),base);
    assert.equal(git(workspace,'rev-parse','HEAD'),base);
    console.log(JSON.stringify({status:'PASS',scope:'installed DSH services in two isolated processes',cases:['create and release','flush and resume with same cwd','empty session cannot resume','maintenance cancellation and separate quiescence','detached worktree retains pinned base and separate working files'],notRun:['model turn cancellation','external process cancellation','crash during wake','tool filesystem confinement','multi-host']},null,2));
  }finally{
    await rm(directory,{recursive:true,force:true});
  }
}
