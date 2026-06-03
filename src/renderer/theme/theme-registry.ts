/**
 * Single source of truth for the WorkTrack3D theme set.
 *
 * Each id matches a `[data-theme='<id>']` block in `styles/themes.css` and a
 * `themes/<id>` palette in the 10 UI mockups (`docs/ui-mockups/index.html`).
 * Consumed by the Settings theme picker, the `useTheme` hook, and the project
 * schema (which widens its `theme` enum to accept these ids).
 */

export const THEME_IDS = [
  'graphite',
  'blueprint',
  'machinist',
  'carbon',
  'titanium',
  'neon',
  'slate',
  'precision',
  'hud',
  'heritage'
] as const

export type ThemeId = (typeof THEME_IDS)[number]

export interface ThemeMeta {
  id: ThemeId
  label: string
  mode: 'dark' | 'light'
  blurb: string
}

export const THEMES: readonly ThemeMeta[] = [
  { id: 'graphite', label: 'Graphite Pro', mode: 'dark', blurb: 'Neutral dark graphite, electric-blue accent' },
  { id: 'blueprint', label: 'Blueprint', mode: 'dark', blurb: 'Navy drafting world, cyan linework' },
  { id: 'machinist', label: 'Machinist Light', mode: 'light', blurb: 'Bright steel daylight, safety-orange accent' },
  { id: 'carbon', label: 'Carbon & Amber', mode: 'dark', blurb: 'Near-black carbon, warm amber accent' },
  { id: 'titanium', label: 'Titanium', mode: 'dark', blurb: 'Cool brushed-metal greys, steel-blue accent' },
  { id: 'neon', label: 'Neon Shop', mode: 'dark', blurb: 'Dark glass, neon cyan glow' },
  { id: 'slate', label: 'Workshop Slate', mode: 'dark', blurb: 'Warm slate, cream text, muted teal' },
  { id: 'precision', label: 'Precision White', mode: 'light', blurb: 'Ultra-minimal flat white, blue accent' },
  { id: 'hud', label: 'HUD / Tactical', mode: 'dark', blurb: 'Terminal-green on black, monospace' },
  { id: 'heritage', label: 'Heritage Machinist', mode: 'dark', blurb: 'Retro machine-green, brass accent' }
]

/** Default brand theme (the `:root` block in themes.css matches this). */
export const DEFAULT_THEME: ThemeId = 'titanium'

const THEME_ID_SET: ReadonlySet<string> = new Set(THEME_IDS)

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_ID_SET.has(value)
}
