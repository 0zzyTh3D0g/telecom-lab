import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { ChevronRight, Menu, Moon, Search, Sun } from 'lucide-react'
import { configured, db, errorMessage, internalEmail, invoke, getRequestWorkspace, type ContentItem, type AcademicLevel, type TrackLevel, type AcademicYear, type Group, type Track, type Subject, type Workspace } from './backend/client'
import { blockSchema, type ContentBlock } from './domain/schema'
import { activeDelta } from './domain/activity'
import { BlockRenderer } from './features/lessons/BlockRenderer'
import { WorkspaceContext, canAuthor, isStaff, roleLabel, useWorkspace } from './backend/workspace'
import { Sidebar, Navigation, Footer, About } from './features/shell/Shell'
import { Home, Catalog, ContentCard, AssignmentList, type AssignmentSummary } from './features/catalog/Catalog'
import { BrandMark, Skeleton } from './components/ProductUI'
import { useCatalog } from './backend/useCatalog'
import { useInstitutions } from './backend/useInstitutions'
import { ContextBar, ContextSwitch } from './features/context/ContextSwitch'
import 'katex/dist/katex.min.css'
import './index.css'
import './styles/p3.css'
import './styles/p31.css'
import './styles/p32.css'

const Importer = lazy(() => import('./features/importer/Importer'))
const PromptBuilder = lazy(() => import('./features/prompt-builder/PromptBuilder'))
const Planning = lazy(() => import('./features/curriculum/Planning'))
const PersonalLibrary = lazy(() => import('./features/library/PersonalLibrary'))
const Management = lazy(() => import('./features/management/Management'))
const AssignmentPage = lazy(() => import('./features/assignments/AssignmentPage'))
const href = (path: string) => `#${path}`
function useRoute() { const [route, setRoute] = useState(() => decodeURI(window.location.hash.slice(1) || '/')); useEffect(() => { const update = () => { setRoute(decodeURI(window.location.hash.slice(1) || '/')); window.scrollTo({ top: 0 }) }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update) }, []); return route }
type Theme = 'system' | 'light' | 'dark'
function useTheme() { const [theme, setTheme] = useState<Theme>(() => { const value = localStorage.getItem('telecom-theme'); return value === 'light' || value === 'dark' ? value : 'system' }); useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'); const update = () => { document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'dark' : 'light' : theme }; update(); media.addEventListener('change', update); localStorage.setItem('telecom-theme', theme); return () => media.removeEventListener('change', update) }, [theme]); return { theme, cycle: () => setTheme(value => value === 'system' ? 'light' : value === 'light' ? 'dark' : 'system') } }
class ContentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> { state = { failed: false }; static getDerivedStateFromError() { return { failed: true } }; componentDidCatch(error: Error, info: ErrorInfo) { console.error('Content rendering failed', error, info) }; render() { return this.state.failed ? <div className="content-error">Contenuto non disponibile.</div> : this.props.children } }
function Privacy() { return <div className="catalog-page"><div className="page-heading"><span className="eyebrow">TRASPARENZA</span><h1>Privacy e attività</h1><p>La piattaforma registra solo ciò che serve a gestire accessi, contenuti e compiti.</p></div><section className="panel management-panel"><h2>Dati registrati</h2><ul><li>Account globale, membership per istituto, iscrizioni storiche e incarichi sui gruppi.</li><li>Prima e ultima apertura, numero di aperture e tempo attivo stimato aggregato, associati alla versione distribuita e al gruppo.</li><li>Per gli esercizi Practice: tentativi, completamento, ultimo tentativo e correttezza quando deterministica, per versione della lezione.</li><li>Per i compiti: tentativi, risposte, correzioni e feedback.</li></ul><p>Una nuova apertura è una visita alla lezione separata di almeno cinque minuti dalla precedente. Il tempo attivo è una stima: la scheda nascosta e i periodi di inattività non vengono conteggiati. Non registriamo traiettorie del mouse, tasti digitati, siti esterni, fingerprint, pubblicità o session replay. Le attività sono isolate per istituto. I responsabili possono gestire i dati del proprio contesto. La libreria personale resta privata e non copia account, risposte o attività. Le preferenze di contesto salvate nel browser non concedono permessi.</p></section></div> }
function Setup() { return <div className="not-found"><span className="eyebrow">CONFIGURAZIONE</span><h1>Backend da configurare</h1><p>Imposta le variabili VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY, applica le migrazioni P2, P2.1, P3, P3.1 e P3.2 e distribuisci le funzioni Supabase Free. Le istruzioni sono nel README.</p></div> }
function Login({ onLogin }: { onLogin: () => void }) { const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false); return <div className="auth-page"><section className="panel auth-panel"><div className="auth-brand"><BrandMark size={42}/></div><span className="eyebrow">IL TUO WORKSPACE</span><h1>Le idee ripartono da qui.</h1><p>Accedi con le credenziali ricevute dal responsabile della piattaforma.</p><form onSubmit={async event => { event.preventDefault(); if (!db) return; setBusy(true); setError(''); try { if (!/^[a-z][a-z0-9]{2,39}$/.test(username.trim().toLowerCase())) throw new Error('Username non valido.'); const { error: authError } = await db.auth.signInWithPassword({ email: internalEmail(username), password }); if (authError) throw new Error((authError.status ?? 0) >= 500 || authError.status === 429 || !authError.status ? 'Servizio temporaneamente non disponibile.' : 'Credenziali non valide.'); onLogin() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) } }}><label>Username<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>{error && <p className="feedback error" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy ? 'Accesso…' : 'Accedi'}</button></form></section></div> }
function ChangePassword({ onChanged }: { onChanged: () => void }) { const [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [error, setError] = useState(''); return <div className="auth-page"><section className="panel auth-panel"><span className="eyebrow">PRIMO ACCESSO</span><h1>Imposta una nuova password</h1><p>Scegli almeno 12 caratteri. Dopo il cambio potrai usare la piattaforma.</p><form onSubmit={async event => { event.preventDefault(); if (password !== confirm) { setError('Le password non coincidono.'); return } try { await invoke('change-password', { password }); onChanged() } catch (e) { setError(errorMessage(e)) } }}><label>Nuova password<input type="password" autoComplete="new-password" minLength={12} value={password} onChange={e => setPassword(e.target.value)} required /></label><label>Conferma<input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></label>{error && <p role="alert" className="feedback error">{error}</p>}<button className="button primary">Salva password</button></form></section></div> }
function useActivity(contentId: string | null | undefined, userId: string) {
  useEffect(() => {
    if (!contentId || !db) return
    const storageKey = `telecom:active:${userId}:${contentId}`
    let pending = 0, sending = false, last = Date.now(), lastInput = Date.now()
    try { pending = Math.max(0, Math.min(600, Number(sessionStorage.getItem(storageKey)) || 0)) } catch { /* Storage can be unavailable. */ }
    const backend = db
    const context = getRequestWorkspace()
    const options = {headers:{'x-workspace-id':context||''}}
    const persist = () => { try { if (pending > 0) sessionStorage.setItem(storageKey,String(pending)); else sessionStorage.removeItem(storageKey) } catch { /* Tracking stays best effort. */ } }
    const flush = async () => {
      if (sending || pending < 1 || !navigator.onLine) return
      sending = true
      const value = Math.min(120,pending)
      const { error } = await backend.rpc('record_release_activity', { rid: contentId, seconds_delta: value }).setHeader('x-workspace-id',context||'')
      if (!error) pending = Math.max(0,pending - value)
      persist()
      sending = false
    }
    void backend.rpc('record_release_open', { rid: contentId }).setHeader('x-workspace-id',options.headers['x-workspace-id']).then(() => flush())
    const input = () => { lastInput = Date.now() }
    const tick = () => {
      const now = Date.now()
      pending += activeDelta(now,last,lastInput,document.hidden)
      persist()
      last = now
      if (pending >= 30) void flush()
    }
    const visibility = () => { if (document.hidden) { tick(); void flush() } else { last = Date.now(); lastInput = last } }
    const online = () => { void flush() }
    const timer = window.setInterval(tick,30000)
    document.addEventListener('visibilitychange',visibility)
    window.addEventListener('pointerdown',input)
    window.addEventListener('keydown',input)
    window.addEventListener('touchstart',input)
    window.addEventListener('online',online)
    window.addEventListener('pagehide',online)
    return () => { window.clearInterval(timer); tick(); persist(); void flush(); document.removeEventListener('visibilitychange',visibility); window.removeEventListener('pointerdown',input); window.removeEventListener('keydown',input); window.removeEventListener('touchstart',input); window.removeEventListener('online',online); window.removeEventListener('pagehide',online) }
  }, [contentId,userId])
}
function LessonPage({ item, userId }: { item: ContentItem; userId: string }) { const {subjects}=useWorkspace(); const subject=subjects.find(s=>s.id===item.subject_id); const [blocks, setBlocks] = useState<ContentBlock[]>([]), [positions, setPositions] = useState<number[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true); useActivity(item.release_id,userId); useEffect(() => { if (!db) return; setLoading(true); async function load() { const { data, error: e } = await db!.rpc('lesson_resources',{cid:item.id,rid:item.release_id||null}); if (e) throw e; const entries = (data || []).flatMap((row:{blocks:unknown[]}) => Array.isArray(row.blocks) ? row.blocks : []) as { position: number; block: unknown }[]; const parsed = entries.sort((a,b) => a.position-b.position).map(entry => ({ position: entry.position, result: blockSchema.safeParse(entry.block) })).filter(entry => entry.result.success); setBlocks(parsed.map(entry => entry.result.data as ContentBlock)); setPositions(parsed.map(entry => entry.position)) } load().catch(e => setError(errorMessage(e))).finally(() => setLoading(false)) }, [item.id,item.release_id]); return <div className="lesson-layout"><div className="lesson-main"><nav className="breadcrumb"><a href="#/">Libreria</a><ChevronRight size={14} /><a href={href(item.level_code?`/year/${encodeURIComponent(item.level_code)}`:'/general')}>Livello {item.level_code||'Generale'}</a><ChevronRight size={14} />{item.module}</nav><div className="lesson-header"><span className="eyebrow">{subject?.name} / {item.topic} · LIVELLO {item.level_code||'Generale'}</span><h1>{item.title}</h1><p className="lesson-summary">{item.summary}</p><div className="lesson-tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div></div>{loading ? <div className="loading-card">Caricamento risorse…</div> : error ? <div className="content-error" role="alert">{error}</div> : blocks.length ? <ContentBoundary key={item.id}><BlockRenderer blocks={blocks} contentId={item.id} releaseId={item.release_id} positions={positions} /></ContentBoundary> : <div className="empty-search">Nessuna risorsa disponibile per questo contenuto.</div>}</div><aside className="toc"><div className="toc-sticky"><span className="eyebrow">IN QUESTA LEZIONE</span>{blocks.filter(block => block.type === 'heading').map((block, i) => block.type === 'heading' && <a key={i} href="#" onClick={e => { e.preventDefault(); document.getElementById(block.id || block.text.toLowerCase().replace(/[^a-z0-9]+/g,'-'))?.scrollIntoView() }}>{block.text}</a>)}</div></aside></div> }
function ResolvedLesson({path,userId}:{path:string;userId:string}) {
 const {profile,subjects}=useWorkspace();const [item,setItem]=useState<ContentItem|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('')
 useEffect(()=>{if(!db)return;let active=true;const parts=path.slice(8).split('/').map(decodeURIComponent);
 Promise.resolve(db.rpc('resolve_lesson',{content_slug:parts.at(-1),subject_slug:parts.length===1?null:parts[0]}).setHeader('x-workspace-id',profile?.workspace_id||'')).then(({data,error:issue})=>{if(!active)return;if(issue){setError(errorMessage(issue));setItem(null)}else setItem(data)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}
 },[path,profile?.workspace_id])
 useEffect(()=>{if(item&&path.slice(8).split('/').length===1){const subject=subjects.find(s=>s.id===item.subject_id);if(subject)window.history.replaceState(null,'',`#/lesson/${encodeURIComponent(subject.slug)}/${encodeURIComponent(item.slug)}`)}},[item,path,subjects])
 return loading?<Skeleton label="Caricamento lezione…"/>:error?<p role="alert" className="content-error">{error}</p>:item?<LessonPage key={`${item.id}:${item.release_id||'draft'}`} item={item} userId={userId}/>:<div className="not-found"><h1>Contenuto non disponibile</h1><p>Il contenuto non esiste, non è autorizzato o il collegamento precedente è ambiguo.</p></div>
}
function SearchPage({ contents }: { contents: ContentItem[] }) {
  const {subjects,levels,profile}=useWorkspace(); const [subject,setSubject]=useState('all')
  const [query, setQuery] = useState(''), [year, setYear] = useState('all'), [module, setModule] = useState('all')
  const [matched, setMatched] = useState<ContentItem[]>([]), [searchPage,setSearchPage]=useState(0),[more,setMore]=useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const clean = query.trim().replaceAll('%','').replaceAll('_','')
    if (!db || clean.length<2) return
    let current = true
    const timer = window.setTimeout(() => {
      setLoading(true); setError('')
      db!.rpc('search_catalog',{query_text:clean,page_number:searchPage,subject_id_filter:subject==='all'?null:subject}).setHeader('x-workspace-id',profile?.workspace_id||'').then(({ data, error: issue }) => {
        if (!current) return
        if (issue) setError(errorMessage(issue))
        else {const rows=(data||[]) as ContentItem[];setMatched(old=>searchPage===0?rows:[...old,...rows]);setMore(rows.length===50)}
        setLoading(false)
      })
    },300)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query,searchPage,subject,profile?.workspace_id])
  const q = query.trim().toLocaleLowerCase('it')
  const searchItems=q?matched:contents
  const modules = [...new Set(searchItems.filter(item => (subject==='all'||item.subject_id===subject) && (year === 'all' || item.level_code === year)).map(item => item.module))]
  const results = searchItems.filter(item => (subject==='all'||item.subject_id===subject) && (year === 'all' || item.level_code === year) && (module === 'all' || item.module === module) && (!q || [item.title,item.summary,item.module,item.topic,...item.tags].join(' ').toLocaleLowerCase('it').includes(q) || Boolean(q)))
  return <div className="catalog-page"><div className="page-heading"><span className="eyebrow">LIBRERIA / RICERCA</span><h1>Ricerca contenuti</h1><p>La ricerca include solo metadati e testo delle risorse autorizzate.</p></div><div className="search-tools"><div><Search size={19} /><input aria-label="Cerca contenuti" value={query} onChange={e => { setQuery(e.target.value); setMatched([]);setSearchPage(0);setMore(false);setLoading(false);setError('') }} placeholder="Cerca un argomento…" /></div><select aria-label="Filtra per materia" value={subject} onChange={e=>{setSubject(e.target.value);setModule('all');setSearchPage(0);setMatched([]);setMore(false)}}><option value="all">Tutte le materie</option>{subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><select aria-label="Filtra per anno" value={year} onChange={e => { setYear(e.target.value); setModule('all') }}><option value="all">Tutti i livelli</option>{levels.filter(l=>!l.archived_at).map(l=><option key={l.id} value={l.code}>{l.label}</option>)}</select><select aria-label="Filtra per modulo" value={module} onChange={e => setModule(e.target.value)}><option value="all">Tutti i moduli</option>{modules.map(value => <option key={value}>{value}</option>)}</select></div>{loading && <p role="status">Ricerca in corso…</p>}{error && <p role="alert" className="feedback error">{error}</p>}<p className="result-count">{results.length} risultati</p><div className="lesson-grid">{results.map(item => <ContentCard key={item.id} item={item} highlight={q} />)}</div>{more&&q&&<button className="button subtle" disabled={loading} onClick={()=>setSearchPage(p=>p+1)}>Altri risultati</button>}{results.length === 0 && <p className="empty-search">Nessun contenuto disponibile.</p>}</div>
}
export default function App() {
  const route=useRoute(), path=route.split('?')[0], {theme,cycle}=useTheme()
  const [menuOpen,setMenuOpen]=useState(false)
  const session=useInstitutions(),{profile,account,activeId,selection}=session
  const {select:selectContext,change:changeInstitution,institutions,loading:institutionsLoading}=session
  const loadedWorkspace=useRef('');const contextSelection=useRef(selection);useEffect(()=>{contextSelection.current=selection},[selection])
  const [assignments,setAssignments]=useState<AssignmentSummary[]>([])
  const [subjects,setSubjects]=useState<Subject[]>([]),[workspace,setWorkspace]=useState<Workspace|null>(null)
  const [years,setYears]=useState<AcademicYear[]>([]),[tracks,setTracks]=useState<Track[]>([]),[groups,setGroups]=useState<Group[]>([])
  const [levels,setLevels]=useState<AcademicLevel[]>([]),[trackLevels,setTrackLevels]=useState<TrackLevel[]>([])
  const [activity,setActivity]=useState<{content_id:string;last_active_at:string}[]>([]),[dataRevision,setDataRevision]=useState(0),[contextLoading,setContextLoading]=useState(false)
  const catalog=useCatalog(activeId,selection.subjectId,dataRevision,Boolean(profile&&!profile.disabled&&!profile.must_change_password)),contents=catalog.items
  const closeMenu=useCallback(()=>setMenuOpen(false),[setMenuOpen])
  const refreshProfile=session.refresh,authLoading=session.loading,authError=session.error,setAuthError=session.setError
  useEffect(()=>{const updated=()=>{setDataRevision(v=>v+1);void refreshProfile()};window.addEventListener('telecom:data-changed',updated);return()=>window.removeEventListener('telecom:data-changed',updated)},[refreshProfile])
  useEffect(()=>{
    const requested=new URLSearchParams(route.split('?')[1]).get('workspace')
    if(requested&&requested!==activeId&&!institutionsLoading&&account){if(institutions.some(w=>w.id===requested&&!w.disabled&&!w.archived_at))changeInstitution(requested);else setAuthError('Istituto non autorizzato o archiviato.')}
  },[route,activeId,account,institutionsLoading,institutions,changeInstitution,setAuthError])
  useEffect(()=>{
    if(!db||!profile||profile.disabled||profile.must_change_password){setAssignments([]);setActivity([]);setSubjects([]);setWorkspace(null);return}
    let active=true
    if(loadedWorkspace.current!==activeId){setContextLoading(true);setAssignments([]);setSubjects([]);setYears([]);setTracks([]);setGroups([]);setLevels([]);setTrackLevels([])}
    Promise.all([
      db.rpc('my_assignment_overview'),db.rpc('my_recent_activity'),
      db.from('subjects').select('*').order('sort_order').order('name'),db.from('workspaces').select('id,name').eq('id',profile.workspace_id).single(),db.from('academic_years').select('*').order('start_date',{ascending:false}),db.from('tracks').select('*').order('name'),db.from('groups').select('*').order('name').limit(500),db.from('academic_levels').select('*').order('sort_order'),db.from('track_levels').select('*').order('sort_order')
    ]).then(([a,v,s,w,y,t,g,l,tl])=>{if(!active)return;const issue=l.error||tl.error||a.error||v.error||s.error||w.error||y.error||t.error||g.error;if(issue)throw issue;setAssignments((a.data||[]) as AssignmentSummary[]);setActivity(v.data||[]);setSubjects((s.data||[]) as Subject[]);setWorkspace(w.data as Workspace);loadedWorkspace.current=activeId;setYears(y.data||[]);setTracks(t.data||[]);setGroups(g.data||[]);setLevels(l.data||[]);setTrackLevels(tl.data||[]);const selection=contextSelection.current;const validYear=(y.data||[]).find(entry=>entry.id===selection.yearId)||(y.data||[]).find(entry=>entry.status==='active')||(y.data||[])[0];selectContext({yearId:validYear?.id||'',trackId:(t.data||[]).some(entry=>entry.id===selection.trackId&&!entry.archived_at)?selection.trackId:'',subjectId:(s.data||[]).some(entry=>entry.id===selection.subjectId&&!entry.archived_at)?selection.subjectId:'',groupId:(g.data||[]).some(entry=>entry.id===selection.groupId&&entry.academic_year_id===validYear?.id&&!entry.archived_at)?selection.groupId:''});setAuthError('')}).catch(e=>{if(active)setAuthError(errorMessage(e))}).finally(()=>{if(active)setContextLoading(false)})
    return()=>{active=false}
  },[profile,activeId,dataRevision,selectContext,setAuthError])
  const visibleContents=selection.subjectId?contents.filter(c=>c.subject_id===selection.subjectId):contents
  const visibleAssignments=assignments.filter(a=>(!selection.subjectId||a.subject_id===selection.subjectId)&&(!selection.yearId||!a.academic_year_id||a.academic_year_id===selection.yearId)&&(!selection.groupId||!a.group_ids||a.group_ids.includes(selection.groupId)))
  let page:ReactNode
  if(path==='/privacy')page=<Privacy/>
  else if(path==='/about')page=<About/>
  else if(path==='/setup')page=<Setup/>
  else if(authLoading)page=<Skeleton label="Verifica accesso…"/>
  else if(authError)page=<div className="content-error" role="alert">Servizio temporaneamente non disponibile. {authError}</div>
  else if(account?.disabled)page=<div className="content-error">Account disattivato.</div>
  else if(account?.must_change_password)page=<ChangePassword onChanged={refreshProfile}/>
  else if(account&&path==='/personal/planning')page=<Suspense fallback={<Skeleton/>}><Planning personal ownerId={account.id}/></Suspense>
  else if(account&&path==='/personal')page=<Suspense fallback={<Skeleton/>}><PersonalLibrary ownerId={account.id}/></Suspense>
  else if(account&&!profile)page=<div className="not-found"><h1>Nessun istituto disponibile</h1><p>La membership è stata revocata o l’istituto è archiviato.</p><a href="#/personal" className="button primary">Spazio personale</a></div>
  else if((contextLoading||workspace?.id!==activeId)&&profile)page=<Skeleton label="Caricamento contesto…"/>
  else if(path==='/'&&(!profile||(!profile.disabled&&!profile.must_change_password)))page=<Home contents={visibleContents} assignments={visibleAssignments} activity={activity}/>
  else if(!configured)page=<Setup/>
  else if(!profile)page=<Login onLogin={refreshProfile}/>
  else if(profile.disabled)page=<div className="content-error">Account disattivato.</div>
  else if(profile.must_change_password)page=<ChangePassword onChanged={refreshProfile}/>
  else if(path==='/login')page=<Home contents={visibleContents} assignments={visibleAssignments} activity={activity}/>
  else if(path==='/general')page=<Catalog general contents={visibleContents}/>
  else if(path.startsWith('/year/'))page=<Catalog key={path} year={decodeURIComponent(path.slice(6))} contents={visibleContents}/>
  else if(path.startsWith('/subject/')){const year=new URLSearchParams(route.split('?')[1]).get('year');page=<Catalog key={route} subjectSlug={path.slice(9)} year={year||undefined} contents={visibleContents}/>}
  else if(path.startsWith('/lesson/'))page=<ResolvedLesson key={path} path={path} userId={profile.id}/>
  else if(path==='/search')page=<SearchPage contents={visibleContents}/>
  else if(path==='/assignments')page=<AssignmentList assignments={visibleAssignments}/>
  else if(path.startsWith('/assignment/'))page=<Suspense fallback={<Skeleton/>}><AssignmentPage key={path} id={path.slice(12)}/></Suspense>
  else if(isStaff(profile.role)&&path==='/planning')page=<Suspense fallback={<Skeleton/>}><Planning/></Suspense>
  else if(isStaff(profile.role)&&path==='/manage')page=<Suspense fallback={<Skeleton/>}><Management/></Suspense>
  else if(canAuthor(profile.role)&&path==='/import')page=<Suspense fallback={<Skeleton/>}><Importer/></Suspense>
  else if(canAuthor(profile.role)&&path==='/prompt')page=<Suspense fallback={<Skeleton/>}><PromptBuilder/></Suspense>
  else page=<div className="not-found"><h1>Pagina non disponibile</h1><a className="button primary" href="#/">Torna alla panoramica</a></div>
  const ready=profile&&!profile.must_change_password&&!profile.disabled
  return <WorkspaceContext.Provider value={{profile,subjects,workspace,years,tracks,groups,levels,trackLevels,selection,selectContext:session.select}}>
    <header className="topbar"><div className="topbar-left">{ready&&<button className="icon-button mobile-menu" aria-label="Apri navigazione" aria-expanded={menuOpen} onClick={()=>setMenuOpen(true)}><Menu size={20}/></button>}<a className="brand" href="#/" aria-label="Telecom/lab, panoramica"><BrandMark size={33}/>Telecom<span className="brand-light">/lab</span></a><span className="topbar-divider"/><span className="topbar-context">{account?<ContextSwitch institutions={session.institutions} activeId={activeId} change={session.change} recent={session.recent}/>:"Interactive workspace"}</span></div><div className="topbar-actions">{ready&&<a className="header-link" href="#/search"><Search size={17}/>Cerca</a>}{ready&&isStaff(profile.role)&&<span className="topbar-role">{roleLabel[profile.role]}</span>}<button className="icon-button theme-button" aria-label={`Tema: ${theme}. Cambia tema`} onClick={cycle}>{theme==='dark'?<Moon size={19}/>:<Sun size={19}/>}</button>{account?<button className="button subtle logout-button" onClick={async()=>{await session.logout();closeMenu()}}>Esci</button>:<a className="button subtle" href={configured?'#/login':'#/setup'}>Accedi</a>}</div></header>
    <div className="app-shell">{ready&&<Navigation open={menuOpen} onClose={closeMenu}><Sidebar route={route} contents={visibleContents} profile={profile} close={closeMenu}/></Navigation>}<main id="main-content" tabIndex={-1} className="main-content"><div key={`${activeId}:${path}:${selection.yearId}:${selection.trackId}:${selection.subjectId}:${selection.groupId}`} className="route-enter">{ready&&<ContextBar/>}{page}{catalog.error&&<p className="content-error" role="alert">{catalog.error}</p>}{catalog.more&&['/','/search'].includes(path)&&<button className="button subtle" disabled={catalog.loading} onClick={catalog.next}>Carica altri contenuti</button>}{catalog.more&&(path.startsWith('/year/')||path.startsWith('/subject/'))&&<button className="button subtle" disabled={catalog.loading} onClick={catalog.next}>Carica altri contenuti</button>}</div><Footer/></main></div><a className="skip-link" href="#" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus()}}>Vai al contenuto</a>
  </WorkspaceContext.Provider>
}
