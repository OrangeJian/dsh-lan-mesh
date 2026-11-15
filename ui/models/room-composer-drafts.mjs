/** Page-local unsent drafts. No serialization, disk storage, messages, or permissions. */
export function createRoomComposerDrafts() {
 const entries=new Map();
 const key=scope=>JSON.stringify([String(scope.nodeId??''),String(scope.sessionId??''),String(scope.roomId??'')]);
 function remove(record){if(entries.get(record.key)!==record)return;entries.delete(record.key);record.listeners.clear();record.observers.clear();record.attachments?.dispose();record.attachments=null;}
 return {
  get(scope){const id=key(scope);if(!entries.has(id))entries.set(id,{key:id,values:Object.create(null),attempt:{current:null},attachments:null,listeners:new Set(),observers:new Set(),revision:0,taskPending:null});return entries.get(id);},
  bindAttachments(record,create,listener,limits){
   if(!record.attachments)record.attachments=create(rows=>{record.revision++;for(const fn of [...record.listeners])fn([...rows]);});
   record.attachments.updateLimits?.(limits);
   record.listeners.add(listener);listener([...record.attachments.rows]);
   let subscribed=true;
   return ()=>{if(!subscribed)return;subscribed=false;record.listeners.delete(listener);if(!record.listeners.size&&record.attachments?.rows.length===0){record.attachments.dispose();record.attachments=null;}};
  },
  watch(record,listener){record.observers.add(listener);return()=>record.observers.delete(listener);},
  acknowledge(record,attempt,revision){
   if(record.attempt.current!==attempt)return false;
   record.attempt.current=null;
   if(record.revision!==revision)return false;
   for(const [field,value] of Object.entries({draft:'',draftMentions:[],draftSkills:[],caret:0,quickTask:false}))record.values[field]=value;
   record.attachments?.clear?.();record.revision++;
   for(const listener of [...record.observers])listener();
   return true;
  },
  acknowledgeForm(record,fields){
   if(!Object.entries(fields).every(([name,value])=>record.values[name]===value))return false;
   record.values.taskTitle='';record.values.taskDetail='';record.revision++;
   for(const listener of [...record.observers])listener();return true;
  },
  changed(record){for(const listener of [...record.observers])listener();},
  drop(scope){const record=entries.get(key(scope));if(record)remove(record);},
  dispose(){for(const record of [...entries.values()])remove(record);}
 };
}
/** Persist before React commits so immediate navigation cannot discard an edit. */
export function useComposerField(React,record,name,initial,canWrite=()=>true) {
 if(!Object.hasOwn(record.values,name))record.values[name]=typeof initial==='function'?initial():initial;
 const [snapshot,setSnapshot]=React.useState(()=>({record,name,value:record.values[name]}));
 const value=record.values[name];
 const set=next=>{if(!canWrite())return;const updated=typeof next==='function'?next(record.values[name]):next;if(name!=='caret'&&record.values[name]!==updated)record.revision++;record.values[name]=updated;setSnapshot({record,name,value:updated});};
 return [value,set];
}
