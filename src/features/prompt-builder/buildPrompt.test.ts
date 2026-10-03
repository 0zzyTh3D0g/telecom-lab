import { describe, expect, it } from 'vitest'
import { buildPrompt, type PromptOptions } from './buildPrompt'

const options: PromptOptions = { levelCode: '4', module: 'Segnali', topic: 'Serie', title: 'Armoniche', source: 'A = 10; Ak = A/k; prime sei armoniche', formulas: 'Ak=A/k', limits: 'Non trattare la forma complessa', mode: 'aderente', selected: ['grafici','compiti'], assignment: { count: 6, minDifficulty: 1, maxDifficulty: 5, progression: 'facile → difficile', customProgression: '', types: ['numeric'], hints: false, solutions: true, release: 'dopo la consegna' } }
describe('source-first metaprompt', () => { it('preserves the source, formulas and limits', () => { const prompt = buildPrompt(options); expect(prompt).toContain(options.source); expect(prompt).toContain(options.formulas); expect(prompt).toContain(options.limits); expect(prompt).toContain('Non ampliare il programma'); expect(prompt).toContain('generationWarnings') }); it('lists only supported simulation IDs', () => { expect(buildPrompt(options)).toContain('signal-sine') }) })

it('carries the selected subject into the prompt and JSON contract',()=>{ const prompt=buildPrompt({...options,subject:'matematica',subjectName:'Matematica'});expect(prompt).toContain('Matematica');expect(prompt).toContain('matematica');expect(prompt).toContain('Non ampliare il programma') })
