/**
 * Files — browse/manage documents (folder rail + sortable table).
 * Rebuilt from the `WorkTrack CAD - App` prototype with DS primitives + tokens.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Card, Eyebrow, IconButton } from '../../ds'
import { HomeIcon } from '../icons'
import {
  FILES,
  FILE_BREADCRUMB,
  FILE_FOLDERS,
  FILE_ICON_BY_KIND
} from '../home-sample-data'

export function FilesScreen(): ReactElement {
  const [activeFolder, setActiveFolder] = useState('prod')
  const [selected, setSelected] = useState('bracket-mount.wtc')

  return (
    <div className="wt-home__split">
      <div className="wt-home__rail-col">
        <Eyebrow style={{ padding: '4px 10px 8px' }}>Library</Eyebrow>
        {FILE_FOLDERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`wt-home__nav-item${activeFolder === f.id ? ' is-active' : ''}`}
            aria-current={activeFolder === f.id ? 'true' : undefined}
            onClick={() => setActiveFolder(f.id)}
          >
            <HomeIcon name={f.icon} size={18} />
            <span className="wt-home__nav-label">{f.label}</span>
            {f.count ? <span className="wt-files__count">{f.count}</span> : null}
          </button>
        ))}
        <div className="wt-files__storage">
          <Card style={{ padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgb(var(--c-text))' }}>Storage</div>
            <div className="wt-files__storage-bar">
              <div className="wt-files__storage-fill" style={{ width: '62%' }} />
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'rgb(var(--c-text-subtle))' }}>
              31.0 / 50 GB
            </div>
          </Card>
        </div>
      </div>

      <div className="wt-files__main">
        <div className="wt-files__toolbar">
          <div className="wt-files__crumb mono">
            {FILE_BREADCRUMB.map((c, i) => (
              <span key={c}>
                {i > 0 ? <span className="wt-files__crumb-sep"> / </span> : null}
                <span className={i === FILE_BREADCRUMB.length - 1 ? 'wt-files__crumb-here' : undefined}>{c}</span>
              </span>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <IconButton style={{ width: 'auto', padding: '0 12px', gap: 7, fontSize: 12.5, color: 'rgb(var(--c-text-muted))' }}>
            <HomeIcon name="sort" size={16} />
            Modified
          </IconButton>
          <Button
            variant="secondary"
            size="sm"
            style={{ display: 'inline-flex', gap: 7, alignItems: 'center' }}
          >
            <HomeIcon name="plus" size={16} />
            New folder
          </Button>
          <Button variant="primary" size="sm" style={{ display: 'inline-flex', gap: 7, alignItems: 'center' }}>
            <HomeIcon name="upload" size={16} />
            Upload
          </Button>
        </div>

        <div className="wt-files__scroll">
          <div className="wt-files__thead wt-home__thead">
            <span>Name</span>
            <span>Type</span>
            <span>Modified</span>
            <span>Size</span>
            <span>Owner</span>
            <span />
          </div>
          {FILES.map((f) => (
            <div
              key={f.name}
              role="button"
              tabIndex={0}
              className={`wt-files__row${selected === f.name ? ' is-selected' : ''}`}
              onClick={() => setSelected(f.name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSelected(f.name)
                }
              }}
            >
              <span className="wt-files__name">
                <HomeIcon
                  name={FILE_ICON_BY_KIND[f.kind]}
                  size={19}
                  style={{ color: f.kind === 'folder' ? 'rgb(var(--c-accent))' : 'rgb(var(--c-text-muted))' }}
                />
                <span className="wt-files__name-text">{f.name}</span>
              </span>
              <span className="wt-files__cell">{f.type}</span>
              <span className="wt-files__cell mono">{f.mod}</span>
              <span className="wt-files__cell mono">{f.size}</span>
              <span className="wt-files__cell">{f.owner}</span>
              <IconButton size="sm" aria-label="More" onClick={(e) => e.stopPropagation()}>
                <HomeIcon name="dots" size={16} style={{ color: 'rgb(var(--c-text-subtle))' }} />
              </IconButton>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
