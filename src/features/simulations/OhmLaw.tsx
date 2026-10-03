import { useState } from 'react'
import { formatNumber, ohmVoltage } from '../../domain/math'
import { getConfigRange } from './registry'
import { Control } from './shared'

export default function OhmLaw({ config = {} }: { config?: Record<string, unknown> }) {
  const voltageRange = getConfigRange(config, 'voltage', { min: 1, max: 24, default: 12 })
  const resistanceRange = getConfigRange(config, 'resistance', { min: 10, max: 1000, default: 100 })
  const [voltage, setVoltage] = useState(voltageRange.default)
  const [resistance, setResistance] = useState(resistanceRange.default)
  const current = voltage / resistance
  return <div className="simulation-shell"><div className="simulation-head"><div><span className="eyebrow">MODELLO INTERATTIVO · CIRCUITI</span><h3>Legge di Ohm</h3><p>Esplora la relazione tra tensione, resistenza e corrente.</p></div><span className="live-pill"><span /> In tempo reale</span></div><div className="simulation-grid"><div className="simulation-plot ohm-visual"><div className="circuit"><span className="circuit-source">{voltage} V</span><span className="circuit-resistor">R<br />{resistance} Ω</span><span className="circuit-current">I = {formatNumber(current * 1000)} mA →</span></div><div className="metric-grid"><div><small>CORRENTE</small><strong>{formatNumber(current * 1000)} mA</strong></div><div><small>VERIFICA</small><strong>{formatNumber(ohmVoltage(current, resistance))} V</strong></div></div></div><div className="simulation-controls"><h4>Parametri</h4><Control label="Tensione" value={voltage} onChange={setVoltage} {...voltageRange} step={1} unit="V" /><Control label="Resistenza" value={resistance} onChange={setResistance} {...resistanceRange} step={10} unit="Ω" /><div className="equation-readout">I = V / R = {voltage} / {resistance} = {formatNumber(current)} A</div></div></div></div>
}
