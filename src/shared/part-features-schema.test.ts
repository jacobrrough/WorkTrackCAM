import { describe, expect, it } from 'vitest'
import { defaultPartFeatures, partFeaturesFileSchema } from './part-features-schema'

describe('part-features-schema', () => {
  it('defaultPartFeatures round-trips through schema', () => {
    const d = defaultPartFeatures()
    const raw = JSON.stringify(d)
    const again = partFeaturesFileSchema.parse(JSON.parse(raw) as unknown)
    expect(again.version).toBe(d.version)
    expect(again.items).toEqual(d.items)
  })

  it('parses kernel rectangular pattern + boolean cylinder (project file shape)', () => {
    const raw = {
      version: 1,
      items: [
        { id: 'sk1', kind: 'sketch', label: 'Sketch1' },
        { id: 'ex1', kind: 'extrude', label: 'Extrude1' }
      ],
      kernelOps: [
        { kind: 'pattern_rectangular', countX: 2, countY: 1, spacingXMm: 35, spacingYMm: 0 },
        {
          kind: 'boolean_subtract_cylinder',
          centerXMm: 0,
          centerYMm: 0,
          radiusMm: 3,
          zMinMm: 2,
          zMaxMm: 8
        }
      ]
    }
    const parsed = partFeaturesFileSchema.parse(raw)
    expect(parsed.kernelOps).toHaveLength(2)
  })

  it('parses directional fillet/chamfer ops', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        { kind: 'fillet_select', radiusMm: 0.8, edgeDirection: '+Z' },
        { kind: 'chamfer_select', lengthMm: 0.6, edgeDirection: '-X' }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('fillet_select')
    expect(parsed.kernelOps?.[1]?.kind).toBe('chamfer_select')
  })

  // --- FG-5b: picked-edge / picked-face OCCT-id targeting (additive) ---

  it('FG-5b back-compat: directional fillet/chamfer/shell WITHOUT picked ids still parse', () => {
    // Exactly the pre-FG-5b shape: axis-bucket only, no pickedEdgeIds / pickedFaceIds.
    const legacy = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        { kind: 'fillet_select', radiusMm: 0.8, edgeDirection: '+Z' },
        { kind: 'chamfer_select', lengthMm: 0.6, edgeDirection: '-X' },
        { kind: 'shell_inward', thicknessMm: 2, openDirection: '+Z' }
      ]
    })
    const fillet = legacy.kernelOps?.[0]
    const chamfer = legacy.kernelOps?.[1]
    const shell = legacy.kernelOps?.[2]
    expect(fillet && fillet.kind === 'fillet_select' && fillet.pickedEdgeIds).toBeUndefined()
    expect(chamfer && chamfer.kind === 'chamfer_select' && chamfer.pickedEdgeIds).toBeUndefined()
    expect(shell && shell.kind === 'shell_inward' && shell.pickedFaceIds).toBeUndefined()
  })

  it('FG-5b parses fillet_select / chamfer_select with pickedEdgeIds (occt hash strings)', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        { kind: 'fillet_select', radiusMm: 1.2, edgeDirection: '+Z', pickedEdgeIds: ['2147480001', '99887766'] },
        { kind: 'chamfer_select', lengthMm: 0.5, edgeDirection: '-X', pickedEdgeIds: ['123456789'] }
      ]
    })
    const fillet = parsed.kernelOps?.[0]
    const chamfer = parsed.kernelOps?.[1]
    expect(fillet && fillet.kind === 'fillet_select' && fillet.pickedEdgeIds).toEqual(['2147480001', '99887766'])
    expect(chamfer && chamfer.kind === 'chamfer_select' && chamfer.pickedEdgeIds).toEqual(['123456789'])
    // edgeDirection is retained as the fallback alongside the picked ids.
    expect(fillet && fillet.kind === 'fillet_select' && fillet.edgeDirection).toBe('+Z')
  })

  it('FG-5b parses shell_inward with pickedFaceIds', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        { kind: 'shell_inward', thicknessMm: 1.5, openDirection: '+Z', pickedFaceIds: ['555000111'] }
      ]
    })
    const shell = parsed.kernelOps?.[0]
    expect(shell && shell.kind === 'shell_inward' && shell.pickedFaceIds).toEqual(['555000111'])
  })

  it('FG-5b rejects an empty pickedEdgeIds array (omit the field to mean "axis bucket")', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'fillet_select', radiusMm: 1, edgeDirection: '+Z', pickedEdgeIds: [] }]
      })
    ).toThrow()
  })

  it('FG-5b rejects an empty-string id inside pickedFaceIds', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'shell_inward', thicknessMm: 2, pickedFaceIds: [''] }]
      })
    ).toThrow()
  })

  it('parses shell_inward with openDirection on any world axis', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        { kind: 'shell_inward', thicknessMm: 2 },
        { kind: 'shell_inward', thicknessMm: 1.5, openDirection: '+X' },
        { kind: 'shell_inward', thicknessMm: 1, openDirection: '-Y' }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('shell_inward')
    expect(parsed.kernelOps?.[1]).toMatchObject({ openDirection: '+X' })
    expect(parsed.kernelOps?.[2]).toMatchObject({ openDirection: '-Y' })
  })

  it('rejects non-finite kernel mm (e.g. fillet_all radius Infinity)', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'fillet_all', radiusMm: Number.POSITIVE_INFINITY }]
      })
    ).toThrow()
  })

  it('parses boolean_union_box', () => {
    const raw = {
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'boolean_union_box',
          xMinMm: 0,
          xMaxMm: 10,
          yMinMm: 0,
          yMaxMm: 10,
          zMinMm: 5,
          zMaxMm: 8
        }
      ]
    }
    const parsed = partFeaturesFileSchema.parse(raw)
    expect(parsed.kernelOps?.[0]?.kind).toBe('boolean_union_box')
  })

  it('parses boolean_subtract_box', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'boolean_subtract_box',
          xMinMm: -3,
          xMaxMm: 3,
          yMinMm: -3,
          yMaxMm: 3,
          zMinMm: 2,
          zMaxMm: 8
        }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('boolean_subtract_box')
  })

  it('rejects degenerate boolean_subtract_box', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [
          {
            kind: 'boolean_subtract_box',
            xMinMm: 0,
            xMaxMm: 0,
            yMinMm: 0,
            yMaxMm: 1,
            zMinMm: 0,
            zMaxMm: 1
          }
        ]
      })
    ).toThrow()
  })

  it('rejects degenerate boolean_union_box', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [
          {
            kind: 'boolean_union_box',
            xMinMm: 0,
            xMaxMm: 0,
            yMinMm: 0,
            yMaxMm: 1,
            zMinMm: 0,
            zMaxMm: 1
          }
        ]
      })
    ).toThrow()
  })

  it('parses sheet_tab_union', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'sheet_tab_union',
          centerXMm: 5,
          centerYMm: 0,
          zBaseMm: 1,
          lengthMm: 12,
          widthMm: 6,
          heightMm: 4
        }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('sheet_tab_union')
  })

  it('rejects sheet_tab_union with non-finite mm (kernel also validates pre-OCC)', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [
          {
            kind: 'sheet_tab_union',
            centerXMm: Number.POSITIVE_INFINITY,
            centerYMm: 0,
            zBaseMm: 0,
            lengthMm: 10,
            widthMm: 10,
            heightMm: 5
          }
        ]
      })
    ).toThrow()
  })

  it('rejects 1x1 pattern', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'pattern_rectangular', countX: 1, countY: 1, spacingXMm: 1, spacingYMm: 1 }]
      })
    ).toThrow()
  })

  it('parses pattern_circular', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'pattern_circular',
          count: 6,
          centerXMm: 0,
          centerYMm: 0,
          startAngleDeg: 0,
          totalAngleDeg: 360
        }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('pattern_circular')
  })

  it('rejects pattern_circular count < 2', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'pattern_circular', count: 1, centerXMm: 0, centerYMm: 0 }]
      })
    ).toThrow()
  })

  it('parses pattern_linear_3d', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'pattern_linear_3d', count: 3, dxMm: 10, dyMm: 0, dzMm: 5 }]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('pattern_linear_3d')
  })

  it('parses pattern_path', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'pattern_path', count: 5, pathPoints: [[0, 0], [10, 0], [10, 10]] }]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('pattern_path')
  })

  it('rejects pattern_path with no non-zero segment', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'pattern_path', count: 3, pathPoints: [[1, 1], [1, 1], [1, 1]] }]
      })
    ).toThrow()
  })

  it('parses pattern_path with closedPath', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'pattern_path',
          count: 4,
          closedPath: true,
          pathPoints: [
            [0, 0],
            [10, 0],
            [5, 8]
          ]
        }
      ]
    })
    expect(parsed.kernelOps?.[0]).toMatchObject({ kind: 'pattern_path', closedPath: true })
  })

  it('rejects pattern_path closedPath with fewer than 3 points', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [
          {
            kind: 'pattern_path',
            count: 2,
            closedPath: true,
            pathPoints: [
              [0, 0],
              [10, 0]
            ]
          }
        ]
      })
    ).toThrow()
  })

  it('rejects pattern_linear_3d with zero step', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'pattern_linear_3d', count: 3, dxMm: 0, dyMm: 0, dzMm: 0 }]
      })
    ).toThrow()
  })

  it('parses mirror_union_plane with default origins', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'mirror_union_plane', plane: 'XZ' }]
    })
    const op = parsed.kernelOps?.[0]
    expect(op && op.kind === 'mirror_union_plane' && op.originXMm).toBe(0)
  })

  it('parses mirror_union_plane with explicit offset origin', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'mirror_union_plane',
          plane: 'YZ',
          originXMm: 15,
          originYMm: -2.5,
          originZMm: 0
        }
      ]
    })
    const op = parsed.kernelOps?.[0]
    expect(op && op.kind === 'mirror_union_plane').toBe(true)
    if (op && op.kind === 'mirror_union_plane') {
      expect(op.originXMm).toBe(15)
      expect(op.originYMm).toBe(-2.5)
      expect(op.originZMm).toBe(0)
    }
  })

  it('parses boolean_intersect_box', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'boolean_intersect_box',
          xMinMm: -2,
          xMaxMm: 2,
          yMinMm: -2,
          yMaxMm: 2,
          zMinMm: 1,
          zMaxMm: 6
        }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('boolean_intersect_box')
  })

  it('parses boolean_combine_profile', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'boolean_combine_profile', mode: 'subtract', profileIndex: 1, extrudeDepthMm: 10, zStartMm: 2 }]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('boolean_combine_profile')
  })

  it('parses split_keep_halfspace', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'split_keep_halfspace', axis: 'Z', offsetMm: 3.5, keep: 'positive' }]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('split_keep_halfspace')
  })

  it('parses split_keep_halfspace with keep negative and non-zero offset', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'split_keep_halfspace', axis: 'Y', offsetMm: 5, keep: 'negative' }]
    })
    expect(parsed.kernelOps?.[0]).toMatchObject({
      kind: 'split_keep_halfspace',
      axis: 'Y',
      offsetMm: 5,
      keep: 'negative'
    })
  })

  it('parses hole_from_profile (depth + through_all)', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        { kind: 'hole_from_profile', profileIndex: 0, mode: 'depth', depthMm: 6, zStartMm: 1 },
        { kind: 'hole_from_profile', profileIndex: 1, mode: 'through_all', zStartMm: 0 }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('hole_from_profile')
    expect(parsed.kernelOps?.[1]?.kind).toBe('hole_from_profile')
  })

  it('rejects hole_from_profile depth mode without depthMm', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'hole_from_profile', profileIndex: 0, mode: 'depth', zStartMm: 0 }]
      })
    ).toThrow()
  })

  // ── HOLE WIZARD (Phase-3): holeType + counterbore / countersink + tap metadata ──
  describe('hole_from_profile — hole wizard (Fusion parity)', () => {
    const parseHole = (op: unknown): unknown =>
      partFeaturesFileSchema.parse({ version: 1, items: [], kernelOps: [op] }).kernelOps?.[0]

    it('legacy hole (no holeType) parses and stays absent (kernel treats as simple)', () => {
      const op = parseHole({
        kind: 'hole_from_profile',
        profileIndex: 0,
        mode: 'through_all',
        zStartMm: 0
      }) as { holeType?: string }
      // Safety Rule 2: an old saved hole with NO holeType key still parses AND
      // stays absent on disk — the kernel treats an absent holeType as a straight
      // (simple) bore, so old + new simple holes are byte-identical.
      expect(op.holeType).toBeUndefined()
    })

    it('accepts an explicit simple hole', () => {
      expect(() =>
        parseHole({
          kind: 'hole_from_profile',
          profileIndex: 0,
          mode: 'through_all',
          zStartMm: 0,
          holeType: 'simple'
        })
      ).not.toThrow()
    })

    it('accepts a counterbore with diameter + depth', () => {
      const op = parseHole({
        kind: 'hole_from_profile',
        profileIndex: 1,
        mode: 'through_all',
        zStartMm: 0,
        holeType: 'counterbore',
        cboreDiameterMm: 12,
        cboreDepthMm: 4
      }) as { holeType?: string; cboreDiameterMm?: number; cboreDepthMm?: number }
      expect(op.holeType).toBe('counterbore')
      expect(op.cboreDiameterMm).toBe(12)
      expect(op.cboreDepthMm).toBe(4)
    })

    it('rejects a counterbore missing its required fields', () => {
      for (const missing of [
        { cboreDepthMm: 4 }, // no diameter
        { cboreDiameterMm: 12 }, // no depth
        {} // neither
      ]) {
        expect(() =>
          parseHole({
            kind: 'hole_from_profile',
            profileIndex: 0,
            mode: 'through_all',
            zStartMm: 0,
            holeType: 'counterbore',
            ...missing
          })
        ).toThrow()
      }
    })

    it('rejects non-positive counterbore dimensions', () => {
      expect(() =>
        parseHole({
          kind: 'hole_from_profile',
          profileIndex: 0,
          mode: 'through_all',
          zStartMm: 0,
          holeType: 'counterbore',
          cboreDiameterMm: 0,
          cboreDepthMm: 4
        })
      ).toThrow()
    })

    it('accepts a countersink with diameter + included angle (82/90/100/120)', () => {
      for (const angle of [82, 90, 100, 120]) {
        const op = parseHole({
          kind: 'hole_from_profile',
          profileIndex: 0,
          mode: 'depth',
          depthMm: 8,
          zStartMm: 0,
          holeType: 'countersink',
          csinkDiameterMm: 10,
          csinkAngleDeg: angle
        }) as { holeType?: string; csinkAngleDeg?: number }
        expect(op.holeType).toBe('countersink')
        expect(op.csinkAngleDeg).toBe(angle)
      }
    })

    it('rejects a countersink missing its required fields', () => {
      for (const missing of [{ csinkAngleDeg: 90 }, { csinkDiameterMm: 10 }, {}]) {
        expect(() =>
          parseHole({
            kind: 'hole_from_profile',
            profileIndex: 0,
            mode: 'through_all',
            zStartMm: 0,
            holeType: 'countersink',
            ...missing
          })
        ).toThrow()
      }
    })

    it('rejects a countersink angle outside (0, 180)', () => {
      for (const angle of [0, -10, 180, 200]) {
        expect(() =>
          parseHole({
            kind: 'hole_from_profile',
            profileIndex: 0,
            mode: 'through_all',
            zStartMm: 0,
            holeType: 'countersink',
            csinkDiameterMm: 10,
            csinkAngleDeg: angle
          })
        ).toThrow()
      }
    })

    it('records a tap designation (metadata) on any hole type', () => {
      const op = parseHole({
        kind: 'hole_from_profile',
        profileIndex: 0,
        mode: 'through_all',
        zStartMm: 0,
        holeType: 'simple',
        tapDesignation: 'M5x0.8'
      }) as { tapDesignation?: string }
      expect(op.tapDesignation).toBe('M5x0.8')
    })

    it('rejects an empty tap designation string', () => {
      expect(() =>
        parseHole({
          kind: 'hole_from_profile',
          profileIndex: 0,
          mode: 'through_all',
          zStartMm: 0,
          tapDesignation: ''
        })
      ).toThrow()
    })

    it('rejects an unknown hole type', () => {
      expect(() =>
        parseHole({
          kind: 'hole_from_profile',
          profileIndex: 0,
          mode: 'through_all',
          zStartMm: 0,
          holeType: 'spotface'
        })
      ).toThrow()
    })
  })

  it('parses thread_cosmetic', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'thread_cosmetic',
          centerXMm: 0,
          centerYMm: 0,
          majorRadiusMm: 4,
          pitchMm: 1.5,
          lengthMm: 8,
          depthMm: 0.4,
          zStartMm: 0
        }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('thread_cosmetic')
  })

  it('parses transform_translate', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'transform_translate', dxMm: 10, dyMm: -5, dzMm: 2, keepOriginal: true }]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('transform_translate')
  })

  it('parses press_pull_profile and rejects zero delta', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'press_pull_profile', profileIndex: 0, deltaMm: 2, zStartMm: 0 }]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('press_pull_profile')
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'press_pull_profile', profileIndex: 0, deltaMm: 0, zStartMm: 0 }]
      })
    ).toThrow()
  })

  it('parses sweep_profile_path and rejects degenerate path', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'sweep_profile_path', profileIndex: 0, pathPoints: [[0, 0], [10, 0]], zStartMm: 0 }]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('sweep_profile_path')
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'sweep_profile_path', profileIndex: 0, pathPoints: [[1, 1], [1, 1]], zStartMm: 0 }]
      })
    ).toThrow()
  })

  it('parses sweep_profile_path_true with fixed normal mode', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'sweep_profile_path_true',
          profileIndex: 0,
          pathPoints: [[0, 0], [10, 0], [10, 8]],
          zStartMm: 0,
          orientationMode: 'fixed_normal',
          fixedNormal: [0, 0, 1]
        }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('sweep_profile_path_true')
  })

  it('parses pipe_path and rejects invalid wall thickness', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'pipe_path', pathPoints: [[0, 0], [5, 0]], outerRadiusMm: 2, wallThicknessMm: 0.5, zStartMm: 0 }]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('pipe_path')
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'pipe_path', pathPoints: [[0, 0], [5, 0]], outerRadiusMm: 2, wallThicknessMm: 2, zStartMm: 0 }]
      })
    ).toThrow()
  })

  it('parses thicken_scale and rejects zero delta', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'thicken_scale', deltaMm: 1.5 }]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('thicken_scale')
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'thicken_scale', deltaMm: 0 }]
      })
    ).toThrow()
  })

  it('parses thicken_offset and rejects zero distance', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'thicken_offset', distanceMm: 1.25, side: 'both' }]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('thicken_offset')
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'thicken_offset', distanceMm: 0, side: 'outward' }]
      })
    ).toThrow()
  })

  it('parses thread_wizard modeled/cosmetic variants', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'thread_wizard',
          centerXMm: 0,
          centerYMm: 0,
          majorRadiusMm: 4,
          pitchMm: 1.5,
          lengthMm: 8,
          depthMm: 0.4,
          zStartMm: 0,
          mode: 'modeled',
          hand: 'right',
          standard: 'ISO',
          designation: 'M8x1.25',
          class: '6g',
          starts: 1
        },
        {
          kind: 'thread_wizard',
          centerXMm: 0,
          centerYMm: 0,
          majorRadiusMm: 4,
          pitchMm: 1.5,
          lengthMm: 8,
          depthMm: 0.4,
          zStartMm: 0,
          mode: 'cosmetic',
          hand: 'left',
          standard: 'ISO',
          designation: 'M8x1.25',
          class: '6g',
          starts: 2
        }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('thread_wizard')
    expect(parsed.kernelOps?.[1]?.kind).toBe('thread_wizard')
  })

  it('parses coil_cut', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'coil_cut',
          centerXMm: 0,
          centerYMm: 0,
          majorRadiusMm: 4,
          pitchMm: 1.5,
          turns: 4,
          depthMm: 0.4,
          zStartMm: 0
        }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('coil_cut')
  })

  it('rejects boolean_combine_profile with negative profileIndex', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'boolean_combine_profile', mode: 'union', profileIndex: -1, extrudeDepthMm: 5 }]
      })
    ).toThrow()
  })

  it('accepts suppressed on kernel ops', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [{ kind: 'fillet_all', radiusMm: 1, suppressed: true }]
    })
    expect(parsed.kernelOps?.[0]).toMatchObject({ kind: 'fillet_all', suppressed: true })
  })

  // --- Editable timeline (suppress + roll-back) additive fields ---

  it('back-compat: a features file WITHOUT the new timeline fields still parses (load-bearing)', () => {
    // Exactly the shape an existing v1 part/features.json had before the editable
    // timeline landed: kernel ops with NO `suppressed`, and NO `rolledBackTo`.
    const legacy = {
      version: 1,
      items: [{ id: 'sk1', kind: 'sketch', label: 'Sketch1' }],
      kernelOps: [
        { kind: 'fillet_all', radiusMm: 1 },
        { kind: 'chamfer_all', lengthMm: 0.5 }
      ]
    }
    const parsed = partFeaturesFileSchema.parse(legacy)
    // Old files gain neither field — `rolledBackTo` stays absent (means "build all"),
    // and per-op `suppressed` stays undefined.
    expect(parsed.rolledBackTo).toBeUndefined()
    expect(parsed.kernelOps?.[0]?.suppressed).toBeUndefined()
    expect(parsed.kernelOps).toHaveLength(2)
  })

  it('round-trips a features file WITH rolledBackTo and per-op suppressed', () => {
    const withTimeline = {
      version: 1 as const,
      items: [],
      kernelOps: [
        { kind: 'fillet_all' as const, radiusMm: 1 },
        { kind: 'chamfer_all' as const, lengthMm: 0.5, suppressed: true },
        { kind: 'shell_inward' as const, thicknessMm: 2 }
      ],
      rolledBackTo: 1
    }
    const raw = JSON.stringify(withTimeline)
    const again = partFeaturesFileSchema.parse(JSON.parse(raw) as unknown)
    expect(again.rolledBackTo).toBe(1)
    expect(again.kernelOps?.[1]).toMatchObject({ kind: 'chamfer_all', suppressed: true })
    expect(again.kernelOps).toHaveLength(3)
  })

  it('accepts rolledBackTo of -1 (explicit "build all" sentinel) and rejects < -1', () => {
    expect(partFeaturesFileSchema.parse({ version: 1, items: [], rolledBackTo: -1 }).rolledBackTo).toBe(-1)
    expect(() => partFeaturesFileSchema.parse({ version: 1, items: [], rolledBackTo: -2 })).toThrow()
    expect(() => partFeaturesFileSchema.parse({ version: 1, items: [], rolledBackTo: 1.5 })).toThrow()
  })

  it('parses sheet_fold and sheet_flat_pattern', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'sheet_fold',
          bendLineYMm: 12,
          bendRadiusMm: 1.5,
          bendAngleDeg: 90,
          kFactor: 0.42,
          bendAllowanceMode: 'k_factor'
        },
        {
          kind: 'sheet_flat_pattern',
          includeBendLines: true
        }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('sheet_fold')
    expect(parsed.kernelOps?.[1]?.kind).toBe('sheet_flat_pattern')
  })

  it('parses loft_guide_rails and plastic MVP ops', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'loft_guide_rails',
          rails: [
            [
              [0, 0],
              [10, 0],
              [10, 5]
            ]
          ]
        },
        {
          kind: 'plastic_rule_fillet',
          radiusMm: 0.8
        },
        {
          kind: 'plastic_boss',
          centerXMm: 0,
          centerYMm: 0,
          zBaseMm: 0,
          outerRadiusMm: 3,
          holeRadiusMm: 1.2,
          heightMm: 5
        },
        {
          kind: 'plastic_lip_groove',
          mode: 'groove',
          xMinMm: -5,
          xMaxMm: 5,
          yMinMm: -1,
          yMaxMm: 1,
          zBaseMm: 2,
          depthMm: 1.5
        }
      ]
    })
    expect(parsed.kernelOps?.[0]?.kind).toBe('loft_guide_rails')
    expect(parsed.kernelOps?.[1]?.kind).toBe('plastic_rule_fillet')
    expect(parsed.kernelOps?.[2]?.kind).toBe('plastic_boss')
    expect(parsed.kernelOps?.[3]?.kind).toBe('plastic_lip_groove')
  })

  it('rejects degenerate boolean_intersect_box', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [
          {
            kind: 'boolean_intersect_box',
            xMinMm: 0,
            xMaxMm: 0,
            yMinMm: 0,
            yMaxMm: 1,
            zMinMm: 0,
            zMaxMm: 1
          }
        ]
      })
    ).toThrow()
  })

  // --- Construct datums (reference-geometry marker ops; no solid change) ---

  it('parses datum_plane / datum_axis / datum_point (offset 0 allowed; labels optional)', () => {
    const parsed = partFeaturesFileSchema.parse({
      version: 1,
      items: [],
      kernelOps: [
        { kind: 'datum_plane', basePlane: 'XY', offsetMm: 5, label: 'mid plane' },
        // offset 0 is valid (a coincident reference plane is still useful).
        { kind: 'datum_plane', basePlane: 'YZ', offsetMm: 0 },
        { kind: 'datum_axis', axis: 'Z', originXMm: 1, originYMm: 2, originZMm: 3 },
        // datum_axis origins default to 0 when omitted.
        { kind: 'datum_axis', axis: 'X' },
        { kind: 'datum_point', xMm: 4, yMm: 5, zMm: 6, label: 'top center' }
      ]
    })
    expect(parsed.kernelOps).toHaveLength(5)
    expect(parsed.kernelOps?.[0]?.kind).toBe('datum_plane')
    const axisDefaulted = parsed.kernelOps?.[3]
    expect(axisDefaulted && axisDefaulted.kind === 'datum_axis' && axisDefaulted.originXMm).toBe(0)
  })

  it('rejects a datum_plane with a non-canonical base plane', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'datum_plane', basePlane: 'XX', offsetMm: 1 }]
      })
    ).toThrow()
  })

  it('rejects a datum_point with non-finite coordinates', () => {
    expect(() =>
      partFeaturesFileSchema.parse({
        version: 1,
        items: [],
        kernelOps: [{ kind: 'datum_point', xMm: Number.NaN, yMm: 0, zMm: 0 }]
      })
    ).toThrow()
  })
})
