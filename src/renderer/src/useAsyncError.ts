/**
 * useAsyncError -- hook that catches promise rejections and feeds them
 * to the nearest React error boundary.
 *
 * React error boundaries only catch errors thrown during render. Async errors
 * (e.g. from IPC calls) are invisible to them. This hook bridges the gap:
 * call `throwAsyncError(error)` to re-throw the error inside a setState
 * updater, which React treats as a render-phase error and propagates to the
 * nearest ErrorBoundary.
 *
 * Usage:
 *   const throwAsyncError = useAsyncError()
 *
 *   async function loadData() {
 *     try {
 *       const data = await ipc.invoke('load-data')
 *       setData(data)
 *     } catch (err) {
 *       throwAsyncError(err instanceof Error ? err : new Error(String(err)))
 *     }
 *   }
 */
import { useCallback, useState } from 'react'

/**
 * Returns a function that, when called with an Error, throws it during
 * React's render phase so the nearest ErrorBoundary can catch it.
 */
export function useAsyncError(): (error: Error) => void {
  const [, setError] = useState<null>(null)

  return useCallback((error: Error) => {
    setError(() => {
      throw error
    })
  }, [setError])
}
