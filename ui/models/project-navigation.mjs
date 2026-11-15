/** Project names are labels. Room IDs remain the identity for every action. */
export function discoverProjectsView(input, query='') {
  const rows=Array.isArray(input)?input:[], seen=new Set(),needle=String(query??'').trim().toLocaleLowerCase();
  const value=x=>typeof x==='string'?x:'';
  return rows.filter(room=>room&&typeof room.id==='string'&&room.id&&!room.isMember&&room.deleted!==true&&room.lifecycle?.status!=='archived').filter(room=>{if(seen.has(room.id))return false;seen.add(room.id);return true;}).map(room=>({id:room.id,name:value(room.name)||room.id,topic:value(room.topic),leaderName:value(room.leader?.name)||value(room.leader?.title),deviceName:value(room.leader?.nodeName)||value(room.leader?.nodeId)})).filter(row=>!needle||[row.id,row.name,row.topic,row.leaderName,row.deviceName].some(x=>x.toLocaleLowerCase().includes(needle)));
}
