/**
 * Templates — start from a parametric starter (category filter + card grid).
 * "Use template" opens the modeling workspace. DS primitives + tokens.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Card, Eyebrow } from '../../ds'
import { HomeIcon } from '../icons'
import { TEMPLATE_CATS, TEMPLATES } from '../home-sample-data'

export interface TemplatesScreenProps {
  onEnterWorkspace: () => void
}

export function TemplatesScreen({ onEnterWorkspace }: TemplatesScreenProps): ReactElement {
  const [cat, setCat] = useState<string>('All')
  const shown = cat === 'All' ? TEMPLATES : TEMPLATES.filter((t) => t.cat === cat)

  return (
    <div className="wt-tpl">
      <div className="wt-tpl__chips">
        {TEMPLATE_CATS.map((c) => (
          <button
            key={c}
            type="button"
            className={`wt-tpl__chip${cat === c ? ' is-active' : ''}`}
            aria-pressed={cat === c}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="wt-tpl__grid">
        {shown.map((t, i) => (
          <Card key={t.title} className="wt-tpl__card">
            <div className={`wt-tpl__thumb${i % 2 === 1 ? ' wt-tpl__thumb--b' : ''}`}>
              <HomeIcon name="cube" size={56} />
              <Eyebrow className="wt-tpl__cat">{t.cat}</Eyebrow>
            </div>
            <div className="wt-tpl__body">
              <div>
                <div className="wt-tpl__title">{t.title}</div>
                <div className="wt-tpl__desc">{t.desc}</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="wt-tpl__use"
                onClick={onEnterWorkspace}
                style={{ justifyContent: 'center' }}
              >
                Use template
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
