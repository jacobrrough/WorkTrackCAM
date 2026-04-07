import { describe, expect, it } from 'vitest'
import { toFriendlyError, formatErrorForToast } from './error-messages'

describe('error-messages', () => {
  describe('toFriendlyError', () => {
    it('returns null for empty / falsy input', () => {
      expect(toFriendlyError('')).toBeNull()
      expect(toFriendlyError(null as unknown as string)).toBeNull()
      expect(toFriendlyError(undefined as unknown as string)).toBeNull()
    })

    it('returns null when no pattern matches', () => {
      expect(toFriendlyError('something totally unrelated 12345')).toBeNull()
    })

    // ── Tool / geometry ─────────────────────────────────────────────────────
    it('matches tool diameter exceeds pocket width', () => {
      const r = toFriendlyError('Tool diameter (12mm) exceeds pocket width (10mm)')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/tool.*large.*pocket/i)
      expect(r!.suggestion).toMatch(/smaller/i)
    })

    it('matches generic tool diameter exceed', () => {
      const r = toFriendlyError('tool diameter exceeds feature')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/tool diameter/i)
    })

    it('matches stepover exceeds', () => {
      const r = toFriendlyError('Stepover (8mm) exceeds tool diameter (6mm)')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/stepover/i)
    })

    it('matches depth exceeds safe limit', () => {
      const r = toFriendlyError('depth of cut too deep for this tool')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/depth/i)
    })

    // ── Python engine ───────────────────────────────────────────────────────
    it('matches python not found', () => {
      const r = toFriendlyError('Python not found on PATH')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/python.*not found/i)
      expect(r!.suggestion).toMatch(/install.*python/i)
    })

    it('matches ENOENT python', () => {
      const r = toFriendlyError('ENOENT: spawn python3 failed')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/python.*not found/i)
    })

    it('matches ModuleNotFoundError', () => {
      const r = toFriendlyError("ModuleNotFoundError: No module named 'numpy'")
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/missing.*python.*depend/i)
      expect(r!.suggestion).toMatch(/pip.*install/i)
    })

    it('matches python crash', () => {
      const r = toFriendlyError('python process crashed with signal SIGSEGV')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/python.*crash/i)
    })

    it('matches engine timeout', () => {
      const r = toFriendlyError('CAM engine timeout after 300s')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/timed out/i)
    })

    // ── File I/O ────────────────────────────────────────────────────────────
    it('matches corrupt STL', () => {
      const r = toFriendlyError('STL file corrupt: unexpected EOF at byte 1024')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/stl.*corrupt/i)
      expect(r!.suggestion).toMatch(/re-export/i)
    })

    it('matches STEP parse failure', () => {
      const r = toFriendlyError('STEP file invalid: unable to parse entity')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/step/i)
    })

    it('matches ENOENT file not found', () => {
      const r = toFriendlyError('ENOENT: no such file or directory')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/file not found/i)
    })

    it('matches permission denied', () => {
      const r = toFriendlyError('EACCES: permission denied, open /tmp/out.gcode')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/permission denied/i)
    })

    it('matches disk full', () => {
      const r = toFriendlyError('ENOSPC: no space left on device')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/disk full/i)
    })

    // ── Printer / network ───────────────────────────────────────────────────
    it('matches printer connection failure', () => {
      const r = toFriendlyError('ECONNREFUSED: connect to moonraker failed')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/printer.*connection/i)
    })

    it('matches network timeout', () => {
      const r = toFriendlyError('ETIMEDOUT: request timed out')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/network timeout/i)
    })

    // ── CuraEngine ──────────────────────────────────────────────────────────
    it('matches CuraEngine not found', () => {
      const r = toFriendlyError('ENOENT: CuraEngine not found')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/curaengine not found/i)
    })

    it('matches cura crash', () => {
      const r = toFriendlyError('CuraEngine error: slice failed')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/slicer failed/i)
    })

    // ── Stock ───────────────────────────────────────────────────────────────
    it('matches model outside stock', () => {
      const r = toFriendlyError('Model extends outside stock bounding box')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/model.*exceed.*stock/i)
    })

    // ── JSON ────────────────────────────────────────────────────────────────
    it('matches invalid JSON', () => {
      const r = toFriendlyError('Unexpected token } in JSON at position 42')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/invalid json/i)
    })

    it('matches invalid session file', () => {
      const r = toFriendlyError('Invalid session file: missing jobs array')
      expect(r).not.toBeNull()
      expect(r!.title).toMatch(/invalid project file/i)
    })
  })

  describe('formatErrorForToast', () => {
    it('returns friendly title + suggestion when pattern matches', () => {
      const msg = formatErrorForToast('Python not found on PATH')
      expect(msg).toMatch(/python engine not found/i)
      expect(msg).toContain('\u2014') // em dash separator
    })

    it('returns raw error (truncated) when no pattern matches', () => {
      const msg = formatErrorForToast('random stuff happened')
      expect(msg).toBe('random stuff happened')
    })

    it('prepends fallbackPrefix when no pattern matches', () => {
      const msg = formatErrorForToast('random stuff happened', 'Generate failed')
      expect(msg).toBe('Generate failed: random stuff happened')
    })

    it('does NOT prepend fallbackPrefix when a pattern matches', () => {
      const msg = formatErrorForToast('Python not found', 'Generate failed')
      expect(msg).not.toContain('Generate failed')
      expect(msg).toMatch(/python engine not found/i)
    })

    it('truncates very long raw errors', () => {
      const long = 'x'.repeat(300)
      const msg = formatErrorForToast(long)
      expect(msg.length).toBeLessThan(210)
      expect(msg).toContain('\u2026') // ellipsis
    })
  })
})
