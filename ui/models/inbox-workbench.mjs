/** Pure projection over the returned unread subset; no routing or read-state mutation. */
export function inboxWorkbenchView({messages,self,rooms=[],peers=[],query='',filter='all'}={}) {
 const string=value=>typeof value==='string'?value:'';
 const roomList=Array.isArray(rooms)?rooms:[],peerList=Array.isArray(peers)?peers:[];
 const allRows=(Array.isArray(messages)?messages:[]).filter(message=>message&&typeof message==='object'&&message.read!==true&&!(self?.nodeId&&message.from?.nodeId===self.nodeId&&(!message.from.sessionId||message.from.sessionId==='human'))).slice().reverse().map(message=>{
  const nodeId=string(message.from?.nodeId),id=string(message.id),roomId=string(message.room);
  const sender=string(message.from?.title)||string(message.from?.name)||nodeId||'未知作者';
  const deviceName=nodeId&&nodeId===self?.nodeId?string(self?.name):string(peerList.find(peer=>peer?.nodeId===nodeId)?.name);
  const device=nodeId?(deviceName?deviceName+' · '+nodeId:nodeId):'来源设备未知';
  const roomLabel=string(roomList.find(room=>room?.id===roomId)?.name)||string(message.topic)||roomId;
  const body=string(message.text),preview=body.replace(/\s+/g,' ').slice(0,240);
  const category=message.kind==='room-task'?'tasks':['system','system-event'].includes(message.kind)?'system':'ordinary';
  const mentioned=!!self?.nodeId&&Array.isArray(message.structuredMentions)&&message.structuredMentions.some(ref=>ref?.memberKey===self.nodeId+'/human');
  return {key:JSON.stringify([nodeId,id]),message,id,nodeId,sender,device,roomId,roomLabel,body,preview,timestamp:string(message.at??message.receivedAt??message.sentAt),category,mentioned};
 });
 const counts={all:allRows.length,mentions:allRows.filter(row=>row.mentioned).length,tasks:allRows.filter(row=>row.category==='tasks').length,system:allRows.filter(row=>row.category==='system').length};
 const availableFilters=['all',...['mentions','tasks','system'].filter(key=>counts[key]>0)];
 const activeFilter=availableFilters.includes(filter)?filter:'all';
 const needle=string(query).trim().toLocaleLowerCase();
 const rows=allRows.filter(row=>(activeFilter==='all'||activeFilter==='mentions'&&row.mentioned||row.category===activeFilter)&&(!needle||[row.sender,row.device,row.roomLabel,row.roomId,row.body].join(' ').toLocaleLowerCase().includes(needle)));
 return {rows,allRows,counts,availableFilters,activeFilter};
}
