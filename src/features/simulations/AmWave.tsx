import { useMemo, useState } from 'react'
import { getConfigRange } from './registry'
import { Control, WaveChart } from './shared'

export default function AmWave({ config = {} }: { config?: Record<string, unknown> }) {
  const carrierRange = getConfigRange(config, 'carrier', { min: 5, max: 20, default: 12 })
  const modulatingRange = getConfigRange(config, 'modulating', { min: 1, max: 4, default: 2 })
  const depthRange = getConfigRange(config, 'depth', { min: 0, max: 100, default: 60 })
  const [carrier, setCarrier] = useState(carrierRange.default), [modulating, setModulating] = useState(modulatingRange.default), [depth, setDepth] = useState(depthRange.default)
  const points = useMemo(() => Array.from({ length: 480 }, (_, i) => (1 + depth / 100 * Math.sin(2 * Math.PI * modulating * i / 479)) * Math.sin(2 * Math.PI * carrier * i / 479)), [carrier, modulating, depth])
  const envelope = useMemo(() => Array.from({ length: 480 }, (_, i) => 1 + depth / 100 * Math.sin(2 * Math.PI * modulating * i / 479)), [modulating, depth])
  return <div className="simulation-shell"><div className="simulation-head"><div><span className="eyebrow">MODELLO INTERATTIVO · MODULAZIONE</span><h3>Modulazione AM</h3><p>L’inviluppo segue il segnale modulante.</p></div><span className="live-pill"><span /> In tempo reale</span></div><div className="simulation-grid"><div className="simulation-plot"><WaveChart lines={[{ points, color: 'var(--accent)', label: 'Segnale AM' }, { points: envelope, color: 'var(--gold)', label: 'Inviluppo' }]} yLabel="Ampiezza" xLabel="Tempo relativo" /></div><div className="simulation-controls"><h4>Parametri</h4><Control label="Cicli portante" value={carrier} onChange={setCarrier} {...carrierRange} step={1} unit="" /><Control label="Cicli modulante" value={modulating} onChange={setModulating} {...modulatingRange} step={1} unit="" /><Control label="Indice di modulazione" value={depth} onChange={setDepth} {...depthRange} step={5} unit="%" /><div className="equation-readout">s(t) = [1 + {depth / 100}·sin(2πfₘt)] sin(2πf꜀t)</div></div></div></div>
}
