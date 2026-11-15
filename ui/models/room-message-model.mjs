/** Display-only rows. Exact author identities and transcript order remain authoritative. */
export function roomMessageRows(messages, { self = {}, members = [], peers = [] } = {}) {
  const rows=Array.isArray(messages)?messages:[];
  const text=value=>typeof value==='string'?value.trim():'';
  const stamp=message=>message?.at??message?.receivedAt??message?.sentAt??'';
  const identity=message=>{const from=message?.from;return text(from?.nodeId)&&text(from?.sessionId)?JSON.stringify([from.nodeId,from.sessionId]):null;};
  const boundary=message=>message?.kind!=='room-message'||['skillRefs','documentRefs','structuredMentions','mentions','attachments'].some(key=>Array.isArray(message?.[key])&&message[key].length>0)||!!message?.file||!!message?.contextSelection||!!message?.contextPack;
  return rows.map((message,index)=>{
    const previous=rows[index-1];const timestamp=stamp(message),before=stamp(previous);
    const time=typeof timestamp==='string'&&timestamp!==''?Date.parse(timestamp):NaN;
    const prior=typeof before==='string'&&before!==''?Date.parse(before):NaN;
    const sameDay=Number.isFinite(time)&&Number.isFinite(prior)&&new Date(time).toDateString()===new Date(prior).toDateString();
    const continuation=!!previous&&identity(message)!==null&&identity(message)===identity(previous)&&!boundary(message)&&!boundary(previous)&&sameDay&&time>=prior&&time-prior<=180000;
    const nodeId=text(message?.from?.nodeId),sessionId=text(message?.from?.sessionId);
    const member=members.find(row=>row.nodeId===nodeId&&row.sessionId===sessionId);
    const peer=peers.find(row=>row.nodeId===nodeId);
    const deviceName=nodeId&&nodeId===self.nodeId?text(self.name):text(member?.nodeName)||text(peer?.name);
    return {message,continuation,timestamp:typeof timestamp==='string'?timestamp:'',kind:sessionId==='human'?'human':sessionId?'agent':'system',nodeId,sessionId,deviceLabel:nodeId?(deviceName?deviceName+' · '+nodeId:nodeId):'来源设备未知'};
  });
}
