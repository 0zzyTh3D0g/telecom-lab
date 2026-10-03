# Architettura Fase 2

Documento storico della Fase 2. Il modello corrente di identità, membership, istituti e curriculum è descritto in [ARCHITECTURE-P31.md](ARCHITECTURE-P31.md).

## Stato iniziale e migrazione

React, TypeScript, Vite, renderer a blocchi, KaTeX, quattro simulatori, esercizi guidati/parametrici, tema e GitHub Pages restano la base. Le otto lezioni d'esempio diventano fixture di test. Il catalogo non carica più JSON dal bundle.

## Confini di sicurezza

GitHub Pages ospita solo il frontend statico. Supabase Free fornisce Auth, Postgres con RLS e funzioni server. Il browser contiene soltanto URL e chiave pubblicabile. La chiave privilegiata resta nelle Edge Functions. Le query del catalogo passano da viste/tabelle con RLS; titoli, tag, corpo e URL sono protetti insieme. Il primo accesso richiede cambio password. Gli account si creano solo tramite funzione amministrativa; la registrazione pubblica va disabilitata nel progetto Auth.

Il JSON TelecomContent v2 viene validato all'importazione. La versione integrale è leggibile solo dal manager. Alla pubblicazione, le risorse teoria, simulazione ed esercizi sono separate per consentire permessi diversi. Le domande dei compiti sono pubbliche solo ai destinatari; chiavi, soluzioni e rubriche private sono in una tabella senza policy di lettura per i member. Una funzione server verifica tentativi e date, corregge domande chiuse e registra risposte aperte da rivedere. Il frontend non è un confine di autorizzazione.

## Modello

`profiles` (ruolo, stato, cambio password), `groups` e `group_memberships`; `content_items` (metadati/stato/date), `content_versions` (JSON sorgente manager con versione e autore), `content_resources` (blocchi per categoria), `module_access`, `content_access` e `resource_access` (grant espliciti per gruppo o utente, con indici univoci parziali); `assignments`, `assignment_targets`, `questions`, `private_answer_keys`, `attempts`, `reviews`; `lesson_activity` con numero aperture e tempo aggregato; `practice_progress` separato dai compiti; `audit_log` per azioni amministrative. Lo stato `published` e l'intervallo `available_from`/`available_until` sono verificati al momento della query, senza cron.

## Flussi

Manager: materiale reale → metaprompt locale → chatbot esterno → JSON v2 → validazione/anteprima → bozza o nuova versione atomica → grant espliciti → pubblicazione. Member: login → catalogo filtrato → risorse consentite → aperture/attività aggregata → Practice personale. Compito: domanda visibile → risposta → funzione server → valutazione deterministica o coda correzioni → feedback. I dati Practice restano separati da `attempts` e `reviews` dei compiti. Le RPC esposte sono wrapper invoker; le implementazioni privilegiate sono in `app_private`, mai esposto dalla Data API.

## Costo e disponibilità

Nessuna API IA o server a pagamento. La configurazione è manuale sul piano gratuito Supabase; nessun upgrade automatico. Query paginabili, nessun realtime/polling continuo, attività aggregata e backup JSON manuale. Al limite delle quote o durante una pausa del progetto il servizio può fermarsi mostrando un errore leggibile. Senza credenziali l'app compila e mostra istruzioni di configurazione. Il deploy GitHub Pages richiede un repository pubblico per restare gratuito.
