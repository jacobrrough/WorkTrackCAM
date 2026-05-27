/**
 * Regenerate every per-machine sample bundle in `resources/samples/`.
 *
 * Run with:  node scripts/sample-stl-gen/generate-all.js
 *
 * Each generator script is self-contained and writes its output to the
 * conventional location consumed by the first-launch wizard
 * (`samples:list` IPC + `WIZARD_MACHINE_TO_SAMPLE_FILE` map).
 */
'use strict'

const path = require('node:path')

const scripts = [
  'gen-calibration-cube.js',     // Creality K2 Plus
  'gen-sign-board-dxf.js',        // Laguna Swift 5x10
  'gen-carvera-pocket.js',        // Makera Carvera 3-axis
  'gen-carvera-rotary-pen.js'     // Makera Carvera 4-axis
]

for (const s of scripts) {
  console.log(`\n--- ${s} ---`)
  require(path.join(__dirname, s))
}

console.log('\nAll sample bundles regenerated.')
