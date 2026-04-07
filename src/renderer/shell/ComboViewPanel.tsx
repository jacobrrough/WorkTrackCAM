import { useCallback, type KeyboardEvent, type ReactNode } from 'react'

export type ComboViewTab = 'model' | 'tasks'

type Props = {
  tab: ComboViewTab
  onTabChange: (t: ComboViewTab) => void
  model: ReactNode
  tasks: ReactNode
}

const TABS: { id: ComboViewTab; label: string }[] = [
  { id: 'model', label: 'Model' },
  { id: 'tasks', label: 'Tasks' }
]

export function ComboViewPanel({ tab, onTabChange, model, tasks }: Props) {
  const onTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, tabId: ComboViewTab) => {
      const idx = TABS.findIndex((x) => x.id === tabId)
      if (idx < 0) return
      let nextIdx = -1
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        nextIdx = (idx + 1) % TABS.length
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        nextIdx = (idx - 1 + TABS.length) % TABS.length
      } else if (e.key === 'Home') {
        e.preventDefault()
        nextIdx = 0
      } else if (e.key === 'End') {
        e.preventDefault()
        nextIdx = TABS.length - 1
      }
      if (nextIdx < 0) return
      onTabChange(TABS[nextIdx]!.id)
      queueMicrotask(() => document.getElementById(`combo-tab-${TABS[nextIdx]!.id}`)?.focus())
    },
    [onTabChange]
  )

  return (
    <div className="combo-view-panel">
      <div
        className="combo-view-tabs"
        role="tablist"
        aria-label="Combo view"
        aria-orientation="horizontal"
      >
        {TABS.map((t, index) => (
          <button
            key={t.id}
            id={`combo-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`combo-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'active' : ''}
            onClick={() => onTabChange(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, t.id)}
            aria-posinset={index + 1}
            aria-setsize={TABS.length}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id="combo-panel-model"
        role="tabpanel"
        aria-labelledby="combo-tab-model"
        hidden={tab !== 'model'}
        className="combo-view-panel__panel"
      >
        {model}
      </div>
      <div
        id="combo-panel-tasks"
        role="tabpanel"
        aria-labelledby="combo-tab-tasks"
        hidden={tab !== 'tasks'}
        className="combo-view-panel__panel"
      >
        {tasks}
      </div>
    </div>
  )
}
