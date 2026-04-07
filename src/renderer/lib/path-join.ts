/** Cross-platform path join without Node `path` in renderer. */
export function joinPath(base: string, segment: string): string {
  const a = base.replace(/[/\\]+$/, '')
  const b = segment.replace(/^[/\\]+/, '')
  const sep = a.includes('\\') ? '\\' : '/'
  return `${a}${sep}${b}`
}
