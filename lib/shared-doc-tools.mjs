/** Agent-only document tools; actor identity always comes from execute context. */
import {CONTEXT_SELECTION_SCHEMA} from './room-context-protocol.mjs';
export function sharedDocumentTools(node, callerId) {
 const fields={roomId:{type:'string'},documentId:{type:'string'},revisionId:{type:'string'},baseRevisionId:{type:'string'},content:{type:'string'},message:{type:'string'},proposalId:{type:'string'},cursor:{type:'string'},limit:{type:'integer'}};
 const definitions=[
  ['list','listDocuments',['roomId'],['roomId']],
  ['read','getDocument',['documentId'],['roomId','documentId','revisionId']],
  ['propose','submitDocumentProposal',['documentId','baseRevisionId','content','message','proposalId'],['documentId','baseRevisionId','content','message','proposalId']],
  ['history','listDocumentHistory',['documentId'],['roomId','documentId','cursor','limit']],
 ].map(([suffix,method,required,keys])=>({
  name:`lan_mesh_document_${suffix}`,description:`Shared Room documents: ${suffix}. Proposals do not grant human confirmation rights. Read a pinned revision before editing.`,
  parameters:{type:'object',additionalProperties:false,required,properties:Object.fromEntries(keys.map(key=>[key,fields[key]]))},
  output:{schema:{type:'object',additionalProperties:false,required:['summary'],properties:{summary:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.summary}]},
  async execute(args,exec){
   const sessionId=callerId(exec);
   if(!sessionId||sessionId==='human'||sessionId.includes('/'))throw Error('Document tools require the actual executing Agent');
   const value=await node.documentOperation(method,{...args,via:'tool',sessionId});
   const summary=JSON.stringify(value);
   if(Buffer.byteLength(summary)>512*1024)throw Error('Document output exceeds tool limit; request a smaller history page');
   return {summary};
  },
 }));
 definitions.push({name:'lan_mesh_room_context',description:'Build bounded project context from explicitly selected authorized documents/messages. Documents are pinned to exact revisions and hashes.',parameters:{type:'object',additionalProperties:false,required:['roomId','contextSelection'],properties:{roomId:fields.roomId,contextSelection:CONTEXT_SELECTION_SCHEMA}},output:{schema:{type:'object',additionalProperties:false,required:['summary'],properties:{summary:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.summary}]},async execute(args,exec){const sessionId=callerId(exec);if(!sessionId||sessionId==='human'||sessionId.includes('/'))throw Error('Context requires the actual executing Agent');await node.start();return {summary:JSON.stringify(await node.buildRoomContextPacket({room:args.roomId,sessionId,contextSelection:args.contextSelection}))};}});
 return definitions;
}
