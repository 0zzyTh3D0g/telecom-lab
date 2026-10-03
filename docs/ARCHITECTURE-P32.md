# Architettura P3.2

## Identità e contesto

`auth.users → profiles` è globale. `workspace_memberships(workspace_id,user_id)` conserva ruolo e disattivazione locali. Preferenze browser e header `x-workspace-id` selezionano un contesto; `current_workspace()` verifica membership, account pronto e istituto attivo. `resolve_recent_contexts` verifica al massimo otto contesti, anche cross-workspace. Libri/piani personali restano owner-bound e separati dai dati istituzionali.

## Modello accademico

```
workspace → academic_years → groups
          → academic_levels ← track_levels → tracks
profiles + workspace + year + group → enrollments (dated history)
year + track + subject + optional level → subject_offerings
staff + year + subject + group → teaching_assignments
```

Una sola iscrizione primaria active per account/istituto/anno tramite indice parziale. Sono possibili iscrizione corrente e futura in anni distinti; la futura non concede accesso. Cambi di gruppo chiudono/creano record, senza cancellare il precedente. Stato e outcome distinti; date a granularità giorno, evento/audit con timestamp. Il gruppo conserva anno/indirizzo e non cambia livello dopo iscrizioni. Codici/etichette dei livelli distinti: codice stabile nei documenti, etichetta configurabile. L’ordine dell’indirizzo viene usato per proporre avanzamento; non implica autorizzazione.

`group_memberships` e colonne numeriche legacy sono riferimenti conservati, senza operatività. Le date migranti dichiarano provenienza ricostruita dall’anno. Attribuzioni storiche sconosciute non vengono inventate. Un database vuoto non riceve livelli o contenuti dimostrativi; conserva solo bootstrap strutturale P3.1.

## Rollover

`rollover_batches` registra anni, autore, stato, revisione, applicazione e report. `rollover_entries` registra decisione/destinazione e snapshot dell’iscrizione sorgente. Salvataggi esiti usano optimistic revision; anteprima confronta snapshot attuale, target, ruoli e percorso. Applicazione blocca workspace, batch, anni, iscrizioni e gruppi destinazione; tutti gli outcome/inserimenti/audit in una transazione. Riapplicare lo stesso batch restituisce il report. Nessuna chiamata browser per singolo account durante la finalizzazione.

La chiusura è operativa subito: finalizzare al termine dell’anno, preparare la bozza prima. Destinazione prossima e data d’ingresso impediscono accessi anticipati. Uscita/completamento non creano target. Nessun contenuto, grant, release, attività, risposta o review copiato. Curriculum copiato separatamente come nuovo draft, con progressi azzerati.

Annullamento: lock sugli anni, verifica assenza di operazioni/release e integrità delle iscrizioni prodotte; conserva destinazioni annullate, ripristina la sorgente. Cambi successivi alle iscrizioni richiedono correzione tracciata, non cancellazione dello storico. Anno archiviato: lettura manager/staff autorizzato, nessuna operazione sui dati collegati. Lock condivisi sull’anno nei trigger impediscono scritture che si sovrappongono all’archiviazione.

## Bozze, release, snapshot

```
content_item → content_versions(document immutable)
            → content_resources (author draft only)
content + version + year + group → content_releases
release + user → lesson_release_activity / practice_release_progress
assignment → questions + private_answer_keys (immutable after publication)
question + user + enrollment → attempts → reviews
```

Una nuova versione non modifica distribuzioni. Member non legge direttamente content_items/content_resources/content_versions: usa catalog, resolver, ricerca e risorse sanitizzate della release. Titolo, summary, slug, livello, testo e risorse arrivano dal documento pinning. Il vecchio record release passa a superseded; il nuovo è append-only. Nessuna soluzione privata Assignment passa dai blocchi lezione. Grant e offerta restano controlli attuali: una snapshot non è un permesso eterno.

Practice/tempo precedenti restano senza release; analytics mostra provenienza legacy. Nuovi tentativi registrano enrollment effettivo, così cambio gruppo non amplia lo scope del reviewer. Vecchi tentativi non attribuibili sono manager-only. Snapshot Assignment protetta da trigger su domande, chiavi e metadati, oltre a RLS e privilegi.

## Query e volume

Catalog 100/pagina, ricerca 50/pagina con debounce, resolver singolo indipendente da paginazione, attività/percorso/account 50, review 25, esiti UI 25. Tabelle struttura solo dell’istituto selezionato (gruppi context fino a 500, adatti al target di 100 gruppi). Incarichi e versioni caricati quando aperti; nessun polling/Realtime. Recenti risolvono solo gli ID richiesti. Indici: anno active unico, enrollment active unico e per gruppo/data, ordine track-level, offering unici globali/per livello, release current unica e per contesto, tracking per release/user, namespace per subject. Aggregati sono server-side, senza query HTTP per account. La ricerca testuale esegue confronti sulle sole snapshot/risorse autorizzate; il carico reale di 1.000 account non è stato benchmarkato.

## PDF e metaprompt

PDF.js è lazy-loaded; worker locale bundlato da Vite. Estrazione seriale con limiti, cleanup document/worker, preview paginata. File non salvato né trasmesso; soltanto fonte confermata con provenienza. Immagini/scansioni degradano a inserimento manuale. Prompts includono estratti confermati senza raddoppiare page_text nei metadata. Nessun controllo semantico IA, nessuna citazione inventata.

## Backup e architettura futura

v6 conserva lifecycle, authoring, curriculum e storico locale. Restore in subtransaction real/dryrun; ID istituto originale, infrastruttura vuota, identità globali/membership predisposte. Non cambia ruoli/global Auth. Prerequisiti FK convalidati dalla stessa transazione. Backup applicativo richiede manutenzione durante export; dump amministrativo necessario per disaster recovery di Auth/membership e coerenza globale.

Configurazioni già consentono futuro onboarding istituto → anno → indirizzo → livelli → materie → gruppi → staff senza nuove entità. Retention non automatizzata: dati account sono indicizzati per user/owner/reviewer; FK e audit richiedono una procedura deliberata di anonimizzazione. Non cancellare identità globali come normale operazione annuale. Nessun servizio a pagamento o endpoint di auto-promozione.
