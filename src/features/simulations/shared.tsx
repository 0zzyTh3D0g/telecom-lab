import { useId } from 'react'

export function Control({ label, value, onChange, min, max, step, unit }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number; unit: string }) {
  const id = useId()
  return <div className="control"><div className="control-head"><label htmlFor={id}>{label}</label><strong>{value} <span>{unit}</span></strong></div><input id={id} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /><div className="range-ends"><span>{min} {unit}</span><span>{max} {unit}</span></div></div>
}

export function WaveChart({ lines, xLabel = 'Tempo', yLabel = 'Ampiezza' }: { lines: { points: number[]; color: string; label: string }[]; xLabel?: string; yLabel?: string }) {
  const width = 720, height = 260, padX = 42, padY = 24
  const all = lines.flatMap(line => line.points)
  const peak = Math.max(1, ...all.map(Math.abs)) * 1.18
  const toPoints = (points: number[]) => points.map((y, index) => `${padX + (index / (points.length - 1)) * (width - padX - 16)},${height / 2 - y / peak * (height / 2 - padY)}`).join(' ')
  return <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${yLabel} rispetto a ${xLabel}: ${lines.map(line => line.label).join(', ')}`}>
    <defs><pattern id="chart-grid" width="60" height="52" patternUnits="userSpaceOnUse"><path d="M 60 0 L 0 0 0 52" fill="none" stroke="currentColor" strokeOpacity=".09" /></pattern></defs>
    <rect width={width} height={height} fill="url(#chart-grid)" />
    <line x1={padX} x2={width - 16} y1={height / 2} y2={height / 2} className="chart-axis" />
    <line x1={padX} x2={padX} y1={padY} y2={height - padY} className="chart-axis" />
    <text x="8" y="20" className="chart-label">{yLabel}</text><text x={width - 125} y={height - 8} className="chart-label">{xLabel}</text>
    {lines.map(line => <polyline key={line.label} points={toPoints(line.points)} fill="none" stroke={line.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />)}
  </svg><div className="chart-legend">{lines.map(line => <span key={line.label}><i style={{ backgroundColor: line.color }} />{line.label}</span>)}</div></div>
}
