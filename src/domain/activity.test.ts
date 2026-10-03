import { describe, expect, it } from 'vitest'
import { activeDelta } from './activity'

describe('active time estimate', () => {
  it('counts a visible recent interval', () => expect(activeDelta(30_000, 0, 10_000, false)).toBe(30))
  it('does not count a hidden tab', () => expect(activeDelta(30_000, 0, 10_000, true)).toBe(0))
  it('does not count an idle session', () => expect(activeDelta(150_000, 120_000, 0, false)).toBe(0))
  it('caps background delays', () => expect(activeDelta(90_000, 0, 30_000, false)).toBe(30))
})
