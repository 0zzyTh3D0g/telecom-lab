import { describe, expect, it } from 'vitest'
import sine from '../../tests/fixtures/content/year-3/signals/segnale-sinusoidale.json'
import { parseLessonJson, validateLesson } from './validate'
const fixtures = import.meta.glob('../../tests/fixtures/content/**/*.json', { eager: true, import: 'default' })

describe('TelecomContent validation and migration', () => {
  it('keeps all former examples valid as test-only fixtures', () => { expect(Object.keys(fixtures)).toHaveLength(8); for (const value of Object.values(fixtures)) expect(validateLesson(value).errors).toEqual([]) })
  it('migrates a v1 fixture through v2 to v3', () => { const result = validateLesson(sine); expect(result.errors).toEqual([]); expect(result.lesson?.schemaVersion).toBe(3); expect(result.stats.simulations).toBe(1) })
  it('reports unsupported simulator IDs', () => { const data = structuredClone(sine); data.blocks[6] = { type: 'simulation', simulationId: 'unknown-simulator', config: {} } as typeof data.blocks[number]; expect(validateLesson(data).errors.join(' ')).toContain('unknown-simulator') })
  it('reports malformed JSON in plain language', () => { expect(parseLessonJson('{"schemaVersion":1,}').errors[0]).toContain('JSON non leggibile') })
  it('rejects invalid simulator configuration', () => { const data = structuredClone(sine); data.blocks[6] = { type: 'simulation', simulationId: 'signal-sine', config: { frequency: { min: 100, max: 20, default: 50 } } } as typeof data.blocks[number]; expect(validateLesson(data).errors.join(' ')).toContain('config') })
  it('validates v2 plots and source warnings', () => { const data = structuredClone(validateLesson(sine).lesson!); data.blocks.push({ type: 'spectrumPlot', title: 'Spettro', xLabel: 'k', yLabel: 'Ak', xMin: 1, xMax: 6, variable: 'k', parameters: { A: 10 }, samples: 100, series: [{ label: 'A/k', expression: 'A/k' }] }); data.generationWarnings.push('Possibile incongruenza nella fonte.'); const result = validateLesson(data); expect(result.errors).toEqual([]); expect(result.stats.plots).toBe(1); expect(result.warnings).toContain('Possibile incongruenza nella fonte.') })
  it('rejects code in a plot expression', () => { const data = structuredClone(validateLesson(sine).lesson!); data.blocks.push({ type: 'functionPlot', title: 'x', xLabel: 'x', yLabel: 'y', xMin: 0, xMax: 1, variable: 'x', parameters: {}, samples: 20, series: [{ label: 'unsafe', expression: 'window.alert(1)' }] }); expect(validateLesson(data).errors.join(' ')).toContain('Simbolo non ammesso') })
  it('requires private keys for generated assignment questions', () => { const data = structuredClone(validateLesson(sine).lesson!); data.assignments.push({ id: 'task-one', title: 'Misura', description: '', questions: [{ id: 'q-one', type: 'numeric', prompt: 'Periodo?', difficulty: 'base', points: 1, hints: [] }], privateKeys: {} }); expect(validateLesson(data).errors.join(' ')).toContain('manca la chiave') })
  it('rejects duplicate IDs and incoherent numeric answer units', () => {
    const data = structuredClone(validateLesson(sine).lesson!)
    data.blocks.push({ id:'duplicate-practice',type:'practiceQuestion',title:'Prova',prompt:'Calcola',difficulty:'base',hints:[] },{ id:'duplicate-practice',type:'practiceQuestion',title:'Prova 2',prompt:'Calcola',difficulty:'base',hints:[] })
    data.assignments.push({ id:'task-one',title:'Misura',description:'',questions:[{ id:'q-one',type:'numeric',prompt:'Periodo?',difficulty:'base',points:1,hints:[] }],privateKeys:{ 'q-one':{ answer:{ value:2 },unit:'furlong' } } })
    const errors = validateLesson(data).errors.join(' ')
    expect(errors).toContain('ID duplicato')
    expect(errors).toContain('unità numerica')
  })
  it('accepts explicit dimensionless numeric assignments for Mathematics', () => {
    const data = structuredClone(validateLesson(sine).lesson!)
    data.subject = 'matematica'
    data.assignments.push({ id:'math-task',title:'Numeri',description:'',questions:[{id:'math-q',type:'numeric',prompt:'Quanto vale 2 + 2? Risposta senza unità (1).',difficulty:'base',points:1,hints:[]}],privateKeys:{'math-q':{answer:{value:4},unit:'1',tolerance:0}} })
    expect(validateLesson(data).errors).toEqual([])
  })
})
