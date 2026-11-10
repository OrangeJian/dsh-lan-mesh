/** Versioned context metadata is signed independently of legacy room references. */
export const CONTEXT_SELECTION_SCHEMA={type:'object',additionalProperties:false,properties:{
 selectedDocumentVersions:{type:'array',items:{type:'object',additionalProperties:false,required:['documentId','revisionId','contentHash'],properties:{documentId:{type:'string'},revisionId:{type:'string'},contentHash:{type:'string'}}}},
 documentIds:{type:'array',items:{type:'string'}},messageIds:{type:'array',items:{type:'string'}},attachmentIds:{type:'array',items:{type:'string'}},skillNames:{type:'array',items:{type:'string'}}
}};
export function normalizeContextPacket(packet,roomId) {
 if(!packet||typeof packet!=='object'||Array.isArray(packet)||packet.roomId!==roomId)throw Error('Invalid context room');
 const raw=JSON.stringify(packet);
 if(Buffer.byteLength(raw)>64*1024)throw Error('Context packet too large');
 if(!Array.isArray(packet.selectedDocumentVersions)||packet.selectedDocumentVersions.length>8)throw Error('Invalid context documents');
 for(const item of packet.selectedDocumentVersions){
  if(!/^doc-[a-z0-9]{12}$/.test(item.documentId)||!/^rev-[a-z0-9]{12}$/.test(item.revisionId)||!/^[a-f0-9]{64}$/.test(item.contentHash)||typeof item.content!=='string')throw Error('Invalid pinned context version');
 }
 return JSON.parse(raw);
}
