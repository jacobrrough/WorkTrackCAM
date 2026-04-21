import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockReaddir, mockReadFile, mockWriteFile, mockMkdir, mockUnlink } = vi.hoisted(() => ({
  mockReaddir: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockUnlink: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData')
  }
}))

vi.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  unlink: mockUnlink
}))

vi.mock('./paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./paths')>()
  return {
    ...actual,
    getResourcesRoot: vi.fn().mockReturnValue('/mock/resources')
  }
})

vi.mock('./machine-cps-import', () => ({
  machineProfileFromCpsContent: vi.fn()
}))

import { parseMachineProfileText, loadMachineCatalog, loadAllMachines, getMachineById, saveUserMachine, deleteUserMachine } from './machines'

const minimalCncJson = {
  id: 'test-cnc',
  name: 'Test CNC',
  kind: 'cnc',
  workAreaMm: { x: 200, y: 200, z: 50 },
  maxFeedMmMin: 3000,
  postTemplate: 'grbl_mm.hbs',
  dialect: 'grbl'
}

describe('parseMachineProfileText', () => {
  it('parses valid JSON machine profile', () => {
    const result = parseMachineProfileText(JSON.stringify(minimalCncJson), 'test.json')
    expect(result.id).toBe('test-cnc')
    expect(result.kind).toBe('cnc')
    expect(result.name).toBe('Test CNC')
  })

  it('parses JSON without a file hint', () => {
    const result = parseMachineProfileText(JSON.stringify(minimalCncJson))
    expect(result.id).toBe('test-cnc')
  })

  it('parses YAML machine profile', () => {
    const yaml = `
id: yaml-cnc
name: YAML CNC
kind: cnc
workAreaMm:
  x: 300
  y: 300
  z: 100
maxFeedMmMin: 5000
postTemplate: grbl_mm.hbs
dialect: grbl
`
    const result = parseMachineProfileText(yaml, 'machine.yaml')
    expect(result.id).toBe('yaml-cnc')
    expect(result.workAreaMm.x).toBe(300)
  })

  it('parses TOML machine profile', () => {
    const toml = `
id = "toml-cnc"
name = "TOML CNC"
kind = "cnc"
maxFeedMmMin = 2000
postTemplate = "grbl_mm.hbs"
dialect = "grbl"

[workAreaMm]
x = 100
y = 100
z = 50
`
    const result = parseMachineProfileText(toml, 'machine.toml')
    expect(result.id).toBe('toml-cnc')
    expect(result.maxFeedMmMin).toBe(2000)
  })

  it('parses JSON5 with comments and trailing commas', () => {
    const json5 = `{
  // CNC machine
  id: "json5-cnc",
  name: "JSON5 CNC",
  kind: "cnc",
  workAreaMm: { x: 1, y: 2, z: 3, },
  maxFeedMmMin: 100,
  postTemplate: "grbl_mm.hbs",
  dialect: "grbl",
}`
    const result = parseMachineProfileText(json5, 'machine.jsonc')
    expect(result.id).toBe('json5-cnc')
  })

  it('throws for empty text', () => {
    expect(() => parseMachineProfileText('', 'empty.json')).toThrow(/empty/i)
  })

  it('throws for whitespace-only text', () => {
    expect(() => parseMachineProfileText('   \n\t  ', 'blank.json')).toThrow(/empty/i)
  })

  it('throws for unparseable text without hint', () => {
    expect(() => parseMachineProfileText('this is not valid anything', 'unknown')).toThrow()
  })

  it('tries multiple parsers when no file extension matches', () => {
    const result = parseMachineProfileText(JSON.stringify(minimalCncJson), 'pasted-profile')
    expect(result.id).toBe('test-cnc')
  })

  it('strips BOM from input', () => {
    const withBom = '\uFEFF' + JSON.stringify(minimalCncJson)
    const result = parseMachineProfileText(withBom, 'bom.json')
    expect(result.id).toBe('test-cnc')
  })
})

describe('loadMachineCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
  })

  it('returns empty catalog when directories have no files', async () => {
    mockReaddir.mockResolvedValue([])
    const result = await loadMachineCatalog()
    expect(result.machines).toEqual([])
  })

  it('returns machines from bundled and user directories', async () => {
    mockReaddir
      .mockResolvedValueOnce(['cnc1.json'])   // bundled
      .mockResolvedValueOnce(['cnc2.json'])   // user
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify(minimalCncJson))
      .mockResolvedValueOnce(JSON.stringify({ ...minimalCncJson, id: 'user-cnc', name: 'User CNC' }))
    const result = await loadMachineCatalog()
    expect(result.machines.length).toBe(2)
  })

  it('user machines override bundled with same id', async () => {
    mockReaddir
      .mockResolvedValueOnce(['cnc.json'])    // bundled
      .mockResolvedValueOnce(['cnc.json'])    // user
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ ...minimalCncJson, name: 'Bundled' }))
      .mockResolvedValueOnce(JSON.stringify({ ...minimalCncJson, name: 'User Override' }))
    const result = await loadMachineCatalog()
    expect(result.machines.length).toBe(1)
    expect(result.machines[0]!.name).toBe('User Override')
  })

  it('returns diagnostics for malformed files', async () => {
    mockReaddir
      .mockResolvedValueOnce(['bad.json'])
      .mockResolvedValueOnce([])
    mockReadFile.mockResolvedValueOnce('not json')
    const result = await loadMachineCatalog()
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('ignores non-json files', async () => {
    mockReaddir
      .mockResolvedValueOnce(['readme.txt', 'machine.json'])
      .mockResolvedValueOnce([])
    mockReadFile.mockResolvedValueOnce(JSON.stringify(minimalCncJson))
    const result = await loadMachineCatalog()
    expect(result.machines.length).toBe(1)
  })

  it('returns sorted machines by name', async () => {
    mockReaddir
      .mockResolvedValueOnce(['z.json', 'a.json'])
      .mockResolvedValueOnce([])
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ ...minimalCncJson, id: 'z', name: 'Zeta CNC' }))
      .mockResolvedValueOnce(JSON.stringify({ ...minimalCncJson, id: 'a', name: 'Alpha CNC' }))
    const result = await loadMachineCatalog()
    expect(result.machines[0]!.name).toBe('Alpha CNC')
    expect(result.machines[1]!.name).toBe('Zeta CNC')
  })
})

describe('loadAllMachines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue([])
  })

  it('returns just the machines array from the catalog', async () => {
    const result = await loadAllMachines()
    expect(Array.isArray(result)).toBe(true)
  })
})

describe('getMachineById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
  })

  it('returns null when machine not found', async () => {
    mockReaddir.mockResolvedValue([])
    const result = await getMachineById('nonexistent')
    expect(result).toBeNull()
  })

  it('returns the machine matching the id', async () => {
    mockReaddir
      .mockResolvedValueOnce(['cnc.json'])
      .mockResolvedValueOnce([])
    mockReadFile.mockResolvedValueOnce(JSON.stringify(minimalCncJson))
    const result = await getMachineById('test-cnc')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('test-cnc')
  })
})

describe('saveUserMachine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('saves machine profile to user directory', async () => {
    const result = await saveUserMachine(minimalCncJson as never)
    expect(result.id).toBe('test-cnc')
    expect(result.meta?.source).toBe('user')
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
  })

  it('sanitizes filename from machine id', async () => {
    const weird = { ...minimalCncJson, id: 'My Machine!! #1' }
    await saveUserMachine(weird as never)
    const [filePath] = mockWriteFile.mock.calls[0]!
    expect(filePath).not.toContain('!')
    expect(filePath).not.toContain('#')
    expect(filePath).toMatch(/\.json$/)
  })
})

describe('deleteUserMachine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUnlink.mockResolvedValue(undefined)
  })

  it('returns false when no user machines directory', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'))
    const result = await deleteUserMachine('nonexistent')
    expect(result).toBe(false)
  })

  it('returns false when machine id not found', async () => {
    mockReaddir.mockResolvedValue(['other.json'])
    mockReadFile.mockResolvedValue(JSON.stringify({ ...minimalCncJson, id: 'other' }))
    const result = await deleteUserMachine('nonexistent')
    expect(result).toBe(false)
  })

  it('deletes the matching machine file and returns true', async () => {
    mockReaddir.mockResolvedValue(['test-cnc.json'])
    mockReadFile.mockResolvedValue(JSON.stringify(minimalCncJson))
    const result = await deleteUserMachine('test-cnc')
    expect(result).toBe(true)
    expect(mockUnlink).toHaveBeenCalledTimes(1)
  })
})
