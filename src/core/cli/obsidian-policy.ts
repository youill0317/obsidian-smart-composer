// Only documented read-only forms are eligible; new flags require approval.
const readParameters: Record<string, string[]> = {
  files: ['folder', 'ext', 'total'],
  folders: ['folder', 'total'],
  file: ['path', 'file'],
  read: ['path', 'file'],
  search: ['query', 'path', 'limit', 'format', 'total', 'case'],
  'search:context': ['query', 'path', 'limit', 'format', 'case'],
  tags: ['path', 'file', 'sort', 'total', 'counts', 'format'],
  properties: ['path', 'file', 'name', 'sort', 'format', 'total', 'counts'],
  'property:read': ['path', 'file', 'name'],
  links: ['path', 'file', 'total'],
  backlinks: ['path', 'file', 'counts', 'total', 'format'],
  unresolved: ['total', 'counts', 'verbose', 'format'],
  outline: ['path', 'file', 'format', 'total'],
}
const flags = new Set(['total', 'case', 'counts', 'verbose'])
const targeted = new Set([
  'file',
  'read',
  'property:read',
  'links',
  'backlinks',
  'outline',
])

export function isObsidianReadOnly(args: string[], stdin?: string): boolean {
  if (stdin !== undefined) return false
  const [command, ...parameters] = args
  if (command === 'help')
    return (
      parameters.length <= 1 &&
      parameters.every((p) => /^[a-z][a-z:-]*$/.test(p))
    )
  if (command === 'version') return parameters.length === 0
  if (command === 'vault')
    return parameters.length === 1 && parameters[0] === 'info=path'
  const allowed = readParameters[command]
  if (!allowed) return false
  const seen = new Set<string>()
  for (const parameter of parameters) {
    const equals = parameter.indexOf('=')
    const key = equals < 0 ? parameter : parameter.slice(0, equals)
    const value = equals < 0 ? undefined : parameter.slice(equals + 1)
    if (!allowed.includes(key) || seen.has(key)) return false
    if (flags.has(key) ? value !== undefined : !value) return false
    seen.add(key)
  }
  if (seen.has('path') && seen.has('file') && command !== 'search') return false
  if (targeted.has(command) && !seen.has('path') && !seen.has('file'))
    return false
  if (command.startsWith('search') && !seen.has('query')) return false
  if (command === 'property:read' && !seen.has('name')) return false
  return true
}
