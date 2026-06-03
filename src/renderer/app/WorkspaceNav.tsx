import type { ReactElement } from 'react'
import type { WorkspaceId } from './useWorkspaceRouter'

interface NavItem {
  readonly id: WorkspaceId
  readonly label: string
  readonly icon: ReactElement
}

const I = (path: ReactElement): ReactElement => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {path}
  </svg>
)

const ITEMS: readonly NavItem[] = [
  {
    id: 'design',
    label: 'Design',
    icon: I(
      <>
        <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M3 7l9 5 9-5" stroke="currentColor" strokeWidth="1.5" />
      </>
    )
  },
  {
    id: 'assemble',
    label: 'Assemble',
    icon: I(
      <>
        <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 7h4a2 2 0 0 1 2 2v4" stroke="currentColor" strokeWidth="1.5" />
      </>
    )
  },
  {
    id: 'manufacture',
    label: 'Make',
    icon: I(
      <path
        d="M3 17l7-7m0 0l4-4 4 4-4 4m-4-4 4 4M14 17l4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    )
  },
  {
    id: 'drawings',
    label: 'Drawings',
    icon: I(
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7h8M8 11h5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M16 21v-5M13.5 18.5h5" stroke="currentColor" strokeWidth="1.5" />
      </>
    )
  },
  {
    id: 'workshop',
    label: 'Workshop',
    icon: I(
      <>
        <path
          d="M12 3v3m0 12v3m9-9h-3M6 12H3m13.5-6.5-2 2m-7 7-2 2m11 0-2-2m-7-7-2-2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      </>
    )
  },
  {
    id: 'utilities',
    label: 'Utilities',
    icon: I(
      <>
        <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="9" cy="6" r="2" fill="currentColor" />
        <circle cx="15" cy="12" r="2" fill="currentColor" />
        <circle cx="8" cy="18" r="2" fill="currentColor" />
      </>
    )
  }
]

export function WorkspaceNav({
  active,
  onSelect
}: {
  active: WorkspaceId
  onSelect: (w: WorkspaceId) => void
}): ReactElement {
  return (
    <nav className="wt-nav" aria-label="Workspaces">
      {ITEMS.map(item => {
        const isActive = active === item.id
        return (
          <button
            key={item.id}
            type="button"
            className={`wt-nav__btn${isActive ? ' wt-nav__btn--active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(item.id)}
            title={item.label}
          >
            <span className="wt-nav__icon">{item.icon}</span>
            <span className="wt-nav__label">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
