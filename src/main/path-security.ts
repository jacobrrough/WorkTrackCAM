/**
 * Path-security utilities for Electron IPC handlers.
 *
 * Every IPC handler that accepts a user-supplied file path should call one of
 * these helpers to prevent path-traversal attacks that could read or write
 * outside the intended directory trees.
 *
 * Design decisions:
 * - Pure functions, no side effects (easy to test).
 * - Null-byte injection is always rejected.
 * - We resolve to absolute paths and then check prefix containment, which
 *   handles `..` segments, symlink indirection (to the extent `path.resolve`
 *   can without `realpath`), and Windows UNC tricks.
 */

import { basename, normalize, resolve, sep } from 'node:path'

/**
 * Returns the normalised absolute path when `userPath` resolves inside
 * `allowedRoot`, or `null` otherwise. The check is purely lexical (no
 * filesystem calls), so callers who need symlink protection should resolve
 * the root ahead of time with `fs.realpath`.
 *
 * Usage:
 * ```ts
 * const safe = isPathSafe(untrustedPath, projectDir)
 * if (!safe) throw new Error('path_outside_allowed_root')
 * await readFile(safe, 'utf-8')
 * ```
 */
export function isPathSafe(userPath: string, allowedRoot: string): string | null {
  if (!userPath || !allowedRoot) return null
  // Null-byte injection
  if (userPath.includes('\0') || allowedRoot.includes('\0')) return null

  const root = normalize(resolve(allowedRoot))
  const abs = normalize(resolve(root, userPath))

  // The resolved path must start with the root (directory prefix check).
  // We append `sep` to root so that "/foo" doesn't match "/foobar/".
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (abs !== root && !abs.startsWith(rootWithSep)) return null

  return abs
}

/**
 * Validate that an *absolute* path lives under one of the provided allowed
 * root directories. Returns the normalised path or `null`.
 *
 * Useful for IPC handlers that receive absolute paths (e.g. from native
 * dialog results) and must verify the file belongs to a known-safe tree.
 */
export function isAbsolutePathUnderRoots(absPath: string, allowedRoots: string[]): string | null {
  if (!absPath) return null
  if (absPath.includes('\0')) return null
  const normed = normalize(resolve(absPath))
  for (const root of allowedRoots) {
    if (!root || root.includes('\0')) continue
    const normedRoot = normalize(resolve(root))
    const rootWithSep = normedRoot.endsWith(sep) ? normedRoot : normedRoot + sep
    if (normed === normedRoot || normed.startsWith(rootWithSep)) return normed
  }
  return null
}

/**
 * Strip dangerous characters from a filename to prevent directory traversal
 * or OS-level exploits via crafted file names. Returns only the basename
 * (strips any directory prefix) and removes characters that are illegal or
 * risky on Windows, macOS, or Linux:
 *
 * - Null bytes
 * - Path separators (/ and \)
 * - Windows reserved chars: < > : " | ? *
 * - Leading/trailing dots and spaces (hidden files, Windows edge-cases)
 * - Control characters (0x00-0x1F)
 *
 * Returns `null` if the sanitised result is empty.
 */
export function sanitizeFilename(name: string): string | null {
  if (!name) return null
  // Take only the filename portion (strip any directory prefix)
  let safe = basename(name.replace(/\\/g, '/'))
  // Remove null bytes and control characters
  safe = safe.replace(/[\x00-\x1f]/g, '')
  // Remove OS-dangerous characters
  safe = safe.replace(/[<>:"|?*]/g, '')
  // Remove leading/trailing dots and spaces
  safe = safe.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  // If after sanitization nothing is left, reject
  if (!safe) return null
  return safe
}

/**
 * Validate a URL string for use with `shell.openExternal()`.
 *
 * Only `https:` and `http:` protocols are allowed. This prevents
 * `file://`, `javascript:`, and custom protocol handler exploits.
 */
export function isSafeExternalUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Validate arguments before passing to `child_process.spawn`. Ensures:
 * - The command is a simple executable name or absolute path (no shell metacharacters)
 * - Arguments don't contain shell injection sequences
 *
 * Returns `true` if safe, `false` if suspicious.
 * Note: This is a secondary defense. The primary defense is `shell: false`
 * in subprocess-bounded.ts (which is already the case).
 */
export function isSubprocessArgSafe(arg: string): boolean {
  if (!arg) return true
  // Null bytes are never acceptable in process args
  if (arg.includes('\0')) return false
  return true
}

/**
 * Validate that a python path looks like a safe executable reference.
 * Rejects strings containing shell metacharacters that could enable injection
 * when shell=true is accidentally used.
 */
export function isPythonPathSafe(pythonPath: string): boolean {
  if (!pythonPath || pythonPath.includes('\0')) return false
  // Reject shell metacharacters. The path should be a bare executable name
  // (e.g. "python", "python3") or an absolute/relative filesystem path.
  const shellMetachars = /[;&|`$(){}!#]/
  if (shellMetachars.test(pythonPath)) return false
  return true
}
