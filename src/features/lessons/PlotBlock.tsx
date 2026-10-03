import type { ContentBlock } from '../../domain/schema'
import { parseExpression } from '../../domain/expression'

type Plot = Extract<ContentBlock, { type: 'functionPlot' | 'discretePlot' | 'spectrumPlot' | 'timeSignalPlot' | 'comparisonPlot' }>
type Point = { x: number; y: number }
const colors = ['#397a63', '#b18a47', '#6c8eac', '#b76c78']

function segments(points: Point[], sx: (value: number) => number, sy: (value: number) => number) {
  const result: string[] = []
  let current: string[] = []
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      if (current.length > 1) result.push(current.join(' '))
      current = []
    } else current.push(`${sx(point.x)},${sy(point.y)}`)
  }
  if (current.length > 1) result.push(current.join(' '))
  return result
}

export function PlotBlock({ block }: { block: Plot }) {
  const discrete = block.type === 'discretePlot' || block.type === 'spectrumPlot'
  const width = block.xMax - block.xMin
  const count = discrete ? Math.min(101,Math.floor(width)+1) : block.samples
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(count) || count < 2) return <div className="content-error">Intervallo del grafico non rappresentabile. Controlla limiti minimo e massimo.</div>
  const errors: string[] = []
  const series = block.series.map((item,index) => {
    let evaluate: ((values: Record<string,number>) => number) | null = null
    try { evaluate = parseExpression(item.expression,[block.variable,...Object.keys(block.parameters)]) }
    catch { errors.push(`${item.label}: espressione non valida.`) }
    const points = Array.from({ length: count },(_,step) => {
      const x = discrete ? block.xMin + step : block.xMin + width * step / (count - 1)
      if (!evaluate) return { x,y:NaN }
      try { const y = evaluate({ ...block.parameters,[block.variable]:x }); return { x,y:Number.isFinite(y) ? y : NaN } }
      catch { return { x,y:NaN } }
    })
    return { label:item.label,color:item.color || colors[index % colors.length],points }
  })
  const values = series.flatMap(item => item.points.map(point => point.y)).filter(Number.isFinite)
  if (!values.length) return <div className="content-error">Grafico non rappresentabile nell’intervallo indicato. {errors.join(' ')} Controlla le espressioni e i punti non definiti.</div>
  const low = Math.min(0,...values), high = Math.max(0,...values), span = high - low
  if (!Number.isFinite(span)) return <div className="content-error">I valori del grafico sono troppo grandi per essere rappresentati in modo affidabile. Riduci l’intervallo.</div>
  const scale = span || 1
  const sx = (x: number) => 45 + 700 * ((x - block.xMin) / width)
  const sy = (y: number) => 285 - 245 * ((y - low) / scale)
  const invalid = series.reduce((total,item) => total + item.points.filter(point => !Number.isFinite(point.y)).length,0)
  return <figure className="plot-block"><figcaption><strong>{block.title}</strong><span>{block.xLabel} · {block.yLabel}</span></figcaption>{errors.map(error => <p className="plot-warning" key={error}>{error}</p>)}{invalid > 0 && <p className="plot-warning">{invalid} campioni non definiti non sono tracciati; le linee si interrompono in quei punti.</p>}
    <div className="plot-scroll"><svg viewBox="0 0 780 310" role="img" aria-label={`${block.title}: ${series.map(item => item.label).join(', ')}`}><line x1="45" x2="745" y1={sy(0)} y2={sy(0)} className="chart-axis" /><line x1="45" x2="45" y1="40" y2="285" className="chart-axis" />{series.map(item => discrete ? item.points.filter(point => Number.isFinite(point.y)).map((point,index) => <g key={`${item.label}-${index}`}><line x1={sx(point.x)} x2={sx(point.x)} y1={sy(0)} y2={sy(point.y)} stroke={item.color} strokeWidth="2" /><circle cx={sx(point.x)} cy={sy(point.y)} r="3.5" fill={item.color} /></g>) : segments(item.points,sx,sy).map((part,index) => <polyline key={`${item.label}-${index}`} points={part} fill="none" stroke={item.color} strokeWidth="2.5" />))}<text x="45" y="303" className="chart-label">{block.xMin} {block.xLabel}</text><text x="694" y="303" className="chart-label">{block.xMax} {block.xLabel}</text></svg></div>
    <div className="plot-legend">{series.map(item => <span key={item.label}><i style={{ background:item.color }} />{item.label}</span>)}</div><details><summary>Dati del grafico</summary><div className="table-scroll"><table><thead><tr><th scope="col">{block.xLabel}</th>{series.map(item => <th scope="col" key={item.label}>{item.label}</th>)}</tr></thead><tbody>{Array.from({ length:Math.min(count,30) },(_,index) => <tr key={index}><td>{series[0].points[index].x.toPrecision(4)}</td>{series.map(item => <td key={item.label}>{Number.isFinite(item.points[index].y) ? item.points[index].y.toPrecision(4) : '—'}</td>)}</tr>)}</tbody></table></div>{count > 30 && <p>Tabella limitata ai primi 30 campioni.</p>}</details></figure>
}
