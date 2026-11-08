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
