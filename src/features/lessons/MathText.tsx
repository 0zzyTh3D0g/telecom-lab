import katex from 'katex'
import type { ReactNode } from 'react'

export function MathText({ text }: { text: string }) {
  return <>{text.split(/(\$[^$]+\$)/g).map((part, index): ReactNode => {
    if (!part.startsWith('$') || !part.endsWith('$')) return part
    try { return <span key={index} className="inline-math" dangerouslySetInnerHTML={{ __html: katex.renderToString(part.slice(1, -1), { throwOnError: true, trust: false }) }} /> }
    catch { return <code key={index}>{part}</code> }
  })}</>
}

export function Formula({ latex, caption }: { latex: string; caption?: string }) {
  let rendered: string
  try { rendered = katex.renderToString(latex, { displayMode: true, throwOnError: true, trust: false }) }
  catch { return <div className="content-error">Formula non disponibile. Controlla la sintassi LaTeX.</div> }
  return <figure className="formula-box"><div className="formula-scroll" dangerouslySetInnerHTML={{ __html: rendered }} />{caption && <figcaption>{caption}</figcaption>}</figure>
}
