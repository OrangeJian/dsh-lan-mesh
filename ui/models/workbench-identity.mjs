/** Pure projection: identity and version are not evidence of connection health. */
export function workbenchIdentityView(self, uiVersion, hostVersion) {
  const value=x=>typeof x==='string'?x.trim():'';
  const ui=value(uiVersion),host=value(hostVersion);
  return { nodeId:value(self?.nodeId), name:value(self?.selfName)||value(self?.name), uiVersion:ui, hostVersion:host||null, versionMismatch:!!ui&&!!host&&ui!==host, connectionHealth:'unknown' };
}
