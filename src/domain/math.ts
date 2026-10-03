import type { Answer } from './schema'

const prefixes: Record<string, number> = { p: 1e-12, n: 1e-9, 'µ': 1e-6, u: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 }
const units = ['rad/s', 'Hz', 's', 'V', 'A', 'Ω', 'W', 'dB']

export function parseQuantity(input: string): { value: number; unit?: string } | null {
  const match = input.trim().replace(',', '.').match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([pnuµmkMG]?)(rad\/s|Hz|s|V|A|Ω|W|dB)?$/i)
  if (!match) return null
  const value = Number(match[1]) * (prefixes[match[2]] ?? 1)
  if (!Number.isFinite(value)) return null
  const unit = match[3]
  if (unit && !units.includes(unit)) return null
  if (unit === 'dB' && match[2]) return null
  return { value, unit }
}

export function checkAnswer(input: string, answer: Answer): boolean {
  if (answer.kind === 'text') return answer.accepted.some(item => item.trim().toLocaleLowerCase('it') === input.trim().toLocaleLowerCase('it'))
  const parsed = parseQuantity(input)
  if (!parsed || (answer.unit && parsed.unit !== answer.unit)) return false
  return Math.abs(parsed.value - answer.value) <= Math.max(answer.tolerance, Math.abs(answer.value) * 1e-9)
}

export function formatNumber(value: number, digits = 3): string {
  return new Intl.NumberFormat('it-IT', { maximumSignificantDigits: digits }).format(value)
}

export function periodFromFrequency(frequencyHz: number): number { return 1 / frequencyHz }
export function angularFrequency(frequencyHz: number): number { return 2 * Math.PI * frequencyHz }
export function ohmVoltage(currentA: number, resistanceOhm: number): number { return currentA * resistanceOhm }
export function gainDb(powerOut: number, powerIn: number): number { return 10 * Math.log10(powerOut / powerIn) }
