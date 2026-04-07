/**
 * User-friendly error message mapping.
 *
 * Maps raw technical errors (from the Python CAM engine, file I/O, etc.)
 * to actionable messages that tell the user *what went wrong* and *what to do*.
 */

export interface FriendlyErrorResult {
  title: string
  suggestion: string
}

interface ErrorPattern {
  /** Regex or plain substring to match against the raw error string. */
  test: RegExp
  /** Short title shown in the toast / banner. */
  title: string
  /** Actionable next-step the user can take. */
  suggestion: string
}

/**
 * Ordered list of patterns — first match wins.
 * More specific patterns go first so they aren't shadowed by broad ones.
 */
const ERROR_PATTERNS: ErrorPattern[] = [
  // ── Tool / geometry conflicts ───────────────────────────────────────────────
  {
    test: /tool\s*diameter.*exceeds.*(?:pocket|slot|width)/i,
    title: 'Tool too large for pocket',
    suggestion: 'Use a smaller endmill or widen the pocket geometry.',
  },
  {
    test: /tool\s*diameter.*exceed/i,
    title: 'Tool diameter exceeds feature size',
    suggestion: 'Select a smaller tool or adjust the feature dimensions.',
  },
  {
    test: /stepover.*(?:exceed|greater|larger)/i,
    title: 'Stepover exceeds tool diameter',
    suggestion: 'Reduce stepover to less than 100% of the tool diameter.',
  },
  {
    test: /depth.*(?:exceed|greater|too\s*deep)/i,
    title: 'Cut depth exceeds safe limit',
    suggestion: 'Reduce depth of cut or increase the number of passes.',
  },

  // ── Python engine ───────────────────────────────────────────────────────────
  {
    test: /python.*not\s*found|ENOENT.*python|no\s*python/i,
    title: 'Python engine not found',
    suggestion: 'Install Python 3.8+ and ensure it is on your PATH, or set the path in Settings.',
  },
  {
    test: /pip.*install|ModuleNotFoundError|No module named/i,
    title: 'Missing Python dependency',
    suggestion: 'Run "pip install -r requirements.txt" in the engines/cam directory.',
  },
  {
    test: /python.*(?:crash|exit|signal|killed|terminated)/i,
    title: 'Python engine crashed',
    suggestion: 'Check the output log for details. Try regenerating or restarting the app.',
  },
  {
    test: /(?:engine|cam)\s*timeout/i,
    title: 'CAM engine timed out',
    suggestion: 'The operation took too long. Try simplifying the model or reducing resolution.',
  },

  // ── CuraEngine / FDM (before generic file I/O so "ENOENT.*cura" isn't shadowed) ─
  {
    test: /cura.*not\s*found|ENOENT.*cura/i,
    title: 'CuraEngine not found',
    suggestion: 'Set the CuraEngine path in Settings, or install CuraEngine.',
  },
  {
    test: /cura.*(?:crash|fail|error)/i,
    title: 'Slicer failed',
    suggestion: 'Check the output log. The model may have non-manifold geometry — try mesh repair.',
  },

  // ── File I/O ────────────────────────────────────────────────────────────────
  {
    test: /(?:stl|mesh).*(?:corrupt|invalid|malformed|parse\s*error|unexpected\s*eof)/i,
    title: 'STL file appears corrupt',
    suggestion: 'Try re-exporting from your CAD software. Ensure the file is a valid binary or ASCII STL.',
  },
  {
    test: /(?:step|stp).*(?:corrupt|invalid|parse)/i,
    title: 'STEP file could not be read',
    suggestion: 'Re-export as STEP AP214 from your CAD software, or convert to STL first.',
  },
  {
    test: /(?:gcode|\.nc|\.ngc).*(?:corrupt|invalid|empty)/i,
    title: 'G-code file is invalid',
    suggestion: 'The file may be truncated or in an unsupported dialect. Try regenerating.',
  },
  {
    test: /ENOENT|no such file|file not found|cannot\s*find/i,
    title: 'File not found',
    suggestion: 'The file may have been moved or deleted. Browse for it again.',
  },
  {
    test: /EACCES|permission denied/i,
    title: 'Permission denied',
    suggestion: 'The file or folder is read-only. Check file permissions or save to a different location.',
  },
  {
    test: /ENOSPC|disk.*full|no\s*space/i,
    title: 'Disk full',
    suggestion: 'Free up disk space and try again.',
  },

  // ── Network / printer ───────────────────────────────────────────────────────
  {
    test: /moonraker|printer.*(?:offline|unreachable)|ECONNREFUSED/i,
    title: 'Printer connection failed',
    suggestion: 'Check that the printer is powered on and the URL is correct.',
  },
  {
    test: /ETIMEDOUT|network.*timeout|request\s*timeout/i,
    title: 'Network timeout',
    suggestion: 'Check your network connection and try again.',
  },

  // ── Stock / setup ───────────────────────────────────────────────────────────
  {
    test: /model.*(?:outside|exceed|larger).*stock/i,
    title: 'Model exceeds stock dimensions',
    suggestion: 'Increase stock size or scale the model down. Use Auto-fit (F) in the viewport.',
  },
  {
    test: /no\s*(?:model|stl|mesh)\s*loaded/i,
    title: 'No model loaded',
    suggestion: 'Import an STL file by dropping it onto the viewport or using File > Open.',
  },
  {
    test: /no\s*(?:machine|operations?)\s*(?:selected|configured)/i,
    title: 'Setup incomplete',
    suggestion: 'Select a machine and add at least one operation before generating.',
  },

  // ── JSON / project ──────────────────────────────────────────────────────────
  {
    test: /invalid\s*json|unexpected\s*token.*json|JSON\.parse/i,
    title: 'Invalid JSON',
    suggestion: 'The file is not valid JSON. It may have been edited incorrectly.',
  },
  {
    test: /invalid\s*(?:session|project)\s*file/i,
    title: 'Invalid project file',
    suggestion: 'The file format is not recognized. Ensure it was saved by WorkTrackCAM.',
  },
]

/**
 * Map a raw error string to a user-friendly title + suggestion.
 * Returns `null` when no pattern matches (caller can fall back to the raw message).
 */
export function toFriendlyError(rawError: string): FriendlyErrorResult | null {
  if (!rawError || typeof rawError !== 'string') return null
  for (const p of ERROR_PATTERNS) {
    if (p.test.test(rawError)) {
      return { title: p.title, suggestion: p.suggestion }
    }
  }
  return null
}

/**
 * Format an error for the toast system.
 * Returns a single-line message: "Title -- Suggestion" if a pattern matches,
 * otherwise returns the raw error truncated to a reasonable length.
 */
export function formatErrorForToast(rawError: string, fallbackPrefix?: string): string {
  const friendly = toFriendlyError(rawError)
  if (friendly) {
    return `${friendly.title} \u2014 ${friendly.suggestion}`
  }
  const MAX = 200
  const trimmed = rawError.length > MAX ? `${rawError.slice(0, MAX)}\u2026` : rawError
  return fallbackPrefix ? `${fallbackPrefix}: ${trimmed}` : trimmed
}
