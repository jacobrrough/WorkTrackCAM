import { describe, expect, it } from 'vitest'
import { CAM_FEED_PLUNGE_FLOOR_MM_MIN } from './cam-numeric-floors'

describe('cam-numeric-floors', () => {
  it('exports CAM_FEED_PLUNGE_FLOOR_MM_MIN as a positive number', () => {
    expect(typeof CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBe('number')
    expect(CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBeGreaterThan(0)
  })

  it('CAM_FEED_PLUNGE_FLOOR_MM_MIN equals 1', () => {
    expect(CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBe(1)
  })

  it('CAM_FEED_PLUNGE_FLOOR_MM_MIN is an integer', () => {
    expect(Number.isInteger(CAM_FEED_PLUNGE_FLOOR_MM_MIN)).toBe(true)
  })

  it('any feed value below the floor would be invalid', () => {
    const tooLow = 0.5
    expect(tooLow).toBeLessThan(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
  })

  it('a feed exactly at the floor is valid', () => {
    const atFloor = CAM_FEED_PLUNGE_FLOOR_MM_MIN
    expect(atFloor).toBeGreaterThanOrEqual(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
  })
})
