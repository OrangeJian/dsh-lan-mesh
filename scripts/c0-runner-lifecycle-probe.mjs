import {executionResourceKey,inspectExecutionWorkspace,prepareExecutionWorkspace} from '../lib/runner-resources.mjs';
import {openTeamStore} from '../lib/team-store.mjs';
import {prepareRunnerWorkspace,releaseRunnerWorkspace,verifyRunnerWorkspace} from '../lib/runner-workspace.mjs';
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
import * as fs from 'node:fs/promises';
import {lstat,mkdtemp,mkdir,rm,readFile,symlink,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const load=name=>import(pathToFileURL(fromHost.resolve('@deepseek-ai/'+name)).href);
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',timeout:15000,windowsHide:true}).trim();
const [stage,root]=process.argv.slice(2);
const sessionId='session-runner-probe';

/**
 * Read-only reconciliation evidence on isolated temp repos. Each scenario keeps
 * its own ledger and resource root. Nothing here retries prepare, promotes the
 * ledger, deletes directories or reaches dispatch.
 */
async function reconcileScenarios(base,hooks){
  const scenarios=join(base,'reconcile');
  await mkdir(scenarios,{recursive:true});
  const cases={};

  async function build(name){
    const dir=join(scenarios,name);
    const repo=join(dir,'source');
    const resourcesRoot=join(dir,'resources');
    await Promise.all([mkdir(repo,{recursive:true}),mkdir(resourcesRoot,{recursive:true})]);
    git(repo,'init','--quiet');
    const tracked=join(repo,'tracked.txt');
    await writeFile(tracked,'baseline\n');
    git(repo,'add','--','tracked.txt');
    const identity=['-c','user.name=Runner Probe','-c','user.email=runner-probe@example.invalid','-c','commit.gpgsign=false'];
    git(repo,...identity,'-c',`core.hooksPath=${hooks}`,'commit','--quiet','-m','baseline');
    const baseCommit=git(repo,'rev-parse','HEAD');
    const binding={repoId:'reconcile-repo',root:repo};
    const ledgerDirectory=join(dir,'ledger');
    const store=await openTeamStore({directory:ledgerDirectory});
    const descriptor={roomId:'room-'+name,taskId:'task-'+name,executionId:'exec-'+name,generation:1,leaderKey:'node-a/leader',actorKey:'node-a/leader',workerKey:'node-b/worker',title:'Reconcile',detail:''};
    await store.transact(state=>{state.workerExecutions[descriptor.executionId]={descriptor,state:'received',started:false,seq:1,result:null};return{state};});
    const managed={store,executionId:descriptor.executionId,generation:1,binding,baseCommit,resourcesRoot,authorize:()=>true};
    const reserve=(phase='reserved')=>store.transact(state=>{
      state.workerExecutions[descriptor.executionId].workspaceResource={generation:1,repoId:binding.repoId,baseCommit,key:executionResourceKey(descriptor.executionId,1),phase};
      return{state};
    });
    return{dir,repo,resourcesRoot,baseCommit,binding,ledgerDirectory,store,descriptor,managed,reserve,identity};
  }

  // 1. Complete resource observed after the ledger store is closed and reopened.
  {
    const s=await build('complete');
    await prepareExecutionWorkspace(s.managed);
    const reopened=await openTeamStore({directory:s.ledgerDirectory});
    const report=await inspectExecutionWorkspace({...s.managed,store:reopened});
    assert.equal(report.status,'COMPLETE');
    assert.equal(report.ledger.status,'prepared');
    assert.equal(report.disk.status,'COMPLETE');
    assert.equal(report.disk.verification.baseCommit,s.baseCommit);
    cases.complete=report.status;
  }

  // 2. Missing: ledger still says prepared but the resource directory is gone.
  {
    const s=await build('missing');
    const key=executionResourceKey(s.descriptor.executionId,1);
    await prepareExecutionWorkspace(s.managed);
    await rm(join(s.resourcesRoot,key),{recursive:true,force:true});
    const report=await inspectExecutionWorkspace(s.managed);
    assert.equal(report.status,'MISSING');
    assert.equal(report.ledger.status,'prepared');
    assert.equal(report.disk.status,'ABSENT');
    cases.missing=report.status;
  }

  // 3. Leftover: disk worktree is complete but the ledger was never promoted.
  {
    const s=await build('unpromoted');
    const key=executionResourceKey(s.descriptor.executionId,1);
    await s.reserve();
    await mkdir(join(s.resourcesRoot,key));
    await prepareRunnerWorkspace({binding:s.binding,repoId:s.binding.repoId,baseCommit:s.baseCommit,resourceRoot:join(s.resourcesRoot,key)});
    const report=await inspectExecutionWorkspace(s.managed);
    assert.equal(report.status,'UNPROMOTED');
    assert.equal(report.ledger.status,'reserved');
    assert.equal(report.disk.status,'COMPLETE');
    cases.unpromoted=report.status;
  }

  // 4. Partial: reserved ledger but no workspace created in the resource directory.
  {
    const s=await build('partial');
    await s.reserve();
    await mkdir(join(s.resourcesRoot,executionResourceKey(s.descriptor.executionId,1)));
    const report=await inspectExecutionWorkspace(s.managed);
    assert.equal(report.status,'PARTIAL');
    assert.equal(report.ledger.status,'reserved');
    assert.equal(report.disk.status,'PARTIAL');
    cases.partial=report.status;
  }

  // 5. Mismatch: prepared ledger but the worktree on disk is pinned to another commit.
  {
    const s=await build('mismatch');
    const key=executionResourceKey(s.descriptor.executionId,1);
    await writeFile(join(s.repo,'tracked.txt'),'second\n');
    git(s.repo,'add','--','tracked.txt');
    git(s.repo,...s.identity,'-c',`core.hooksPath=${hooks}`,'commit','--quiet','-m','second');
    const other=git(s.repo,'rev-parse','HEAD');
    await s.reserve('prepared');
    await mkdir(join(s.resourcesRoot,key));
    await prepareRunnerWorkspace({binding:s.binding,repoId:s.binding.repoId,baseCommit:other,resourceRoot:join(s.resourcesRoot,key)});
    const report=await inspectExecutionWorkspace(s.managed);
    assert.equal(report.status,'MISMATCH');
    assert.equal(report.ledger.status,'prepared');
    assert.equal(report.disk.status,'MISMATCH');
    cases.mismatch=report.status;
  }

  // 6. Old generation: a gen-1 resource must not satisfy a gen-2 reconciliation,
  //    and reconciliation must leave the gen-1 directory untouched.
  {
    const s=await build('stale');
    const key1=executionResourceKey(s.descriptor.executionId,1);
    await prepareExecutionWorkspace(s.managed);
    const report=await inspectExecutionWorkspace({...s.managed,generation:2});
    assert.equal(report.status,'STALE');
    assert.equal(report.ledger.status,'STALE');
    assert.notEqual(report.key,key1);
    assert.equal((await lstat(join(s.resourcesRoot,key1))).isDirectory(),true);
    cases.stale=report.status;
  }

  // 7. Foreign: a worktree from another repository must not be treated as ours.
  {
    const s=await build('foreign');
    const key=executionResourceKey(s.descriptor.executionId,1);
    const otherRepo=join(s.dir,'other-source');
    await mkdir(otherRepo);
    git(otherRepo,'init','--quiet');
    await writeFile(join(otherRepo,'tracked.txt'),'foreign\n');
    git(otherRepo,'add','--','tracked.txt');
    git(otherRepo,...s.identity,'-c',`core.hooksPath=${hooks}`,'commit','--quiet','-m','foreign');
    await s.reserve('prepared');
    await mkdir(join(s.resourcesRoot,key));
    git(otherRepo,'-c',`core.hooksPath=${hooks}`,'worktree','add','--detach','--quiet',join(s.resourcesRoot,key,'workspace'),'HEAD');
    const report=await inspectExecutionWorkspace(s.managed);
    assert.equal(report.status,'FOREIGN');
    assert.equal(report.disk.status,'FOREIGN');
    cases.foreign=report.status;
  }

  // 8. Path escape: a symlinked resource root must not be trusted.
  {
    const s=await build('escape');
    const key=executionResourceKey(s.descriptor.executionId,1);
    await s.reserve('prepared');
    const outside=join(s.dir,'outside');
    await mkdir(outside);
    await symlink(outside,join(s.resourcesRoot,key),process.platform==='win32'?'junction':'dir');
    const report=await inspectExecutionWorkspace(s.managed);
    assert.equal(report.status,'PATH_ESCAPE');
    assert.equal(report.disk.status,'PATH_ESCAPE');
    cases.pathEscape=report.status;
  }

  // 9. Resource-root EACCES/EIO is UNKNOWN, never reported ABSENT/MISSING.
  {
    const s=await build('root-io-fault');
    const io={...fs,realpath:async p=>{
      if(p===s.resourcesRoot){const e=new Error('denied');e.code='EACCES';throw e;}
      return fs.realpath(p);
    }};
    const report=await inspectExecutionWorkspace({...s.managed,io});
    assert.equal(report.disk.observationError,'EACCES');
    assert.equal(report.disk.status,'UNKNOWN');
    assert.notEqual(report.status,'MISSING');
    cases.rootIoFault=report.status;
  }

  // 10. EIO on the root with a reserved ledger must stay UNKNOWN, not become PARTIAL.
  {
    const s=await build('unknown-reserved');
    await s.reserve();
    const io={...fs,realpath:async p=>{
      if(p===s.resourcesRoot){const e=new Error('io');e.code='EIO';throw e;}
      return fs.realpath(p);
    }};
    const report=await inspectExecutionWorkspace({...s.managed,io});
    assert.equal(report.ledger.status,'reserved');
    assert.equal(report.disk.status,'UNKNOWN');
    assert.equal(report.status,'UNKNOWN');
    cases.unknownReserved=report.status;
  }

  // 11. lstat→realpath race on resourceRoot returns UNKNOWN without throwing.
  {
    const s=await build('race-root');
    const key=executionResourceKey(s.descriptor.executionId,1);
    await s.reserve();
    await mkdir(join(s.resourcesRoot,key));
    const io={...fs,realpath:async p=>{
      if(String(p).endsWith(key)){const e=new Error('raced');e.code='ENOENT';throw e;}
      return fs.realpath(p);
    }};
    const report=await inspectExecutionWorkspace({...s.managed,io});
    assert.equal(report.disk.status,'UNKNOWN');
    assert.equal(report.status,'UNKNOWN');
    cases.raceRoot=report.status;
  }

  // 12. lstat→realpath race on workspace returns UNKNOWN without throwing.
  {
    const s=await build('race-workspace');
    const key=executionResourceKey(s.descriptor.executionId,1);
    await s.reserve('prepared');
    await mkdir(join(s.resourcesRoot,key));
    await mkdir(join(s.resourcesRoot,key,'workspace'));
    const io={...fs,realpath:async p=>{
      if(String(p).endsWith(join(key,'workspace'))){const e=new Error('raced');e.code='ENOENT';throw e;}
      return fs.realpath(p);
    }};
    const report=await inspectExecutionWorkspace({...s.managed,io});
    assert.equal(report.disk.status,'UNKNOWN');
    assert.equal(report.status,'UNKNOWN');
    cases.raceWorkspace=report.status;
  }

  // 13. A symlinked workspace is explicitly PATH_ESCAPE.
  {
    const s=await build('workspace-link');
    const key=executionResourceKey(s.descriptor.executionId,1);
    await s.reserve('prepared');
    await mkdir(join(s.resourcesRoot,key));
    const outside=join(s.dir,'outside-ws');
    await mkdir(outside);
    await symlink(outside,join(s.resourcesRoot,key,'workspace'),process.platform==='win32'?'junction':'dir');
    const report=await inspectExecutionWorkspace(s.managed);
    assert.equal(report.disk.status,'PATH_ESCAPE');
    assert.equal(report.status,'PATH_ESCAPE');
    cases.workspaceLink=report.status;
  }

  // 14. A workspace resolving outside the expected child is PATH_ESCAPE and no Git evidence is trusted.
  {
    const s=await build('workspace-swap');
    const key=executionResourceKey(s.descriptor.executionId,1);
    await s.reserve('prepared');
    await mkdir(join(s.resourcesRoot,key));
    await mkdir(join(s.resourcesRoot,key,'workspace'));
    const swapped=join(s.resourcesRoot,key,'swapped');
    await mkdir(swapped);
    const io={...fs,realpath:async p=>{
      if(String(p).endsWith(join(key,'workspace')))return fs.realpath(swapped);
      return fs.realpath(p);
    }};
    const report=await inspectExecutionWorkspace({...s.managed,io});
    assert.equal(report.disk.status,'PATH_ESCAPE');
    assert.equal(report.disk.verification,null);
    cases.workspaceSwap=report.status;
  }

  return cases;
}
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
    await assert.rejects(releaseRunnerWorkspace({...prepare,canRelease:()=>true}),{code:'WORKSPACE_DIRTY'});
    const resourcesRoot=join(directory,'managed-resources');
    const ledgerDirectory=join(directory,'team-ledger');
    await mkdir(resourcesRoot);
    let store=await openTeamStore({directory:ledgerDirectory});
    const descriptor={roomId:'room-probe',taskId:'task-probe',executionId:'exec-probe',generation:1,leaderKey:'node-a/leader',actorKey:'node-a/leader',workerKey:'node-b/worker',title:'Probe',detail:''};
    await store.transact(state=>{
      state.workerExecutions[descriptor.executionId]={descriptor,state:'received',started:false,seq:1,result:null};
      return {state};
    });
    const managed={store,executionId:descriptor.executionId,generation:1,binding,baseCommit:base,resourcesRoot,authorize:()=>true};
    await assert.rejects(prepareExecutionWorkspace({...managed,generation:2}),{code:'STALE_EXECUTION'});
    const prepared=await prepareExecutionWorkspace(managed);
    assert.equal(prepared.baseCommit,base);
    store=await openTeamStore({directory:ledgerDirectory});
    assert.equal(store.read().workerExecutions[descriptor.executionId].workspaceResource.phase,'prepared');
    await assert.rejects(prepareExecutionWorkspace({...managed,store}),{code:'WORKSPACE_ALREADY_RESERVED'});
    const cleanRoot=join(directory,'clean-resource');
    await mkdir(cleanRoot);
    const clean={...prepare,resourceRoot:cleanRoot};
    const cleanWorkspace=(await prepareRunnerWorkspace(clean)).workspace;
    await assert.rejects(releaseRunnerWorkspace({...clean,canRelease:()=>false}),{code:'RELEASE_NOT_AUTHORIZED'});
    assert.equal((await releaseRunnerWorkspace({...clean,canRelease:()=>true})).released,true);
    await assert.rejects(realpath(cleanWorkspace),{code:'ENOENT'});
    assert.equal(git(repo,'rev-parse','HEAD'),base);
    assert.equal(git(workspace,'rev-parse','HEAD'),base);
    const reconcile=await reconcileScenarios(directory,hooks);
    console.log(JSON.stringify({
      status:'PASS',
      scope:'installed DSH services in two isolated processes; read-only resource reconciliation on isolated temp repos',
      cases:['create and release','flush and resume with same cwd','empty session cannot resume','maintenance cancellation and separate quiescence','detached worktree retains pinned base and separate files','authorized clean worktree release preserves dirty and unauthorized worktrees',reconcile],
      notRun:['model turn cancellation','external process cancellation','crash during wake','tool filesystem confinement','multi-host','real dispatch or ledger promotion (intentionally disabled)']
    },null,2));
  }finally{
    await rm(directory,{recursive:true,force:true});
  }
}
