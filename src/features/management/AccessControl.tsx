import { useCallback, useEffect, useState } from 'react'
import { db, errorMessage, type ContentItem } from '../../backend/client'
import { useWorkspace } from '../../backend/workspace'
import { Badge, StatusBadge } from '../../components/ProductUI'

type Group={id:string;name:string;archived_at:string|null}
type Grant={module:boolean;lesson:boolean;theory:boolean;simulation:boolean;exercise:boolean}
const empty:Grant={module:false,lesson:false,theory:false,simulation:false,exercise:false}
const kinds=[['theory','Teoria'],['simulation','Simulazioni e grafici'],['exercise','Esercizi']] as const
export function AccessControl({contents,groups}:{contents:ContentItem[];groups:Group[]}){
  const {subjects}=useWorkspace()
  const [groupId,setGroupId]=useState(''),[releases,setReleases]=useState<Record<string,{content_version:number|null;effective:boolean;reason:string;resources:Record<string,boolean>}>>({}),[grants,setGrants]=useState<Record<string,Grant>>({})
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[message,setMessage]=useState('')
  const refresh=useCallback(async()=>{
    if(!db||!groupId)return;setLoading(true)
    try{
      const [m,c,r,p]=await Promise.all([
        db.from('module_access').select('subject_id,level_code,module,allowed').eq('group_id',groupId).limit(1000),
        db.from('content_access').select('content_id,allowed').eq('group_id',groupId).in('content_id',contents.map(c=>c.id)),
        db.from('resource_access').select('content_id,kind,allowed').eq('group_id',groupId).in('content_id',contents.map(c=>c.id)),
        db.rpc('group_release_state',{gid:groupId,cids:contents.map(c=>c.id)}),
      ])
      if(m.error||c.error||r.error||p.error)throw m.error||c.error||r.error||p.error
      setReleases(Object.fromEntries((p.data||[]).map((row:{content_id:string;content_version:number|null;effective:boolean;reason:string;resources:Record<string,boolean>})=>[row.content_id,row])))
      setGrants(Object.fromEntries(contents.map(item=>[item.id,{module:m.data?.find(g=>g.subject_id===item.subject_id&&g.level_code===(item.level_code||'')&&g.module===item.module)?.allowed||false,lesson:c.data?.find(g=>g.content_id===item.id)?.allowed||false,...Object.fromEntries(kinds.map(([kind])=>[kind,r.data?.find(g=>g.content_id===item.id&&g.kind===kind)?.allowed||false]))} as Grant])))
    }catch(e){setMessage(errorMessage(e))}finally{setLoading(false)}
  },[groupId,contents])
  useEffect(()=>{if(contents.length)void refresh()},[refresh,contents.length])
  const save=async(item:ContentItem,grant:Grant)=>{
    if(!db||!groupId||busy)return;setBusy(true);setMessage('')
    const {error}=await db.rpc('save_group_access',{cid:item.id,gid:groupId,module_allowed:grant.module,lesson_allowed:grant.lesson,theory_allowed:grant.theory,simulation_allowed:grant.simulation,exercise_allowed:grant.exercise})
    if(error)setMessage(errorMessage(error));else{await refresh();setMessage('Accessi salvati.')};setBusy(false)
  }
  const setModule=async(sid:string,year:string,module:string,enabled:boolean)=>{
    if(!db||!groupId||busy)return;setBusy(true);setMessage('')
    const {error}=await db.rpc('set_level_module_bundle',{sid,gid:groupId,level_code_value:year,module_name:module,allowed_value:enabled})
    if(error)setMessage(errorMessage(error));else{await refresh();setMessage(enabled?'Modulo e risorse abilitati.':'Modulo e risorse disabilitati.')};setBusy(false)
  }
  const permitted=contents.filter(c=>releases[c.id]?.effective).length
  return <section className="panel management-panel access-tree"><span className="eyebrow">ACCESSI / GERARCHIA</span><h2>Ogni livello ha il suo ruolo.</h2><p>Materia → modulo → lezione → risorse. Le risorse ereditano il blocco del livello superiore. L’accesso effettivo usa versione, date e offerta della release. Eccezioni individuali si applicano al singolo account. I pulsanti configurano i grant del documento corrente. L’albero mostra la pagina corrente; le azioni sul modulo includono tutte le sue lezioni.</p><label>Gruppo<select value={groupId} onChange={e=>{setGroupId(e.target.value);setMessage('')}}><option value="">Seleziona un gruppo</option>{groups.filter(g=>!g.archived_at).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>{message&&<p role="status" className="management-message">{message}</p>}{loading&&<p role="status">Caricamento accessi…</p>}{groupId&&!loading&&<><div className="access-summary"><Badge tone="positive">{permitted} lezioni abilitate</Badge><Badge>{contents.length-permitted} bloccate o disabilitate</Badge><Badge tone="info">Eredità: tutti i livelli devono consentire l’accesso</Badge></div>{subjects.filter(s=>contents.some(c=>c.subject_id===s.id)).map(subject=><div key={subject.id} className={`access-year tone-${subject.color}`}><h3><span className="subject-dot"/> {subject.name}</h3>{[...new Set(contents.map(c=>c.level_code||''))].flatMap(year=>[...new Set(contents.filter(c=>c.subject_id===subject.id&&(c.level_code||'')===year).map(c=>c.module))].map(module=>{
    const items=contents.filter(c=>c.subject_id===subject.id&&(c.level_code||'')===year&&c.module===module),moduleOn=items.some(c=>grants[c.id]?.module)
    return <details key={`${year}:${module}`} className="access-module"><summary>Anno {year} · {module}<Badge tone={moduleOn?'positive':'neutral'}>{moduleOn?'Abilitato':'Disabilitato'}</Badge></summary><div className="access-module-actions"><button className="button subtle" disabled={busy} onClick={()=>setModule(subject.id,year,module,true)}>Abilita intero modulo</button><button className="button subtle" disabled={busy} onClick={()=>setModule(subject.id,year,module,false)}>Disabilita intero modulo</button></div>{items.map(item=>{
      const grant=grants[item.id]||empty,effective=releases[item.id]?.effective||false,state=releases[item.id]?.reason||'Stato non disponibile'
      return <div className="access-lesson" key={item.id}><div className="access-lesson-heading"><strong>{item.title}</strong><StatusBadge status={releases[item.id]?.content_version?'published':item.status}/>{releases[item.id]?.content_version&&<small>Release v{releases[item.id].content_version}</small>}<Badge tone={effective?'positive':'neutral'}>{state}</Badge><button className="button subtle" aria-pressed={grant.lesson} disabled={busy} onClick={()=>save(item,{...grant,lesson:!grant.lesson})}>{grant.lesson?'Disabilita lezione':'Abilita lezione'}</button></div><div className="access-resources">{kinds.map(([kind,label])=><button className="access-resource" key={kind} aria-pressed={grant[kind]} disabled={busy} onClick={()=>save(item,{...grant,[kind]:!grant[kind]})}><span>{label}</span><strong>{!effective?'Bloccato dal livello superiore':releases[item.id]?.resources[kind]?'Abilitato':'Disabilitato'}</strong></button>)}</div><button className="button subtle" disabled={busy} onClick={()=>save(item,{...grant,lesson:true,theory:true,simulation:true,exercise:true})}>Abilita tutte le risorse della lezione</button></div>
    })}</details>
  }))}</div>)}</>}</section>
}
