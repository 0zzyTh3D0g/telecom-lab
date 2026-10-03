import { useEffect, useState } from 'react'
import { Progress, Badge } from '../../components/ProductUI'
import { db, errorMessage } from '../../backend/client'

type Option = { id: string; label: string }
type Row = {legacyUnattributed?:boolean;currentlyAccessible?:boolean;versions?:{version:number;group:string;year:string;openCount:number;activeSeconds:number;practiceAttempts:number}[]; subjectId?: string; userId?: string; username?: string; firstName?: string; lastName?: string; contentId?: string; title?: string; firstOpen: string | null; lastOpen: string | null; openCount: number; activeSeconds: number; practiceAttempted: number; practiceCompleted: number; practiceAttempts?: number; assignmentCount?: number; assignmentAttempts: number; pendingReviews?: number; feedback?: string | null }
type GroupSummary = {legacyNote?:string; eligible: number; opened: number; practiceAttempted: number; practiceCompleted: number; practiceAttempts: number; pendingReviews: number; averageAssignmentAttempts: number; topErrors: { question: string; errors: number }[] }
const when = (value: string | null) => value ? new Date(value).toLocaleString('it-IT') : '—'

export function Activity({subjectId=''}:{subjectId?:string}) {
  const [view, setView] = useState<'content' | 'account' | 'group'>('content')
  const [contents, setContents] = useState<Option[]>([]), [accounts, setAccounts] = useState<Option[]>([]), [groups, setGroups] = useState<Option[]>([])
  const [optionPage,setOptionPage]=useState(0);const [page,setPage]=useState(0);const [selected, setSelected] = useState(''), [rows, setRows] = useState<Row[]>([]), [summary, setSummary] = useState<GroupSummary | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (!db) return
    let current = true
    Promise.all([
      db.from('content_items').select('id,title,subject_id').order('title').range(optionPage*100,optionPage*100+99),
      db.rpc('workspace_accounts',{member_only:true,page_number:optionPage}),
      db.from('groups').select('id,name').order('name').range(optionPage*100,optionPage*100+99),
    ]).then(([c,a,g]) => {
      if (!current) return
      if (c.error || a.error || g.error) throw c.error || a.error || g.error
      setContents((c.data || []).filter(row=>!subjectId||row.subject_id===subjectId).map(row => ({ id: row.id, label: row.title })))
      setAccounts((a.data || []).map((row:{id:string;username:string}) => ({ id: row.id, label: row.username })))
      setGroups((g.data || []).map(row => ({ id: row.id, label: row.name })))
    }).catch(e => { if (current) setError(errorMessage(e)) })
    return () => { current = false }
  }, [subjectId,optionPage])
  useEffect(() => {
    if (!db || !selected) { setRows([]); setSummary(null); return }
    let current = true
    setLoading(true); setError('')
    const name = view === 'group' ? 'management_group_activity' : 'management_activity_page'
    const args = view === 'group' ? {gid:selected,sid:subjectId||null} : {view_name:view,target_id:selected,subject_filter:subjectId||null,page_number:page}
    Promise.resolve(db.rpc(name,args)).then(({ data, error: issue }) => {
      if (!current) return
      if (issue) throw issue
      if (view === 'group') setSummary(data as GroupSummary)
      else setRows(((data || []) as Row[]).filter(row=>view!=='account'||!subjectId||row.subjectId===subjectId))
    }).catch(e => { if (current) setError(errorMessage(e)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [selected,view,subjectId,page])
  const options = view === 'content' ? contents : view === 'account' ? accounts : groups
  return <section className="panel management-panel activity-panel"><h2>Attività</h2><p>Tempo attivo stimato e progressi, senza classifiche. Gli account con accesso ma senza apertura compaiono nella vista per contenuto.</p>
    <div className="activity-switch" role="group" aria-label="Vista attività">{([['content','Per contenuto'],['account','Per account'],['group','Per gruppo']] as const).map(([key,label]) => <button key={key} className={`button ${view === key ? 'primary' : 'subtle'}`} aria-pressed={view === key} onClick={() => { setView(key);setOptionPage(0);setPage(0); setSelected(''); setRows([]); setSummary(null) }}>{label}</button>)}</div>
    <label>Seleziona {view === 'content' ? 'contenuto' : view === 'account' ? 'account' : 'gruppo'}<select value={selected} onChange={event => {setSelected(event.target.value);setPage(0)}}><option value="">Seleziona</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
    <div className="management-actions"><button className="button subtle" disabled={!optionPage} onClick={()=>{setOptionPage(p=>p-1);setSelected('')}}>Selezioni precedenti</button><span>Pagina selezioni {optionPage+1}</span><button className="button subtle" disabled={options.length<(view==='account'?50:100)} onClick={()=>{setOptionPage(p=>p+1);setSelected('')}}>Altre selezioni</button></div>
    {loading && <p role="status">Caricamento attività…</p>}{error && <p className="feedback error" role="alert">{error}</p>}
    {view === 'group' && summary && <><div className="stat-grid">{[
      ['Ha aperto',summary.eligible ? `${Math.round(summary.opened / summary.eligible * 100)}%` : '—'],
      ['Practice completati tra quelli tentati',summary.practiceAttempted ? `${Math.round(summary.practiceCompleted / summary.practiceAttempted * 100)}%` : '—'],
      ['Tentativi medi compiti',summary.averageAssignmentAttempts],
      ['Risposte da correggere',summary.pendingReviews],
    ].map(([label,value]) => <div className="stat-card" key={label}><strong>{value}</strong><span>{label}</span></div>)}</div><p>{summary.opened} aperture su {summary.eligible} coppie account/contenuto della coorte · {summary.practiceAttempts} tentativi Practice.</p>{summary.legacyNote&&<p>{summary.legacyNote}</p>}<h3>Domande con più errori</h3><ul>{summary.topErrors.map(item => <li key={item.question}>{item.question}: {item.errors} risposte errate</li>)}</ul>{summary.topErrors.length === 0 && <p>Nessun errore registrato.</p>}</>}
    {view !== 'group' && selected && !loading && <><div className="activity-summary"><div><strong>{rows.length}</strong><span>{view==='content'?'Account nella pagina, accesso o storico':'Contenuti nella pagina, accesso o storico'}</span></div><div><strong>{rows.filter(r=>r.openCount>0).length}</strong><span>Aperti almeno una volta</span></div><div><strong>{rows.reduce((n,r)=>n+r.practiceCompleted,0)}</strong><span>Practice completati</span></div></div><div className="table-scroll"><table className="activity-table"><thead><tr><th>{view === 'content' ? 'Account' : 'Contenuto'}</th><th>Accesso / apertura</th><th>Prima apertura</th><th>Ultima apertura</th><th>Aperture</th><th>Tempo attivo stimato</th><th>Practice</th><th>Tentativi compiti</th></tr></thead><tbody>{rows.map(row => <tr key={row.userId || row.contentId}><th scope="row">{view === 'content' ? `${row.firstName || ''} ${row.lastName || ''} (${row.username})` : row.title}</th><td><Badge tone={row.openCount?'positive':'neutral'}>{row.openCount ? 'Aperto' : 'Non aperto'}</Badge></td><td>{when(row.firstOpen)}</td><td>{when(row.lastOpen)}</td><td>{row.openCount}</td><td>{Math.round(row.activeSeconds / 60)} min</td><td><Progress value={row.practiceCompleted} total={row.practiceAttempted} label="Practice completati"/><small>{row.practiceAttempts || 0} tentativi</small></td><td>{row.assignmentAttempts}{row.pendingReviews ? ` · ${row.pendingReviews} da correggere` : ''}{row.versions?.length? <details><summary>Versioni e gruppi</summary><ul>{row.versions.map((v,i)=><li key={i}>v{v.version} · {v.group} · {v.year}: {v.openCount||0} aperture, {Math.round(v.activeSeconds/60)||0} min stimati, {v.practiceAttempts} tentativi Practice</li>)}</ul></details>:null}{row.legacyUnattributed&&<small>Storico P3.1: versione e gruppo non ricostruibili</small>}{row.currentlyAccessible===false&&<small>Accesso attuale terminato · storico</small>}</td></tr>)}</tbody></table></div><div className="management-actions"><button className="button subtle" disabled={page===0} onClick={()=>setPage(v=>v-1)}>Precedenti</button><span>Pagina {page+1}</span><button className="button subtle" disabled={rows.length<50} onClick={()=>setPage(v=>v+1)}>Successive</button></div>{rows.length === 0 && <p>Nessun dato accessibile per questa selezione.</p>}{view === 'account' && rows.some(row => row.feedback) && <div><h3>Feedback recenti</h3>{rows.filter(row => row.feedback).map(row => <p key={row.contentId}><strong>{row.title}:</strong> {row.feedback}</p>)}</div>}</>}
  </section>
}
