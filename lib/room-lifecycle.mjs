/** Room lifecycle is separate from irreversible global deletion. */
export const archived = room => room?.lifecycle?.status === 'archived';
export function lifecycle(raw, leaderKey) {
 if (!raw || !['active','archived'].includes(raw.status) || !Number.isSafeInteger(raw.generation) || raw.generation<1 || raw.actorKey!==leaderKey || typeof raw.eventId!=='string' || !raw.eventId) return {status:'active',generation:0};
 return {status:raw.status,generation:raw.generation,actorKey:raw.actorKey,eventId:raw.eventId,at:typeof raw.at==='string'?raw.at:''};
}
export function participants(raw,members=[]) {
 const result=Object.create(null);
 for(const [key,value] of Object.entries(raw??{}))if(value===true&&key.endsWith('/human'))result[key]=true;
 for(const member of members)if(member.sessionId==='human')result[member.key]=true;
 return result;
}
export function mergeLifecycle(room,other){
 const left=lifecycle(room.lifecycle,room.leader?.key),right=lifecycle(other.lifecycle,room.leader?.key);
 const rank=value=>[value.generation,value.status==='archived'?1:0,value.eventId??''];
 const a=rank(left),b=rank(right);
 const winner=b[0]>a[0]||(b[0]===a[0]&&(b[1]>a[1]||(b[1]===a[1]&&b[2]>a[2])))?right:left;
 const changed=JSON.stringify(left)!==JSON.stringify(winner);
 room.lifecycle=winner;
 const events=new Map();
 for(const event of [...(room.lifecycleEvents??[]),...(other.lifecycleEvents??[])]){
  const valid=lifecycle(event,room.leader?.key);
  if(valid.generation&&(!events.has(valid.eventId)||JSON.stringify(valid)>JSON.stringify(events.get(valid.eventId))))events.set(valid.eventId,valid);
 }
 if(winner.generation)events.set(winner.eventId,winner);
 room.lifecycleEvents=[...events.values()].sort((a,b)=>a.generation-b.generation||a.eventId.localeCompare(b.eventId));
 return changed;
}
export function setLifecycle(room,{actorKey,status,eventId,baseGeneration}){
 if(actorKey!==room.leader?.key)throw new Error('only Room Leader may archive or restore');
 if(!['active','archived'].includes(status)||typeof eventId!=='string'||!eventId||eventId.length>128)throw new Error('invalid lifecycle operation');
 const current=lifecycle(room.lifecycle,room.leader?.key);
 const previous=room.lifecycleEvents?.find(event=>event.eventId===eventId);
 if(previous){if(previous.status!==status||previous.actorKey!==actorKey||previous.generation!==baseGeneration+1)throw new Error('lifecycle request ID conflict');return current;}
 if(baseGeneration!==current.generation)throw new Error('room lifecycle changed; refresh and retry');
 if(current.generation===Number.MAX_SAFE_INTEGER)throw new Error('room lifecycle generation exhausted');
 const event={status,generation:current.generation+1,actorKey,eventId,at:new Date().toISOString()};
 room.lifecycle=event;room.lifecycleEvents=[...(room.lifecycleEvents??[]),event];
 return event;
}
