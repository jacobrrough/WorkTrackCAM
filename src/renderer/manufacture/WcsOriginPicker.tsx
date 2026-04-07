import type { ReactNode } from 'react'
import type { WcsOriginPoint } from '../../shared/manufacture-schema'

/**
 * WCS Origin Picker — Makera CAM style.
 *
 * Displays a 3×3 grid of buttons representing the top face of the stock
 * (TL, TC, TR, ML, Center, MR, BL, BC, BR) plus a separate "Bottom center"
 * button for flip-side machining. The selected point defines which physical
 * location on the workpiece maps to machine zero for this setup.
 */

type Props = {
  value: WcsOriginPoint | undefined
  onChange: (point: WcsOriginPoint) => void
  disabled?: boolean
}

type GridCell = {
  point: WcsOriginPoint
  label: string
  title: string
}

/** 3×3 grid layout for the top face (row-major, 3 cols). */
const TOP_GRID: GridCell[] = [
  { point: 'top-tl', label: '↖', title: 'Top face — front-left corner' },
  { point: 'top-tc', label: '↑', title: 'Top face — front-center edge' },
  { point: 'top-tr', label: '↗', title: 'Top face — front-right corner' },
  { point: 'top-ml', label: '←', title: 'Top face — mid-left edge' },
  { point: 'top-center', label: '⊕', title: 'Top face — center of stock' },
  { point: 'top-mr', label: '→', title: 'Top face — mid-right edge' },
  { point: 'top-bl', label: '↙', title: 'Top face — back-left corner' },
  { point: 'top-bc', label: '↓', title: 'Top face — back-center edge' },
  { point: 'top-br', label: '↘', title: 'Top face — back-right corner' }
]

export function WcsOriginPicker({ value, onChange, disabled }: Props): ReactNode {
  return (
    <div className="wcs-origin-picker">
      <div className="wcs-origin-picker__label">WCS origin</div>
      <div className="wcs-origin-picker__face-label">Top face</div>
      <div className="wcs-origin-picker__grid" role="radiogroup" aria-label="WCS origin point — top face">
        {TOP_GRID.map((cell) => (
          <button
            key={cell.point}
            type="button"
            role="radio"
            aria-checked={value === cell.point}
            aria-label={cell.title}
            title={cell.title}
            disabled={disabled}
            className={`wcs-origin-picker__cell${value === cell.point ? ' wcs-origin-picker__cell--active' : ''}`}
            onClick={() => onChange(cell.point)}
          >
            {cell.label}
          </button>
        ))}
      </div>
      <div className="wcs-origin-picker__face-label wcs-origin-picker__face-label--bottom">Bottom face</div>
      <div className="wcs-origin-picker__bottom-row">
        <button
          type="button"
          role="radio"
          aria-checked={value === 'bottom-center'}
          aria-label="Bottom face — center (flip-side reference)"
          title="Bottom face — center of stock (flip-side / two-sided machining)"
          disabled={disabled}
          className={`wcs-origin-picker__cell wcs-origin-picker__cell--bottom${value === 'bottom-center' ? ' wcs-origin-picker__cell--active' : ''}`}
          onClick={() => onChange('bottom-center')}
        >
          ⊗
        </button>
        <span className="wcs-origin-picker__bottom-hint">Bottom center</span>
      </div>
      {value ? (
        <div className="wcs-origin-picker__current" aria-live="polite">
          Zero at: <strong>{value}</strong>
        </div>
      ) : (
        <div className="wcs-origin-picker__current wcs-origin-picker__current--none">No origin set</div>
      )}
    </div>
  )
}
