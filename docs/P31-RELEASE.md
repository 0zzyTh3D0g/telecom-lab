# P3.1 — Multi-Institution, Smart Context & Curriculum Planning

## Audit iniziale

La base P3 è stata conservata: React/TypeScript, renderer TelecomContent, v1 migration, grafici, registry simulatori, Auth, Practice, Assignment, review, tracking, versionamento, design system, motion, brand e GitHub Pages/Actions.

I problemi effettivi individuati erano:

- Ruolo e istituto appartenevano a `profiles`: una persona non poteva operare in istituti diversi con ruoli differenti.
- Diverse RPC confrontavano direttamente il workspace del profilo. Cambiare solo React avrebbe lasciato privilegi e relazioni errati nel database.
- Letture personali di tentativi, review e attività non richiedevano sempre il contesto dell’istituto; le analytics di gruppo e la cancellazione attività potevano attraversare istituti nel nuovo modello.
- Il cambio ruolo eliminava tutti gli ambiti della persona; il cambio gruppo tutte le membership dei gruppi. Sarebbero state regressioni con più istituti/anni.
- Slug e ID sorgente erano univoci globalmente, impedendo copie indipendenti negli istituti.
- Reset, disattivazione e cancellazione di identità globali richiedevano una revisione per evitare effetti sugli altri istituti.
- Mancavano anno scolastico, indirizzo configurabile, libreria personale, fonti curriculum, piano/versioni, timeline e preparazione distinta dal contenuto pubblicabile.
- L’audit deduceva l’istituto dal profilo: attribuzione insufficiente per membership multiple e operazioni service role.

Package, schema, migrazioni, helper/RPC/RLS, Edge Functions, App, gestione, importatore, Prompt Builder, compiti, tracking, renderer, registry, test, README e pipeline sono stati esaminati. Sono stati consultati i riferimenti primari Supabase su [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [funzioni](https://supabase.com/docs/guides/database/functions) e [sicurezza della Data API](https://supabase.com/docs/guides/api/securing-your-api).

## Architettura

Identità globale in `profiles`; ruolo e stato per istituto in `workspace_memberships`. La migration trasferisce i valori P3 nella prima membership e rimuove le colonne globali di ruolo/istituto. Il tipo frontend Profile rappresenta la membership attiva insieme all’identità.

`workspace = istituto/organizzazione`. RLS e trigger verificano relazioni e accessi attraverso la membership richiesta dall’header `x-workspace-id`. Un header non autorizzato o mancante non concede accesso. Le RPC pubbliche restano invoker, i privilegi sono nello schema privato non esposto. Vedi [architettura completa](ARCHITECTURE-P31.md).

## Smart Context

Switcher istituto in alto, barra separata anno/materia/gruppo, contesti recenti, preferenze locali per account e palette Ctrl/Cmd+K. Nessun logout per il cambio. La palette rispetta gli editor e usa dialog, focus ed Escape nativi. Le preferenze non sono autorizzazioni; contesti revocati/archiviati vengono esclusi e materie/gruppi non disponibili scartati.

Le query caricano esclusivamente il contesto attivo, ignorano risposte obsolete e rimontano le pagine alla selezione. La ricerca usa il client con RLS dello stesso contesto. Gli heartbeat in uscita conservano il workspace della lezione precedente. Non vengono caricati contemporaneamente dati di tutti gli istituti.

## Academic Years / Tracks

Anni con date, etichetta e stati upcoming/active/archived; indirizzi configurabili con associazioni alle materie. Area gestione → Struttura consente creazione/modifica e archiviazione degli anni, creazione/modifica degli indirizzi e creazione di un istituto vuoto da owner.

I gruppi hanno istituto, anno e indirizzo obbligatori. I compiti derivano l’anno dal gruppo. Archiviare preserva righe e storico; blocca nuove operazioni sui gruppi storici e le modifiche ai piani. Gli analytics includono le visite storiche. Nuovi gruppi e copie di piani non duplicano persone o attività.

I gruppi preesistenti vengono attribuiti a 2026/2027 e “Da configurare”; i metadati possono essere aggiornati da Struttura. Il contesto storico del gruppo non viene spostato direttamente. I grant individuali dei contenuti restano separati dall’anno scolastico e vanno revocati esplicitamente se non devono continuare.

## Personal Library

Libreria privata per proprietario, con snapshot di contenuti e template. La copia di una lezione in un istituto è atomica, crea documento indipendente, nuovo identificatore, bozza/versione 1 e conserva la provenienza. La stessa lezione è stata forkata in due istituti nel test PostgreSQL: modificare lo snapshot non ha cambiato nessuna copia. Gli altri template si riutilizzano via JSON. Non si copiano account, tentativi, review o attività.

## Curriculum Planner

Fonti con ente/provenienza/data/versione/testo/metadata; piani personali o contestuali CurriculumPlan v1. Il workflow è fonte → metaprompt esterno → JSON → validazione → anteprima → modifica → salvataggio → approvazione. Nessuna chiamata a un LLM.

Estratti letterali, interpretazioni e proposte organizzative sono separati. Il tipo official della fonte è dichiarato, non certificato. Gli import entrano come proposed; owner/manager approvano, editor delle materie assegnate modificano, reviewer delle materie assegnate leggono. Member non accede al planner interno.

Timeline mensile con durata, movimento e riordino da tastiera, esclusione, note, obiettivi, attività e progressi effettivi. Ore nominali/pianificabili sono stime; periodi esclusi sovrapposti conteggiati una volta; le ore esplicite per verifiche prevalgono sulla percentuale. Cronologia con autore/data/documenti, versione attesa per evitare sovrascritture concorrenti e ripristino come nuova versione. Modifiche a piani approvati richiedono nuova approvazione. La duplicazione per nuovo anno crea un piano indipendente con progresso e materiale effettivo azzerati.

## Prepare Topic

Metaprompt separato per preparazione personale: contesto, modulo, fonti, familiarità, conoscenze disponibili e limiti. Richiede prerequisiti, spiegazione rigorosa, errori frequenti, esercizi personali e punti da verificare. Non produce automaticamente materiale pubblicabile.

Da un argomento si apre il Prompt Builder con materia, livello, modulo, argomento, fonte e obiettivi mostrati come suggerimenti. Il campo “Materiale trattato” resta vuoto; l’utente deve dichiarare il materiale reale. Aderente resta il default.

## Sicurezza

Test reali su PostgreSQL/PGlite, con ruolo authenticated e identità JWT simulata nel database, verificano:

- Account con due membership e ruoli differenti; account solo A respinto in B; header assente/ostile, membership disabilitata e istituto archiviato.
- Tabelle dell’istituto, gruppi, scope staff, contenuti, compiti, tentativi, review, attività e analytics limitati al contesto.
- Tentativi e review popolati in entrambi gli istituti: leggibili soltanto nel contesto corretto; soluzione/chiavi private non leggibili dal member.
- INSERT diretto attempts/activity e UPDATE ostili content/reviews respinti oppure zero righe autorizzate.
- Delete attività in A conserva tentativi e attività in B; cambio gruppo conserva la membership dell’altro istituto.
- Libreria, fonti, piani e versioni personali visibili solo al proprietario.
- Fonti di contesto diverso, editor non autorizzato alla materia, reviewer in scrittura, approvazione editor e modifica dell’anno archiviato respinti.
- Ripristino aggiunge versioni; conflitto di versione respinto; restore backup fallito dopo scritture iniziali lascia zero righe parziali.
- Ultimo owner protetto; anon senza EXECUTE; nessuna SECURITY DEFINER nello schema public.

Le Edge Functions verificano JWT e membership; disattivazione per istituto, reset/cancellazione globale bloccati per identità con più membership. La procedura del primo owner è ancora solo SQL amministrativo, aggiornata al nuovo modello.

## Migration

Nuovo file: `supabase/migrations/202610010004_phase31_context_curriculum.sql`. Nessuna modifica alle tre migrazioni già applicabili P2/P2.1/P3. Sono aggiornati bootstrap e due Edge Functions.

Per aggiornare P3: fare backup, applicare soltanto la nuova migration e aggiornare Edge Functions/frontend nella stessa finestra controllata. Su un’installazione nuova eseguire tutte e quattro nell’ordine, poi il bootstrap. Non esporre `app_private`. Verificare Security Advisor e configurazione Data API nell’istanza effettiva. Il backup UI v5 include anche struttura scolastica/curriculum; il restore UI rimane configurazione/contenuti, senza ripristino automatico di identità, compiti, curriculum o attività. Conflitti e struttura incompatibile vengono rifiutati.

## Test — risultati realmente eseguiti

| Controllo | Risultato |
|---|---|
| npm ci | Passato; 65 pacchetti installati, audit senza vulnerabilità segnalate |
| npm run typecheck | Passato |
| npm run lint | Passato, 0 errori; 13 warning React/Fast Refresh/effect |
| npm test | 34 test passati in 12 file |
| PostgreSQL/RLS | Incluse suite P2.1, P3 e P3.1, applicazione delle migrazioni e chiamate ostili |
| Playwright | 7 passati, 1 live saltato per assenza di Supabase locale/credenziali |
| Responsive | 320, 375, 768, 1024, 1440 px; schermate P3, gestione/Struttura, planner e libreria; dialog switch anche mobile |
| npm run build | Passato; bundle statico con planner/libreria caricati in modo lazy |

Gli E2E UI usano un backend simulato e verificano navigazione, cambio ruolo, preferenze, link negato, fonte/import, timeline, versioni, approvazione, duplicazione, preparazione, passaggio al contratto di pubblicazione, libreria e regressioni P3. I test database verificano SQL/RLS veri, senza service-role bypass. Nessun test UI mock viene presentato come test Supabase Auth/Edge Functions reale.

## Costi

**Costo operativo previsto e obbligatorio: 0,00 €.** Nessun servizio a pagamento, API IA, analytics commerciale, email/SMS o server aggiunto. Dipendenze e tooling sono open source/gratuiti. GitHub Pages/Actions e Supabase devono rimanere nei piani gratuiti; nessun upgrade automatico viene eseguito. Quote o indisponibilità producono degradazione/errore comprensibile. Il costo effettivo dell’account del provider va mantenuto Free dall’amministratore: il codice non gestisce acquisti o upgrade.

## Limiti effettivi

- Migrazione, Auth e Edge Functions non sono state distribuite o collaudate in una reale istanza Supabase; il test live resta esplicitamente saltato. Nessun repository Git/remote o progetto Supabase era disponibile.
- PGlite esegue PostgreSQL reale ma non sostituisce PostgREST, Auth, CORS, Deno o il Security Advisor dell’istanza Supabase.
- Le fonti PDF non vengono estratte. Sono disponibili testo incollato e file UTF-8; niente OCR o certificazione della provenienza.
- Il validatore non verifica semanticamente il programma didattico o la validità normativa; warning e approvazione restano responsabilità della persona.
- Timeline per mesi/periodi e riordino accessibile, senza drag-and-drop o diff grafico. Le ore sono stime.
- I template diversi da lezioni e curriculum si riusano via JSON. Nessuna pubblicazione, assegnazione o propagazione automatica.
- Il backup UI è limitato/paginato e il restore è configurazione-only. Per ricostruire integralmente storico, curriculum e identità serve un backup amministrativo del database; i cohort/grant archiviati possono essere respinti dal restore operativo.
- Reset e cancellazione di identità condivise richiedono un operatore globale fidato. Vincoli su proprietà/autori possono impedire la cancellazione di identità che possiedono piani/fonti: il sistema non elimina automaticamente lo storico per aggirarli.
- La palette non precarica materie/gruppi di tutti gli istituti; i dettagli recenti sono risolti nel solo contesto caricato. La ricerca trasversale a tutti gli istituti non è implementata.
- Non sono stati eseguiti test su browser/dispositivi fisici, prove di carico, deploy GitHub Pages remoto o test di concorrenza su più connessioni PostgreSQL. I 13 warning lint restano visibili e non sono errori di build.

Il footer e le nove varianti del brand FM sono conservati. Il catalogo production resta senza contenuti demo.
