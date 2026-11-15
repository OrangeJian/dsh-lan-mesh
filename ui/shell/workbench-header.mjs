/** Presentational only. The caller owns DSH navigation and all side effects. */
export function WorkbenchReturnButton({h,onExit,label,hint,main=false}) {
  return h('button',{type:'button',className:main?'lm-navBtn lm-workbenchReturn lm-mainReturn':'lm-navBtn lm-conversation lm-workbenchReturn','aria-label':label,title:hint,onClick:onExit},
    h('span',{'aria-hidden':true,className:'lm-returnGlyph'},'←'),h('span',{className:'lm-returnLabel'},label));
}
export function WorkbenchHeader({h,model,title,subtitle,backLabel,backHint,onExit,labels={}}) {
  const copy={versions:'身份与版本',ui:'界面',host:'服务端',unknown:'版本未知',node:'节点',mismatch:'版本不一致，请重新加载插件和界面',...labels};
  return h('header',{className:'lm-workbenchHeader'},
    WorkbenchReturnButton({h,onExit,label:backLabel,hint:backHint}),
    h('div',{className:'lm-brand'},h('strong',{className:'lm-brandTitle'},title),h('span',{className:'lm-brandSubtitle'},subtitle)),
    h('details',{className:'lm-versionDetails'},h('summary',null,copy.versions),
      h('div',{className:'lm-versionContent'},h('span',null,`${copy.ui} v${model.uiVersion}`),h('span',null,`${copy.host} ${model.hostVersion?`v${model.hostVersion}`:copy.unknown}`),
        model.nodeId?h('span',{className:'lm-nodeIdentity',title:model.nodeId},`${copy.node} · ${model.nodeId}`):null)),
    model.versionMismatch?h('div',{className:'lm-versionMismatch',role:'status'},copy.mismatch):null);
}
