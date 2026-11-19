/** Nonmodal read-only discovery surface; all joins use the existing Host handler. */
export function DiscoverProjectsPanel({h,rows,query,onQuery,onJoin,onClose,busy,labels={},panelRef,error=''}) {
  const copy={title:'发现项目',close:'关闭',search:'搜索项目、设备或 Room ID',leader:'负责人',unknownLeader:'负责人未知',unknownDevice:'设备未知',empty:'没有符合条件的可加入项目',join:'加入',joining:'加入中…',hint:'同名项目已按房间编号区分，加入前请确认目标；加入仍由现有房间权限校验。',sameName:'同名项目',...labels};
  const list=Array.isArray(rows)?rows:[];
  // Same-name projects are the disambiguation trap: give each card a short id
  // so two identically named rooms are visibly different, instead of pushing
  // the job onto a prose hint. The full id stays available on hover / aria.
  const nameCounts=new Map();
  for(const row of list){const key=String(row?.name??'');nameCounts.set(key,(nameCounts.get(key)||0)+1);}
  const shortId=id=>{const value=String(id??'');const match=value.match(/([0-9a-f]{6,})/i);return match?'#'+match[1].slice(0,8):value;};
  return h('aside',{className:'lm-discoverPanel',id:'lm-discover-projects',role:'region','aria-label':copy.title,tabIndex:-1,ref:panelRef,onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}},
    h('div',{className:'lm-discoverHead'},h('h2',null,copy.title),h('button',{type:'button',className:'lm-btn lm-discoverClose',onClick:onClose,'aria-label':copy.close},copy.close)),
    h('p',{className:'lm-discoverHint'},copy.hint),
    h('input',{className:'lm-input lm-discoverSearch',type:'search',value:query,maxLength:200,'aria-label':copy.search,placeholder:copy.search,onChange:event=>onQuery(event.target.value)}),
    error?h('p',{className:'lm-error lm-discoverError',role:'alert'},error):null,
    h('div',{className:'lm-discoverResults','aria-live':'polite'},list.length===0?h('p',{className:'lm-muted lm-discoverEmpty'},copy.empty):list.map(row=>{
      const leader=String(row?.leaderName??''),device=String(row?.deviceName??'');
      const hasOrigin=leader!==''||device!=='';
      const duplicate=(nameCounts.get(String(row?.name??''))||0)>1;
      return h('article',{key:row.id,className:'lm-discoverProject'},
        h('div',{className:'lm-discoverProjectBody'},
          h('div',{className:'lm-discoverProjectTitle'},
            h('strong',{className:'lm-discoverProjectName'},row.name),
            duplicate?h('span',{className:'lm-discoverSameName',title:copy.sameName},copy.sameName):null,
          ),
          row.topic?h('p',{className:'lm-discoverTopic'},row.topic):null,
          hasOrigin?h('p',{className:'lm-discoverLeader'},`${copy.leader}: ${leader||copy.unknownLeader}${device?' · '+device:''}`):null,
          h('code',{className:'lm-discoverId',title:String(row.id)},shortId(row.id)),
        ),
        h('button',{type:'button',className:'lm-btn lm-btnPrimary lm-joinBtn',disabled:!!busy,onClick:()=>onJoin(row.id),'aria-label':`${copy.join} ${row.name} · ${row.id}`},busy===row.id?copy.joining:copy.join),
      );
    })));
}
