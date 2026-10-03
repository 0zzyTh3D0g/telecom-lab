# Security P3.2

## Confini

Auth/profiles globali; ruolo locale in membership. `x-workspace-id` non autorizza: validazione server di account, password iniziale, membership e istituto. Member vede solo dati propri e release effettivamente consentite; non legge draft/title/search_text/versioni private. Grant individuale non espone la lezione al resto del gruppo. Scope authoring separato dall’incarico anno/materia/gruppo. Demozione revoca dati operativi. Reviewer accede a risposte/rubriche soltanto con enrollment registrato nel gruppo assegnato; legacy non ricostruibile rimane al manager.

## Postgres

RLS su tutte le nuove tabelle, letture esplicite e nessun INSERT/UPDATE/DELETE diretto per authenticated su lifecycle/release/tracking. Le RPC public sono SECURITY INVOKER; implementazioni privilegiate in app_private non esposto, SECURITY DEFINER con search_path vuoto e riferimenti qualificati. EXECUTE revocato a PUBLIC/anon, concesso per firma ai ruoli necessari; callback trigger interne non eseguibili dai ruoli API. `register_created_accounts` esclusivo service_role, valida comunque actor/istituto/target e registra dati in una transazione.

Rollover, trasferimento, pubblicazione e attività coordinano lock; anni bloccati in modo condiviso per scritture operative e esclusivo per archiviazione. Indici parziali garantiscono unicità degli active, grant e release. Stato del frontend non è un controllo di sicurezza. Snapshot pubblicate e iscrizioni concluse protette da trigger. Privacy deletion è una RPC amministrativa locale con flag transazionale interno; API role non può sfruttarlo per DML diretto.

## Edge/Auth

Bearer verificato tramite Auth, ruolo/membership/stato risolti server-side. Service key solamente Edge. Creazione account: Auth via admin API, registrazione profili/membership/enrollment atomica via RPC; compensazione Auth se fallisce la registrazione. Auth è un servizio distinto: non esiste transazione ACID unica con PostgreSQL, e una perdita di rete può richiedere pulizia amministrativa degli account Auth orfani. Il test live necessario verifica questa integrazione; qui non è stato eseguito.

Signup pubblico da disabilitare. Password iniziale casuale, mostrata una sola volta, cambio obbligatorio. Reset/delete di identità multi-istituto bloccati. Eliminazione bloccata in presenza di iscrizioni, attività, Practice, tentativi, documenti o materiale personale; non è una funzione di retention. Disattivazione/uscita locale non modifica altri istituti. CORS con ALLOWED_ORIGINS esatto; nessun endpoint pubblico di promozione.

## Input e privacy

JSON limitato/validato, no esecuzione codice dal documento; expression parser limitato, KaTeX trust:false, React escaping. PDF.js locale, niente OCR/upload file. Fonti e backup possono contenere dati personali: esportazione riservata, conservazione protetta. Backup non include password, chiavi service o sessioni. Restore originale/destinazione vuota, dryrun e transazione: no upsert identità/history, no dati cross-workspace, colonne sconosciute respinte. ID audit originali conservati nei dettagli.

Il tempo attivo è aggregato e stimato, non una misura esatta dello studio. Nessun fingerprint, advertising, registrazione tasti/mouse o ranking. Tracking P3.1 resta con attribuzione sconosciuta esplicita. Anonimizzazione completa e retention automatica non implementate: progettare migrazione autorizzata che consideri FK, audit e documenti con provenienza, oltre a risposte/libri personali. La sola eliminazione attività non cancella ogni dato personale.

## Evidenze e limiti

`lifecycle.test.ts` esegue sette migration su PostgreSQL reale PGlite, RLS con authenticated/anon/service_role, upgrade popolato 3/4, scope 3A/4A, ostilità DML/RPC, account bloccati, release pinning, snapshot, rollover/idempotenza/cancel, archiviazione, isolamento A/B e restore reale/dryrun/errore atomico. I test P2/P3/P3.1 restano attivi. Playwright wizard usa SQL/RLS PGlite; Auth UI simulato e distinto dal test live locale, esplicitamente skipped senza configurazione. Nessun Security Advisor remoto, stress test multi-connessione o verifica Supabase Auth/Edge live è stato eseguito qui.

Riferimenti primari verificati: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html), [PDF.js](https://mozilla.github.io/pdf.js/examples/). Verificare la configurazione degli schemi esposti e i grant anche nel progetto Supabase prima del deploy.
