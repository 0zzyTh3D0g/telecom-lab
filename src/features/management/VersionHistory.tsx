import { useEffect, useState } from 'react'
import { db, errorMessage } from '../../backend/client'

type Version = { id: string; version: number; created_at: string; created_by: string | null }

export function VersionHistory({ contentId, onRestored }: { contentId: string; onRestored: () => void }) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<Version[]>([])
  const [authors, setAuthors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open || !db) return
    let current = true
    const load = async () => {
      const { data, error } = await db!.from('content_versions').select('id,version,created_at,created_by').eq('content_id',contentId).order('version',{ ascending: false }).limit(100)
      if (error) throw error
      if (!current) return
      setVersions(data || [])
      const ids = [...new Set((data || []).map(row => row.created_by).filter((id): id is string => Boolean(id)))]
      if (ids.length) {
        const people = await db!.from('profiles').select('id,username').in('id',ids)
        if (people.error) throw people.error
        if (current) setAuthors(Object.fromEntries((people.data || []).map(person => [person.id,person.username])))
      }
    }
    load().catch(error => { if (current) setMessage(errorMessage(error)) })
    return () => { current = false }
  }, [open,contentId,busy])
  const restore = async (version: number) => {
    if (!db || busy) return
    setBusy(true); setMessage('')
    const { data, error } = await db.rpc('restore_content_version',{ cid: contentId, source_version: version })
    if (error) setMessage(error.message)
    else { setMessage(`Ripristino creato come versione ${(data as { version: number }).version}, in bozza.`); onRestored() }
    setBusy(false)
  }
  return <div className="version-history"><button className="button subtle" aria-expanded={open} onClick={() => setOpen(value => !value)}>Cronologia versioni</button>{open && <div><ol>{versions.map(item => <li key={item.id}><span>Versione {item.version} · {new Date(item.created_at).toLocaleString('it-IT')} · {item.created_by ? authors[item.created_by] || 'Autore non disponibile' : 'Versione precedente'}</span><button className="button subtle" disabled={busy || item.version === versions[0]?.version} onClick={() => restore(item.version)}>Ripristina questa versione</button></li>)}</ol>{!versions.length && <p>Nessuna versione disponibile.</p>}{message && <p role="status">{message}</p>}</div>}</div>
}
