import type { FusionStyleCommand } from '../../shared/fusion-style-command-catalog'

/** Status line when a drawing-related command is run from the palette (Stream E). */
export function drawingPaletteStatusFor(cmd: FusionStyleCommand): string {
  switch (cmd.id) {
    case 'dr_new_sheet':
      return 'Drawing manifest — set primary sheet name/scale on the Project tab, add view slots, **Build STEP (kernel)** so `output/kernel-part.stl` exists, then export PDF/DXF for **Tier A** mesh-edge projection (no HLR).'
    case 'dr_base_view':
      return 'Base view — Project tab: **+ Base view slot**, set **View from**, save, export PDF/DXF. Linework comes from kernel STL when Python runs `project_views.py` successfully.'
    case 'dr_projected_view':
      return 'Projected view — Project tab: **+ Projected view slot**, pick **parent** + **direction**, save, export. Each slot is projected independently from the kernel mesh (Tier A).'
    default:
      return `${cmd.label} — Project tab: drawing manifest; PDF/DXF include Tier A projections when kernel STL + Python are available.`
  }
}
