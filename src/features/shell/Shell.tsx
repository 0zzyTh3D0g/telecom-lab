import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, BookOpen, CalendarDays, ChevronDown, ClipboardList, Compass, Folder, Layers3, PanelLeftClose, ShieldCheck, Sparkles, Upload } from 'lucide-react'
import type { ContentItem, Profile } from '../../backend/client'
import { canAuthor, isStaff, roleLabel, useWorkspace } from '../../backend/workspace'
import { BrandMark } from '../../components/ProductUI'

function TreeSection({label,storageId,active=false,children,icon}:{label:ReactNode;storageId:string;active?:boolean;children:ReactNode;icon?:ReactNode}) {
  const [open,setOpen]=useState(()=>{try{return localStorage.getItem(storageId)==='true'||active}catch{return active}})
  useEffect(()=>{if(active)setOpen(true)},[active])
  const expanded=open
  return <div className={`nav-tree-section ${expanded?'expanded':''}`}><button className="nav-tree-toggle" aria-expanded={expanded} onClick={()=>{const next=!expanded;setOpen(next);try{localStorage.setItem(storageId,String(next))}catch{/* Optional preference. */}}}>{icon}{label}<ChevronDown size={13}/></button><div className="nav-tree-reveal" inert={!expanded}><div>{children}</div></div></div>
}

export function Sidebar({route,contents,profile,close}:{route:string;contents:ContentItem[];profile:Profile;close:()=>void}) {
  const {subjects,workspace,levels}=useWorkspace()
  const link=(path:string,label:string,icon:ReactNode)=><a className={`side-link ${route.split('?')[0]===path?'active':''}`} aria-current={route.split('?')[0]===path?'page':undefined} href={`#${path}`} onClick={close}>{icon}{label}</a>
  return <aside className="sidebar"><div className="sidebar-inner"><div className="workspace-card"><span className="workspace-glyph"><Layers3 size={18}/></span><div><strong>{workspace?.name||'Telecom/lab'}</strong><small>Spazio didattico</small></div></div><nav aria-label="Navigazione principale"><div className="side-section-label">WORKSPACE</div>{link('/','Panoramica',<Compass size={17}/>)}{link('/assignments','Compiti',<ClipboardList size={17}/>)}<div className="side-section-label tools-label">LIBRERIA</div>
    {[...levels.filter(l=>!l.archived_at).map(l=>({code:l.code,label:l.label})),...(contents.some(c=>!c.level_code)?[{code:null,label:"Risorse generali"}]:[])].map(level=>{const year=level.code;return <TreeSection key={year||'general'} storageId={`nav:${profile.id}:year:${year}`} label={level.label} active={contents.some(c=>(c.level_code||null)===year&&route===`/lesson/${subjects.find(s=>s.id===c.subject_id)?.slug}/${c.slug}`)} icon={<span className="year-glyph">{year||"•"}</span>}>
      <a className="nav-overview" href={year?`#/year/${encodeURIComponent(year)}`:'#/general'} onClick={close}>Tutti i contenuti <ArrowUpRight size={12}/></a>
      {subjects.filter(s=>!s.archived_at).map(subject=>{const items=contents.filter(c=>(c.level_code||null)===year&&c.subject_id===subject.id);const modules=[...new Set(items.map(c=>c.module))];return <TreeSection key={subject.id} storageId={`nav:${profile.id}:${year}:${subject.id}`} active={items.some(c=>route===`/lesson/${subjects.find(s=>s.id===c.subject_id)?.slug}/${c.slug}`)||route.startsWith(`/subject/${subject.slug}`)} label={<><span className={`subject-dot tone-${subject.color}`}/><span>{subject.name}</span></>}>
        <a className="nav-overview" href={`#/subject/${subject.slug}?year=${year}`} onClick={close}>Panoramica materia</a>
        {modules.map(module=><TreeSection key={module} storageId={`nav:${profile.id}:${year}:${subject.id}:${module}`} active={items.some(c=>c.module===module&&route===`/lesson/${subjects.find(s=>s.id===c.subject_id)?.slug}/${c.slug}`)} label={module} icon={<Folder size={13}/>}>
          {items.filter(c=>c.module===module).map(item=><a key={item.id} className={`side-lesson ${route===`/lesson/${subject.slug}/${item.slug}`?'active':''}`} aria-current={route===`/lesson/${subject.slug}/${item.slug}`?'page':undefined} href={`#/lesson/${encodeURIComponent(subject.slug)}/${encodeURIComponent(item.slug)}`} onClick={close}><span/>{item.title}</a>)}
        </TreeSection>)}
      </TreeSection>})}
    </TreeSection>})}
    {isStaff(profile.role)&&<><div className="side-section-label tools-label">STUDIO</div>{link('/planning','Pianificazione',<CalendarDays size={17}/>)}{link('/manage',profile.role==='reviewer'?'Correzioni':'Area gestione',<ShieldCheck size={17}/>)}{canAuthor(profile.role)&&<>{link('/prompt','Prompt Builder',<Sparkles size={17}/>)}{link('/import','Importa contenuto',<Upload size={17}/>)}</>}</>}
    <div className="side-section-label tools-label">ACCOUNT</div>{link('/personal','Libreria personale',<BookOpen size={17}/>)}
    </nav><div className="sidebar-footer"><span className="profile-avatar">{profile.first_name[0]}{profile.last_name[0]}</span><div><strong>{profile.username}</strong><small>{roleLabel[profile.role]}</small></div></div></div></aside>
}

export function Navigation({open,onClose,children}:{open:boolean;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if(!open)return
    const previous=document.activeElement as HTMLElement|null
    const before=document.body.style.overflow
    document.body.style.overflow='hidden'
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose()}
      if(event.key==='Tab'){
        const nodes=[...(ref.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')||[])].filter(node=>node.getClientRects().length)
        const first=nodes[0],last=nodes.at(-1)
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
      }
    }
    document.addEventListener('keydown',key)
    return()=>{document.body.style.overflow=before;document.removeEventListener('keydown',key);previous?.focus()}
  },[open,onClose])
  return <><button tabIndex={-1} className={`mobile-overlay ${open?'visible':''}`} aria-label="Chiudi navigazione" onClick={onClose}/><div ref={ref} role={open?'dialog':undefined} aria-modal={open?true:undefined} aria-label={open?'Navigazione workspace':undefined} className={`sidebar-wrap ${open?'open':''}`}><button className="icon-button sidebar-close" aria-label="Chiudi navigazione" onClick={onClose}><PanelLeftClose size={20}/></button>{children}</div></>
}
export function Footer(){return <footer className="site-footer"><div className="footer-signature"><BrandMark size={25}/><span>Progettata da Francesco Di Martino · 4ITC1 · A.S. 2026/2027</span></div><div><a href="#/about">Design & crediti</a><a href="#/privacy">Privacy e attività</a></div></footer>}
export function About(){return <div className="catalog-page"><div className="page-heading"><span className="eyebrow">DESIGN & TECNOLOGIA</span><h1>Progettare con intenzione.</h1><p>Telecom/lab è un ambiente tecnico per trasformare il materiale reale in contenuti, esperimenti e pratica.</p></div><section className="brand-story panel"><div className="brand-signature-light"><img src={`${import.meta.env.BASE_URL}brand/fdm-horizontal-light.svg`} alt="Francesco Di Martino"/></div><div><span className="eyebrow">L’IDENTITÀ</span><h2>Una firma. Un sistema.</h2><p>Il monogramma FM unisce due iniziali in una struttura geometrica compatta. La firma completa mantiene il nome al centro, con un linguaggio visivo sobrio e utilizzabile nel tempo.</p><a className="button subtle" href={`${import.meta.env.BASE_URL}brand/fdm-horizontal-mono.svg`} download>Scarica il logo SVG <ArrowUpRight size={15}/></a></div></section><div className="feature-strip"><article><BookOpen/><h3>Materiale al centro</h3><p>Le fonti definiscono il programma. Il Prompt Builder organizza il lavoro senza sostituire il contratto didattico.</p></article><article><ShieldCheck/><h3>Accessi espliciti</h3><p>Contenuti, correzioni e strumenti rispettano il ruolo e l’ambito assegnato.</p></article><article><Layers3/><h3>Un sistema aperto</h3><p>React, PostgreSQL e strumenti open source. Nessuna API IA integrata o servizio premium richiesto.</p></article></div></div>}
