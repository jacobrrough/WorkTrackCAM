import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import type { MaterialRecord } from '../../shared/material-schema'
import type { ToolRecord } from '../../shared/tool-schema'
import { fab } from '../src/shop-types'
import { useToast } from './ToastContext'

type Phase = 'splash' | 'app'

type MachineSessionContextValue = {
  phase: Phase
  setPhase: React.Dispatch<React.SetStateAction<Phase>>
  sessionMachine: MachineProfile | null
  setSessionMachine: React.Dispatch<React.SetStateAction<MachineProfile | null>>
  machines: MachineProfile[]
  setMachines: React.Dispatch<React.SetStateAction<MachineProfile[]>>
  materials: MaterialRecord[]
  setMaterials: React.Dispatch<React.SetStateAction<MaterialRecord[]>>
  machineTools: ToolRecord[]
  setMachineTools: React.Dispatch<React.SetStateAction<ToolRecord[]>>
  lastMachineId: string | null
  setLastMachineId: React.Dispatch<React.SetStateAction<string | null>>
  /** Refetches the machine library from disk. Useful after imports / edits. */
  reloadMachines: () => Promise<void>
  /** Loads the tool library for a given machine id. */
  loadToolsForMachine: (machineId: string | null | undefined) => Promise<void>
}

const Ctx = createContext<MachineSessionContextValue | null>(null)

export function MachineSessionProvider({ children }: { children: ReactNode }) {
  const { pushToast } = useToast()
  const [phase, setPhase] = useState<Phase>('splash')
  const [sessionMachine, setSessionMachine] = useState<MachineProfile | null>(null)
  const [machines, setMachines] = useState<MachineProfile[]>([])
  const [materials, setMaterials] = useState<MaterialRecord[]>([])
  const [machineTools, setMachineTools] = useState<ToolRecord[]>([])
  const [lastMachineId, setLastMachineId] = useState<string | null>(null)

  const reloadMachines = useCallback(async () => {
    try {
      const list = await fab().machinesList()
      setMachines(list)
    } catch (e) {
      console.error(e)
      pushToast('err', 'Failed to load machines')
    }
  }, [pushToast])

  const loadToolsForMachine = useCallback(async (machineId: string | null | undefined) => {
    if (!machineId) {
      setMachineTools([])
      return
    }
    try {
      const lib = await fab().machineToolsRead(machineId)
      setMachineTools(lib.tools ?? [])
    } catch (e) {
      console.error(e)
      pushToast('err', 'Failed to load machine tools')
    }
  }, [pushToast])

  // Initial load: machines, materials, last machine id
  useEffect(() => {
    void reloadMachines()
    fab().materialsList()
      .then(setMaterials)
      .catch(e => { console.error(e); pushToast('err', 'Failed to load materials') })
    fab().settingsGet()
      .then(s => { if (s.lastMachineId) setLastMachineId(String(s.lastMachineId)) })
      .catch(e => { console.error(e); pushToast('err', 'Failed to load settings') })
  }, [reloadMachines, pushToast])

  return (
    <Ctx.Provider value={{
      phase, setPhase,
      sessionMachine, setSessionMachine,
      machines, setMachines,
      materials, setMaterials,
      machineTools, setMachineTools,
      lastMachineId, setLastMachineId,
      reloadMachines,
      loadToolsForMachine,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useMachineSession(): MachineSessionContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useMachineSession must be used within MachineSessionProvider')
  return ctx
}
