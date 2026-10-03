import { useState } from 'react'
import { formatNumber, gainDb } from '../../domain/math'
import { getConfigRange } from './registry'
import { Control } from './shared'

export default function DecibelGain({ config = {} }: { config?: Record<string, unknown> }) {
  const inputRange = getConfigRange(config, 'input', { min: 1, max: 100, default: 10 })
  const outputRange = getConfigRange(config, 'output', { min: 1, max: 100, default: 50 })
  const [input, setInput] = useState(inputRange.default)
  const [output, setOutput] = useState(outputRange.default)
  const gain = gainDb(output, input)
  return <div className="simulation-shell"><div className="simulation-head"><div><span className="eyebrow">MODELLO INTERATTIVO · TELECOMUNICAZIONI</span><h3>Guadagno in decibel</h3><p>Confronta la potenza in ingresso e in uscita.</p></div><span className="live-pill"><span /> In tempo reale</span></div><div className="simulation-grid"><div className="simulation-plot"><div className="bar-comparison"><div><span>Ingresso</span><i style={{ width: `${input}%` }} /><strong>{input} W</strong></div><div><span>Uscita</span><i style={{ width: `${output}%` }} /><strong>{output} W</strong></div></div><div className="metric-grid"><div><small>RAPPORTO</small><strong>{formatNumber(output / input)}×</strong></div><div><small>{gain >= 0 ? 'GUADAGNO' : 'ATTENUAZIONE'}</small><strong>{formatNumber(gain)} dB</strong></div></div></div><div className="simulation-controls"><h4>Parametri</h4><Control label="Potenza ingresso" value={input} onChange={setInput} {...inputRange} step={1} unit="W" /><Control label="Potenza uscita" value={output} onChange={setOutput} {...outputRange} step={1} unit="W" /><div className="equation-readout">G = 10 log₁₀({output} / {input}) = {formatNumber(gain)} dB</div></div></div></div>
}
