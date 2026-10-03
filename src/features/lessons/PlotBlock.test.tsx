import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlotBlock } from './PlotBlock'

const base = { type:'functionPlot' as const,title:'Discontinuità',xLabel:'x',yLabel:'y',xMin:-1,xMax:1,samples:5,variable:'x' as const,parameters:{},series:[{ label:'1/x',expression:'1/x' }] }

describe('PlotBlock', () => {
  it('does not connect finite points across division by zero and keeps the data table', () => {
    const markup = renderToStaticMarkup(<PlotBlock block={base} />)
    expect(markup.match(/<polyline/g)).toHaveLength(2)
    expect(markup).toContain('campioni non definiti')
    expect(markup).toContain('Dati del grafico')
  })
  it('explains an invalid expression or overflowing range without crashing the lesson', () => {
    expect(renderToStaticMarkup(<PlotBlock block={{ ...base,series:[{label:'Errata',expression:'x+'}] }} />)).toContain('espressione non valida')
    expect(renderToStaticMarkup(<PlotBlock block={{ ...base,xMin:-1e308,xMax:1e308 }} />)).toContain('Intervallo del grafico non rappresentabile')
  })
})
