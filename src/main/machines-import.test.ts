import { describe, expect, it } from 'vitest'
import { parseMachineProfileText } from './machines'

const yamlMinimal = `
id: bench-yaml
name: Bench YAML
kind: cnc
workAreaMm:
  x: 200
  y: 200
  z: 50
maxFeedMmMin: 3000
postTemplate: grbl_mm.hbs
dialect: grbl
`

const tomlMinimal = `
id = "bench-toml"
name = "Bench TOML"
kind = "cnc"
maxFeedMmMin = 3000
postTemplate = "grbl_mm.hbs"
dialect = "grbl"

[workAreaMm]
x = 200
y = 200
z = 50
`

const json5WithComments = `{
  // machine
  id: "j5",
  name: "JSON5",
  kind: "cnc",
  workAreaMm: { x: 1, y: 2, z: 3, },
  maxFeedMmMin: 100,
  postTemplate: "grbl_mm.hbs",
  dialect: "grbl",
}`

describe('parseMachineProfileText', () => {
  it('parses JSON without a file hint', () => {
    const j = JSON.stringify({
      id: 'j1',
      name: 'J',
      kind: 'cnc',
      workAreaMm: { x: 1, y: 2, z: 3 },
      maxFeedMmMin: 100,
      postTemplate: 'grbl_mm.hbs',
      dialect: 'grbl'
    })
    const m = parseMachineProfileText(j, 'x')
    expect(m.id).toBe('j1')
  })

  it('parses YAML when hint is .yaml', () => {
    const m = parseMachineProfileText(yamlMinimal, 'm.yaml')
    expect(m.id).toBe('bench-yaml')
    expect(m.kind).toBe('cnc')
  })

  it('parses YAML in auto mode when JSON fails', () => {
    const m = parseMachineProfileText(yamlMinimal.trim(), 'noext')
    expect(m.id).toBe('bench-yaml')
  })

  it('parses TOML when hint is .toml', () => {
    const m = parseMachineProfileText(tomlMinimal.trim(), 'm.toml')
    expect(m.id).toBe('bench-toml')
    expect(m.kind).toBe('cnc')
  })

  it('parses TOML in auto mode when earlier parsers fail', () => {
    const m = parseMachineProfileText(tomlMinimal.trim(), 'noext')
    expect(m.id).toBe('bench-toml')
  })

  it('parses JSON5 with comments when hint is .jsonc', () => {
    const m = parseMachineProfileText(json5WithComments, 'profile.jsonc')
    expect(m.id).toBe('j5')
  })

  it('parses JSON5 in auto mode after strict JSON fails', () => {
    const m = parseMachineProfileText(json5WithComments, 'paste')
    expect(m.id).toBe('j5')
  })

  it('rejects empty input', () => {
    expect(() => parseMachineProfileText('   ', 'a.json')).toThrow(/empty/i)
  })
})
