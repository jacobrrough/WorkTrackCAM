/** Tier A + B: extensions offered by the unified import dialog and registry. */
export const MESH_IMPORT_FILE_EXTENSIONS = [
  'stl',
  'step',
  'stp',
  'iges',
  'igs',
  'obj',
  'ply',
  'gltf',
  'glb',
  '3mf',
  /** Tier B: common trimesh loaders (no extra binary deps in typical installs). */
  'off',
  'dae',
  /** Often needs trimesh + assimp / pyassimp in the same Python env — may fail with `mesh_import_failed`. */
  'fbx',
  /** 2D DXF import — produces 2D geometry for pocket/contour/drill ops, NOT 3D mesh. */
  'dxf'
] as const

export type MeshImportFileExtension = (typeof MESH_IMPORT_FILE_EXTENSIONS)[number]

/** Extensions converted via `engines/mesh/mesh_to_stl.py` (trimesh). */
export const MESH_PYTHON_EXTENSIONS = new Set<string>([
  'obj',
  'ply',
  'gltf',
  'glb',
  '3mf',
  'off',
  'dae',
  'fbx'
])

/** STEP and IGES extensions — converted via `engines/occt/step_to_stl.py` (CadQuery / OCP). */
export const STEP_IGES_EXTENSIONS = new Set<string>(['step', 'stp', 'iges', 'igs'])
