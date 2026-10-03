# P3.2 — report di rilascio e collaudo

Versione applicativa **3.2.0**. Consegna del 2 ottobre 2026, basata sul progetto P3.1 esistente. React, TypeScript, Supabase, Practice, Assignment, grafici, simulatori, Prompt Builder, curriculum e libreria personale conservati. Nessun redesign globale. Costo operativo richiesto **0,00 €**: nessun servizio a pagamento, API IA, OCR cloud o upgrade automatico introdotto.

## 1. Audit iniziale e problemi corretti

L’[audit precedente alle modifiche](P32-AUDIT.md) comprende package/workflow, tutte le migration applicate, policy, privilegi, RPC, trigger, Auth/Edge, scope, contenuti, curriculum, libreria, contesto, tracking, gestione, backup e test. Gli invarianti A–J sono stati definiti prima dell’implementazione.

Problemi principali:

- I cambi di gruppo cancellavano l’associazione precedente; mancava un percorso temporale.
- Livelli 3/4 incorporati nel modello, nell’interfaccia e nei documenti.
- Reimportazione e distribuzione condividevano le risorse della bozza: una modifica poteva cambiare quanto già pubblicato.
- Scope materia usato anche per dati personali di gruppi diversi.
- Anno attivo non univoco, offerta formativa non storicizzata.
- Practice/activity senza versione; vecchi dati insufficienti per attribuire gruppo o materiale con certezza.
- Slug vincolato all’istituto, recenti cross-workspace senza label, PDF testuali non supportati.
- Backup precedente privo del nuovo ciclo accademico e di tutte le relazioni necessarie.

Durante il collaudo sono stati corretti anche problemi non elencati nel prompt:

- RPC Practice costruita come PromiseLike senza avviarne realmente l’esecuzione.
- Link diretti dipendenti dalla prima pagina del catalogo e slug pubblicato modificato dalla bozza.
- Attività storica assente per chi aveva solo tentativi Assignment e nessuna apertura della lezione.
- Attribuzione delle risposte precedenti al gruppo dedotta dalla data, troppo ambigua dopo trasferimenti: quelle senza enrollment registrato restano manager-only.
- Indicatori di accesso effettivo dedotti da campi della bozza anziché dalla release: ora arrivano dal backend.
- Restore: ordine delle FK, chiavi JSON null, collisioni delle identità audit, scope del manifest e colonne sconosciute. Il dry run prova ora gli inserimenti reali e li annulla.
- Cambio workspace con risultati asincroni precedenti ancora visualizzabili: catalogo e resolver scartano risultati del vecchio contesto.

## 2. Modello e invarianti

| Invariante | Implementazione e verifica |
| --- | --- |
| A — identità globale multi-workspace | `profiles` globale; membership locali. Account presente in A e B nei test. |
| B — isolamento A/B | Scope workspace nelle RPC/RLS; uscita e rollover A conservano B e profilo globale. |
| C — identità persistente | Passaggio crea iscrizioni, non account. Scenario browser: 21 profili prima/dopo, inclusi owner e 20 member. |
| D — storico conservato | Iscrizioni chiuse più nuove; cancellazione batch conserva le destinazioni annullate; versioni precedenti conservate. |
| E — storico senza accesso corrente | Eligibility verifica iscrizione active, intervallo, anno/date, gruppo e membership correnti. |
| F — nuova bozza distinta dalla distribuzione | Release lega una versione immutabile; catalogo, titolo, slug e risorse member leggono la snapshot. |
| G — Assignment snapshot | Trigger impediscono modifica di domande/chiavi/rubriche dopo pubblicazione. |
| H — dati personali per incarico | `staff_subjects` authoring separato da `teaching_assignments` anno/materia/gruppo; RLS negativa reviewer 3A contro 4A. |
| I — archivio consultabile e non operativo | Guardie su anno e lock condivisi: niente nuovi tentativi, grant, iscrizioni o operazioni didattiche; lettura staff autorizzato. |
| J — permessi coerenti in UI/DB | Stato accessi calcolato dalla RPC sulla release effettiva; tutte le mutazioni sensibili server-side autorizzate. |

`academic_levels` contiene codici portabili e label configurabili; `track_levels` ne stabilisce l’ordine. Sono supportati codici non numerici. L’avanzamento usa quell’ordine, senza `current + 1`. TelecomContent v3 usa `levelCode` opzionale, senza UUID; i contenuti generali restano possibili. Migrazioni v1→v2→v3 e v2→v3 testate senza perdita di blocchi, warning o compiti. Le colonne numeriche legacy restano solo per compatibilità, senza vincoli 3/4.

`enrollments` distingue stato ed esito, date e provenienza. Indice parziale: massimo una iscrizione primaria active per account/istituto/anno. Il cambio gruppo chiude e crea, preservando entrambe le righe. Le date accademiche hanno granularità giorno; audit e creazione hanno timestamp. `subject_offerings` rende annuale l’offerta, senza riscrivere anni precedenti.

Per dettagli: [architettura](ARCHITECTURE-P32.md) e [sicurezza](../SECURITY.md).

## 3. Migrazione incrementale senza cancellazioni

Le quattro migration P2/P2.1/P3/P3.1 sono conservate. Sono aggiunte soltanto:

1. `202610010005_phase32_academic_lifecycle.sql`: livelli, iscrizioni, offerte, incarichi, passaggio anno, release, tracking, scope e backup v6.
2. `202610010006_phase32_activity_reports.sql`: report paginati e aggregati di attività/storico.
3. `202610010007_phase32_integrity_guards.sql`: guardie integrità/archivio, compatibilità, resolver, ricerca e accesso effettivo.

La preflight rifiuta più anni active o associazioni primarie ambigue **prima delle trasformazioni**. Non sceglie una riga e non cancella le alternative. Questi due rifiuti sono testati su database P3.1 popolati.

Il test upgrade prepara livelli legacy 3/4, gruppi, 20 member, contenuti/versioni, grant, compiti/chiavi, tentativi, review, activity e Practice. Dopo le nuove migration verifica conservazione delle righe originarie e nuovi riferimenti. Un secondo database vuoto è usato per recupero e dry run. Le fixture restano nei test: nessun contenuto demo inserito nel catalogo production.

Limite storico esplicito: P3.1 non registrava la data esatta di ingresso né la versione/gruppo di ogni attività. La migrazione dichiara la provenienza ricostruita dall’anno e conserva i dati precedenti come legacy non attribuiti. Le release iniziali usano la versione corrente all’upgrade e preservano grant di gruppo e individuali; non inventano quali versioni fossero distribuite anni prima. Tentativi legacy senza enrollment verificabile restano accessibili al manager, senza estendere gli incarichi dei reviewer.

Applicare 005→006→007 insieme all’aggiornamento frontend ed Edge in manutenzione, dopo backup amministrativo DB/Auth. Non rieseguire migration già applicate. La distribuzione remota non è stata eseguita.

## 4. Passaggio anno, percorso e account

La procedura in **Struttura → Passaggio anno** ha dieci fasi: sorgente, destinazione, struttura, gruppi, proposte, eccezioni, anteprima, conferma, applicazione, report. Bozze salvate riapribili, filtro account/gruppo, esiti individuali e mapping per persona consentono divisioni e fusioni. Esiti professionali: Avanza, Ripete il livello, Cambia gruppo, Cambia indirizzo, Completa il percorso, Trasferimento/uscita, In sospeso.

L’ultimo livello propone completamento; resta possibile ripetere. Pending o errori impediscono l’applicazione. RPC unica con revisione della bozza, snapshot della sorgente, lock di workspace/batch/anni/iscrizioni/gruppi, transazione e idempotenza. Un errore non produce iscrizioni parziali; una seconda applicazione restituisce il report senza duplicare. Audit registra attore, anni, batch, decisioni e data.

**La finalizzazione conclude subito gli accessi operativi della sorgente.** Preparare la bozza in anticipo e applicare al termine dell’anno. Iscrizioni future iniziano alla data destinazione e non concedono accesso anticipato. Attivazione chiede esplicitamente l’archiviazione del predecessore; indice parziale garantisce un solo anno active. Date fuori intervallo e sovrapposizioni sono rifiutate.

Rollback automatico solo prima di release, compiti operativi, tentativi, attività/Practice e cambi alle iscrizioni generate. È testato anche il rifiuto dopo una correzione della destinazione. Le righe annullate restano nella storia. In caso contrario serve correzione tracciata. Questa procedura non promette di annullare operazioni già utilizzate dagli utenti.

La UI Utenti/Percorso e Gruppi mostra iscrizioni attuali e concluse con anno, gruppo, date, esito e provenienza. Nuovi ingressi possono usare account nuovi o identità globali già collegate. Uscita locale termina A e conserva B, identità e storico. Disattivazione locale è distinta da reset/delete globale; account condivisi o con storico non sono eliminabili tramite la normale gestione. Nessun nuovo endpoint pubblico di promozione.

Il wizard rimanda alla duplicazione curriculum già presente nella Pianificazione: nuova bozza, progressi azzerati. Non vengono copiati automaticamente grant, release, attività, tentativi, risposte o review.

## 5. Distribuzioni, Assignment e attività

`content_releases` associa contenuto/versione, istituto, anno, gruppo, date e stato. Aggiornare esplicitamente la distribuzione crea una nuova release e conserva la precedente come superseded. UI con documento corrente, versione distribuita per gruppo, preview e conferma. Versioni di gruppi diversi possono differire.

Il member non legge direttamente le tabelle di bozza `content_items`, `content_resources`, `content_versions`. Catalogo, ricerca, resolver e risorse restituiscono soltanto dati autorizzati della versione distribuita. Il test cambia titolo e slug nella nuova bozza: entrambi restano quelli precedenti per il member finché la release non viene aggiornata.

Namespace slug/source ID: workspace + materia. Route qualificata `#/lesson/<subjectSlug>/<contentSlug>`; il vecchio link a slug singolo è accettato solo se autorizzato e non ambiguo. Resolver e ricerca non dipendono dalla prima pagina del catalogo.

Nuove aperture, tempo attivo stimato e Practice conservano release/versione. Apertura significativa aggregata con finestra di cinque minuti, heartbeat senza conteggi di render; tempi limitati anche lato server. Scritture sulla release sostituita vengono rifiutate, senza cancellare il progresso precedente. Practice resta distinto da Assignment. I tentativi Assignment nuovi registrano l’iscrizione effettiva, anche per target individuali; la correzione si basa su quel riferimento anziché su inferenze temporali.

Report per contenuto/account/gruppo paginati e aggregati server-side, con accesso attuale, non aperti, storico per versione, Practice, tentativi e feedback. Compare anche chi aveva solo risposte a compiti e ha perso l’accesso corrente. Le misure legacy non attribuibili sono segnalate. Nessun ranking.

## 6. PDF testuali, Prompt Builder e contesto

PDF.js 6.3.289, Apache 2.0, caricato su richiesta con worker locale incluso nella build. Flusso: file → estrazione locale → preview → selezione pagine/estratti → conferma → fonte curriculum. Nessun PDF trasmesso o OCR; il test controlla assenza di POST durante l’estrazione. Fonte salvata solo dopo conferma, con nome, pagine, testo originale ed estratto selezionato. Il metaprompt include l’estratto una volta, senza duplicare il testo di provenienza.

Limiti espliciti: 20 MB/file, 300 pagine, 2 milioni di caratteri estratti; fonte confermata 200.000 caratteri e 900 kB con provenienza. Scansioni mostrano esattamente “Il documento sembra essere composto prevalentemente da immagini/scansioni.” Inserimento manuale disponibile. Ordine di lettura ed estratti richiedono controllo umano; PDF cifrati/non leggibili degradano al testo manuale. Non vengono inventate citazioni. Dimensione caratteri/token visibile.

Aderente resta default e il materiale resta il contratto didattico. Conservati formule, indicazioni/limiti, Assistita/Approfondita, grafici e simulatori esistenti. Nessuna IA integrata o controllo semantico perfetto dichiarato.

Smart Context conserva workspace, anno, indirizzo, materia, gruppo. La RPC risolve al massimo otto recenti forniti, verifica autorizzazione e restituisce label anche cross-workspace. Ripristina il contesto della richiesta; preferenze locali non concedono diritti. Scope revocati producono fallback sicuro. Non scarica tutte le strutture degli altri istituti.

## 7. Sicurezza e integrità

RPC pubbliche come wrapper invoker, logica privilegiata in schema privato non esposto, `search_path = ''`, nomi qualificati, revoke PUBLIC/anon ed EXECUTE espliciti. Callback interne non invocabili dal member. Il test verifica assenza di SECURITY DEFINER pubblico, search_path privato e privilegi anon. Il modello segue le indicazioni ufficiali [Supabase functions](https://supabase.com/docs/guides/database/functions) e [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security); lock e transazioni seguono [PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html).

Le chiamate ostili reali a PostgreSQL verificano: chiavi private, dati personali altrui, contenuti/titoli/testo non autorizzati, enrollment e tracking altrui, scope operativo non assegnato; INSERT/UPDATE diretti e RPC amministrative come member. Dove RLS nasconde righe, zero righe aggiornate è considerato diniego; non serve un errore SQL per ogni UPDATE. Account disabled e must_change_password perdono accesso operativo. Reviewer 3A non legge 4A; la demozione revoca lo scope anche se resta un incarico.

Registrazione DB degli account bulk è una transazione service-only con attore esplicito e validazione. Creazione Auth è esterna alla transazione PostgreSQL: l’Edge tenta compensazione in caso di errore. **Non è ACID fra Auth e DB**: un’interruzione di rete può richiedere controllo e pulizia degli account Auth orfani. Nessuna password conservata nei dati applicativi.

Le verifiche PostgreSQL girano su PGlite, con ruoli, RLS, migration e RPC reali. Non sostituiscono la verifica di schemi esposti, proprietari, grant effettivi, Security Advisor, Auth e Edge nel progetto Supabase di destinazione.

## 8. Backup v6 e privacy

Manifest versionato con struttura e storico locali, livelli/ordine, anni, offerte, iscrizioni/batch, incarichi/scope, release/documenti/versioni, curriculum, libreria del proprietario, grant, compiti/risposte/correzioni, attività e audit. Nessuna password o service secret.

Export ordinato/paginato in blocchi di 500, massimo 5.500 righe per tabella: oltre il limite si ferma senza file parziale. Import browser massimo 20 MB, server massimo 50 MB. Richiede manutenzione senza scritture concorrenti: un export applicativo a pagine non garantisce la snapshot consistente di un dump PostgreSQL.

Restore per **stesso UUID workspace**, destinazione vuota o bootstrap; identità globali e membership/ruoli necessari già predisposti. Non sovrascrive identità o ruoli. Non è un clone fra istituti né disaster recovery completo Auth. Libreria personale ripristinabile solo dal proprietario. Sezioni/colonne sconosciute, riferimenti incompatibili e scope esterni vengono rifiutati. Dry run esegue gli stessi inserimenti in sotto-transazione e li annulla; applicazione tutto o niente. Audit riceve nuove identità mantenendo ID sorgente nei dettagli.

Il test recupera contenuti/versioni/release, curriculum/libreria, compiti/chiavi JSON null, tentativi/storico/audit su un secondo database, con 23 identità globali preesistenti conservate. Testa dry run senza residue modifiche e rollback integrale per colonna invalida. Backup v3/v4/v5: recupero prima in P3.1 e conversione, rifiuto esplicito in P3.2.

Pagina Privacy aggiornata: aperture, conteggi, tempo attivo stimato, Practice, tentativi, risposte e feedback. Nessun tasto, traiettoria mouse, sito esterno, fingerprint, advertising. Cancellazione attività locale e auditata. Anonimizzazione completa, retention configurabile e suite legale non implementate: FK, autori, reviewer, provenance e audit richiedono una procedura deliberata futura. Non usare la cancellazione dell’identità come normale passaggio anno.

## 9. Performance, design e costo

Catalogo 100/pagina; ricerca 50 con debounce; account, percorso e report attività 50; review/esiti UI 25; recenti massimo 8. Metadati di struttura solo del contesto scelto, con limite 500 gruppi adatto all’obiettivo di 100. Nessun polling o query HTTP per persona durante applicazione/analytics. Caricamento per tab e indici per contesto, iscrizioni, release, offering e unicità. L’export è limitato. Il comportamento con 1.000 account non è stato benchmarkato.

Build finale: PDF lazy chunk circa 431 kB / 129 kB gzip; worker locale circa 1,27 MB, non caricato come parte della home. Bundle principale circa 298 kB / 94 kB gzip. Nessuna promessa di latenza cloud misurata.

Responsive verificato a **320, 375, 768, 1024, 1440 px**, tema, navigazione, riduzione movimento, PDF, wizard e superfici esistenti. Brand SVG, font Manrope, stile e footer conservati. Screenshot di controllo disponibili nella consegna. Questi controlli non costituiscono un audit WCAG completo.

GitHub/Supabase esclusivamente Free; nessun componente acquista quote o effettua upgrade. Limiti applicativi e indisponibilità provider fermano l’operazione con errore comprensibile. Quote correnti da controllare alla messa in servizio. Il costo zero dipende dall’uso dei piani Free; nessun piano a pagamento è stato attivato.

## 10. Gate eseguiti e scenario richiesto

| Gate finale | Esito effettivo |
| --- | --- |
| `npm ci` | Passato; audit dipendenze: 0 vulnerabilità segnalate. |
| `npm run typecheck` | Passato, exit 0. |
| `npm run lint` | Exit 0; **13 warning, 0 errori**. Warning React/Fast Refresh non soppressi, stesso numero della base. |
| `npm test` | **37/37 test, 14/14 file**, inclusi PostgreSQL/RLS e recupero; circa 17 s. |
| `npm run build` | Passato; Vite 8.3.1, 2.080+ moduli, licenza PDF.js inclusa anche in dist. |
| `npm run test:e2e` | **9 passati, 1 saltato**, circa 43 s. |

Scenario browser con PostgreSQL/RLS reale e sessione UI di test, non Auth live: manager prepara 20 member; **14 avanzano, 2 ripetono, 1 cambia gruppo, 1 cambia indirizzo, 1 completa, 1 esce**. Risultato: 20 iscrizioni sorgenti concluse, 18 destinazioni, identità invariate, storico e release v1 conservati anche dopo salvataggio bozza v2. Test integra preview, conferma, report e controlli responsive.

Ulteriori verifiche DB: avanzamento 4→5 per ordine configurato, ultimo livello/completamento, trasferimento in anno, ripetizione, nessuna nuova iscrizione per uscita/completamento, pending/errore senza parziali, idempotenza, cancellazione sicura e bloccata, anno futuro/archiviato, isolamento B, scope reviewer, snapshot Assignment/release, accessi negati, backup dry run/restore, preflight migration.

Gli E2E conservano anche flussi curriculum, contesto cross-workspace, libreria personale, superfici editor/reviewer, brand e shell senza backend. Il test PDF usa estrazione reale nel browser. Il test live manager→account→release→Practice→Assignment→review→chiamate ostili è predisposto e aggiornato, ma **saltato** perché manca Supabase locale configurato.

## 11. Non completato o non verificato in questo ambiente

- Nessuna CLI Supabase, Docker, Deno o credenziale backend disponibile: Auth/Edge reali non collaudati né typecheck Deno eseguito.
- Nessun deploy Supabase/GitHub Pages, push, commit o PR: cartella consegnata senza remote Git.
- Nessun stress test multi-connessione di lock/archiviazione né benchmark con 1.000 account. I test verificano transazioni/guardie/idempotenza, non ogni interleaving concorrente di un server remoto.
- Security Advisor, schema Data API effettivo, ownership e grant sul progetto destinatario da verificare prima dell’uso reale.
- Backup applicativo non recupera Auth né crea global identities/membership/ruoli e non copia storico arbitrariamente fra workspace.
- Dati P3.1 privi di provenienza esatta restano esplicitamente non attribuiti; questa informazione non può essere ricostruita dal software.
- Nessun OCR, semantic validator IA, retention/anonimizzazione completa, audit legale o WCAG certificato.
- Restano 13 warning lint dichiarati. Non sono nascosti né presentati come lint privo di avvisi.

Il prossimo collaudo concreto è l’E2E Auth/Edge su Supabase locale, seguendo il [README](../README.md), prima dell’applicazione remota delle migration. Le modifiche implementate e i risultati locali sono consegnati senza dichiarare eseguito quel passaggio.

Progettata da Francesco Di Martino · 4ITC1 · A.S. 2026/2027
