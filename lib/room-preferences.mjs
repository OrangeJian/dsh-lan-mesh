/** Human-local settings, never part of the replicated room document. */
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
const defaults = () => ({pinned:false, muted:false, muteAtException:true});
function validate(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('preference patch must be an object');
  for (const [key,value] of Object.entries(patch)) {
    if (!Object.hasOwn(defaults(),key)) throw new Error(`unknown preference field: ${key}`);
    if (typeof value !== 'boolean') throw new Error(`${key} must be boolean`);
  }
}
export class RoomPreferences {
  constructor(file) { this.file=file; this.rooms=Object.create(null); this.queue=Promise.resolve(); }
  load() {
    return this.loading ??= (async()=>{
      let raw;
      try { raw=JSON.parse(await readFile(this.file,'utf8')); }
      catch(error) { if(error.code==='ENOENT')return; throw error; }
      if(raw?.version!==1 || !raw.rooms || typeof raw.rooms!=='object' || Array.isArray(raw.rooms))throw new Error('invalid room preferences');
      const rooms=Object.create(null);
      for(const [id,patch] of Object.entries(raw.rooms)){validate(patch);rooms[id]={...defaults(),...patch};}
      this.rooms=rooms;
    })();
  }
  get(id){return {...defaults(),...this.rooms[id]};}
  update(id,patch){
    const task=this.queue.then(async()=>{
      validate(patch);
      if(typeof id!=='string'||!id||id.length>128)throw new Error('invalid roomId');
      await this.load();
      const rooms=Object.assign(Object.create(null),this.rooms,{[id]:{...this.get(id),...patch}});
      const temp=`${this.file}.${randomUUID()}.tmp`;
      await mkdir(dirname(this.file),{recursive:true,mode:0o700});
      try{
        const handle=await open(temp,'wx',0o600);
        try{await handle.writeFile(JSON.stringify({version:1,rooms})+'\n');await handle.sync();}finally{await handle.close();}
        await rename(temp,this.file);
      }finally{await unlink(temp).catch(()=>{});}
      this.rooms=rooms;
      return this.get(id);
    });
    this.queue=task.catch(()=>{});
    return task;
  }
}
