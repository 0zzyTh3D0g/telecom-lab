import { describe, expect, it } from 'vitest'
import { angularFrequency, checkAnswer, gainDb, ohmVoltage, parseQuantity, periodFromFrequency } from './math'

describe('SI quantities and deterministic answers', () => {
  it('converts compatible prefixes', () => {
    expect(parseQuantity('2 ms')).toEqual({ value: 0.002, unit: 's' })
    expect(parseQuantity('500 µA')).toEqual({ value: 0.0005, unit: 'A' })
    expect(parseQuantity('1 kHz')).toEqual({ value: 1000, unit: 'Hz' })
    expect(parseQuantity('10 dB')).toEqual({ value: 10, unit: 'dB' })
    expect(parseQuantity('10 mdB')).toBeNull()
  })
  it('checks value, tolerance and dimension', () => {
    const answer = { kind: 'number' as const, value: 0.002, tolerance: 0.000001, unit: 's' as const }
    expect(checkAnswer('2 ms', answer)).toBe(true)
    expect(checkAnswer('0,002 s', answer)).toBe(true)
    expect(checkAnswer('2 Hz', answer)).toBe(false)
    expect(checkAnswer('3 ms', answer)).toBe(false)
  })
  it('keeps core formulas consistent', () => {
    expect(periodFromFrequency(500)).toBeCloseTo(0.002)
    expect(angularFrequency(100)).toBeCloseTo(200 * Math.PI)
    expect(ohmVoltage(0.05, 220)).toBeCloseTo(11)
    expect(gainDb(20, 2)).toBeCloseTo(10)
  })
})
