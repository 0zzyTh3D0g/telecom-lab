import { useEffect, useState } from 'react'
import { db, errorMessage } from '../../backend/client'

type Option = { id: string; label: string }
type ReviewRow = { attemptId: string; status: string; judgment: string | null; feedback: string | null; score: number | null; updatedAt: string; answer: unknown; attemptNumber: number; submittedAt: string; username: string; prompt: string; assignmentTitle: string; rubric: string | null }
type Edit = { judgment: string; feedback: string; score: string; status: string }

function readableAnswer(answer: unknown): string {
  if (typeof answer === 'string') return answer
  if (typeof answer === 'boolean') return answer ? 'Vero' : 'Falso'
  if (typeof answer === 'number') return String(answer)
  if (Array.isArray(answer)) return answer.map(readableAnswer).join(', ')
  if (answer && typeof answer === 'object') {
    const entries = Object.entries(answer)
    if ('value' in answer) return `${String((answer as { value: unknown }).value)} ${String((answer as { unit?: unknown }).unit || '')}`.trim()
    return entries.map(([key,value]) => `${key}: ${readableAnswer(value)}`).join(' · ')
  }
  return 'Nessuna risposta'
}

export function Reviews({subjectId=''}:{subjectId?:string}) {
  const [groups, setGroups] = useState<Option[]>([]), [assignments, setAssignments] = useState<Option[]>([]), [accounts, setAccounts] = useState<Option[]>([])
  const [status, setStatus] = useState('pending'), [group, setGroup] = useState(''), [assignment, setAssignment] = useState(''), [account, setAccount] = useState('')
  const [page, setPage] = useState(0), [rows, setRows] = useState<ReviewRow[]>([]), [edits, setEdits] = useState<Record<string, Edit>>({})
  const [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [message, setMessage] = useState('')
  useEffect(() => {
    if (!db) return
    let current = true
    Promise.all([
      db.from('groups').select('id,name').order('name').range(0,499),
      db.from('assignments').select('id,title,subject_id').order('created_at',{ascending:false}).range(0,499),
      db.rpc('workspace_accounts',{member_only:true}),
    ]).then(([g,a,u]) => {
      if (!current) return
      if (g.error || a.error || u.error) throw g.error || a.error || u.error
      setGroups((g.data || []).map(item => ({ id:item.id,label:item.name })))
      setAssignments((a.data || []).filter(item=>!subjectId||item.subject_id===subjectId).map(item => ({ id:item.id,label:item.title })))
      setAccounts((u.data || []).map((item:{id:string;username:string}) => ({ id:item.id,label:item.username })))
    }).catch(error => { if (current) setMessage(errorMessage(error)) })
    return () => { current = false }
  }, [subjectId])
  useEffect(() => {
    if (!db) return
    let current = true
    setLoading(true)
    Promise.resolve(db.rpc('management_reviews', { filter_status: status || null, filter_group: group || null, filter_assignment: assignment || null, filter_user: account || null, page_number: page,filter_subject:subjectId||null })).then(({data,error}) => {
      if (!current) return
      if (error) throw error
      setRows(((data as { rows: ReviewRow[] })?.rows || []))
      setEdits({})
    }).catch(error => { if (current) setMessage(errorMessage(error)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [status,group,assignment,account,page,reload,subjectId])
  const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(0) }
  const save = async (row: ReviewRow) => {
    if (!db || busy) return
    const edit = edits[row.attemptId] || { judgment: row.judgment || '', feedback: row.feedback || '', score: row.score?.toString() || '', status: row.status }
    if (edit.status === 'reviewed' && !edit.judgment.trim()) { setMessage('Inserisci un giudizio prima di segnare la risposta come corretta.'); return }
    setBusy(true); setMessage('')
    const { error } = await db.from('reviews').update({ judgment: edit.judgment.trim() || null, feedback: edit.feedback.trim() || null, score: edit.score ? Number(edit.score) : null, status: edit.status }).eq('attempt_id',row.attemptId)
    if (error) setMessage(error.message)
    else { setMessage('Correzione salvata.'); setReload(value => value + 1) }
    setBusy(false)
  }
  return <section className="panel management-panel"><h2>Correzioni</h2><p>Risposte aperte, rubrica privata e giudizi liberi. Il salvataggio registra revisore, data ed evento amministrativo.</p><div className="review-filters">
    <label>Stato<select value={status} onChange={e => changeFilter(setStatus,e.target.value)}><option value="">Tutti</option><option value="pending">Da correggere</option><option value="in_review">In revisione</option><option value="reviewed">Corrette</option></select></label>
    <label>Gruppo<select value={group} onChange={e => changeFilter(setGroup,e.target.value)}><option value="">Tutti</option>{groups.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>Compito<select value={assignment} onChange={e => changeFilter(setAssignment,e.target.value)}><option value="">Tutti</option>{assignments.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>Account<select value={account} onChange={e => changeFilter(setAccount,e.target.value)}><option value="">Tutti</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
  </div>{message && <p role="status" className="management-message">{message}</p>}{loading && <p role="status">Caricamento correzioni…</p>}
  <div className="data-list">{rows.map(row => { const edit = edits[row.attemptId] || { judgment: row.judgment || '', feedback: row.feedback || '', score: row.score?.toString() || '', status: row.status }; const change = (patch: Partial<Edit>) => setEdits(value => ({ ...value,[row.attemptId]: { ...edit,...patch } })); return <article className="review-card" key={row.attemptId}><div><strong>{row.username} · {row.assignmentTitle}</strong><small>{new Date(row.submittedAt).toLocaleString('it-IT')} · tentativo {row.attemptNumber}</small><p>{row.prompt}</p><p><strong>Risposta:</strong> <span className="review-answer">{readableAnswer(row.answer)}</span></p>{row.rubric && <p><strong>Rubrica privata:</strong> {row.rubric}</p>}</div><label>Giudizio<input value={edit.judgment} onChange={e => change({ judgment:e.target.value })} placeholder="Giudizio libero" /></label><label>Feedback<textarea value={edit.feedback} onChange={e => change({ feedback:e.target.value })} /></label><label>Punteggio opzionale<input type="number" step="any" value={edit.score} onChange={e => change({ score:e.target.value })} /></label><label>Stato<select value={edit.status} onChange={e => change({ status:e.target.value })}><option value="pending">Da correggere</option><option value="in_review">In revisione</option><option value="reviewed">Corretta</option></select></label><button className="button primary" disabled={busy} onClick={() => save(row)}>Salva e successiva</button></article> })}{!loading && rows.length === 0 && <p>Nessuna risposta per questi filtri.</p>}</div><div className="management-actions"><button className="button subtle" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>Precedenti</button><span>Pagina {page + 1}</span><button className="button subtle" disabled={rows.length < 25 || loading} onClick={() => setPage(value => value + 1)}>Successive</button></div></section>
}
