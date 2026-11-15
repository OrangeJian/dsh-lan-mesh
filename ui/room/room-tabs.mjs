/** Public Room navigation only; it never grants task or membership authority. */
export function RoomTabs(props) {
 const {h}=props,ids=['chat','docs','tasks','members'];
 const labels=props.labels??{chat:'对话',docs:'文档',tasks:'任务',members:'成员'};
 const count=value=>Number.isFinite(value)?' '+Math.max(0,Math.trunc(value)):'';
 return h('div',{className:'lm-roomTabs',role:'tablist','aria-label':'房间内容'},...ids.map((id,index)=>h('button',{
  key:id,type:'button',id:props.prefix+'-'+id+'-tab',role:'tab','data-tab':id,
  className:'lm-roomTab lm-roomTab-'+id+(props.value===id?' lm-roomTabActive':''),
  'aria-selected':props.value===id,'aria-controls':props.prefix+'-'+id+'-panel',tabIndex:props.value===id?0:-1,
  onClick:()=>props.onSelect(id),onKeyDown:event=>{
   let target;if(event.key==='ArrowRight')target=(index+1)%ids.length;else if(event.key==='ArrowLeft')target=(index+ids.length-1)%ids.length;else if(event.key==='Home')target=0;else if(event.key==='End')target=ids.length-1;else return;
   event.preventDefault();props.onSelect(ids[target]);event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[target]?.focus();
  },
 },labels[id]+(id==='tasks'?count(props.tasks):id==='members'?count(props.members):''))));
}
