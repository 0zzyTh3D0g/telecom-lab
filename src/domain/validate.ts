import katex from 'katex'
import { lessonSchema, migrateV1, migrateV2, type ContentBlock, type Lesson } from './schema'
import { parseExpression } from './expression'
import { simulationIds, validateSimulationConfig } from '../features/simulations/registry'

export type ValidationResult = { lesson?: Lesson; errors: string[]; warnings: string[]; stats: { blocks: number; formulas: number; simulations: number; plots: number; exercises: number; questions: number } }
const emptyStats = { blocks: 0, formulas: 0, simulations: 0, plots: 0, exercises: 0, questions: 0 }
function readablePath(path: PropertyKey[]): string { return path.map(part => typeof part === 'number' ? `blocco ${part + 1}` : String(part)).join(' → ') }

export function validateLesson(value: unknown): ValidationResult {
  const migrated = typeof value === 'object' && value !== null && 'schemaVersion' in value && value.schemaVersion === 1 ? migrateV1(value) : null
  const intermediate = migrated?.success ? migrated.data : value
  const upgraded = typeof intermediate === 'object' && intermediate !== null && 'schemaVersion' in intermediate && intermediate.schemaVersion === 2 ? migrateV2(intermediate) : null
  const result = lessonSchema.safeParse(upgraded?.success ? upgraded.data : intermediate)
  if (!result.success) {
    return { errors: result.error.issues.map(issue => `${readablePath(issue.path)}: ${issue.message}`), warnings: [], stats: emptyStats }
  }
  const lesson = result.data
  const errors: string[] = []
  const warnings: string[] = []
  const ids = new Set<string>()
  const registerId = (value: string | undefined, where: string) => { if (!value) return; if (ids.has(value)) errors.push(`${where}: ID duplicato "${value}".`); else ids.add(value) }
  let formulas = 0, simulations = 0, plots = 0, exercises = 0, questions = 0
  lesson.blocks.forEach((block, index) => {
    const where = `Blocco ${index + 1}`
    registerId(block.id,where)
    if (block.type === 'formula' || block.type === 'equation') {
      formulas++
      try { katex.renderToString(block.latex, { throwOnError: true, trust: false }) }
      catch { errors.push(`${where}: formula LaTeX non valida.`) }
    }
    if (block.type === 'simulation') {
      simulations++
      if (!simulationIds.some(id => id === block.simulationId)) errors.push(`${where}: simulazione "${block.simulationId}" non disponibile.`)
      else errors.push(...validateSimulationConfig(block.simulationId, block.config).map(message => `${where}: ${message}`))
    }
    if (['functionPlot', 'discretePlot', 'spectrumPlot', 'timeSignalPlot', 'comparisonPlot'].includes(block.type)) {
      const plot = block as Extract<ContentBlock, { type: 'functionPlot' | 'discretePlot' | 'spectrumPlot' | 'timeSignalPlot' | 'comparisonPlot' }>
      plots++
      if (plot.xMax <= plot.xMin) errors.push(`${where}: xMax deve superare xMin.`)
      if ((plot.type === 'discretePlot' || plot.type === 'spectrumPlot') && (!Number.isInteger(plot.xMin) || !Number.isInteger(plot.xMax) || plot.xMax - plot.xMin > 100)) errors.push(`${where}: intervallo discreto non valido.`)
      for (const series of plot.series) { try { const evaluate = parseExpression(series.expression, [plot.variable, ...Object.keys(plot.parameters)]); const values = [plot.xMin,(plot.xMin + plot.xMax)/2,plot.xMax].map(value => { try { return evaluate({ ...plot.parameters,[plot.variable]:value }) } catch { return NaN } }); if (values.every(value => !Number.isFinite(value))) warnings.push(`${where}: la serie "${series.label}" non ha valori finiti nei campioni di controllo.`) } catch (error) { errors.push(`${where}: ${error instanceof Error ? error.message : 'espressione non valida'}`) } }
    }
    if (['exercise', 'guidedExercise', 'parametricExercise', 'practiceQuestion', 'exerciseGroup'].includes(block.type)) exercises++
    if (block.type === 'practiceQuestion') questions++
    if (block.type === 'exerciseGroup') { questions += block.questions.length; block.questions.forEach(question => registerId(question.id,`${where} / Practice`)) }
    if (block.type === 'table' && block.rows.some(row => row.length !== block.columns.length)) errors.push(`${where}: ogni riga della tabella deve avere ${block.columns.length} celle.`)
    if (block.type === 'paragraph' && block.text.length > 700) warnings.push(`${where}: paragrafo lungo; valuta di dividerlo.`)
    if (block.type === 'simulation' && !block.title) warnings.push(`${where}: aggiungi un titolo alla simulazione per una migliore accessibilità.`)
  })
  if (lesson.prerequisites.includes(lesson.id)) errors.push('Una lezione non può essere prerequisito di sé stessa.')
  if (new Set(lesson.prerequisites).size !== lesson.prerequisites.length || new Set(lesson.related).size !== lesson.related.length) errors.push('Riferimenti duplicati in prerequisites o related.')
  for (const assignment of lesson.assignments) {
    registerId(assignment.id,'Compito')
    questions += assignment.questions.length
    for (const question of assignment.questions) {
      registerId(question.id,`Compito ${assignment.id}`)
      const key = assignment.privateKeys[question.id]
      if (!key) { errors.push(`Compito ${assignment.id}: manca la chiave privata per ${question.id}.`); continue }
      if (question.type === 'numeric') {
        const value = key.answer && typeof key.answer === 'object' && 'value' in key.answer ? (key.answer as { value: unknown }).value : undefined
        if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`Compito ${assignment.id}, ${question.id}: risposta numerica privata non valida.`)
        if (!key.unit || !/^(?:1|dB|rad\/s|[pnuµmkMG]?(?:Hz|s|V|A|Ω|W))$/.test(key.unit)) errors.push(`Compito ${assignment.id}, ${question.id}: unità numerica mancante o non supportata.`)
      }
      if (question.type === 'singleChoice' && !question.options?.some(option => option.id === key.answer)) errors.push(`Compito ${assignment.id}, ${question.id}: risposta non presente nelle opzioni.`)
      if (question.type === 'multipleChoice' && (!Array.isArray(key.answer) || key.answer.some(value => !question.options?.some(option => option.id === value)))) errors.push(`Compito ${assignment.id}, ${question.id}: risposte multiple non coerenti con le opzioni.`)
      if (question.type === 'matching' && (!question.pairs || question.pairs.left.length !== question.pairs.right.length)) errors.push(`Compito ${assignment.id}, ${question.id}: coppie non coerenti.`)
      if (question.type === 'trueFalse' && typeof key.answer !== 'boolean') errors.push(`Compito ${assignment.id}, ${question.id}: risposta privata deve essere vero o falso.`)
    }
    for (const keyId of Object.keys(assignment.privateKeys)) if (!assignment.questions.some(question => question.id === keyId)) errors.push(`Compito ${assignment.id}: chiave privata senza domanda ${keyId}.`)
  }
  warnings.push(...lesson.generationWarnings)
  if (migrated?.success || upgraded?.success) warnings.unshift(`TelecomContent ${migrated?.success ? 'v1 → v2 → v3' : 'v2 → v3'} migrato automaticamente. Rivedi il contenuto prima di pubblicarlo.`)
  return { lesson: errors.length ? undefined : lesson, errors, warnings, stats: { blocks: lesson.blocks.length, formulas, simulations, plots, exercises, questions } }
}

export function parseLessonJson(input: string): ValidationResult {
  try { return validateLesson(JSON.parse(input) as unknown) }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Errore di sintassi sconosciuto.'
    return { errors: [`JSON non leggibile: ${message}. Controlla virgole, virgolette e parentesi.`], warnings: [], stats: emptyStats }
  }
}
