import type { ReactNode } from 'react'
import { ArrowUpRight, Inbox } from 'lucide-react'

export function BrandMark({ size=32 }: {size?:number}) {
  return <svg className="fdm-mark" width={size} height={size} viewBox="0 0 72 72" aria-hidden="true"><rect width="72" height="72" rx="18" fill="currentColor"/><path d="M10 16H32V24H18V31H29V39H18V50H10ZM35 50V16H41L47 30L53 16H59V50H51V34L47 43L43 34V50Z" transform="translate(4 3)" className="fdm-mark-cut"/></svg>
}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'positive'|'warning'|'danger'|'info'}) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
export function StatusBadge({status}:{status:string}) {
  const map:Record<string,[string,'neutral'|'positive'|'warning'|'danger'|'info']>={draft:['Bozza','neutral'],ready:['Pronto','info'],published:['Pubblicato','positive'],archived:['Archiviato','neutral'],pending:['Da correggere','warning'],in_review:['In revisione','info'],reviewed:['Revisionato','positive']}
  const [label,tone]=map[status] || [status,status==='Scaduto'?'warning':'neutral']
  return <Badge tone={tone}>{label}</Badge>
}
export function EmptyState({title,children,action}:{title:string;children:ReactNode;action?:{label:string;href:string}}) {
  return <div className="product-empty"><span className="empty-orbit"><Inbox size={24}/></span><h3>{title}</h3><p>{children}</p>{action&&<a className="button subtle" href={action.href}>{action.label}<ArrowUpRight size={15}/></a>}</div>
}
export function Skeleton({label='Caricamento…'}:{label?:string}) {
  return <div className="skeleton-page" role="status" aria-label={label}><span className="sr-only">{label}</span><div className="skeleton skeleton-title"/><div className="skeleton skeleton-line"/><div className="skeleton-grid">{[0,1,2].map(i=><div key={i} className="skeleton skeleton-card"/>)}</div></div>
}
export function Progress({value,total,label}:{value:number;total:number;label:string}) {
  const percent=total>0?Math.min(100,Math.round(value/total*100)):0
  return <div className="progress-metric"><div><span>{label}</span><strong>{value}/{total}</strong></div><progress max={100} value={percent} aria-label={label}/></div>
}
