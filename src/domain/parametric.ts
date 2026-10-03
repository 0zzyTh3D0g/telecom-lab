export type FrequencyRange = { min: number; max: number; step: number; unit: 'Hz' }
export const solverRegistry = { 'period-from-frequency': (frequencyHz: number) => 1 / frequencyHz }
export type SolverId = keyof typeof solverRegistry

export function generateFrequency(range: FrequencyRange, random = Math.random): number {
  const count = Math.floor((range.max - range.min) / range.step) + 1
  const index = Math.min(count - 1, Math.max(0, Math.floor(random() * count)))
  return range.min + index * range.step
}

export function solveParametric(id: SolverId, frequencyHz: number): number {
  return solverRegistry[id](frequencyHz)
}
