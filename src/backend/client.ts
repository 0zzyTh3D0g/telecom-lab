import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const configured = Boolean(url && key)
let activeWorkspace: string | null = null
export const setRequestWorkspace = (id: string | null) => { activeWorkspace = id }
export const getRequestWorkspace = () => activeWorkspace
export const db: SupabaseClient | null = configured ? createClient(url, key, { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }, global: { fetch: (input,init) => {
  const headers=new Headers(init?.headers)
  if (!String(input).includes('/auth/v1/')) {
    // An explicitly captured context (e.g. an outgoing heartbeat) wins over the new selection.
    if (!headers.has('x-workspace-id') && activeWorkspace) headers.set('x-workspace-id',activeWorkspace)
  }
  return fetch(input,{...init,headers})
} } }) : null
export type StaffRole = 'owner' | 'manager' | 'editor' | 'reviewer' | 'member'
export type Profile = { id: string; workspace_id: string; username: string; first_name: string; last_name: string; role: StaffRole; disabled: boolean; must_change_password: boolean }
export type Subject = { id: string; workspace_id: string; slug: string; name: string; description: string; color: 'mineral' | 'blue' | 'violet' | 'amber' | 'rose' | 'slate'; archived_at: string | null; sort_order: number }
export type Workspace = { id: string; name: string }
export type Account = Omit<Profile,'role'|'workspace_id'>
export type Institution = Workspace & {role: StaffRole;disabled:boolean;archived_at:string|null}
export type AcademicYear = {id:string;workspace_id:string;label:string;start_date:string;end_date:string;status:'upcoming'|'active'|'archived'}
export type Track = {id:string;workspace_id:string;name:string;description:string;archived_at:string|null}
export type AcademicLevel = {id:string;workspace_id:string;code:string;label:string;sort_order:number;archived_at:string|null}
export type TrackLevel = {track_id:string;level_id:string;sort_order:number}
export type Group = {id:string;workspace_id:string;name:string;level_id:string|null;academic_year_id:string;track_id:string;archived_at:string|null}
export type ContentItem = { id: string; subject_id: string; slug: string; title: string; summary: string; level_code: string|null; module: string; topic: string; tags: string[]; status: string; sort_order: number; available_from: string | null; available_until: string | null;release_id?:string|null;content_version?:number|null }
export type Resource = { kind: 'theory' | 'simulation' | 'exercise'; blocks: unknown[]; search_text: string }
export function internalEmail(username: string) { return `${username.trim().toLowerCase()}@accounts.telecomlab.invalid` }
export async function loadProfile(id: string): Promise<Account> {
  if (!db) throw new Error('Backend non configurato.')
  const { data, error } = await db.from('profiles').select('id,username,first_name,last_name,disabled,must_change_password').eq('id', id).single()
  if (error || !data) throw new Error(error?.message || 'Profilo non disponibile.')
  return data as Account
}
export async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!db) throw new Error('Backend non configurato.')
  const { data, error } = await db.functions.invoke(name, { body })
  if (error) {
    const response = (error as { context?: unknown }).context
    if (response instanceof Response) {
      const details = await response.clone().json().catch(() => null) as { error?: string } | null
      if (details?.error) throw new Error(details.error)
    }
    throw new Error(error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}
export function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const known: Record<string,string> = {
    unknown_level_code:'Il livello del documento non è configurato. Crea il livello in Struttura o correggi levelCode prima di importare.',
    invalid_track_level:'Seleziona un livello configurato per l’indirizzo.',
    historical_level_required:'Questo livello è usato da gruppi storici e deve restare nel percorso.',
    academic_year_overlap:'Le date si sovrappongono a un altro anno dell’istituto.',
    archive_previous_confirmation_required:'Per attivare il nuovo anno conferma esplicitamente l’archiviazione di quello attivo.',
    enrollment_outside_year:'Le date dell’iscrizione devono rientrare nell’anno scolastico.',
    closed_enrollment_immutable:'L’iscrizione conclusa resta nello storico e non può essere riscritta.',
    future_transfer_use_rollover:'Per una variazione futura prepara il passaggio anno; una destinazione già preparata può essere corretta alla sua data iniziale.',
    rollover_revision_conflict:'La bozza è cambiata. Riapri il passaggio salvato prima di modificarlo.',
    rollover_preview_has_errors:'Correggi tutti gli errori e gli esiti in sospeso nell’anteprima.',
    rollover_requires_manual_correction:'La destinazione è già stata modificata o utilizzata. Annullamento automatico bloccato: correggi le iscrizioni con operazioni tracciate.',
    invalid_rollover_years:'Seleziona una sorgente non archiviata e un anno prossimo successivo.',
    subject_offering_required:'Configura prima una offerta annuale attiva per materia, indirizzo e livello del gruppo.',
    published_assignment_snapshot_immutable:'Il compito distribuito conserva domande e chiavi. Crea una nuova bozza per un nuovo compito.',
    historical_account_requires_retention_workflow:'L’identità conserva dati storici o personali. Concludi la membership locale; la cancellazione richiede una procedura di retention autorizzata.',
    backup_destination_not_empty:'Ripristino disponibile solo in un istituto vuoto. Nessun dato esistente viene sovrascritto.',
    backup_requires_original_workspace_identity:'Questo backup è per il recupero dell’istituto originale, con lo stesso ID. Per riuso usa copie di contenuti o curriculum.',
    backup_identity_prerequisites:'Collega prima gli account globali richiesti, con i ruoli locali corretti. La libreria personale deve appartenere al proprietario che ripristina.',
    legacy_backup_requires_p31_conversion_to_v6:'Converti il backup in P3.1, applica P3.2 ed esporta in formato v6.',

    last_owner_required: 'Il workspace deve mantenere almeno un owner attivo.',
    subject_scope_required: 'Assegna almeno una materia a editor e reviewer.',
    subject_access_denied: 'La materia non è disponibile per questo ruolo.',
    workspace_mismatch: 'Gli elementi selezionati appartengono a workspace diversi.',
    access_denied: 'Il ruolo attuale non consente questa operazione.',
    invalid_subject_scope: 'Seleziona materie attive del tuo workspace.',
    subject_move_requires_migration: 'La materia di un contenuto esistente non può essere cambiata con un’importazione.',
    academic_year_archived: 'Anno scolastico archiviato: lo storico è disponibile, le nuove operazioni sono bloccate.',
    curriculum_context_unavailable: 'Seleziona un anno non archiviato e un indirizzo disponibile nello stesso istituto.',
    plan_version_conflict: 'Il piano è stato aggiornato da un’altra persona. Riaprilo prima di salvare le modifiche.',
    source_used_by_plan: 'La fonte è usata da un piano: conserva la provenienza o modifica prima i riferimenti.',
    shared_account_requires_global_operator: 'Questo account appartiene a più istituti. Reset e cancellazione globali richiedono un operatore autorizzato; puoi disattivare la membership di questo istituto.',
  }
  if (known[message]) return known[message]
  return /network|fetch failed|failed to fetch|timeout|quota|rate limit|429|503|temporarily unavailable/i.test(message)
    ? 'Servizio temporaneamente non disponibile o quota gratuita raggiunta. Riprova più tardi; nessun upgrade viene eseguito.'
    : message || 'Servizio temporaneamente non disponibile.'
}
