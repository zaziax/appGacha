/** Pure classification shared by cold and second-instance launches. */
export function eggLaunchId(argv: string[]): string | null {
  const raw = argv.find(arg => arg.startsWith('appgacha://'))
  if (!raw) return null
  // Match the raw argument before URL normalization can hide path traversal.
  const match = raw.match(/^appgacha:\/\/egg\/([a-z0-9-]+)\/?$/i)
  return match ? match[1].toLowerCase() : null
}
