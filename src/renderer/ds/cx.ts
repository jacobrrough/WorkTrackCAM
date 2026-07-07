/**
 * Tiny className joiner used across the DS primitives — filters out falsy
 * values and joins with a space. Mirrors the `cx` helper in the upstream
 * @worktrack/design-system bundle so class output is identical.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
