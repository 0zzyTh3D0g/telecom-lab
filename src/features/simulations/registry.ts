import { lazy } from 'react'
import { z } from 'zod'

const range = z.object({ min: z.number().finite(), max: z.number().finite(), default: z.number().finite() }).strict().refine(v => v.min < v.max && v.default >= v.min && v.default <= v.max, 'Intervallo non coerente.')
const sineConfig = z.object({ amplitude: range.optional(), frequency: range.optional(), phase: range.optional() }).strict()
const ohmConfig = z.object({ voltage: range.optional(), resistance: range.optional() }).strict()
const decibelConfig = z.object({ input: range.optional(), output: range.optional() }).strict()
const amConfig = z.object({ carrier: range.optional(), modulating: range.optional(), depth: range.optional() }).strict()

export const simulationIds = ['signal-sine', 'ohm-law', 'decibel-gain', 'am-wave'] as const
export type SimulationId = typeof simulationIds[number]
const schemas = { 'signal-sine': sineConfig, 'ohm-law': ohmConfig, 'decibel-gain': decibelConfig, 'am-wave': amConfig }
export const simulationRegistry = {
  'signal-sine': lazy(() => import('./SignalSine')),
  'ohm-law': lazy(() => import('./OhmLaw')),
  'decibel-gain': lazy(() => import('./DecibelGain')),
  'am-wave': lazy(() => import('./AmWave')),
}

export function isSimulationId(id: string): id is SimulationId { return simulationIds.includes(id as SimulationId) }
export function validateSimulationConfig(id: string, config: Record<string, unknown>): string[] {
  if (!isSimulationId(id)) return ['Simulazione sconosciuta.']
  const result = schemas[id].safeParse(config)
  return result.success ? [] : result.error.issues.map(issue => `config.${issue.path.join('.')}: ${issue.message}`)
}
export function getConfigRange(config: Record<string, unknown>, name: string, fallback: { min: number; max: number; default: number }) {
  const value = config[name]
  const parsed = range.safeParse(value)
  return parsed.success ? parsed.data : fallback
}
