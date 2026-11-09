import { Readable } from 'node:stream';
import { normalizeRoomAttachments } from './room-message.mjs';
const raster = /^(image\/(png|jpeg|gif|webp|avif|bmp))$/i;
/** Owner-only registry inherits Host cookie authentication; no caller identity is accepted. */
export function registerAttachmentGateway(connection, node) {
  return connection.fetch.register({path:'/api/lan-mesh/attachments', methods:['POST','GET'], requestBody:'streaming', fetch:async request=>{
    let stream;
    const abort=()=>stream?.destroy(new Error('Upload aborted'));
    try {
      if(request.signal.aborted) return new Response('Aborted',{status:499});
      await node.start();
      const url=new URL(request.url), room=url.searchParams.get('room'), blobId=url.searchParams.get('blobId');
      if(!room || room.length>256 || !/^[a-f0-9]{64}$/.test(blobId??'')) return new Response('Invalid room/digest',{status:400});
      if(request.method==='POST') {
        const raw=url.searchParams.get('size');
        const size=raw && /^\d+$/.test(raw)?Number(raw):NaN;
        const limits=node.snapshot().roomAttachmentLimits;
        if(!Number.isSafeInteger(size)||size<0) return new Response('Invalid size',{status:400});
        if(size>limits.maxFileBytes) return new Response('File too large',{status:413});
        const length=request.headers.get('content-length');
        if(length!==null && (!/^\d+$/.test(length)||Number(length)!==size)) return new Response('Size mismatch',{status:400});
        const ref={blobId,size,name:url.searchParams.get('name'),mediaType:request.headers.get('content-type')||'application/octet-stream',ownerNodeId:'owner'};
        try{normalizeRoomAttachments([ref]);}catch{return new Response('Invalid attachment metadata',{status:400});}
        if(!request.body) return new Response('Missing stream',{status:400});
        stream=Readable.fromWeb(request.body);
        // Admission may wait in the ledger queue before a consumer attaches.
        // Keep abort errors observed during that interval; iteration still rejects.
        stream.on('error',()=>{});
        request.signal.addEventListener('abort',abort,{once:true});
        if(request.signal.aborted) abort();
        const result=await node.uploadRoomAttachment({...ref,room,sessionId:'human',readable:stream});
        return Response.json(result,{headers:{'cache-control':'no-store'}});
      }
      if(request.method!=='GET')return new Response('Method not allowed',{status:405});
      const ref=await node.describeRoomAttachment({room,sessionId:'human',blobId});
      if(!ref)return new Response('Attachment unavailable in this Room',{status:403});
      const readable=await node.readRoomAttachment({room,blobId,sessionId:'human'});
      const disposition=url.searchParams.get('preview')==='1'&&raster.test(ref.mediaType)?'inline':'attachment';
      const encoded=encodeURIComponent(ref.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
      return new Response(Readable.toWeb(readable),{headers:{'content-type':ref.mediaType,'content-length':String(ref.size),'content-disposition':`${disposition}; filename="download"; filename*=UTF-8''${encoded}`,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
    } catch(error) {
      stream?.destroy();
      return Response.json({error:String(error?.message??error)},{status:request.signal.aborted?499:403,headers:{'cache-control':'no-store'}});
    } finally {request.signal.removeEventListener('abort',abort);}
  }});
}
