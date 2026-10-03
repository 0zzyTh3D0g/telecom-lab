# P3 — Brand, Experience, Motion, Multi-Subject, Multi-Staff

Report del 1 ottobre 2026. Intervento sul progetto esistente in `outputs/telecomunicazioni`, senza creare un’applicazione parallela. React, TypeScript, Supabase Auth, PostgreSQL/RLS, Edge Functions e distribuzione GitHub Pages rimangono la base.

## 1. Qualità visiva e UX

Nuova home con hero, visuale tecnica SVG originale, materie, ripresa dei contenuti, compiti e accesso al Prompt Builder. Le statistiche derivano dai dati disponibili e dal registry dei simulatori. Nessun contenuto dimostrativo viene inserito nel database o nel bundle di produzione.

Il redesign comprende testata, sidebar, catalogo, ricerca, login, lezioni, Practice, grafici, simulatori, compiti, importazione, Prompt Builder e tutte le sezioni di gestione. Palette avorio/inchiostro/mineral, font Manrope locale, card e badge coerenti, spaziatura e tipografia condivise, tema scuro aggiornato.

Gli accessi mostrano materia, modulo, lezione e risorse, con pulsanti di abilitazione, stato di pubblicazione, programmazione e blocco ereditato. Attività mostra riepiloghi e progressi leggibili; le correzioni separano risposta, rubrica, giudizio e feedback. Nuove sezioni Materie e Staff affiancano quelle esistenti.

## 2. Motion system

CSS leggero, senza aggiungere una dipendenza Motion/Framer Motion. Durate 160/300/520 ms, ingressi delle pagine, stagger delle card, feedback hover/pressione/focus, apertura dell’albero, drawer mobile, notifiche, skeleton e progresso. Nessun loop decorativo continuo; l’onda della hero si disegna una sola volta.

Reduced motion elimina animazioni, transizioni e scroll animato. La sidebar conserva apertura e chiusura, i nodi collassati sono `inert`; il drawer supporta Escape e gestione del focus. Gli aggiornamenti di grafici e simulazioni non vengono ritardati dalle decorazioni.

## 3. Multi-subject

La migrazione aggiuntiva `202610010003_phase3_workspace.sql` introduce `workspaces`, `subjects` e `staff_subjects`, aggiunge relazioni alle tabelle esistenti e aggiorna funzioni, policy e grant. Tutti i dati precedenti vengono associati al workspace Telecom/lab e alla materia Telecomunicazioni. Non vengono eliminati documenti o versioni.

La chiave logica di un modulo è `(subject_id, year, module)`. Moduli omonimi in materie diverse hanno accessi indipendenti, verificati nel database. Contenuti e compiti appartengono a una materia; gruppi e profili al workspace. I trigger impediscono collegamenti tra workspace incompatibili.

Materia integrata in navigazione **Anno → Materia → Modulo → Contenuti**, ricerca, filtri, importazione, Prompt Builder, compiti e analytics. L’archiviazione di una materia interrompe l’accesso operativo dei member/editor/reviewer e conserva lo storico per l’amministrazione.

TelecomContent resta v2: `subject` è uno slug con default `telecomunicazioni`, compatibile con i documenti precedenti. Il materiale fornito resta il contratto didattico e Aderente rimane la modalità predefinita. Per i compiti numerici adimensionali, come in Matematica, è disponibile l’unità esplicita `1`, verificata da validatore e PostgreSQL.

## 4. Multi-staff e sicurezza

| Ruolo | Ambito effettivo |
| --- | --- |
| Owner | Amministrazione del workspace, staff, configurazione, export/restore |
| Manager | Materie, gruppi, member, accessi, pubblicazione, attività e correzioni del proprio workspace |
| Editor / instructor | Contenuti, importazione, versioni e bozze dei compiti nelle materie assegnate |
| Reviewer | Risposte aperte, rubriche e feedback delle materie assegnate |
| Member | Fruizione autorizzata, Practice, propri tentativi e feedback |

L’owner assegna ruolo e materie attraverso una RPC transazionale. L’ultimo owner attivo è protetto da demozione, disattivazione e cancellazione. Il bootstrap crea un owner; su dati preesistenti il manager più anziano viene promosso. Gli account restano username/password con primo cambio obbligatorio.

La sicurezza è applicata nel database e nelle Edge Functions: il menu è solo una rappresentazione. Un editor non può pubblicare, cambiare grant o leggere attività altrui; il reviewer non legge la tabella delle chiavi private, le versioni integrali o l’attività generale. Le Edge Functions controllano il workspace del destinatario e limitano i manager agli account member.

Le funzioni privilegiate rimangono in `app_private`, con `search_path=''`; le RPC pubbliche sono invoker. Permessi UPDATE limitati alle colonne necessarie. Eventi staff, materie e operazioni sensibili mantengono l’audit; le modifiche delle membership eseguite dal servizio vengono attribuite al workspace corretto.

Riferimenti tecnici: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) e [Database Functions](https://supabase.com/docs/guides/database/functions).

## 5. Identità Francesco Di Martino

Monogramma originale **FM**, geometrico e compatto, abbinato al wordmark completo. Il lettering Manrope è convertito in tracciati SVG: il marchio è riutilizzabile senza installare font. L’identità è integrata con misura in testata, accesso, footer e pagina Design & crediti.

Il footer è conservato esattamente:

**Progettata da Francesco Di Martino · 4ITC1 · A.S. 2026/2027**

## 6. Asset e documentazione

- Nove SVG: monogramma, firma orizzontale e wordmark, ciascuno in versione light/dark/mono.
- Favicon/app mark `public/logo.svg`.
- Tavola visuale `public/brand/index.html`.
- Guida di utilizzo `public/brand/README.md`: colori, dimensioni minime, area libera, usi consentiti e varianti.
- Design system `docs/DESIGN-SYSTEM.md`.
- Font locale e licenza SIL OFL in `public/fonts/`.
- Archivio esterno `francesco-di-martino-brand-kit.zip`, con asset, tavola e licenza.

## 7. Elementi preservati

Mantenuti nome Telecom/lab, struttura React/TypeScript, temi, renderer a blocchi, KaTeX, registry e simulatori esistenti, cinque famiglie di grafici, tabelle accessibili, Practice separata dagli Assignment, correzioni, tracking aggregato, versionamento/ripristino e backup transazionale. Nessuna API IA; il chatbot esterno resta fuori dal prodotto.

La P3 riutilizza le superfici e i flussi della P2.1; separa shell e catalogo da App e aggiunge componenti coerenti per materie/staff. Non sostituisce Auth, database o architettura di distribuzione.

## 8. Verifiche eseguite

| Verifica | Esito |
| --- | --- |
| TypeScript, `npm run typecheck` | Superato |
| Lint, `npm run lint` | Superato, 15 warning React non bloccanti |
| Vitest, `npm test` | 29 test superati in 9 file |
| Build, `npm run build` | Superata |
| Playwright Chromium | 4 test superati, 1 live saltato |
| Responsive | 320, 375, 768, 1024, 1440 px: nessun overflow della pagina nelle schermate collaudate |
| Verifica visiva | Home light/dark/mobile, lezione con formula/grafico/simulatore, accessi, attività, correzioni, crediti e tavola marchio |

Il test PostgreSQL P3 applica tutte e tre le migrazioni su PGlite: isolamento delle materie e dei workspace, privilegi editor/reviewer, ultimo owner, materia archiviata, account disabilitato, cambio password, audit di servizio e risposta numerica adimensionale. Rimane la suite negativa RLS P2.1. Le prove eseguono realmente SQL e policy; non sono semplici verifiche del testo delle migrazioni.

I test UI usano fixture e risposte backend simulate, verificano anche ruoli visibili, drawer da tastiera, reduced motion, caricamento dei nove SVG e assenza di errori JavaScript. Il flusso live manager/member/Practice/Assignment/review/chiamate ostili è conservato e aggiornato, ma **non eseguito**: mancano un’istanza Supabase locale e le credenziali di test.

Build misurata: chunk principale circa **89,1 kB gzip**, gestione circa **11,8 kB gzip**, CSS applicativo circa **15,6 kB gzip**. KaTeX e validazione restano chunk separati; il font locale pesa circa 165 kB. Questi valori non rappresentano l’intero download iniziale. Nessuna dipendenza runtime aggiunta per il motion.

## 9. Limiti residui e aggiornamento

- Nessun deploy remoto eseguito e nessuna migrazione applicata a un Supabase reale. Prima di usare la P3 con dati reali: backup, applicazione delle sole migrazioni mancanti, redeploy delle Edge Functions e flusso live descritto nel README.
- PGlite non copre Auth, gateway Data API, CORS e Deno. Il collaudo locale Supabase resta necessario per questi confini.
- Workspace aggiuntivi si creano con amministrazione SQL fidata; non esistono self-service, selettore tra workspace dello stesso account o trasferimenti automatici di contenuti.
- Editor/reviewer hanno scope per materia, non per singolo compito. Un profilo appartiene a un workspace; username, slug e source ID restano globalmente univoci. I livelli rimangono 3 e 4.
- Le query di gestione sono paginate; alcuni selettori mantengono limiti espliciti di 200/500 record e il catalogo una soglia di 1000. Non è stata eseguita una prova di carico su dataset reali di grandi dimensioni.
- Il backup v4 è accettato insieme al v3; il restore importa configurazioni e contenuti in bozza, senza ricreare Auth, staff, compiti o dati personali. È distinta da un backup completo amministrativo PostgreSQL.
- Restano warning React su sincronizzazione negli effect/Fast Refresh e memoizzazione. Lint e build non hanno errori. Non è stata eseguita una certificazione WCAG né una suite Safari/Firefox.

## 10. Costo

**Il progetto mantiene il vincolo di 0,00 €**, usando GitHub pubblico/Pages/Actions nei limiti gratuiti, Supabase Free, tooling locale e librerie open source. Nessun servizio premium, API IA, email/SMS o upgrade automatico introdotto. Font e logo sono locali. Al raggiungimento delle quote il servizio si ferma o segnala indisponibilità; non acquista capacità aggiuntiva. Restano da rispettare e verificare le quote del provider indicate nel README.
