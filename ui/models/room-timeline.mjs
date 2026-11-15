/** Local reading position only; does not change Room/Inbox read state. */
export function createRoomTimeline() {
 let ids=[],pending=new Set(),following=true,top=0,anchor=null;
 const view=()=>({follow:following,pending:pending.size,top});
 return {
  update(messages){
   const next=[...new Set((Array.isArray(messages)?messages:[]).map(row=>typeof row?.id==='string'?row.id:'').filter(Boolean))];
   const known=new Set(ids);const anchor=ids.length?next.lastIndexOf(ids[ids.length-1]):-1;
   const arrivals=(anchor>=0?next.slice(anchor+1):next).filter(id=>!known.has(id));
   const retained=new Set(next);pending=new Set([...pending].filter(id=>retained.has(id)));
   if(following)pending.clear();else for(const id of arrivals)pending.add(id);
   ids=next;return view();
  },
  observe(node){
   const height=Number(node?.scrollHeight),size=Number(node?.clientHeight),position=Number(node?.scrollTop);
   if([height,size,position].every(Number.isFinite)){
    top=Math.max(0,position);following=height-size-top<=80;
    if(following){pending.clear();anchor=null;}
    else {
     const viewport=node.getBoundingClientRect?.();
     const first=viewport&&[...(node.querySelectorAll?.('[data-message-id]')??[])].find(row=>row.getBoundingClientRect().bottom>viewport.top);
     anchor=first?{id:first.getAttribute('data-message-id'),offset:first.getBoundingClientRect().top-viewport.top}:null;
    }
   }
   return view();
  },
  restore(node){
   if(following||!node)return;
   const match=anchor&&[...(node.querySelectorAll?.('[data-message-id]')??[])].find(row=>row.getAttribute('data-message-id')===anchor.id);
   if(match&&node.getBoundingClientRect){node.scrollTop+=match.getBoundingClientRect().top-node.getBoundingClientRect().top-anchor.offset;}
   else node.scrollTop=top;
   top=node.scrollTop;
  },
  jump(){following=true;anchor=null;pending.clear();return view();},
  current:view,
 };
}
