import { describe, expect, it } from 'vitest'
import { generateFrequency, solveParametric } from './parametric'

describe('registered parametric solver', () => {
  const range = { min: 100, max: 1000, step: 50, unit: 'Hz' as const }
  it('generates a value within the configured grid', () => {
    expect(generateFrequency(range, () => 0)).toBe(100)
    expect(generateFrequency(range, () => 0.999)).toBe(1000)
    expect(generateFrequency(range, () => 0.5) % 50).toBe(0)
  })
  it('calculates the period without evaluating JSON code', () => { expect(solveParametric('period-from-frequency', 500)).toBeCloseTo(0.002) })
})
