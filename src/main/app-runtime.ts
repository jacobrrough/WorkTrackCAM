import { app } from 'electron'

export function getAppVersion(): string {
  return app.getVersion()
}
