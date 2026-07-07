/**
 * Home-shell icon set — a strictly-typed React port of the inline SVG glyphs
 * from the `WorkTrack CAD - App` design prototype. Each glyph is a 24×24
 * `currentColor` stroke path (~1.7 stroke), so it inherits the surrounding
 * text/accent colour and re-themes with the app palette automatically.
 *
 * These live beside the Home shell rather than in the shared icon set because
 * they are the exact glyphs the handoff specifies for the 9-screen app surface.
 */
import type { ReactElement, SVGProps } from 'react'

export type HomeIconName =
  | 'brand'
  | 'home'
  | 'folder'
  | 'grid'
  | 'machine'
  | 'jobs'
  | 'bell'
  | 'users'
  | 'card'
  | 'gear'
  | 'search'
  | 'plus'
  | 'chevR'
  | 'chevDown'
  | 'dots'
  | 'logout'
  | 'cube'
  | 'check'
  | 'clock'
  | 'upload'
  | 'importI'
  | 'chat'
  | 'share'
  | 'bolt'

/** Inner path content for each glyph, keyed by {@link HomeIconName}. */
const PATHS: Record<HomeIconName, ReactElement> = {
  brand: (
    <>
      <path d="M12 2.6 20.8 7v10L12 21.4 3.2 17V7z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M3.4 7.1 12 11.6l8.6-4.5M12 11.6v9.4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </>
  ),
  home: (
    <path
      d="M3.2 11.3 12 4l8.8 7.3M5.6 9.6V19a1 1 0 0 0 1 1H17.4a1 1 0 0 0 1-1V9.6"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  folder: (
    <path
      d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
    </>
  ),
  machine: (
    <>
      <rect x="5.5" y="5.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M9.5 3v2.5M14.5 3v2.5M9.5 18.5V21M14.5 18.5V21M3 9.5h2.5M3 14.5h2.5M18.5 9.5H21M18.5 14.5H21"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </>
  ),
  jobs: (
    <>
      <path d="M8.5 6h11.5M8.5 12h11.5M8.5 18h11.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="4.2" cy="6" r="1.3" fill="currentColor" />
      <circle cx="4.2" cy="12" r="1.3" fill="currentColor" />
      <circle cx="4.2" cy="18" r="1.3" fill="currentColor" />
    </>
  ),
  bell: (
    <>
      <path
        d="M6 9.5a6 6 0 0 1 12 0c0 4.5 1.8 5.7 1.8 5.7H4.2S6 14 6 9.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9.6 19a2.5 2.5 0 0 0 4.8 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M3.4 19a5.6 5.6 0 0 1 11.2 0M16 5.3a3 3 0 0 1 0 5.6M17 13.4a5 5 0 0 1 3.6 5.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 10h18M7 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.6v2.6M12 18.8v2.6M4.2 4.6 6 6.4M18 17.6l1.8 1.8M2.4 12H5M19 12h2.6M4.2 19.4 6 17.6M18 6.4l1.8-1.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-3.7-3.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  chevR: (
    <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  ),
  chevDown: (
    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  ),
  dots: (
    <>
      <circle cx="5.5" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.7" fill="currentColor" />
    </>
  ),
  logout: (
    <path
      d="M15 12H4.5M8 8l-4 4 4 4M14 4.5h4a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-4"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  cube: (
    <>
      <path d="M12 2.6 20.8 7v10L12 21.4 3.2 17V7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M3.4 7.1 12 11.6l8.6-4.5M12 11.6v9.4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </>
  ),
  check: (
    <path
      d="m5 12.6 4.4 4.4L19 7.2"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.4V12l3.2 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  upload: (
    <path
      d="M12 16V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  importI: (
    <path
      d="M3 12h11M10.5 8.5 14 12l-3.5 3.5M16.5 4H20a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  chat: (
    <path
      d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9l-4 3.5V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.5" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.5" cy="18" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="m8.1 10.9 7.3-3.8M8.1 13.1l7.3 3.8" stroke="currentColor" strokeWidth="1.7" />
    </>
  ),
  bolt: (
    <path
      d="M13 3 4.5 13.5H11l-1 7.5L18.5 10H12z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  )
}

export interface HomeIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: HomeIconName
  /** Square edge length in px. Defaults to 20. */
  size?: number
}

/**
 * Render a Home-shell glyph at `size` px. The SVG uses `currentColor`, so set
 * the colour on an ancestor (or via `style`/`color`) and the icon follows.
 */
export function HomeIcon({ name, size = 20, style, ...rest }: HomeIconProps): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ flex: '0 0 auto', display: 'block', ...style }}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
