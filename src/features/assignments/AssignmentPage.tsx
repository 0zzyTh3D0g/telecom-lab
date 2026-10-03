import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../backend/workspace'
import { Progress, StatusBadge } from '../../components/ProductUI'
import { db, errorMessage } from '../../backend/client'

type Assignment = { id: string; subject_id: string; title: string; description: string; due_at: string | null; max_attempts: number; hints_allowed: boolean; solution_release: 'manual' | 'after_submission' | 'after_deadline'; solutions_released: boolean }
type Question = { id: string; kind: string; prompt: string; options: { id: string; text: string }[] | null; pairs: { left: string[]; right: string[] } | null; hints: string[]; points: number }
type Attempt = { id: string; question_id: string; correct: boolean | null; attempt_number: number }
type Review = { attempt_id: string; status: string; judgment: string | null; feedback: string | null; score: number | null }

function validAnswer(question: Question, answer: unknown): string | null {
  if (question.kind === 'numeric') {
    const value = (answer as { value?: string })?.value?.trim()
    const unit = (answer as { unit?: string })?.unit?.trim()
    if (!value || !Number.isFinite(Number(value))) return 'Inserisci un valore numerico valido.'
    if (!unit || !['1','s','ms','µs','ns','Hz','kHz','MHz','GHz','V','mV','A','mA','Ω','kΩ','W','mW','rad/s','dB'].includes(unit)) return 'Seleziona un’unità supportata.'
  } else if (question.kind === 'multipleChoice' && (!Array.isArray(answer) || answer.length === 0)) return 'Seleziona almeno una risposta.'
  else if (question.kind === 'matching' && (!question.pairs || question.pairs.left.some(left => !(answer as Record<string,string>)?.[left]))) return 'Completa tutte le associazioni.'
  else if (typeof answer === 'string' && !answer.trim()) return 'Inserisci una risposta.'
  else if (answer === undefined || answer === null) return 'Inserisci una risposta.'
  return null
}

export default function AssignmentPage({ id }: { id: string }) {
  const {subjects}=useWorkspace()
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [questions, setQuestions] = useState<Question[]>([]), [attempts, setAttempts] = useState<Attempt[]>([]), [reviews, setReviews] = useState<Review[]>([])
  const [error, setError] = useState(''), [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [result, setResult] = useState<Record<string, string>>({}), [hintsUsed, setHintsUsed] = useState<Record<string, number>>({})
  const [solutions, setSolutions] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const pending = useRef(false)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer) }, [])
  const load = useCallback(async () => {
    if (!db) return
    const { data: item, error: itemError } = await db.from('assignments').select('id,subject_id,title,description,due_at,max_attempts,hints_allowed,solution_release,solutions_released').eq('id', id).single()
    if (itemError) throw itemError
    const q = await db.from('questions').select('id,kind,prompt,options,pairs,hints,points').eq('assignment_id', id).order('sort_order')
    if (q.error) throw q.error
    const ids = (q.data || []).map(row => row.id)
    const a = ids.length ? await db.from('attempts').select('id,question_id,correct,attempt_number').in('question_id',ids).order('submitted_at') : { data: [], error: null }
    if (a.error) throw a.error
    const attemptIds = (a.data || []).map(row => row.id)
    const r = attemptIds.length ? await db.from('reviews').select('attempt_id,status,judgment,feedback,score').in('attempt_id',attemptIds) : { data: [], error: null }
    if (r.error) throw r.error
    setAssignment(item as Assignment); setQuestions((q.data || []) as Question[]); setAttempts((a.data || []) as Attempt[]); setReviews((r.data || []) as Review[])
  }, [id])
  useEffect(() => { load().catch(e => setError(errorMessage(e))) }, [load])
  const submit = async (question: Question) => {
    if (!db || pending.current || !assignment) return
    const issue = validAnswer(question, answers[question.id])
    if (issue) { setResult(value => ({ ...value, [question.id]: issue })); return }
    pending.current = true; setBusy(true)
    try {
      let answer = answers[question.id]
      if (question.kind === 'numeric') answer = { value: Number((answer as { value: string }).value), unit: (answer as { unit: string }).unit.trim() }
      const { data, error: submissionError } = await db.rpc('submit_assignment_answer', { qid: question.id, response: answer, used_hints: hintsUsed[question.id] || 0 })
      if (submissionError) throw submissionError
      const response = data as { correct: boolean | null }
      setResult(value => ({ ...value, [question.id]: response.correct === null ? 'Risposta inviata: in attesa di correzione.' : response.correct ? 'Risposta corretta.' : 'Risposta non corretta.' }))
      await load()
      window.dispatchEvent(new Event('telecom:data-changed'))
    } catch (e) { setResult(value => ({ ...value, [question.id]: errorMessage(e) })) }
    finally { pending.current = false; setBusy(false) }
  }
  const showSolution = async (question: Question) => {
    if (!db) return
    const { data, error: issue } = await db.rpc('get_assignment_solution', { qid: question.id })
    setSolutions(value => ({ ...value, [question.id]: issue ? errorMessage(issue) : String(data || 'Nessuna soluzione testuale disponibile.') }))
  }
  if (error) return <div className="content-error" role="alert">{error}</div>
  if (!assignment) return <div className="loading-card">Caricamento compito…</div>
  const expired = Boolean(assignment.due_at && now > new Date(assignment.due_at).getTime())
  const started = attempts.length > 0
  const allAttempted = questions.length > 0 && questions.every(q => attempts.some(a => a.question_id === q.id))
  const pendingReview = reviews.some(r => r.status !== 'reviewed')
  const allReviewedOrCorrect = allAttempted && questions.every(q => attempts.some(a => a.question_id === q.id && (a.correct === true || reviews.some(r => r.attempt_id === a.id && r.status === 'reviewed'))))
  const status = pendingReview ? 'Da correggere' : allReviewedOrCorrect ? 'Corretto' : expired ? 'Scaduto' : allAttempted ? 'Completato' : started ? 'In corso' : 'Non iniziato'
  return <div className="catalog-page"><div className="page-heading"><span className="eyebrow">{subjects.find(s=>s.id===assignment.subject_id)?.name} / COMPITI</span><h1>{assignment.title}</h1><p>{assignment.description}</p><div className="page-stats"><StatusBadge status={status}/><span>{assignment.due_at ? `Scadenza ${new Date(assignment.due_at).toLocaleString('it-IT')}` : 'Nessuna scadenza'}</span><span>Massimo {assignment.max_attempts} tentativi per domanda</span></div></div>
    <div className="assignment-progress"><StatusBadge status={status}/><Progress value={questions.filter(q=>attempts.some(a=>a.question_id===q.id)).length} total={questions.length} label="Domande affrontate"/></div><div className="assignment-list">{questions.map((question, index) => {
      const questionAttempts = attempts.filter(attempt => attempt.question_id === question.id)
      const used = questionAttempts.length, remaining = Math.max(0, assignment.max_attempts - used)
      const answer = answers[question.id], set = (value: unknown) => setAnswers(current => ({ ...current, [question.id]: value }))
      const visibleHints = hintsUsed[question.id] || 0
      const solutionAvailable = assignment.solution_release === 'manual' ? assignment.solutions_released : assignment.solution_release === 'after_deadline' ? expired : used > 0
      const last = questionAttempts.at(-1)
      const lastReview = last && reviews.find(review => review.attempt_id === last.id)
      const questionStatus = !last ? 'Non iniziata' : last.correct === true ? 'Corretta' : last.correct === false ? 'Non corretta' : lastReview?.status === 'reviewed' ? 'Revisionata' : 'In revisione'
      return <section className="exercise-card" key={question.id}><span className="eyebrow">DOMANDA {index + 1} · {question.points} PUNTI</span><h3>{question.prompt}</h3><p className="assignment-question-status">Stato: {questionStatus} · Tentativi: {used} / {assignment.max_attempts} · {remaining} rimasti</p>
        {question.kind === 'numeric' && <div className="answer-row"><input aria-label="Valore numerico" type="number" step="any" value={(answer as { value?: string })?.value || ''} onChange={e => set({ ...(answer as object || {}), value: e.target.value })} /><input aria-label="Unità" list={`units-${question.id}`} placeholder="Unità: ms, Hz, oppure 1 (senza unità)" value={(answer as { unit?: string })?.unit || ''} onChange={e => set({ ...(answer as object || {}), unit: e.target.value })} /><datalist id={`units-${question.id}`}>{['1','s','ms','µs','ns','Hz','kHz','MHz','GHz','V','mV','A','mA','Ω','kΩ','W','mW','rad/s','dB'].map(unit => <option key={unit} value={unit} />)}</datalist></div>}
        {question.kind === 'singleChoice' && question.options?.map(option => <label className="choice" key={option.id}><input type="radio" name={question.id} checked={answer === option.id} onChange={() => set(option.id)} />{option.text}</label>)}
        {question.kind === 'multipleChoice' && question.options?.map(option => <label className="choice" key={option.id}><input type="checkbox" checked={Array.isArray(answer) && answer.includes(option.id)} onChange={() => set((Array.isArray(answer) ? answer : []).includes(option.id) ? (answer as string[]).filter(value => value !== option.id) : [...(Array.isArray(answer) ? answer : []), option.id])} />{option.text}</label>)}
        {question.kind === 'trueFalse' && <div><label className="choice"><input type="radio" name={question.id} checked={answer === true} onChange={() => set(true)} />Vero</label><label className="choice"><input type="radio" name={question.id} checked={answer === false} onChange={() => set(false)} />Falso</label></div>}
        {question.kind === 'matching' && question.pairs?.left.map(left => <label className="choice" key={left}>{left}<select value={(answer as Record<string,string>)?.[left] || ''} onChange={e => set({ ...(answer as Record<string,string> || {}), [left]: e.target.value })}><option value="">Associa</option>{question.pairs?.right.map(right => <option key={right}>{right}</option>)}</select></label>)}
        {['shortOpen','extendedOpen'].includes(question.kind) && <textarea aria-label="Risposta aperta" value={String(answer || '')} onChange={e => set(e.target.value)} rows={question.kind === 'extendedOpen' ? 7 : 3} />}
        {assignment.hints_allowed && visibleHints < question.hints.length && <button className="button subtle" onClick={() => setHintsUsed(current => ({ ...current, [question.id]: visibleHints + 1 }))}>Mostra suggerimento</button>}
        {assignment.hints_allowed && question.hints.slice(0, visibleHints).map((hint, i) => <p className="feedback" key={i}>{hint}</p>)}
        {questionAttempts.map(attempt => { const review = reviews.find(item => item.attempt_id === attempt.id); return <div className="attempt-line" key={attempt.id}><strong>Tentativo {attempt.attempt_number}:</strong> {attempt.correct === null ? review?.status === 'reviewed' ? review.judgment || 'Revisionato' : 'in revisione' : attempt.correct ? 'corretto' : 'non corretto'}{review?.feedback && <p className="review-feedback">{review.feedback}</p>}</div> })}
        <div className="exercise-actions"><button className="button primary" disabled={busy || expired || remaining === 0 || answer === undefined} onClick={() => submit(question)}>{busy ? 'Invio…' : 'Invia risposta'}</button>{solutionAvailable && <button className="button subtle" onClick={() => showSolution(question)}>Mostra soluzione</button>}</div>
        {expired && <p className="feedback">La scadenza è trascorsa: nuove risposte non sono disponibili.</p>}{result[question.id] && <p role="status" className="feedback">{result[question.id]}</p>}{solutions[question.id] && <p className="feedback" role="status">{solutions[question.id]}</p>}
      </section>
    })}</div></div>
}
