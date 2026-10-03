export function activeDelta(now: number, previousTick: number, lastInteraction: number, hidden: boolean) {
  if (hidden || now - lastInteraction >= 120_000) return 0
  return Math.max(0, Math.min(30, Math.round((now - previousTick) / 1000)))
}
