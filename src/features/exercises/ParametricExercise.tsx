import { useState } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { checkAnswer, formatNumber } from '../../domain/math'
import { generateFrequency, solveParametric, type FrequencyRange, type SolverId } from '../../domain/parametric'
import { usePracticeRecorder } from './PracticeTracking'

export function ParametricExercise({ title, solverId, frequency }: { title: string; solverId: SolverId; frequency: FrequencyRange }) {
  const record = usePracticeRecorder()
  const [value, setValue] = useState(() => generateFrequency(frequency))
  const [input, setInput] = useState(''), [hint, setHint] = useState(false), [correct, setCorrect] = useState(false), [attempted, setAttempted] = useState(false)
  const period = solveParametric(solverId, value)
  const regenerate = () => { setValue(generateFrequency(frequency)); setInput(''); setHint(false); setCorrect(false); setAttempted(false) }
  return <section className="exercise-card parametric-card" aria-label={title}><div className="exercise-top"><span className="eyebrow">ESERCIZIO PARAMETRICO</span><button className="text-button" onClick={regenerate}><RefreshCw size={15} /> Nuovo valore</button></div><h3>{title}</h3><p>Un segnale ha frequenza <strong>f = {value} Hz</strong>. Calcola il periodo T e indica l’unità.</p><div className="exercise-data"><div><small>DATO GENERATO</small><span>f = {value} Hz</span></div><div><small>RELAZIONE</small><span>T = 1/f</span></div></div><form className="answer-form" onSubmit={event => { event.preventDefault(); const okay = checkAnswer(input, { kind: 'number', value: period, tolerance: 0.000001, unit: 's' }); record(okay,okay); setCorrect(okay); setAttempted(true) }}><label htmlFor="parametric-answer">Il periodo è</label><div><input id="parametric-answer" value={input} onChange={event => { setInput(event.target.value); setAttempted(false) }} placeholder="Es. 2 ms" /><button className="button primary" type="submit">Verifica <ArrowRight size={16} /></button></div></form>{attempted && <p className={`feedback ${correct ? 'success' : 'error'}`} role="status">{correct ? `Corretto: T = 1/${value} s = ${formatNumber(period * 1000, 4)} ms.` : 'Riprova. Controlla valore e unità.'}</p>}{!correct && <div className="exercise-actions"><button className="text-button" onClick={() => setHint(true)}>Mostra suggerimento</button></div>}{hint && !correct && <p className="feedback">Dividi 1 per {value}. Moltiplica per 1000 per esprimere il risultato in millisecondi.</p>}</section>
}
