/** Explicit addresses are discovery hints, never trust or execution grants. */
import { isIP } from 'node:net';
const fail=()=>{throw Object.assign(new Error('STATIC_PEER_CONFIG: expected unique nodeId/address/httpPort records (IPv4 or hostname, maximum 64)'),{code:'STATIC_PEER_CONFIG'});};
export function normalizeStaticPeers(input=[]) {
 if(!Array.isArray(input)||input.length>64)fail();
 const ids=new Set(),endpoints=new Set();
 return input.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['nodeId','address','httpPort','name'].includes(key)))fail();
  if(typeof row.nodeId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(row.nodeId))fail();
  const address=row.address;
  if(typeof address!=='string'||address.length>253||!address.split('.').every(part=>/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(part)))fail();
  if(/^\d+(\.\d+){3}$/.test(address)&&isIP(address)!==4)fail();
  if(!Number.isInteger(row.httpPort)||row.httpPort<1||row.httpPort>65535)fail();
  if(row.name!==undefined&&(typeof row.name!=='string'||!row.name.trim()||row.name.length>64))fail();
  const endpoint=`${address.toLowerCase()}:${row.httpPort}`;
  if(ids.has(row.nodeId)||endpoints.has(endpoint))fail();ids.add(row.nodeId);endpoints.add(endpoint);
  return {nodeId:row.nodeId,address,httpPort:row.httpPort,name:row.name??row.nodeId,source:'static'};
 });
}
export function peerCandidates(discovered,configured,selfId) {
 const peers=new Map(discovered.filter(peer=>peer.nodeId!==selfId).map(peer=>[peer.nodeId,peer]));
 for(const peer of configured)if(peer.nodeId!==selfId)peers.set(peer.nodeId,{...peer});
 return [...peers.values()];
}
