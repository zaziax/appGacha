// Shared exclusion without coupling the internal pipeline to the MCP transport.
let externalBuildActive = false
export function setExternalBuildActive(active: boolean): void { externalBuildActive = active }
export function hasExternalBuildActivity(): boolean { return externalBuildActive }
