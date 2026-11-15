/** Nonmodal read-only discovery surface; all joins use the existing Host handler. */
export function DiscoverProjectsPanel({h,rows,query,onQuery,onJoin,onClose,busy,labels={},panelRef,error=''}) {
  const copy={title:'发现项目',close:'关闭',search:'搜索项目、设备或 Room ID',leader:'Leader',unknownLeader:'负责人未知',unknownDevice:'设备未知',empty:'没有符合条件的可加入项目',join:'加入',joining:'加入中…',hint:'同名项目请核对负责人设备与 Room ID。加入仍由现有房间权限校验。',...labels};
  return h('aside',{className:'lm-discoverPanel',id:'lm-discover-projects',role:'region','aria-label':copy.title,tabIndex:-1,ref:panelRef,onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}},
    h('div',{className:'lm-discoverHead'},h('h2',null,copy.title),h('button',{type:'button',className:'lm-btn lm-discoverClose',onClick:onClose,'aria-label':copy.close},copy.close)),
    h('p',{className:'lm-discoverHint'},copy.hint),
    h('input',{className:'lm-input lm-discoverSearch',type:'search',value:query,maxLength:200,'aria-label':copy.search,placeholder:copy.search,onChange:event=>onQuery(event.target.value)}),
    error?h('p',{className:'lm-error lm-discoverError',role:'alert'},error):null,
    h('div',{className:'lm-discoverResults','aria-live':'polite'},rows.length===0?h('p',{className:'lm-muted lm-discoverEmpty'},copy.empty):rows.map(row=>h('article',{key:row.id,className:'lm-discoverProject'},
      h('div',{className:'lm-discoverProjectBody'},h('strong',{className:'lm-discoverProjectName'},row.name),row.topic?h('p',{className:'lm-discoverTopic'},row.topic):null,
        h('p',{className:'lm-discoverLeader'},`${copy.leader}: ${row.leaderName||copy.unknownLeader} · ${row.deviceName||copy.unknownDevice}`),h('code',{className:'lm-discoverId'},row.id)),
      h('button',{type:'button',className:'lm-btn lm-btnPrimary lm-joinBtn',disabled:!!busy,onClick:()=>onJoin(row.id),'aria-label':`${copy.join} ${row.name} · ${row.id}`},busy===row.id?copy.joining:copy.join)))));
}
