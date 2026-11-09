/** Bounded descriptive references. Labels and skill sources never grant authority. */
export function normalizeRoomMessageMetadata({ mentions, skillRefs } = {}, room) {
  const result = {};
  const bounded = (value, max, field) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) throw new Error(`invalid room metadata ${field}`);
    return value;
  };
  const list = (value, max, field) => {
    if (!Array.isArray(value) || value.length > max) throw new Error(`invalid room metadata ${field}`);
  };
  if (mentions !== undefined) {
    list(mentions, 64, 'mentions');
    const seen = new Set();
    result.mentions = [];
    for (const entry of mentions) {
      const memberKey = bounded(entry?.memberKey, 129, 'memberKey');
      const label = bounded(entry?.label, 256, 'mention label');
      if (room && !room.members?.some((member) => member.key === memberKey)) throw new Error('mention member is not in this room');
      if (!seen.has(memberKey)) result.mentions.push({ memberKey, label });
      seen.add(memberKey);
    }
  }
  if (skillRefs !== undefined) {
    list(skillRefs, 32, 'skillRefs');
    const seen = new Set();
    result.skillRefs = [];
    for (const entry of skillRefs) {
      const name = bounded(entry?.name, 128, 'skill name');
      const sourceNodeId = bounded(entry?.sourceNodeId, 64, 'skill sourceNodeId');
      const sourceNodeName = bounded(entry?.sourceNodeName, 128, 'skill sourceNodeName');
      const key = JSON.stringify([sourceNodeId, name]);
      if (!seen.has(key)) result.skillRefs.push({ name, sourceNodeId, sourceNodeName });
      seen.add(key);
    }
  }
  return result;
}

export const ROOM_ATTACHMENT_LIMITS = Object.freeze({ maxFileBytes:20*1024*1024, maxTotalBytes:200*1024*1024, maxAttachments:8, maxMessageBytes:40*1024*1024, orphanGraceMs:86400000 });

// Wire/storage validity is independent of deployment admission policy. A node
// may raise its limits, or lower them after previously accepting a reference.
export const ROOM_ATTACHMENT_WIRE_LIMITS = Object.freeze({maxAttachments:1024,maxFileBytes:Number.MAX_SAFE_INTEGER,maxMessageBytes:Number.MAX_SAFE_INTEGER});

export function normalizeRoomAttachments(value, limits = ROOM_ATTACHMENT_WIRE_LIMITS) {
  if (!Array.isArray(value) || !value.length || value.length > limits.maxAttachments) throw new Error('invalid attachment count');
  let total=0;
  return value.map(ref=>{
    if (!ref || !/^[a-f0-9]{64}$/.test(ref.blobId) || typeof ref.name!=='string' || !ref.name || Buffer.byteLength(ref.name)>255 || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(ref.name) || /^[. ]|[. ]$/.test(ref.name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(ref.name)) throw new Error('invalid attachment reference name/digest');
    if (typeof ref.mediaType!=='string' || ref.mediaType.length>256 || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:;[\x20-\x7e]+)?$/.test(ref.mediaType)) throw new Error('invalid attachment media type');
    if (!Number.isSafeInteger(ref.size) || ref.size<0 || ref.size>limits.maxFileBytes || !Number.isSafeInteger(total+=ref.size) || total>limits.maxMessageBytes) throw new Error('attachment size exceeds limit');
    if (typeof ref.ownerNodeId!=='string' || !ref.ownerNodeId || ref.ownerNodeId.length>64) throw new Error('invalid attachment owner');
    return {blobId:ref.blobId,name:ref.name,mediaType:ref.mediaType,size:ref.size,ownerNodeId:ref.ownerNodeId};
  });
}
