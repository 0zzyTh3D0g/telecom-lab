import { useMemo, useState } from 'react'
import { angularFrequency, formatNumber, periodFromFrequency } from '../../domain/math'
import { getConfigRange } from './registry'
import { Control, WaveChart } from './shared'

export default function SignalSine({ config = {} }: { config?: Record<string, unknown> }) {
  const amplitudeRange = getConfigRange(config, 'amplitude', { min: 0.5, max: 10, default: 5 })
  const frequencyRange = getConfigRange(config, 'frequency', { min: 20, max: 1000, default: 100 })
  const phaseRange = getConfigRange(config, 'phase', { min: -180, max: 180, default: 45 })
  const [amplitude, setAmplitude] = useState(amplitudeRange.default)
  const [frequency, setFrequency] = useState(frequencyRange.default)
  const [phase, setPhase] = useState(phaseRange.default)
  const points = useMemo(() => Array.from({ length: 640 }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * (i / 639) * 0.03 + phase * Math.PI / 180)), [amplitude, frequency, phase])
  const period = periodFromFrequency(frequency)
  return <div className="simulation-shell"><div className="simulation-head"><div><span className="eyebrow">MODELLO INTERATTIVO · SEGNALI</span><h3>Segnale sinusoidale</h3><p>Modifica i parametri e osserva la forma d’onda in una finestra di 30 ms.</p></div><span className="live-pill"><span /> In tempo reale</span></div>
    <div className="simulation-grid"><div className="simulation-plot"><WaveChart lines={[{ points, color: 'var(--accent)', label: 'v(t)' }]} yLabel="Tensione (V)" xLabel="Tempo (0–30 ms)" /><div className="metric-grid"><div><small>PERIODO</small><strong>{formatNumber(period * 1000)} ms</strong></div><div><small>PULSAZIONE</small><strong>{formatNumber(angularFrequency(frequency))} rad/s</strong></div><div><small>VALORE MASSIMO</small><strong>{formatNumber(amplitude)} V</strong></div></div></div>
      <div className="simulation-controls"><h4>Parametri</h4><Control label="Ampiezza" value={amplitude} onChange={setAmplitude} {...amplitudeRange} step={0.1} unit="V" /><Control label="Frequenza" value={frequency} onChange={setFrequency} {...frequencyRange} step={10} unit="Hz" /><Control label="Fase" value={phase} onChange={setPhase} {...phaseRange} step={5} unit="°" /><div className="equation-readout">v(t) = {formatNumber(amplitude)} sin(2π · {formatNumber(frequency)}t {phase < 0 ? '−' : '+'} {formatNumber(Math.abs(phase) * Math.PI / 180)} rad)</div></div></div>
    <p className="simulation-foot">Il grafico mostra un intervallo fisso di 30 ms. T = 1/f · ω = 2πf.</p></div>
}
