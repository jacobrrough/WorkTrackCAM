import { app } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

let registered = false

function formatErr(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? reason.message
  return String(reason)
}

async function appendMainLog(line: string): Promise<void> {
  try {
    if (!app.isReady()) return
    const dir = join(app.getPath('userData'), 'logs')
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, 'main-process.log'), line, 'utf-8')
  } catch {
    /* never throw from diagnostics */
  }
}

/**
 * Console + optional `userData/logs/main-process.log` for uncaught main errors.
 * Call once early from the main entry (after Electron can load).
 */
export function registerMainProcessDiagnostics(): void {
  if (registered) return
  registered = true

  process.on('uncaughtException', (err) => {
    const line = `[${new Date().toISOString()}] uncaughtException ${formatErr(err)}\n`
    console.error(line.trimEnd())
    void appendMainLog(line)
  })

  process.on('unhandledRejection', (reason) => {
    const line = `[${new Date().toISOString()}] unhandledRejection ${formatErr(reason)}\n`
    console.error(line.trimEnd())
    void appendMainLog(line)
  })
}
