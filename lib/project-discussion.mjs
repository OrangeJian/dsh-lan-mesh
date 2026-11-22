// The topic reference is carried in the signed, persisted message text so it
// survives Room history, attachment replication and mixed-version transport.
export function projectMessage(text) {
  const value = typeof text === 'string' ? text : '';
  const match = /^\[LAN (discussion|reply|task) ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\]\n/.exec(value);
  return match ? {kind:match[1], id:match[2], text:value.slice(match[0].length)} : {kind:'chat',id:'',text:value};
}

export function projectMessageText(kind,id,text) {
  const value = '[LAN '+kind+' '+id+']\n'+text;
  if (projectMessage(value).kind !== kind || !['discussion','reply','task'].includes(kind)) throw Error('无效的项目消息标记');
  return value;
}
