/** Component probe: authentication is stubbed; no browser/remote identity proof. */
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
const {HostConnectionService}=await import(pathToFileURL(fromHost.resolve('@deepseek-ai/dsh-client-connection')).href);
const ctx=new Context();
const connection=new HostConnectionService(ctx,[],{isAuthenticated:()=>false,authenticateApi:()=>undefined});
let calls=0;
const dispose=connection.fetch.register({path:'/api/c0-probe',methods:['POST'],requestBody:'buffered',fetch:async()=>{calls++;return new Response('ok');}});
const handler=connection.createSharedFetchHandler('/api');
const request=()=>new Request('http://localhost/api/c0-probe',{method:'POST',headers:{'content-type':'application/json','x-owner':'true'},body:JSON.stringify({owner:true,sessionId:'human',role:'owner'})});
try {
 assert.equal((await handler.fetch(request(),{principal:{kind:'api'}})).status,403);
 assert.equal(calls,0);
 assert.equal((await handler.fetch(request(),connection.browserPeer)).status,200);
 assert.equal(calls,1);
 await dispose();
 assert.equal((await handler.fetch(request(),connection.browserPeer)).status,404);
 console.log(JSON.stringify({scope:'installed-connection-component',observedAt:new Date().toISOString(),cases:['non-owner rejected before handler despite forged payload/headers','trusted in-process owner admitted','disposed exact route unavailable'],status:'PASS',authentication:'stubbed-deny-all; not exercised',notVerified:['browser-cookie-authentication','remote-owner-identity','room-team-acl','permission-revocation','physical-two-machine']},null,2));
} finally {await dispose();await connection.browserPeer.dispose();}
