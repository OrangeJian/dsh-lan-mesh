/** Room task projection only: no Team execution or acceptance inference. */
export function canMoveRoomTask({task,nodeId,sessionId,isLeader}={}) {
 return isLeader===true||!!(typeof nodeId==='string'&&nodeId&&typeof sessionId==='string'&&sessionId&&task?.assignee?.nodeId===nodeId&&task.assignee.sessionId===sessionId);
}
export function roomTaskBoardView({rooms,self,query='',status='all',assignee='all'}={}) {
 const text=v=>typeof v==='string'?v:'';const states=['open','doing','blocked','done','unknown'];
 const labels={open:'待开始',doing:'进行中',blocked:'受阻',done:'已完成',unknown:'未知状态'};
 const allRows=[];
 for(const room of Array.isArray(rooms)?rooms:[]){if(!room||room.deleted===true||!text(room.id))continue;for(const task of Array.isArray(room.tasks)?room.tasks:[]){if(!task||task.deleted===true||!text(task.id))continue;const owner=task.assignee??{},nodeId=text(owner.nodeId),sessionId=text(owner.sessionId),ownerKey=nodeId&&sessionId?JSON.stringify([nodeId,sessionId]):null;const ownerName=text(owner.title)||text(owner.name)||sessionId||'负责人未知';const deviceName=text(owner.nodeName)||(nodeId===self?.nodeId?text(self?.name):'');const device=nodeId?(deviceName?deviceName+' · '+nodeId:nodeId):'来源设备未知';const state=states.slice(0,4).includes(task.status)?task.status:'unknown';allRows.push({key:JSON.stringify([room.id,task.id]),task,roomId:room.id,roomName:text(room.name)||room.id,title:text(task.title)||task.id,detail:text(task.detail),status:state,statusLabel:state==='unknown'?labels.unknown+(text(task.status)?' · '+task.status:''):labels[state],assigneeKey:ownerKey,assigneeName:ownerName,device,updatedAt:Number.isFinite(Date.parse(task.updatedAt))?task.updatedAt:'时间未知',source:'Room任务',archived:room.lifecycle?.status==='archived'});}}
 const counts=Object.fromEntries([['all',allRows.length],...states.map(id=>[id,allRows.filter(r=>r.status===id).length])]);
 const assignees=[...new Map(allRows.filter(r=>r.assigneeKey).map(r=>[r.assigneeKey,{key:r.assigneeKey,label:r.assigneeName+' · '+r.device}])).values()];
 const activeStatus=status==='all'||states.includes(status)&&counts[status]>0?status:'all';const activeAssignee=assignee==='all'||assignees.some(a=>a.key===assignee)?assignee:'all';const needle=text(query).trim().toLocaleLowerCase();
 const rows=allRows.filter(r=>(activeStatus==='all'||r.status===activeStatus)&&(activeAssignee==='all'||r.assigneeKey===activeAssignee)&&(!needle||[r.title,r.detail,r.roomName,r.roomId,r.assigneeName,r.device].join(' ').toLocaleLowerCase().includes(needle)));
 return {rows,groups:states.map(id=>({id,label:labels[id],rows:rows.filter(r=>r.status===id)})).filter(g=>g.rows.length),counts,assignees,activeStatus,activeAssignee};
}
