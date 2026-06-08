/**
 * Normalize a user-entered Moonraker / 3D-printer base URL.
 *
 * Operators naturally type a bare IP or hostname ("192.168.1.50",
 * "k2plus.local", "192.168.1.50:7125"), but `new URL()` — used by every
 * Moonraker HTTP call (src/main/moonraker-push.ts) and the e-stop dispatch
 * (src/main/ipc-machine.ts) — THROWS without a scheme, which surfaces to the
 * operator as "invalid_moonraker_url" / an invalid-URL error.
 *
 * Like Fluidd / Mainsail / OctoPrint, we default a scheme-less host to
 * `http://` (Moonraker speaks plain HTTP on the LAN; the K2 Plus is no
 * exception). A value that already carries a scheme (`http://`, `https://`,
 * and even a wrong one like `file://`) is left untouched so genuine
 * mistakes still fail the downstream protocol check rather than being
 * silently "fixed".
 *
 * - Empty / whitespace-only input returns '' (callers treat that as "unset").
 * - Trailing slashes are stripped so callers can append `/printer/...`
 *   without producing a double slash.
 *
 * Pure string transform — no I/O, safe in the renderer and the main process.
 */
export function normalizeMoonrakerUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '') return ''
  // A real scheme is `<letter><letter|digit|+|-|.>* "://"`. A bare `host:port`
  // (single colon, no `//`) deliberately does NOT match, so it is treated as
  // scheme-less and gets the http:// default.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  const withScheme = hasScheme ? trimmed : `http://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}
