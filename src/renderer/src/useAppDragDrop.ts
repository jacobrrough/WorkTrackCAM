/**
 * App-level drag-and-drop file import hook.
 *
 * Wraps the entire app window in a drop zone that accepts:
 *   - Mesh files  (STL, STEP, IGES, OBJ, 3MF, PLY, GLB) -> trigger mesh import
 *   - G-code files (.gcode, .nc, .ngc, .tap)       -> open G-code viewer
 *
 * The hook manages the "dragging over" state for the overlay and delegates
 * actual import to callbacks supplied by the host component (ShopApp).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** File extensions accepted for mesh import (lower-cased, without dot). */
export const MESH_EXTENSIONS = new Set(['stl', 'step', 'stp', 'iges', 'igs', 'obj', '3mf', 'ply', 'glb'])

/** File extensions accepted for G-code preview (lower-cased, without dot). */
export const GCODE_EXTENSIONS = new Set(['gcode', 'nc', 'ngc', 'tap'])

/** All accepted file extensions (union of mesh + gcode). */
export const ALL_DROP_EXTENSIONS = new Set([...MESH_EXTENSIONS, ...GCODE_EXTENSIONS])

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

export type DropFileKind = 'mesh' | 'gcode' | 'unknown'

export function classifyDroppedFile(filename: string): DropFileKind {
  const ext = getExtension(filename)
  if (MESH_EXTENSIONS.has(ext)) return 'mesh'
  if (GCODE_EXTENSIONS.has(ext)) return 'gcode'
  return 'unknown'
}

interface UseAppDragDropArgs {
  /** Called when a mesh file is dropped. Receives the native file path. */
  onMeshDrop: (filePath: string, fileName: string) => void
  /** Called when a G-code file is dropped. Receives the native file path. */
  onGcodeDrop: (filePath: string, fileName: string) => void
  /** Called to show a warning toast. */
  onWarn: (msg: string) => void
  /** Whether the drop zone should be active. Set to false during splash, etc. */
  enabled?: boolean
}

interface UseAppDragDropResult {
  /** Whether a file is currently being dragged over the window. */
  isDraggingOver: boolean
  /** A descriptive label for the current drag (e.g. "Drop STL to import"). */
  dragLabel: string
  /** Attach these to the root element's drag event handlers. */
  handlers: {
    onDragOver: (e: React.DragEvent) => void
    onDragEnter: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

/**
 * Manages app-level drag-and-drop state and file dispatch.
 */
export function useAppDragDrop({
  onMeshDrop,
  onGcodeDrop,
  onWarn,
  enabled = true,
}: UseAppDragDropArgs): UseAppDragDropResult {
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [dragLabel, setDragLabel] = useState('Drop file to import')
  const dragCounterRef = useRef(0)

  // Reset state when disabled
  useEffect(() => {
    if (!enabled) {
      setIsDraggingOver(false)
      dragCounterRef.current = 0
    }
  }, [enabled])

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!enabled) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [enabled])

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!enabled) return
    e.preventDefault()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsDraggingOver(true)
      // Try to determine what's being dragged for a contextual label
      const items = e.dataTransfer.items
      if (items?.length === 1 && items[0].kind === 'file') {
        // We can't read the filename on dragenter in all browsers,
        // so use a generic label
        setDragLabel('Drop file to import')
      } else {
        setDragLabel('Drop file to import')
      }
    }
  }, [enabled])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!enabled) return
    e.preventDefault()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDraggingOver(false)
    }
  }, [enabled])

  const onDrop = useCallback((e: React.DragEvent) => {
    if (!enabled) return
    e.preventDefault()
    setIsDraggingOver(false)
    dragCounterRef.current = 0

    const file = e.dataTransfer.files[0]
    if (!file) { onWarn('No file detected in drop'); return }

    const kind = classifyDroppedFile(file.name)
    const filePath = (file as unknown as { path?: string }).path ?? ''

    if (!filePath) {
      onWarn('Could not read file path from drop')
      return
    }

    switch (kind) {
      case 'mesh':
        onMeshDrop(filePath, file.name)
        break
      case 'gcode':
        onGcodeDrop(filePath, file.name)
        break
      case 'unknown': {
        const ext = file.name.split('.').pop()?.toUpperCase() ?? ''
        onWarn(`Unsupported file type${ext ? ` (.${ext})` : ''}. Drop STL, STEP, IGES, OBJ, 3MF, PLY, GLB, or G-code files.`)
        break
      }
    }
  }, [enabled, onMeshDrop, onGcodeDrop, onWarn])

  return {
    isDraggingOver,
    dragLabel,
    handlers: { onDragOver, onDragEnter, onDragLeave, onDrop },
  }
}
