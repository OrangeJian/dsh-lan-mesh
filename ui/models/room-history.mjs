/** Local display cache: exact origin + message ID, order unchanged, newer metadata wins. */
export function mergeRoomTranscript(earlier,current) {
 const result=[],positions=new Map();
 for(const message of [...(Array.isArray(earlier)?earlier:[]),...(Array.isArray(current)?current:[])]){
  const node=message?.from?.nodeId,id=message?.id;
  const key=typeof node==='string'&&typeof id==='string'?JSON.stringify([node,id]):null;
  if(key!==null&&positions.has(key))result[positions.get(key)]=message;
  else{if(key!==null)positions.set(key,result.length);result.push(message);}
 }
 return result;
}
