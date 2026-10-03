# Telecom/lab — P3.2 · Academic Lifecycle, Historical Integrity & Release Architecture

Evoluzione del progetto P3.1 esistente: React/TypeScript, Supabase Auth/PostgreSQL/RLS, GitHub Pages e Actions. Identità persistenti, iscrizioni storiche, livelli configurabili e lezioni distribuite per versione. Design, funzioni didattiche e brand esistenti conservati. **Costo operativo obbligatorio: 0,00 €**, usando esclusivamente i piani Free e strumenti open source. Nessuna API IA, OCR cloud o upgrade automatico.

## Avvio e verifica

Node.js 24. Le fixture sono esclusivamente in `tests/`; prima installazione: **zero contenuti demo**.

```bash
npm ci
cp .env.example .env.local
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

In `.env.local` inserisci soltanto `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. La chiave service role resta nell’ambiente Edge, mai nel frontend. La build statica è `dist/`; routing a hash compatibile con Pages. Senza backend compare la configurazione.

Documentazione corrente: [architettura](docs/ARCHITECTURE-P32.md), [sicurezza](SECURITY.md), [audit](docs/P32-AUDIT.md), [report e limiti](docs/P32-RELEASE.md). I report precedenti descrivono le versioni storiche.

Prima installazione production: [procedura e gate](docs/PRODUCTION.md). Regole permanenti: [PRODUCTION DATA SAFETY](AGENTS.md). `npm run check` verifica la base locale; `npm run check:production` verifica le variables pubbliche senza stamparle; `npm run migration:dry-run` esegue solo la preview delle migration collegate, senza seed o aggiornamenti Vault. GitHub Actions distribuisce il frontend e non applica migration al database.

## Migrazione P3.1 → P3.2

Applicare **solo le nuove migration 005, 006, 007**, in ordine, nella stessa finestra di manutenzione dell’aggiornamento frontend/Edge. Le quattro migration precedenti restano immutate. Fare prima un backup amministrativo del database e delle identità Auth. La migration non elimina contenuti, versioni, tentativi, risposte, review, attività, Practice, curriculum, libreria o associazioni precedenti.

I livelli numerici osservati diventano codici portabili; i gruppi ricevono `level_id`. Le vecchie colonne numeriche restano solo per compatibilità, senza vincoli 3/4. `group_memberships` è conservata come riferimento della migrazione, non concede nuovi accessi. Iscrizioni ricostruite da P3.1 indicano espressamente che la data di ingresso esatta non era registrata. Activity/Practice precedenti restano senza attribuzione inventata a versione/gruppo; tentativi senza iscrizione registrata sono correggibili dal manager, senza ampliare lo scope dei reviewer.

La preflight blocca più anni attivi o associazioni primarie ambigue nello stesso anno. Risolvere queste anomalie con una decisione amministrativa prima dell’upgrade: nessuna riga viene scelta o cancellata silenziosamente. Le release iniziali preservano i grant pubblicati di gruppo e individuali, usando la versione corrente al momento dell’upgrade. Non ricostruiscono versioni distribuite in passato che P3.1 non registrava.

## Struttura, iscrizioni e passaggio anno

**Struttura** configura anni, indirizzi, livelli e ordine `track_levels`, offerte annuali delle materie. Codici come `base`, `intermedio`, `avanzato` funzionano senza cambiare il codice. Il livello successivo deriva dall’ordine, non da una somma.

Un account può appartenere a più istituti. **Utenti → Percorso** e **Gruppi → Iscrizioni attuali e concluse** mostrano date, stato, esito e provenienza. Cambiare gruppo chiude l’iscrizione precedente e ne crea una nuova. La membership non viene ricreata ogni anno. Per collegare una identità esistente usare **Staff → Collega account esistente**; l’account parte come member e può essere iscritto a un gruppo dell’anno prossimo.

**Struttura → Passaggio anno** segue dieci fasi: sorgente, destinazione, struttura, mappatura, proposte, eccezioni, anteprima, conferma, applicazione, report. Bozze salvate riapribili; ricerca account/gruppo; destinazioni individuali per divisioni e fusioni. Esiti: Avanza, Ripete il livello, Cambia gruppo, Cambia indirizzo, Completa il percorso, Trasferimento/uscita, In sospeso. L’ultimo livello propone completamento, con possibilità di ripetere. Un esito in sospeso o un errore blocca la finalizzazione.

L’applicazione è una RPC transazionale con lock, revisione e idempotenza. **Conclude subito gli accessi operativi della sorgente**: preparare in anticipo, applicare al termine dell’anno. Le nuove iscrizioni iniziano alla data dell’anno destinazione; completamento/uscita non creano iscrizioni future. Nuovi gruppi senza grant o release automatici. Nella Pianificazione è disponibile **Duplica per anno scolastico**: nuova bozza con progressi e materiale trattato azzerati.

L’attivazione del nuovo anno chiede esplicitamente di archiviare quello attivo. Il database garantisce massimo un anno attivo; controlla intervalli, sovrapposizioni e date delle iscrizioni. Archiviato significa consultabile dallo staff autorizzato, senza nuove submission, tentativi, modifiche iscrizioni, grant o distribuzioni.

L’annullamento automatico è consentito solo prima dell’uso operativo della destinazione e se le iscrizioni prodotte dal batch non sono state cambiate. Le iscrizioni annullate restano nella storia. Dopo pubblicazioni, compiti operativi, attività, Practice, tentativi o correzioni alle iscrizioni serve una variazione amministrativa tracciata. Le iscrizioni future di un anno prossimo possono essere corrette alla loro data iniziale; quelle correnti con la data effettiva del trasferimento.

## Ruoli e dati personali

| Ruolo | Scope |
| --- | --- |
| Owner | Amministrazione dell’istituto, ruoli, incarichi, export/restore |
| Manager | Struttura, iscrizioni, member, contenuti, grant, distribuzioni, attività e correzioni |
| Editor | Authoring delle materie assegnate; distribuzione ai gruppi con incarico operativo |
| Reviewer | Risposte aperte e rubriche dei soli incarichi anno + materia + gruppo |
| Member | Release e compiti autorizzati, Practice e propri progressi |

**Può creare contenuti** (`staff_subjects`) è separato da **Può vedere dati dei gruppi** (`teaching_assignments`). Uno scope materia non permette di leggere tutte le risposte di quella materia. Nessun incarico personale viene dedotto automaticamente durante la migrazione. Anche la demozione di un ruolo revoca lo scope operativo.

**Disattiva** riguarda la membership locale; **Concludi appartenenza locale** termina le iscrizioni locali e conserva identità/storico. Reset o eliminazione globale di account condivisi sono bloccati. L’eliminazione fisica è bloccata in presenza di dati storici o personali; occorre una procedura di retention autorizzata. Non esiste un endpoint pubblico per diventare manager.

## TelecomContent v3 e distribuzioni

`schemaVersion:3`, `subject` portabile, `levelCode` opzionale. Il documento non contiene UUID dei livelli. v1 → v2 → v3 e v2 → v3 conservano blocchi, difficoltà, compiti, chiavi e generationWarnings. I contenuti generali non richiedono livello. L’unicità è istituto + materia + slug/source ID.

Prompt Builder: **Materiale trattato → Formule → Indicazioni/limiti**. Aderente resta default; la conoscenza del chatbot esterno non prevale sulla fonte. Sono conservati grafici, Simulation Registry, Practice, esercizi guidati/parametrici e Assignment. Non vengono introdotte nuove API o nuovi simulatori.

Flusso: istruzioni → chatbot esterno → JSON → valida → anteprima → salva bozza. Slug/ID già presenti richiedono una nuova versione esplicita. Salvataggio atomico; cronologia paginata e ripristino come nuova versione. Warning strutturali/generationWarnings restano visibili; non si promette un controllo semantico perfetto.

**Pubblicazioni per gruppo** mostra documento corrente e versioni distribuite. Scegliere gruppo, versione, date, anteprima e conferma esplicita. Una bozza v4 non modifica la release v3: titolo, testo, slug e risorse dei member provengono dalla snapshot pubblicata. La route è `#/lesson/<subjectSlug>/<contentSlug>`; vecchi link con il solo slug sono risolti solo se autorizzati e non ambigui. Link diretti e ricerca funzionano oltre la prima pagina del catalogo.

Gli accessi effettivi sono calcolati dal backend su iscrizione temporalmente valida, anno, offerta, release, date, materia e grant. Il campo di stato del documento non distribuisce una lezione. Archiviare il documento impedisce la fruizione delle sue release; i documenti storici restano allo staff.

Practice e tempo attivo nuovi sono associati alla release. Se una release viene sostituita durante una visita, nuove scritture della release precedente vengono rifiutate: riaprire la lezione aggiornata. Il progresso precedente resta nello storico. Assignment conserva domande/chiavi/rubriche proprie e immutabili dopo pubblicazione. Correzione, scadenze, tentativi massimi e rilascio soluzioni mantengono il modello precedente.

## PDF, fonti e Smart Context

**Pianificazione → Fonti → PDF testuale** estrae testo con PDF.js e worker locali: nessun PDF inviato a un server, nessun OCR. Preview, selezione pagine, estratti modificabili, stima caratteri/token e conferma prima del salvataggio. Provenienza: nome file, numeri pagina, testo e selezione. PDF basati su immagini mostrano: “Il documento sembra essere composto prevalentemente da immagini/scansioni.” È disponibile il testo manuale.

Limiti locali: 20 MB, 300 pagine, 2 milioni di caratteri estratti; fonte confermata fino a 200.000 caratteri e 900 kB inclusa la provenienza. PDF cifrati/non leggibili richiedono testo manuale o una versione leggibile. La qualità dell’ordine di lettura dipende dal PDF: controllare sempre gli estratti. Il metaprompt contiene gli estratti una volta; il testo originale di provenienza non è duplicato nel prompt. Citazioni e qualifiche normative restano da verificare dall’autore.

Il contesto conserva istituto, anno, indirizzo, materia, gruppo. Recenti risolti mediante una RPC sui soli ID forniti (massimo otto), con verifica delle membership/scope; nessun download di tutte le strutture degli altri istituti. Le preferenze locali non sono permessi. Contesti revocati producono fallback sicuro.

## Attività, backup e privacy

Activity per contenuto/account è paginata; gruppi con aggregati e storico per versione. Compaiono anche account autorizzati che non hanno aperto. **Tempo attivo stimato**, mai tempo studiato esatto. Apertura significativa: almeno cinque minuti dalla precedente; heartbeat aggregati, visibilità e attività recente. Nessuna traiettoria mouse, tasti digitati, fingerprint, pubblicità, tracking esterno o ranking.

**Backup v6** include livelli, indirizzi, anni, offerte, iscrizioni, passaggi, incarichi e scope locali, release, documenti/versioni, curriculum, libreria personale del proprietario, grant, compiti, risposte, attività e audit. Non include password o segreti Auth. Export paginato/ordinato: si interrompe oltre 5.500 righe per tabella senza file parziale. Effettuare l’export durante manutenzione senza scritture concorrenti: il JSON applicativo non sostituisce un dump PostgreSQL consistente.

Restore per **recupero dello stesso ID istituto** in destinazione vuota o con sola configurazione iniziale. Account globali e membership/ruoli necessari devono già esistere; nessuna identità o ruolo è creato/sovrascritto. Libreria personale importabile solo dal proprietario. Dry run esegue gli inserimenti reali in una sotto-transazione e li annulla; conferma applica tutto o niente. Identificatori duplicati, colonne sconosciute, riferimenti incompatibili e dati di altri istituti sono rifiutati. Le identità degli eventi audit vengono riallocate, conservando l’ID sorgente nei dettagli. Backup v3/v4/v5: ripristinare prima in P3.1 e convertire, non importarli direttamente in P3.2. La copia verso un altro istituto usa TelecomContent o i workflow di copia, non il backup storico.

La pagina Privacy spiega gli eventi. Cancellazione delle attività è locale e tracciata; anonimizzazione completa/retention automatica non implementate. Vedere SECURITY per FK, provenienza e limiti di recupero.

## Setup Supabase Free

1. Crea manualmente un progetto nel **piano Free**, senza upgrade. Verifica le quote correnti prima dell'uso. Copia URL e chiave **publishable/anon** nelle variabili locali e nelle GitHub Actions **Variables** `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Non usare GitHub Secrets per nascondere questi valori pubblici; la chiave privilegiata resta solo nell'ambiente Supabase.
2. In Authentication → Providers → Email, **disabilita la registrazione pubblica**. L'app non mostra un pulsante Registrati. Configura una policy password adatta al contesto. Il login utente è username/password; Auth usa internamente `username@accounts.telecomlab.invalid`, senza richiedere email reali. Non usare recupero via email: il manager esegue il reset.
3. Applica nell'ordine `supabase/migrations/202609300001_phase2.sql`, `supabase/migrations/202609300002_phase21_hardening.sql`, `supabase/migrations/202610010003_phase3_workspace.sql` `supabase/migrations/202610010004_phase31_context_curriculum.sql` e le tre nuove migration P3.2 `202610010005_phase32_academic_lifecycle.sql`, `202610010006_phase32_activity_reports.sql`, `202610010007_phase32_integrity_guards.sql` con il SQL Editor, oppure usa gratuitamente la CLI Supabase e `supabase db push`. Non aggiungere `app_private` agli schemi esposti della Data API. Verifica grant, RLS, Security Advisor e funzioni dopo la migrazione. Su una installazione esistente, applica solo le migrazioni non ancora eseguite, nell’ordine indicato. La P3 attribuisce i dati preesistenti al workspace Telecom/lab e alla materia Telecomunicazioni, promuovendo il manager più anziano a owner. Fai un backup prima della migrazione. La P3.1 migra ruolo e istituto in membership e rimuove le vecchie colonne del profilo: aggiorna frontend ed Edge Functions nella stessa finestra di manutenzione. Non rieseguire migrazioni già applicate.
4. Distribuisci `admin-accounts` e `change-password` con `supabase functions deploy admin-accounts` e `supabase functions deploy change-password`. Il codice verifica esplicitamente il bearer token tramite Auth. Configura il segreto `ALLOWED_ORIGINS` con le origini esatte consentite, separate da virgole, ad esempio l'origine Pages e `http://localhost:5173`. Supabase inietta `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS` nell'ambiente funzione (con fallback ai nomi legacy); non copiarli nel frontend.
5. Crea il **primo owner** una sola volta in Authentication → Users → Add user, con identificatore interno `admin@accounts.telecomlab.invalid` e una password temporanea. Nel SQL Editor esegui `supabase/bootstrap-first-manager.sql` dopo aver controllato i quattro valori in testa al file. Lo script trova l'UUID Auth da solo, rifiuta il bootstrap se esiste già un owner o manager e verifica la corrispondenza fra username e identificatore interno. Non esiste un endpoint pubblico di promozione.

6. Accedi come `admin`, cambia password al primo accesso, configura livelli e ordine dell’indirizzo, poi crea gruppi e account dall'Area gestione. La funzione genera password casuali di 24 caratteri con `crypto.getRandomValues`, le mostra una volta e impone il cambio. Esporta immediatamente il CSV iniziale; non viene conservato in chiaro. Per omonimi aggiunge suffissi numerici.
7. Importa contenuti, seleziona la materia e crea i grant del **modulo**, della **lezione** e delle **risorse** per ciascun gruppo, configura l’offerta annuale e distribuisci una versione mediante **Pubblicazioni per gruppo**. Le date della distribuzione appartengono alla release; il campo di stato del documento non crea una distribuzione. Un livello 3 non abilita automaticamente tutto l'Anno 3. Owner e manager vedono i contenuti del proprio workspace; gli editor solo delle materie assegnate; i member solo ciò che passa le policy. Prepara i compiti dal documento importato, assegna il gruppo e pubblica.


## GitHub Pages e limiti Free

Repository GitHub pubblico, Settings → Pages → GitHub Actions. Il workflow esegue i quality gate e Playwright prima della build/deploy. Le due variabili frontend sono pubbliche; nessun segreto nel bundle. Il font Manrope locale (SIL OFL), il kit brand con nove SVG, tema, accessibilità e reduced motion sono conservati.

Il software non chiama servizi a pagamento, non acquista quote e non modifica piani. Configurare esclusivamente GitHub/Supabase Free. Quota esaurita o provider sospeso: messaggio di indisponibilità, operazione fermata. Verificare le quote correnti del provider prima dell’installazione; nessun upgrade automatico. Nessun deploy remoto è stato eseguito in questa lavorazione.

## E2E live locale

I test UI con fixture e il wizard con PostgreSQL PGlite girano senza account cloud. Auth e Edge Functions richiedono Supabase locale; il test live rifiuta URL di produzione ed è saltato quando manca la configurazione. Applicare tutte e sette le migration, distribuire le due Edge Functions, bootstrap owner e cambio password iniziale, poi:

```text
E2E_SUPABASE_URL=http://127.0.0.1:54321
E2E_SUPABASE_PUBLISHABLE_KEY=<chiave locale>
E2E_MANAGER_USERNAME=admin
E2E_MANAGER_PASSWORD=<password di test>
E2E_WORKSPACE_ID=10000000-0000-4000-8000-000000000001
```

`npx playwright install chromium`, quindi `npm run test:e2e`. Il test live prepara livello/offerta, crea gruppo e due account, importa/distribuisce una release, esegue Practice e compito, salva feedback e prova chiamate backend ostili. Non dichiararlo verificato prima di eseguirlo con Auth/Edge reali.

## Troubleshooting

- Lezione assente: verificare iscrizione attuale, anno/date, offerta annuale, release pubblicata, grant di modulo/lezione/risorse e materia non archiviata.
- Livello non configurato: creare il codice in Struttura e inserirlo nell’ordine dell’indirizzo, oppure correggere il documento.
- Passaggio bloccato: correggere anteprima; se altre persone hanno cambiato la sorgente, rigenerare la bozza. Non forzare aggiornamenti SQL di storico.
- Restore respinto: controllare ID istituto, destinazione vuota, account/ruoli già collegati, formato v6 e riferimenti. Nessun ripristino parziale viene applicato.
- Formula/grafico: JSON valido, backslash LaTeX corretti, grammatica aritmetica limitata, registry simulatori esistente. Il contenuto non esegue JavaScript arbitrario.
- Servizio indisponibile: controllare configurazione/quote Free e log; nessun upgrade automatico.

Progettata da Francesco Di Martino · 4ITC1 · A.S. 2026/2027
