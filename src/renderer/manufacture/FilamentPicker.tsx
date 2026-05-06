import { memo } from 'react'
import { FILAMENT_TYPE_GROUPS, type FilamentRecord } from '../../shared/filament-schema'

type FilamentPickerProps = {
  filaments: FilamentRecord[]
  activeFilamentId: string | undefined
  onSelect: (id: string) => void
  machineMaxNozzleTempC?: number
  machineMaxBedTempC?: number
}

export const FilamentPicker = memo(function FilamentPicker({
  filaments,
  activeFilamentId,
  onSelect,
  machineMaxNozzleTempC,
  machineMaxBedTempC
}: FilamentPickerProps) {
  return (
    <section className="filament-picker" aria-label="Filament material">
      <h3 className="filament-picker__heading">Filament</h3>
      {Object.entries(FILAMENT_TYPE_GROUPS).map(([group, types]) => {
        const groupFilaments = filaments.filter(f => types.includes(f.type))
        if (groupFilaments.length === 0) return null
        return (
          <div key={group} className="filament-picker__group">
            <span className="filament-picker__group-label">{group}</span>
            <div className="filament-picker__chips">
              {groupFilaments.map(f => {
                const overNozzle = machineMaxNozzleTempC != null && f.printSettings.nozzleTempC > machineMaxNozzleTempC
                const overBed = machineMaxBedTempC != null && f.printSettings.bedTempC > machineMaxBedTempC
                const disabled = overNozzle || overBed
                const active = f.id === activeFilamentId
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={
                      'filament-picker__chip' +
                      (active ? ' filament-picker__chip--active' : '') +
                      (disabled ? ' filament-picker__chip--disabled' : '')
                    }
                    onClick={() => !disabled && onSelect(f.id)}
                    disabled={disabled}
                    title={
                      disabled
                        ? `Exceeds machine limits (${overNozzle ? `nozzle ${f.printSettings.nozzleTempC}°C` : ''}${overBed ? `bed ${f.printSettings.bedTempC}°C` : ''})`
                        : `${f.name} — ${f.printSettings.nozzleTempC}°C nozzle, ${f.printSettings.bedTempC}°C bed`
                    }
                  >
                    <span className="filament-picker__chip-name">{f.name}</span>
                    <span className="filament-picker__chip-temp">{f.printSettings.nozzleTempC}°</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </section>
  )
})
