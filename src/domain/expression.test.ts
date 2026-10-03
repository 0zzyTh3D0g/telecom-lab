import { describe, expect, it } from 'vitest'
import { parseExpression } from './expression'

describe('safe expression grammar', () => {
  it('evaluates supported arithmetic and trigonometry', () => { expect(parseExpression('10*sin(2*pi*t)', ['t'])({ t: 0.25 })).toBeCloseTo(10); expect(parseExpression('A/k', ['A','k'])({ A: 10, k: 2 })).toBe(5) })
  it('rejects JavaScript and unlisted variables', () => { expect(() => parseExpression('window.alert(1)', ['x'])).toThrow(); expect(() => parseExpression('secret+1', ['x'])).toThrow() })
  it('rejects invalid functions', () => { expect(() => parseExpression('fetch(x)', ['x'])).toThrow() })
})
