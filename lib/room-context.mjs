/** Pure context builder. Inputs must already be authorized by the host; explicit
 * authorized:false and room mismatches are additionally excluded here. No IO. */
export const MAX_CONTEXT_DOCUMENTS = 8;
export const MAX_CONTEXT_MESSAGES = 20;
export const MAX_CONTEXT_BYTES = 64 * 1024;
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));
export function buildRoomContextPacket(input={}, limits={}) {
 const cap=(key,fallback)=>{const n=limits[key]??limits[{maxBytes:'MAX_CONTEXT_BYTES',maxDocuments:'MAX_CONTEXT_DOCUMENTS',maxMessages:'MAX_CONTEXT_MESSAGES'}[key]]??fallback;if(!Number.isSafeInteger(n)||n<0)throw new TypeError('Invalid context limit');return Math.min(n,fallback);};
 const maxBytes=cap('maxBytes',MAX_CONTEXT_BYTES),maxDocuments=cap('maxDocuments',MAX_CONTEXT_DOCUMENTS),maxMessages=cap('maxMessages',MAX_CONTEXT_MESSAGES);
 const p={roomId:input.roomId,taskId:input.taskId??null,generatedAt:input.generatedAt??null,selectedDocumentVersions:[],confirmedDecisions:[],openQuestions:[],referencedMessages:[],attachmentRefs:[],skillRefs:[],fetchRefs:[],truncated:false,limits:{maxBytes,maxDocuments,maxMessages}};
 const size=()=>Buffer.byteLength(JSON.stringify(p));
 if(size()>maxBytes)throw new RangeError('Context byte limit cannot hold packet metadata');
 const allowed=x=>x&&x.authorized!==false&&(!x.roomId||x.roomId===input.roomId);
 const selected=(items,ids,key)=> (items??[]).filter(allowed).filter(x=>!ids||ids.includes(x[key]));
 const add=(key,row)=>{p[key].push(row);if(size()>maxBytes){p[key].pop();p.truncated=true;return false;}return true;};
 const docs=selected(input.documents??input.selectedDocumentVersions,input.documentIds,'documentId');
 if(docs.length>maxDocuments)p.truncated=true;
 for(const d of docs.slice(0,maxDocuments)){
  if(!d.documentId||!d.revisionId||!d.contentHash)throw new TypeError('Document context requires documentId, revisionId and contentHash');
  const ref=pick(d,['documentId','revisionId','contentHash']);
  if(!add('fetchRefs',{...ref,roomId:input.roomId,tool:'lan_mesh_document_read'}))continue;
  const row={...ref,title:String(d.title??''),content:String(d.content??''),truncated:false};
  p.selectedDocumentVersions.push(row);
  if(size()>maxBytes){row.truncated=true;p.truncated=true;const chars=Array.from(row.content);let lo=0,hi=chars.length;while(lo<hi){const mid=Math.ceil((lo+hi)/2);row.content=chars.slice(0,mid).join('');if(size()<=maxBytes)lo=mid;else hi=mid-1;}row.content=chars.slice(0,lo).join('');if(size()>maxBytes)p.selectedDocumentVersions.pop();}
  for(const key of ['confirmedDecisions','openQuestions'])for(const mark of d[key]??[])if(typeof mark.text==='string'&&mark.block!==undefined)add(key,{documentId:d.documentId,revisionId:d.revisionId,block:mark.block,text:mark.text});
 }
 const groups=[['referencedMessages',input.referencedMessages??input.messages,input.messageIds,'id',['id','from','text','at'],maxMessages],['attachmentRefs',input.attachmentRefs??input.attachments,input.attachmentIds,'id',['id','name','size','mediaType','available'],100],['skillRefs',input.skillRefs??input.skills,input.skillNames,'name',['name','sourceNodeId','sourceNodeName'],100]];
 for(const [key,items,ids,idKey,keys,max] of groups){const rows=selected(items,ids,idKey);if(rows.length>max)p.truncated=true;for(const row of rows.slice(0,max))add(key,pick(row,keys));}
 return p;
}
