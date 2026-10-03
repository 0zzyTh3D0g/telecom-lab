import { useRef, useState } from 'react'
import { Check, Download, FileJson, Upload, AlertCircle } from 'lucide-react'
import { parseLessonJson, type ValidationResult } from '../../domain/validate'
import { BlockRenderer } from '../lessons/BlockRenderer'
import { db, errorMessage } from '../../backend/client'
import { useWorkspace } from '../../backend/workspace'
import type { Lesson } from '../../domain/schema'

type Existing = { id: string; title: string }

export async function saveDraft(lesson: Lesson, expectedContentId: string | null) {
  if (!db) throw new Error('Backend non configurato.')
  const { data, error } = await db.rpc('save_content_document', { doc: lesson, expected_content_id: expectedContentId })
  if (error) throw error
  return data as { contentId: string; version: number }
}

export default function Importer() {
  const {subjects}=useWorkspace(); const [subjectOverride,setSubjectOverride]=useState('')
  const [source, setSource] = useState(''), [result, setResult] = useState<ValidationResult | null>(null)
  const [existing, setExisting] = useState<Existing | null>(null), [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false), [saveMessage, setSaveMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const clearAnalysis = () => { setResult(null); setExisting(null); setChecked(false); setSaveMessage('') }
  const analyze = async () => {
    clearAnalysis()
    const parsed = parseLessonJson(source)
    if(parsed.lesson&&subjectOverride)parsed.lesson.subject=subjectOverride
    setResult(parsed)
    if (!parsed.lesson || !db) return
    if(!subjects.some(s=>s.slug===parsed.lesson?.subject&&!s.archived_at)){setSaveMessage('La materia del documento non è disponibile per il tuo ruolo. Seleziona una materia autorizzata.');return}
    setBusy(true)
    try {
      const { data, error } = await db.from('content_items').select('id,title').eq('subject_id',subjects.find(s=>s.slug===parsed.lesson?.subject)?.id||'').or(`slug.eq.${parsed.lesson.slug},source_id.eq.${parsed.lesson.id}`).limit(2)
      if (error) throw error
      if ((data || []).length > 1) throw new Error('Slug e ID appartengono a due contenuti diversi. Correggi il documento prima di salvare.')
      setExisting(data?.[0] || null); setChecked(true)
    } catch (error) { setSaveMessage(`Verifica duplicati non riuscita: ${errorMessage(error)}`) }
    finally { setBusy(false) }
  }
  const download = () => {
    if (!result?.lesson) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.lesson, null, 2) + '\n'], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${result.lesson.slug}.json`; anchor.click()
    URL.revokeObjectURL(url)
  }
  const save = async () => {
    if (!result?.lesson || !checked || busy) return
    setBusy(true); setSaveMessage('')
    try {
      const saved = await saveDraft(result.lesson, existing?.id || null)
      setSaveMessage(`Bozza salvata come versione ${saved.version}. Rivedi accessi e pubblicazione nell’Area gestione.`)
      window.dispatchEvent(new Event('telecom:data-changed'))
      setChecked(false)
    } catch (error) { setSaveMessage(errorMessage(error)) }
    finally { setBusy(false) }
  }
  return <div className="tool-page"><div className="page-heading"><span className="eyebrow">AREA CONTENUTI / IMPORTAZIONE</span><h1>Importa contenuto</h1><p>Genera istruzioni, usa il chatbot esterno, incolla il JSON, valida, esamina l’anteprima e salva la bozza.</p><a href="#/prompt">Genera istruzioni</a></div>
    <label className="inline-filter">Materia di destinazione<select value={subjectOverride} onChange={e=>{setSubjectOverride(e.target.value);clearAnalysis()}}><option value="">Usa la materia del JSON (Telecomunicazioni se assente)</option>{subjects.filter(s=>!s.archived_at).map(s=><option key={s.id} value={s.slug}>{s.name}</option>)}</select></label><div className="import-grid"><section className="panel"><div className="panel-heading"><div><FileJson size={19} /><h2>Sorgente JSON</h2></div><button className="button subtle" onClick={() => fileRef.current?.click()}><Upload size={16} /> Carica file</button><input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async event => { const file = event.target.files?.[0]; if (file) { setSource(await file.text()); clearAnalysis() } }} /></div><label htmlFor="json-source" className="sr-only">Contenuto JSON</label><textarea id="json-source" className="json-editor" spellCheck={false} placeholder={'{\n  "schemaVersion": 2,\n  "id": "nuova-lezione",\n  ...\n}'} value={source} onChange={event => { setSource(event.target.value); clearAnalysis() }} /><div className="panel-footer"><span>Verifica locale e controllo duplicati prima del salvataggio.</span><button className="button primary" disabled={!source.trim() || busy} onClick={analyze}>{busy ? 'Verifica…' : 'Valida e mostra anteprima'}</button></div></section>
    <section className="panel result-panel"><div className="panel-heading"><div><Check size={19} /><h2>Validazione</h2></div></div>{!result ? <div className="empty-result"><div className="empty-icon"><FileJson size={27} /></div><h3>Pronto per l’analisi</h3><p>Carica o incolla un file per vedere errori, avvisi e anteprima.</p></div> : <div className="validation-body"><div className={`validation-status ${result.errors.length ? 'invalid' : 'valid'}`}>{result.errors.length ? <AlertCircle size={20} /> : <Check size={20} />}<strong>{result.errors.length ? 'Contenuto da correggere' : 'Schema valido'}</strong></div>{result.errors.length === 0 && <div className="validation-stats"><span>{result.stats.blocks} blocchi</span><span>{result.stats.formulas} formule</span><span>{result.stats.simulations} simulazioni</span><span>{result.stats.plots} grafici</span><span>{result.stats.exercises} Practice</span><span>{result.lesson?.assignments.length || 0} Assignment</span><span>{result.stats.questions} domande</span></div>}{result.errors.map((error, index) => <p className="validation-error" key={index}>{error}</p>)}{result.lesson && result.lesson.generationWarnings.length > 0 && <div className="generation-alert" role="alert"><strong>Avvisi generati dall’IA: rivedili prima di salvare</strong>{result.lesson.generationWarnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}{result.warnings.filter(w => !result.lesson?.generationWarnings.includes(w)).map((warning, index) => <p className="validation-warning" key={index}>{warning}</p>)}{result.lesson && <button className="button subtle download-button" onClick={download}><Download size={16} /> Scarica JSON validato</button>}</div>}</section></div>
    {result?.lesson && <section className="preview-panel"><div className="panel-heading"><h2>Anteprima completa</h2><span className="preview-badge">Non pubblicata</span></div><div className="preview-content"><span className="eyebrow">{subjects.find(s=>s.slug===result.lesson?.subject)?.name} / ANNO {result.lesson.levelCode||'Generale'} / {result.lesson.module}</span><h2>{result.lesson.title}</h2><p className="lesson-summary">{result.lesson.summary}</p><BlockRenderer blocks={result.lesson.blocks} />{result.lesson.assignments.map(assignment => <section className="assignment-preview" key={assignment.id}><span className="eyebrow">COMPITO SEPARATO</span><h3>{assignment.title}</h3><ol>{assignment.questions.map(question => <li key={question.id}>{question.prompt} <small>({question.type})</small></li>)}</ol><p>Le chiavi private saranno salvate separatamente quando crei il compito.</p></section>)}</div><div className="publish-note"><strong>Bozza</strong><p>Il contenuto rimane privato finché non viene pubblicato e autorizzato per un gruppo.</p>{existing && <div className="generation-alert" role="status"><strong>Questo contenuto esiste già: {existing.title}.</strong><p>Puoi creare una nuova versione. La versione precedente resta nella cronologia; la nuova torna in bozza.</p></div>}<div className="management-actions"><button className="button primary" disabled={!checked || busy} onClick={save}>{existing ? 'Crea nuova versione' : 'Salva nuova bozza'}</button>{existing && <button className="button subtle" onClick={() => { setResult(null); setExisting(null); setChecked(false) }}>Annulla</button>}</div>{saveMessage && <p role="status">{saveMessage}</p>}</div></section>}
    {!result?.lesson && saveMessage && <p className="feedback error" role="alert">{saveMessage}</p>}
  </div>
}
