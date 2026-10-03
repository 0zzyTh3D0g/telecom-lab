import { useState } from "react";
import { db, errorMessage } from "../../backend/client";
import { dataChanged, useWorkspace } from "../../backend/workspace";
import { LevelConfiguration } from './LevelConfiguration';
import { Rollover } from './Rollover';

export function AcademicStructure() {
  const { years, tracks, subjects, profile } = useWorkspace(),
    [label, setLabel] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [scope, setScope] = useState<string[]>([]),
    [institution, setInstitution] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [yearId,setYearId]=useState<string|null>(null),[trackId,setTrackId]=useState<string|null>(null);
  const [activate,setActivate]=useState<string|null>(null),[archiveConfirmed,setArchiveConfirmed]=useState(false);
  const run = async (
    fn: () => PromiseLike<{ error: { message: string } | null }>,
  ) => {
    setBusy(true);
    setMessage("");
    try {
      const { error } = await fn();
      if (error) throw error;
      dataChanged();
      setMessage("Struttura aggiornata. Lo storico è conservato.");
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lifecycle-shell"><div className="planner-columns">
      <section className="panel management-panel">
        <h2>Anni scolastici</h2>
        {message && <p role="status">{message}</p>}
        {years.map((y) => (
          <article key={y.id} className="source-card">
            <strong>{y.label}</strong>
            <p>
              {y.start_date} → {y.end_date} · {y.status}
            </p>
            <select
              aria-label={`Stato anno ${y.label}`}
              disabled={busy}
              value={y.status}
              onChange={(e) => e.target.value==='active'&&y.status!=='active'?(setActivate(y.id),setArchiveConfirmed(false)):run(() =>
                  db!.rpc("save_academic_year", {
                    year_id: y.id,
                    year_label: y.label,
                    start_on: y.start_date,
                    end_on: y.end_date,
                    year_status: e.target.value,
                  }))
              }
            >
              <option value="upcoming">Prossimo</option>
              <option value="active">Attivo</option>
              <option value="archived">Archiviato · storico</option>
            </select>
            <button className="button subtle" aria-label={`Modifica anno ${y.label}`} disabled={busy} onClick={()=>{setYearId(y.id);setLabel(y.label);setStart(y.start_date);setEnd(y.end_date)}}>Modifica anno</button>
          </article>
        ))}
        {activate&&<aside className="year-confirmation"><h3>Attivare {years.find(y=>y.id===activate)?.label}?</h3><label><input type="checkbox" checked={archiveConfirmed} onChange={e=>setArchiveConfirmed(e.target.checked)}/>Archiviare {years.find(y=>y.status==='active')?.label||'il precedente anno attivo'}? Lo storico resta leggibile e non operativo.</label><button className="button primary" disabled={busy||!archiveConfirmed} onClick={()=>run(()=>db!.rpc('activate_academic_year',{yid:activate,archive_previous:archiveConfirmed})).then(()=>setActivate(null))}>Conferma attivazione anno</button><button className="button subtle" onClick={()=>setActivate(null)}>Annulla</button></aside>}
        <p>
          Archiviare interrompe l’accesso operativo dei membri ai compiti e ai
          grant di gruppo. Risposte e attività restano consultabili allo staff
          autorizzato.
        </p>
        <label>
          Etichetta anno
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="2027/2028"
          />
        </label>
        <div className="form-pair">
          <label>
            Inizio
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Fine
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <button
          className="button primary"
          disabled={busy || !label || !start || end <= start}
          onClick={() =>
            run(() =>
              db!.rpc("save_academic_year", {
                year_id: yearId,
                year_label: label,
                start_on: start,
                end_on: end,
                year_status: years.find(y=>y.id===yearId)?.status||"upcoming",
              }),
            )
          }
        >
          {yearId?'Salva anno scolastico':'Crea anno scolastico'}
        </button>
        {yearId&&<button className="button subtle" onClick={()=>{setYearId(null);setLabel('');setStart('');setEnd('')}}>Nuovo anno</button>}
      </section>
      <section className="panel management-panel">
        <h2>Indirizzi configurabili</h2>
        {tracks.map((t) => (
          <article key={t.id} className="source-card">
            <strong>{t.name}</strong>
            <p>{t.description}</p>
            <button className="button subtle" aria-label={`Modifica indirizzo ${t.name}`} disabled={busy} onClick={()=>run(async()=>{const result=await db!.from('track_subjects').select('subject_id').eq('track_id',t.id);if(!result.error){setTrackId(t.id);setName(t.name);setDescription(t.description);setScope((result.data||[]).map(v=>v.subject_id))}return result})}>Modifica indirizzo</button>
          </article>
        ))}
        <label>
          Nome indirizzo
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Descrizione
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Materie del percorso</legend>
          {subjects
            .filter((s) => !s.archived_at)
            .map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={scope.includes(s.id)}
                  onChange={(e) =>
                    setScope(
                      e.target.checked
                        ? [...scope, s.id]
                        : scope.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.name}
              </label>
            ))}
        </fieldset>
        <button
          className="button primary"
          disabled={busy || name.trim().length < 2}
          onClick={() =>
            run(() =>
              db!.rpc(trackId?"update_track":"save_track", {
                ...(trackId?{track_id:trackId}:{}),
                track_name: name,
                track_description: description,
                subject_ids: scope,
              }),
            )
          }
        >
          Salva indirizzo
        </button>
        {trackId&&<button className="button subtle" onClick={()=>{setTrackId(null);setName('');setDescription('');setScope([])}}>Nuovo indirizzo</button>}
        {profile?.role === "owner" && (
          <>
            <h3>Nuovo istituto</h3>
            <p>
              L’owner corrente può creare un’organizzazione vuota. Le membership
              e le materie vanno assegnate esplicitamente.
            </p>
            <label>
              Nome istituto
              <input
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
              />
            </label>
            <button
              className="button subtle"
              disabled={busy || institution.trim().length < 2}
              onClick={() =>
                run(() =>
                  db!.rpc("create_workspace", { workspace_name: institution }),
                )
              }
            >
              Crea istituto
            </button>
          </>
        )}
      </section>
    </div><LevelConfiguration/><Rollover/></div>
  );
}
