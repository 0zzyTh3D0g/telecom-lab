import { Suspense, type ReactNode } from 'react'
import type { ContentBlock } from '../../domain/schema'
import { GuidedExercise, SimpleExercise } from '../exercises/GuidedExercise'
import { PracticeProvider, usePracticeTarget } from '../exercises/PracticeTracking'
import { ParametricExercise } from '../exercises/ParametricExercise'
import { isSimulationId, simulationRegistry } from '../simulations/registry'
import { Formula, MathText } from './MathText'
import { PlotBlock } from './PlotBlock'

type BlockType = ContentBlock['type']
type Renderer = (block: ContentBlock) => ReactNode
function entry<T extends BlockType>(render: (block: Extract<ContentBlock, { type: T }>) => ReactNode): Renderer {
  return block => render(block as Extract<ContentBlock, { type: T }>)
}
function Variables({ variables }: { variables: { symbol: string; description: string; unit?: string }[] }) { return <dl className="variables">{variables.map(item => <div key={item.symbol}><dt>{item.symbol}</dt><dd>{item.description} {item.unit && <span>[{item.unit}]</span>}</dd></div>)}</dl> }
function Simulation({ id, config }: { id: string; config: Record<string, unknown> }) {
  if (!isSimulationId(id)) return <div className="content-error">Simulazione “{id}” non disponibile.</div>
  const Component = simulationRegistry[id]
  return <Suspense fallback={<div className="loading-card">Caricamento simulazione…</div>}><Component config={config} /></Suspense>
}
function PracticeGroup({ block }: { block: Extract<ContentBlock, { type: 'exerciseGroup' }> }) {
  const parent = usePracticeTarget()
  return <section className="exercise-group"><h3>{block.title}</h3>{block.questions.map(question => <PracticeProvider key={question.id} target={parent ? { contentId: parent.contentId, exerciseId: question.id } : null}><SimpleExercise title={question.title} prompt={question.prompt} answer={question.answer} hints={question.hints} solution={question.solution || 'Soluzione non disponibile.'} /></PracticeProvider>)}</section>
}
const callout = (type: string, title: string | undefined, text: string) => <aside className={`callout ${type}`}><span className="callout-label">{title || ({ definition: 'Definizione', important: 'Da ricordare', note: 'Nota', concept: 'Concetto', recap: 'In sintesi' } as Record<string, string>)[type]}</span><p><MathText text={text} /></p></aside>

const registry: Record<BlockType, Renderer> = {
  heading: entry<'heading'>(block => block.level === 2 ? <h2 id={block.id || block.text.toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, '-')} className="lesson-heading">{block.text}</h2> : <h3 id={block.id || block.text.toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, '-')} className="lesson-heading">{block.text}</h3>),
  paragraph: entry<'paragraph'>(block => <p className="body-text"><MathText text={block.text} /></p>),
  divider: entry<'divider'>(() => <hr className="lesson-divider" />),
  definition: entry<'definition'>(block => callout('definition', block.title, block.text)),
  important: entry<'important'>(block => callout('important', block.title, block.text)),
  note: entry<'note'>(block => callout('note', block.title, block.text)),
  concept: entry<'concept'>(block => callout('concept', block.title, block.text)),
  recap: entry<'recap'>(block => callout('recap', block.title, block.text)),
  keyPoints: entry<'keyPoints'>(block => <aside className="key-points"><h3>{block.title || 'Punti chiave'}</h3><ul>{block.items.map((item, index) => <li key={index}><MathText text={item} /></li>)}</ul></aside>),
  formula: entry<'formula'>(block => <><Formula latex={block.latex} caption={block.caption} />{block.variables && <Variables variables={block.variables} />}</>),
  equation: entry<'equation'>(block => <Formula latex={block.latex} caption={block.caption} />),
  formulaVariables: entry<'formulaVariables'>(block => <Variables variables={block.variables} />),
  list: entry<'list'>(block => block.ordered ? <ol className="content-list">{block.items.map((item, index) => <li key={index}><MathText text={item} /></li>)}</ol> : <ul className="content-list">{block.items.map((item, index) => <li key={index}><MathText text={item} /></li>)}</ul>),
  table: entry<'table'>(block => <div className="table-scroll"><table><thead><tr>{block.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}><MathText text={cell} /></td>)}</tr>)}</tbody></table></div>),
  comparison: entry<'comparison'>(block => <div className="comparison">{[block.left, block.right].map(side => <div key={side.title}><h3>{side.title}</h3><ul>{side.items.map((item, index) => <li key={index}><MathText text={item} /></li>)}</ul></div>)}</div>),
  example: entry<'example'>(block => <div className="example"><span className="eyebrow">ESEMPIO</span><h3>{block.title}</h3><p><MathText text={block.text} /></p></div>),
  workedExample: entry<'workedExample'>(block => <div className="example"><span className="eyebrow">ESEMPIO SVOLTO</span><h3>{block.title}</h3>{block.givens.length > 0 && <div className="given-list">{block.givens.map(item => <span key={item}>{item}</span>)}</div>}<ol>{block.steps.map((step, index) => <li key={index}><MathText text={step} /></li>)}</ol><p className="example-result"><MathText text={block.result} /></p></div>),
  exercise: entry<'exercise'>(block => <SimpleExercise {...block} />),
  guidedExercise: entry<'guidedExercise'>(block => <GuidedExercise {...block} />),
  parametricExercise: entry<'parametricExercise'>(block => <ParametricExercise {...block} />),
  exerciseStep: entry<'exerciseStep'>(block => <div className="example"><h3>Passo</h3><p>{block.prompt}</p><p>{block.explanation}</p></div>),
  hint: entry<'hint'>(block => callout('note', 'Suggerimento', block.text)),
  solution: entry<'solution'>(block => <details className="solution-details"><summary>Mostra soluzione</summary><p><MathText text={block.text} /></p></details>),
  simulation: entry<'simulation'>(block => <Simulation id={block.simulationId} config={block.config} />),
  functionPlot: entry<'functionPlot'>(block => <PlotBlock block={block} />),
  discretePlot: entry<'discretePlot'>(block => <PlotBlock block={block} />),
  spectrumPlot: entry<'spectrumPlot'>(block => <PlotBlock block={block} />),
  timeSignalPlot: entry<'timeSignalPlot'>(block => <PlotBlock block={block} />),
  comparisonPlot: entry<'comparisonPlot'>(block => <PlotBlock block={block} />),
  practiceQuestion: entry<'practiceQuestion'>(block => <SimpleExercise title={block.title} prompt={block.prompt} answer={block.answer} hints={block.hints} solution={block.solution || 'Soluzione non disponibile.'} />),
  exerciseGroup: entry<'exerciseGroup'>(block => <PracticeGroup block={block} />),
}

export function BlockRenderer({ blocks, contentId, releaseId, positions }: { blocks: ContentBlock[]; contentId?: string; releaseId?:string|null; positions?: number[] }) { return <div className="lesson-body">{blocks.map((block, index) => <PracticeProvider key={block.id || index} target={contentId ? { contentId, releaseId, exerciseId: block.id || `legacy-${positions?.[index] ?? index}` } : null}><div className="block-slot">{registry[block.type](block)}</div></PracticeProvider>)}</div> }
