/** Native sidebar geometry stays with DSH. This toolbar keeps routes reachable. */
export function WorkbenchNavigation({h,rooms=[],archivedRooms=[],view,roomId,onExit,onToggle,onNavigate,notice='',resolveTarget,labels={}}) {
 const copy={back:'返回对话',backHint:'回到 DSH 原生对话',toggle:'展开或收起导航',nav:'导航',switch:'切换工作区或项目',workspaces:'工作区',projects:'我的项目',archived:'已归档',network:'网络总览',inbox:'收件箱',board:'任务看板',manage:'管理与诊断',rooms:'项目列表',agents:'会话管理',...labels};
 const mine=(Array.isArray(rooms)?rooms:[]).filter(r=>r&&typeof r.id==='string'),past=(Array.isArray(archivedRooms)?archivedRooms:[]).filter(r=>r&&typeof r.id==='string'),allowed=[...mine,...past];
 const current=roomId&&allowed.some(r=>r.id===roomId)?'room:'+roomId:'view:'+(['network','inbox','manage','rooms','agents'].includes(view)?view:'inbox');
 return h('div',{className:'lm-workbenchNavigationWrap'},h('nav',{className:'lm-workbenchNavigation','aria-label':copy.switch},
   h('button',{type:'button',className:'lm-navBtn lm-workbenchReturn lm-mainReturn','aria-label':copy.back,title:copy.backHint,onClick:onExit},h('span',{'aria-hidden':true},'←'),h('span',null,copy.back)),
   h('button',{type:'button',className:'lm-navBtn lm-sidebarToggle','aria-label':copy.toggle,title:copy.toggle,onClick:onToggle},h('span',{'aria-hidden':true},'☰'),h('span',{className:'lm-sidebarToggleLabel'},copy.nav)),
   h('select',{className:'lm-workspaceSwitch',value:current,'aria-label':copy.switch,onChange:event=>{const target=resolveTarget?.(event.target.value,allowed);if(target)onNavigate(target);}},
     h('optgroup',{label:copy.workspaces},...['network','inbox','manage','rooms','agents'].map(id=>h('option',{key:id,value:'view:'+id},copy[id]))),
     mine.length?h('optgroup',{label:copy.projects},...mine.map(room=>h('option',{key:room.id,value:'room:'+room.id},`${room.name||room.id} · ${room.id}`))):null,
     past.length?h('optgroup',{label:copy.archived},...past.map(room=>h('option',{key:room.id,value:'room:'+room.id},`${room.name||room.id} · ${room.id}`))):null)),
   notice?h('p',{className:'lm-navigationNotice',role:'status'},notice):null);
}
