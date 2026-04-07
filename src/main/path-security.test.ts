import { describe, expect, it } from 'vitest'
import {
  isPathSafe,
  isAbsolutePathUnderRoots,
  sanitizeFilename,
  isSafeExternalUrl,
  isSubprocessArgSafe,
  isPythonPathSafe
} from './path-security'
import { sep } from 'node:path'

// ── isPathSafe ─────────────────────────────────────────────────────────────

describe('isPathSafe', () => {
  const root = process.platform === 'win32' ? 'C:\\Projects\\MyProject' : '/projects/my-project'

  it('allows a plain filename inside the root', () => {
    const r = isPathSafe('model.stl', root)
    expect(r).not.toBeNull()
    expect(r!.startsWith(root)).toBe(true)
  })

  it('allows nested subdirectories', () => {
    const r = isPathSafe('assets/meshes/part.stl', root)
    expect(r).not.toBeNull()
    expect(r!.startsWith(root)).toBe(true)
  })

  it('rejects path traversal with ..', () => {
    expect(isPathSafe('../../../etc/passwd', root)).toBeNull()
  })

  it('rejects path traversal with encoded ..', () => {
    expect(isPathSafe('assets/../../secret.json', root)).toBeNull()
  })

  it('rejects null bytes', () => {
    expect(isPathSafe('model.stl\0.exe', root)).toBeNull()
  })

  it('rejects null bytes in root', () => {
    expect(isPathSafe('model.stl', root + '\0evil')).toBeNull()
  })

  it('rejects empty userPath', () => {
    expect(isPathSafe('', root)).toBeNull()
  })

  it('rejects empty root', () => {
    expect(isPathSafe('test.stl', '')).toBeNull()
  })

  it('allows the root itself (exact match)', () => {
    // resolve('.') relative to root = root
    const r = isPathSafe('.', root)
    expect(r).not.toBeNull()
  })

  it('rejects a sibling directory with a similar prefix', () => {
    // /projects/my-project-evil should not match /projects/my-project
    const evil = process.platform === 'win32'
      ? 'C:\\Projects\\MyProject-evil\\file.txt'
      : '/projects/my-project-evil/file.txt'
    // Use an absolute path as the user path to test prefix confusion
    expect(isPathSafe(evil, root)).toBeNull()
  })
})

// ── isAbsolutePathUnderRoots ───────────────────────────────────────────────

describe('isAbsolutePathUnderRoots', () => {
  const roots = process.platform === 'win32'
    ? ['C:\\Projects\\MyProject', 'C:\\Temp']
    : ['/projects/my-project', '/tmp']

  it('accepts a path under the first root', () => {
    const p = process.platform === 'win32'
      ? 'C:\\Projects\\MyProject\\assets\\model.stl'
      : '/projects/my-project/assets/model.stl'
    expect(isAbsolutePathUnderRoots(p, roots)).not.toBeNull()
  })

  it('accepts a path under the second root', () => {
    const p = process.platform === 'win32'
      ? 'C:\\Temp\\output.gcode'
      : '/tmp/output.gcode'
    expect(isAbsolutePathUnderRoots(p, roots)).not.toBeNull()
  })

  it('rejects a path not under any root', () => {
    const p = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\cmd.exe'
      : '/etc/passwd'
    expect(isAbsolutePathUnderRoots(p, roots)).toBeNull()
  })

  it('rejects null bytes', () => {
    const p = (process.platform === 'win32' ? 'C:\\Temp\\file\0.exe' : '/tmp/file\0.exe')
    expect(isAbsolutePathUnderRoots(p, roots)).toBeNull()
  })

  it('rejects empty path', () => {
    expect(isAbsolutePathUnderRoots('', roots)).toBeNull()
  })
})

// ── sanitizeFilename ───────────────────────────────────────────────────────

describe('sanitizeFilename', () => {
  it('returns a clean filename unchanged', () => {
    expect(sanitizeFilename('model.stl')).toBe('model.stl')
  })

  it('strips directory prefixes', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
  })

  it('strips Windows-style directory prefixes', () => {
    expect(sanitizeFilename('C:\\Users\\evil\\model.stl')).toBe('model.stl')
  })

  it('removes null bytes', () => {
    expect(sanitizeFilename('model\0.stl')).toBe('model.stl')
  })

  it('removes dangerous Windows characters', () => {
    expect(sanitizeFilename('file<>:"|?*.stl')).toBe('file.stl')
  })

  it('removes leading dots (hidden files)', () => {
    expect(sanitizeFilename('.hidden')).toBe('hidden')
  })

  it('removes leading and trailing dots/spaces', () => {
    expect(sanitizeFilename('...file...')).toBe('file')
  })

  it('returns null for empty input', () => {
    expect(sanitizeFilename('')).toBeNull()
  })

  it('returns null when all characters are stripped', () => {
    expect(sanitizeFilename('...')).toBeNull()
  })

  it('strips control characters', () => {
    expect(sanitizeFilename('file\x01\x02.stl')).toBe('file.stl')
  })
})

// ── isSafeExternalUrl ──────────────────────────────────────────────────────

describe('isSafeExternalUrl', () => {
  it('allows https URLs', () => {
    expect(isSafeExternalUrl('https://example.com/page')).toBe(true)
  })

  it('allows http URLs', () => {
    expect(isSafeExternalUrl('http://192.168.1.50:7125/')).toBe(true)
  })

  it('rejects javascript: protocol', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects file: protocol', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects data: protocol', () => {
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('rejects custom protocol', () => {
    expect(isSafeExternalUrl('myapp://internal/action')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isSafeExternalUrl('')).toBe(false)
  })

  it('rejects invalid URL', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false)
  })
})

// ── isSubprocessArgSafe ────────────────────────────────────────────────────

describe('isSubprocessArgSafe', () => {
  it('accepts normal arguments', () => {
    expect(isSubprocessArgSafe('--output=/tmp/file.gcode')).toBe(true)
  })

  it('accepts empty string', () => {
    expect(isSubprocessArgSafe('')).toBe(true)
  })

  it('rejects null bytes', () => {
    expect(isSubprocessArgSafe('file\0.stl')).toBe(false)
  })
})

// ── isPythonPathSafe ───────────────────────────────────────────────────────

describe('isPythonPathSafe', () => {
  it('accepts bare "python"', () => {
    expect(isPythonPathSafe('python')).toBe(true)
  })

  it('accepts bare "python3"', () => {
    expect(isPythonPathSafe('python3')).toBe(true)
  })

  it('accepts an absolute path', () => {
    const p = process.platform === 'win32'
      ? 'C:\\Python39\\python.exe'
      : '/usr/bin/python3'
    expect(isPythonPathSafe(p)).toBe(true)
  })

  it('rejects shell injection with semicolons', () => {
    expect(isPythonPathSafe('python; rm -rf /')).toBe(false)
  })

  it('rejects shell injection with pipe', () => {
    expect(isPythonPathSafe('python | cat /etc/passwd')).toBe(false)
  })

  it('rejects shell injection with backticks', () => {
    expect(isPythonPathSafe('`malicious`')).toBe(false)
  })

  it('rejects shell injection with $() command substitution', () => {
    expect(isPythonPathSafe('$(whoami)')).toBe(false)
  })

  it('rejects null bytes', () => {
    expect(isPythonPathSafe('python\0')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isPythonPathSafe('')).toBe(false)
  })

  it('rejects ampersand (background exec)', () => {
    expect(isPythonPathSafe('python & malicious')).toBe(false)
  })
})
