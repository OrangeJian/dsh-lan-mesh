export function filterJoinedProjects(input,query='') {
 const needle=String(query??'').trim().toLocaleLowerCase(),seen=new Set();
 return (Array.isArray(input)?input:[]).filter(room=>room&&typeof room.id==='string'&&room.id&&room.deleted!==true&&room.lifecycle?.status!=='archived').filter(room=>{if(seen.has(room.id))return false;seen.add(room.id);return true;}).filter(room=>!needle||[room.name,room.topic,room.id].some(value=>typeof value==='string'&&value.toLocaleLowerCase().includes(needle)));
}
export function workspaceNavigationTarget(value,rooms=[]) {
 if(typeof value!=='string')return null;
 if(value.startsWith('view:')){const view=value.slice(5);return ['network','inbox','manage','rooms','agents'].includes(view)?{view,roomId:''}:null;}
 if(value.startsWith('room:')){const id=value.slice(5);return (Array.isArray(rooms)?rooms:[]).some(room=>room?.id===id&&room.deleted!==true)?{view:'rooms',roomId:id}:null;}
 return null;
}
