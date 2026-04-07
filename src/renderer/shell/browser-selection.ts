/** Selection for assemble / manufacture browser (design uses `DesignSessionContext.selection`). */
export type ShellBrowserSelection =
  | null
  | { kind: 'assemble'; componentId: string }
  | { kind: 'manufacture-setup'; id: string }
  | { kind: 'manufacture-op'; id: string }
