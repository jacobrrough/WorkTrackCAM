import { describe, expect, it } from 'vitest'
import { siblingCamAlignedStlPath } from './ShopModelViewer'

describe('siblingCamAlignedStlPath', () => {
  it('inserts .cam-aligned before extension', () => {
    expect(siblingCamAlignedStlPath('C:/proj/assets/part.stl')).toBe(
      'C:/proj/assets/part.cam-aligned.stl'
    )
  })

  it('preserves .STL casing', () => {
    expect(siblingCamAlignedStlPath('C:/proj/assets/part.STL')).toBe(
      'C:/proj/assets/part.cam-aligned.STL'
    )
  })

  it('appends when path does not end in .stl', () => {
    expect(siblingCamAlignedStlPath('C:/proj/mesh')).toBe('C:/proj/mesh.cam-aligned.stl')
  })

  it('does not accumulate suffixes when re-aligning an already-aligned path', () => {
    expect(siblingCamAlignedStlPath('C:/proj/assets/part.cam-aligned.stl')).toBe(
      'C:/proj/assets/part.cam-aligned.stl'
    )
    expect(
      siblingCamAlignedStlPath('C:/proj/assets/part.cam-aligned.cam-aligned.cam-aligned.stl')
    ).toBe('C:/proj/assets/part.cam-aligned.stl')
  })

  it('strips accumulated suffixes from extensionless paths too', () => {
    expect(siblingCamAlignedStlPath('C:/proj/mesh.cam-aligned.cam-aligned')).toBe(
      'C:/proj/mesh.cam-aligned.stl'
    )
  })
})
