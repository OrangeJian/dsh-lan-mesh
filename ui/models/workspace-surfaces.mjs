export function shellReadState(state={}) {
 const hasData=state.data!==null&&state.data!==undefined;
 return {kind:!hasData?(state.status==='error'?'failed':'loading'):(state.status==='error'?'stale':'ready'),error:typeof state.error==='string'?state.error:'',observedAt:state.observedAt??null};
}
export function networkWorkspaceView({self,peers,agents,agentsStatus,stale=false}={}) {
 const nodes=[],seen=new Set(),catalogueReady=agentsStatus==='ready';
 const list=Array.isArray(peers)?peers:[];
 if(typeof self?.nodeId==='string'&&self.nodeId){seen.add(self.nodeId);const local=Array.isArray(agents?.local)?agents.local:[];nodes.push({id:self.nodeId,name:self.selfName||self.name||self.nodeId,local:true,ageSeconds:null,sessions:catalogueReady?local.length:null,running:catalogueReady&&local.every(a=>a?.status==='running'||a?.status==='idle')?local.filter(a=>a.status==='running').length:null});}
 for(const peer of list){if(!peer||typeof peer.nodeId!=='string'||!peer.nodeId||seen.has(peer.nodeId))continue;seen.add(peer.nodeId);const identity=typeof peer.selfName==='string'?peer.selfName.trim():'';nodes.push({id:peer.nodeId,name:identity||(typeof peer.name==='string'&&peer.name?peer.name:peer.nodeId),local:false,ageSeconds:Number.isFinite(peer.ageSeconds)&&peer.ageSeconds>=0?peer.ageSeconds:null,sessions:null,running:null});}
 // The remote catalogue can be partial. A positive match is evidence, absence isn't zero.
 if(catalogueReady)for(const n of nodes.filter(n=>!n.local)){const matches=(Array.isArray(agents?.remote)?agents.remote:[]).filter(a=>a.nodeId===n.id);if(matches.length)n.sessions=matches.length;}
 return {nodes,peerCount:Array.isArray(peers)?nodes.filter(n=>!n.local).length:null,stale};
}
