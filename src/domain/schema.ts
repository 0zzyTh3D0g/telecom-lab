import { z } from 'zod'

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Usa lettere minuscole, numeri e trattini.')
const text = z.string().trim().min(1, 'Inserisci un testo.')
const blockBase = { id: id.optional() }
const variable = z.object({ symbol: text, description: text, unit: z.string().optional() }).strict()
const numericAnswer = z.object({ kind: z.literal('number'), value: z.number().finite(), tolerance: z.number().min(0).default(0.001), unit: z.enum(['Hz', 's', 'V', 'A', 'Ω', 'W', 'rad/s', 'dB']).optional() }).strict()
const textAnswer = z.object({ kind: z.literal('text'), accepted: z.array(text).min(1) }).strict()
export const answerSchema = z.discriminatedUnion('kind', [numericAnswer, textAnswer])
const stepSchema = z.object({ prompt: text, answer: answerSchema.optional(), hints: z.array(text).default([]), explanation: text }).strict()
const frequencyRange = z.object({ min: z.number().positive(), max: z.number().positive(), step: z.number().positive(), unit: z.literal('Hz') }).strict().refine(value => value.max > value.min && value.step <= value.max - value.min, 'Intervallo della frequenza non coerente.')

const legacyBlocks = [
  z.object({ ...blockBase, type: z.literal('heading'), level: z.union([z.literal(2), z.literal(3)]), text }).strict(),
  z.object({ ...blockBase, type: z.literal('paragraph'), text }).strict(),
  z.object({ ...blockBase, type: z.literal('divider') }).strict(),
  z.object({ ...blockBase, type: z.literal('definition'), title: text.optional(), text }).strict(),
  z.object({ ...blockBase, type: z.literal('important'), title: text.optional(), text }).strict(),
  z.object({ ...blockBase, type: z.literal('note'), title: text.optional(), text }).strict(),
  z.object({ ...blockBase, type: z.literal('concept'), title: text.optional(), text }).strict(),
  z.object({ ...blockBase, type: z.literal('recap'), title: text.optional(), text }).strict(),
  z.object({ ...blockBase, type: z.literal('keyPoints'), title: text.optional(), items: z.array(text).min(1) }).strict(),
  z.object({ ...blockBase, type: z.literal('formula'), latex: text, caption: text.optional(), variables: z.array(variable).optional() }).strict(),
  z.object({ ...blockBase, type: z.literal('equation'), latex: text, caption: text.optional() }).strict(),
  z.object({ ...blockBase, type: z.literal('formulaVariables'), variables: z.array(variable).min(1) }).strict(),
  z.object({ ...blockBase, type: z.literal('list'), ordered: z.boolean().default(false), items: z.array(text).min(1) }).strict(),
  z.object({ ...blockBase, type: z.literal('table'), columns: z.array(text).min(1), rows: z.array(z.array(z.string())).min(1) }).strict(),
  z.object({ ...blockBase, type: z.literal('comparison'), title: text.optional(), left: z.object({ title: text, items: z.array(text).min(1) }), right: z.object({ title: text, items: z.array(text).min(1) }) }).strict(),
  z.object({ ...blockBase, type: z.literal('example'), title: text, text }).strict(),
  z.object({ ...blockBase, type: z.literal('workedExample'), title: text, givens: z.array(text).default([]), steps: z.array(text).min(1), result: text }).strict(),
  z.object({ ...blockBase, type: z.literal('exercise'), title: text, prompt: text, answer: answerSchema.optional(), hints: z.array(text).default([]), solution: text }).strict(),
  z.object({ ...blockBase, type: z.literal('guidedExercise'), title: text, prompt: text, data: z.array(text).default([]), objective: text, steps: z.array(stepSchema).min(1), solution: text }).strict(),
  z.object({ ...blockBase, type: z.literal('parametricExercise'), title: text, solverId: z.literal('period-from-frequency'), frequency: frequencyRange }).strict(),
  z.object({ ...blockBase, type: z.literal('exerciseStep'), prompt: text, explanation: text }).strict(),
  z.object({ ...blockBase, type: z.literal('hint'), text }).strict(),
  z.object({ ...blockBase, type: z.literal('solution'), text }).strict(),
  z.object({ ...blockBase, type: z.literal('simulation'), simulationId: id, title: text.optional(), config: z.record(z.string(), z.unknown()).default({}) }).strict(),
] as const

export const blockSchemaV1 = z.discriminatedUnion('type', legacyBlocks)
export const plotTypes = ['functionPlot', 'discretePlot', 'spectrumPlot', 'timeSignalPlot', 'comparisonPlot'] as const
const plotSeries = z.object({ label: text, expression: text, color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).strict()
const plotBase = { ...blockBase, title: text, xLabel: text, yLabel: text, xMin: z.number().finite(), xMax: z.number().finite(), samples: z.number().int().min(2).max(400).default(100), parameters: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/), z.number().finite()).default({}), series: z.array(plotSeries).min(1).max(4) }
const functionPlot = z.object({ type: z.literal('functionPlot'), ...plotBase, variable: z.literal('x') }).strict()
const timeSignalPlot = z.object({ type: z.literal('timeSignalPlot'), ...plotBase, variable: z.literal('t') }).strict()
const comparisonPlot = z.object({ type: z.literal('comparisonPlot'), ...plotBase, variable: z.enum(['x', 't']) }).strict()
const discretePlot = z.object({ type: z.literal('discretePlot'), ...plotBase, variable: z.literal('k') }).strict()
const spectrumPlot = z.object({ type: z.literal('spectrumPlot'), ...plotBase, variable: z.literal('k') }).strict()
const difficultyV2 = z.enum(['base', 'semplice', 'intermedia', 'avanzata', 'ragionamento'])
const practiceQuestion = z.object({ id, type: z.literal('practiceQuestion'), title: text, prompt: text, difficulty: difficultyV2, answer: answerSchema.optional(), hints: z.array(text).default([]), solution: text.optional() }).strict()
const exerciseGroup = z.object({ id, type: z.literal('exerciseGroup'), title: text, questions: z.array(practiceQuestion).min(1) }).strict()
export const blockSchema = z.discriminatedUnion('type', [...legacyBlocks, functionPlot, timeSignalPlot, comparisonPlot, discretePlot, spectrumPlot, practiceQuestion, exerciseGroup])

export const questionTypeSchema = z.enum(['numeric', 'singleChoice', 'multipleChoice', 'trueFalse', 'matching', 'shortOpen', 'extendedOpen'])
export const assignmentQuestionSchema = z.object({ id, type: questionTypeSchema, prompt: text, difficulty: difficultyV2, options: z.array(z.object({ id, text }).strict()).optional(), pairs: z.object({ left: z.array(text).min(1), right: z.array(text).min(1) }).strict().optional(), hints: z.array(text).default([]), points: z.number().positive().default(1) }).strict()
export const assignmentDraftSchema = z.object({ id, title: text, description: z.string().default(''), questions: z.array(assignmentQuestionSchema).min(1), privateKeys: z.record(z.string(), z.object({ answer: z.unknown(), tolerance: z.number().min(0).optional(), unit: z.string().optional(), solution: z.string().optional(), rubric: z.string().optional() }).strict()) }).strict()

export const lessonSchemaV1 = z.object({
  schemaVersion: z.literal(1), id, slug: id, title: text, summary: text,
  year: z.number().int().positive(), module: text, topic: text,
  difficulty: z.enum(['base', 'intermedio', 'avanzato']).optional(),
  prerequisites: z.array(id).default([]), tags: z.array(text).min(1), order: z.number().int().min(0),
  related: z.array(id).default([]), blocks: z.array(blockSchemaV1).min(1),
}).strict()

export const lessonSchemaV2 = lessonSchemaV1.omit({ schemaVersion: true, blocks: true, difficulty: true }).extend({
  schemaVersion: z.literal(2), difficulty: difficultyV2.optional(),
  subject: id.default('telecomunicazioni'),
  blocks: z.array(blockSchema).min(1),
  generationWarnings: z.array(text).default([]),
  assignments: z.array(assignmentDraftSchema).default([]),
}).strict()

export const lessonSchema = lessonSchemaV2.omit({ schemaVersion: true, year: true }).extend({
  schemaVersion: z.literal(3), levelCode: z.string().trim().min(1).max(40).optional(),
}).strict()

export function migrateV1(value: unknown) {
  const parsed = lessonSchemaV1.safeParse(value)
  if (!parsed.success) return { success: false as const, error: parsed.error }
  const { difficulty, ...rest } = parsed.data
  return { success: true as const, data: lessonSchemaV2.parse({ ...rest, schemaVersion: 2, difficulty: difficulty === 'intermedio' ? 'intermedia' : difficulty === 'avanzato' ? 'avanzata' : difficulty, generationWarnings: [], assignments: [] }) }
}

export function migrateV2(value: unknown) {
  const parsed = lessonSchemaV2.safeParse(value)
  if (!parsed.success) return { success: false as const, error: parsed.error }
  const { year, ...rest } = parsed.data
  return { success: true as const, data: lessonSchema.parse({ ...rest, schemaVersion: 3, levelCode: String(year) }) }
}

export type Lesson = z.infer<typeof lessonSchema>
export type ContentBlock = z.infer<typeof blockSchema>
export type Answer = z.infer<typeof answerSchema>
