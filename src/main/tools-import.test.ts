import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  bufferToUtf8ToolXml,
  inferToolRecordsFromFileBuffer,
  parseFusionToolExport,
  parseFusionToolsCsv,
  parseHsmToolLibraryXml,
  parseToolsCsv,
  splitCsvLine
} from './tools-import'

describe('parseToolsCsv', () => {
  it('parses header and rows', () => {
    const csv = `name,diameterMm,fluteCount,type
Rough,6.35,3,endmill`
    const tools = parseToolsCsv(csv)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('Rough')
    expect(tools[0]!.diameterMm).toBeCloseTo(6.35)
    expect(tools[0]!.fluteCount).toBe(3)
  })
})

describe('parseFusionToolExport', () => {
  it('maps diameter fields', () => {
    const j = JSON.stringify([{ name: 'T1', diameter: 3.0, fluteCount: 2 }])
    const tools = parseFusionToolExport(j)
    expect(tools[0]!.diameterMm).toBe(3)
  })
})

describe('splitCsvLine', () => {
  it('handles quoted commas', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
  })
})

describe('parseFusionToolsCsv', () => {
  it('parses wide header and quoted rows', () => {
    const csv = [
      'Name [desc],Tool Diameter (mm) [diameter],Flutes',
      '"Rough, 6mm",6.0,3',
      'Finish,3.175,2'
    ].join('\n')
    const tools = parseFusionToolsCsv(csv)
    expect(tools).toHaveLength(2)
    expect(tools[0]!.diameterMm).toBe(6)
    expect(tools[0]!.name).toContain('Rough')
    expect(tools[1]!.diameterMm).toBeCloseTo(3.175)
  })

  it('maps stickout, overall length, and material columns when present', () => {
    const csv = [
      'Name,Tool Diameter (mm),Stickout (mm),Overall tool length (mm),Material',
      'T1,6,18,50,Carbide'
    ].join('\n')
    const tools = parseFusionToolsCsv(csv)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.stickoutMm).toBe(18)
    expect(tools[0]!.lengthMm).toBe(50)
    expect(tools[0]!.material).toBe('Carbide')
  })
})

describe('parseHsmToolLibraryXml', () => {
  it('parses Tool blocks (mm and inch diameter)', () => {
    const xml = `<Lib>
      <Tool><Description>A</Description><Diameter>4</Diameter><NumberOfFlutes>2</NumberOfFlutes></Tool>
      <hsm:Tool xmlns:hsm="x"><hsm:Name>B</hsm:Name><hsm:Diameter unit="inch">0.25</hsm:Diameter></hsm:Tool>
    </Lib>`
    const tools = parseHsmToolLibraryXml(xml)
    expect(tools).toHaveLength(2)
    expect(tools[0]!.diameterMm).toBe(4)
    expect(tools[0]!.source).toBe('hsm')
    expect(tools[1]!.diameterMm).toBeCloseTo(6.35)
  })

  it('maps extended HSM fields and tool type', () => {
    const xml = `<Tool>
      <Description>Ball finisher</Description>
      <ToolType>Ball nose end mill</ToolType>
      <Diameter>3</Diameter>
      <Stickout>12.5</Stickout>
      <OverallLength>38</OverallLength>
      <Material>Carbide</Material>
    </Tool>`
    const tools = parseHsmToolLibraryXml(xml)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.type).toBe('ball')
    expect(tools[0]!.stickoutMm).toBeCloseTo(12.5)
    expect(tools[0]!.lengthMm).toBe(38)
    expect(tools[0]!.material).toBe('Carbide')
  })

  it('skips Tool blocks without a positive diameter', () => {
    const xml = `<Lib>
      <Tool><Description>No dia</Description></Tool>
      <Tool><Description>Ok</Description><Diameter>2</Diameter></Tool>
      <Tool><Description>Bad</Description><Diameter>0</Diameter></Tool>
    </Lib>`
    const tools = parseHsmToolLibraryXml(xml)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('Ok')
    expect(tools[0]!.diameterMm).toBe(2)
  })

  it('dedupes identical name+diameter pairs', () => {
    const xml = `<Tool><Description>Same</Description><Diameter>4</Diameter></Tool>
      <Tool><Description>Same</Description><Diameter>4</Diameter></Tool>`
    const tools = parseHsmToolLibraryXml(xml)
    expect(tools).toHaveLength(1)
  })
})

describe('bufferToUtf8ToolXml', () => {
  it('gunzips buffers with gzip magic', () => {
    const inner = '<Tool><Description>X</Description><Diameter>2</Diameter></Tool>'
    const buf = gzipSync(Buffer.from(inner, 'utf-8'))
    expect(bufferToUtf8ToolXml(buf)).toContain('Description')
  })
})

describe('inferToolRecordsFromFileBuffer', () => {
  it('reads gzipped hsmlib by file name', () => {
    const xml = '<Tool><Description>Z</Description><Diameter>5</Diameter></Tool>'
    const buf = gzipSync(Buffer.from(xml, 'utf-8'))
    const tools = inferToolRecordsFromFileBuffer('MyLib.hsmlib', buf)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('Z')
  })

  it('reads gzipped tpgz by extension', () => {
    const xml = '<Tool><Description>Tpgz</Description><Diameter>6</Diameter></Tool>'
    const buf = gzipSync(Buffer.from(xml, 'utf-8'))
    const tools = inferToolRecordsFromFileBuffer('vendor.tpgz', buf)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.diameterMm).toBe(6)
  })

  it('reads gzip-compressed Fusion .tools JSON', () => {
    const json = JSON.stringify({
      data: {
        tools: [
          {
            type: 'flat end mill',
            description: 'Gzip tool',
            NFLUTES: 2,
            geometry: { DC: 3.0, OAL: 40, LCF: 12 }
          }
        ]
      }
    })
    const buf = gzipSync(Buffer.from(json, 'utf-8'))
    const tools = inferToolRecordsFromFileBuffer('Example Tools.tools', buf)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toContain('Gzip')
    expect(tools[0]!.diameterMm).toBe(3)
  })
})
