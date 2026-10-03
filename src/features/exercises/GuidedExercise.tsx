import { useState } from 'react'
import { Check, ChevronRight, Lightbulb, RotateCcw } from 'lucide-react'
import { checkAnswer } from '../../domain/math'
import type { Answer } from '../../domain/schema'
import { MathText } from '../lessons/MathText'
import { usePracticeRecorder } from './PracticeTracking'

function AnswerField({ answer, onAttempt }: { answer?: Answer; onAttempt: (correct: boolean | null) => void }) {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<'idle' | 'incorrect'>('idle')
  if (!answer) return <button className="button primary" onClick={() => onAttempt(null)}>Mostra spiegazione <ChevronRight size={16} /></button>
  return <form onSubmit={event => { event.preventDefault(); const correct = checkAnswer(value, answer); onAttempt(correct); if (!correct) setStatus('incorrect') }} className="answer-form"><label htmlFor="exercise-answer">La tua risposta</label><div><input id="exercise-answer" value={value} onChange={event => { setValue(event.target.value); setStatus('idle') }} placeholder={answer.kind === 'number' ? 'Es. 2 ms' : 'Scrivi la risposta'} autoComplete="off" /><button className="button primary" type="submit">Verifica <Check size={16} /></button></div>{status === 'incorrect' && <p className="feedback error" role="status">Non ancora. Controlla il calcolo e l’unità di misura, poi riprova.</p>}</form>
}

export function GuidedExercise({ title, prompt, data, objective, steps, solution }: { title: string; prompt: string; data: string[]; objective: string; steps: { prompt: string; answer?: Answer; hints: string[]; explanation: string }[]; solution: string }) {
  const record = usePracticeRecorder()
  const [stepIndex, setStepIndex] = useState(0), [hintCount, setHintCount] = useState(0), [revealed, setRevealed] = useState(false), [finished, setFinished] = useState(false)
  const step = steps[stepIndex]
  const next = () => { if (stepIndex === steps.length - 1) setFinished(true); else { setStepIndex(stepIndex + 1); setHintCount(0); setRevealed(false) } }
  return <section className="exercise-card" aria-label={title}><div className="exercise-top"><span className="eyebrow">ESERCIZIO GUIDATO</span><span className="step-counter">{finished ? 'Completato' : `Passo ${stepIndex + 1} di ${steps.length}`}</span></div><h3>{title}</h3><p><MathText text={prompt} /></p><div className="exercise-data"><div><small>DATI</small>{data.map(item => <span key={item}>{item}</span>)}</div><div><small>OBIETTIVO</small><span>{objective}</span></div></div>
    {!finished ? <div className="exercise-step" key={stepIndex}><div className="step-progress" aria-label={`Passo ${stepIndex + 1} di ${steps.length}`}>{steps.map((_, index) => <i key={index} className={index <= stepIndex ? 'active' : ''} />)}</div><h4>Passo {stepIndex + 1}</h4><p><MathText text={step.prompt} /></p>{!revealed ? <AnswerField answer={step.answer} onAttempt={correct => { record(correct, stepIndex === steps.length - 1 && correct !== false); if (correct !== false) setRevealed(true) }} /> : <div className="feedback success" role="status"><Check size={17} /><MathText text={step.explanation} /></div>}{hintCount > 0 && <div className="hints">{step.hints.slice(0, hintCount).map((hint, index) => <p key={index}><Lightbulb size={15} /> {hint}</p>)}</div>}<div className="exercise-actions">{!revealed && hintCount < step.hints.length && <button className="text-button" onClick={() => setHintCount(hintCount + 1)}><Lightbulb size={16} /> {hintCount ? 'Altro suggerimento' : 'Mostra suggerimento'}</button>}{revealed && <button className="button primary" onClick={next}>{stepIndex === steps.length - 1 ? 'Concludi' : 'Passo successivo'} <ChevronRight size={16} /></button>}</div></div> : <div className="exercise-finish"><div className="finish-icon"><Check size={24} /></div><h4>Percorso completato</h4><p><MathText text={solution} /></p><button className="button subtle" onClick={() => { setStepIndex(0); setHintCount(0); setRevealed(false); setFinished(false) }}><RotateCcw size={16} /> Ricomincia</button></div>}
  </section>
}

export function SimpleExercise({ title, prompt, answer, hints, solution }: { title: string; prompt: string; answer?: Answer; hints: string[]; solution: string }) {
  return <GuidedExercise title={title} prompt={prompt} data={[]} objective="Risolvi il problema" steps={[{ prompt, answer, hints, explanation: solution }]} solution={solution} />
}
