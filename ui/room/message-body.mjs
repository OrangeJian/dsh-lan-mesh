/** Rendering only: original source always reaches the host Markdown component. */
export function MessageBody(props) {
 const {h,React}=props;
 const view=props.viewOf(props.text);
 const [expanded,setExpanded]=React.useState(false);
 const [copyState,setCopyState]=React.useState('idle');
 const lifetime=React.useRef({alive:true,pending:false});
 React.useEffect(()=>{lifetime.current.alive=true;return()=>{lifetime.current.alive=false;};},[]);
 React.useEffect(()=>{props.onLayoutChanged?.();},[expanded]);
 const copy=async()=>{
  if(lifetime.current.pending)return;
  lifetime.current.pending=true;setCopyState('copying');
  const result=await props.copySource(view.source,props.clipboard);
  lifetime.current.pending=false;if(lifetime.current.alive)setCopyState(result.status);
 };
 if(view.source==='')return null;
 const collapsed=view.collapsible&&!expanded;
 const feedback=copyState==='copied'?'已复制全文':copyState==='failed'?'复制失败，请重试':copyState==='unavailable'?'当前环境不支持复制，请手动选择正文':'';
 // Distinguish otherwise-identical action labels when many messages are on screen.
 // The component receives no author/time prop; bodyId is the stable per-message id
 // passed by the caller (lm-message-body-<encoded message id>).
 const context=props.bodyId?'（'+String(props.bodyId).replace(/^lm-message-body-/,'')+'）':'';
 return h('div',{className:'lm-messageBody'},
  collapsed?h('span',{className:'lm-messageSummary'},view.source.slice(0,180)+'…正文已折叠，展开全文阅读'):null,
  h('div',{id:props.bodyId,ref:node=>{if(node)node.inert=collapsed;},className:'lm-messageText'+(collapsed?' lm-messageTextCollapsed':'')+(view.codeOnly?' lm-messageCodePreview':'')},
   props.MarkdownText?h(props.MarkdownText,{text:view.source,labels:props.labels}):h('div',{className:'lm-bubblePlain'},view.source)),
  h('div',{className:'lm-messageBodyActions'},
   view.collapsible?h('button',{type:'button',className:'lm-messageExpand','aria-label':(expanded?'收起全文':'展开全文')+context,'aria-expanded':expanded,'aria-controls':props.bodyId,onClick:()=>setExpanded(value=>!value)},expanded?'收起全文':'展开全文'):null,
   h('button',{type:'button',className:'lm-messageCopy','aria-label':'复制全文'+context,disabled:copyState==='copying',onClick:copy},copyState==='copying'?'正在复制…':'复制全文'),
   feedback?h('span',{className:'lm-messageCopyState',role:'status','aria-live':'polite'},feedback):null));
}
