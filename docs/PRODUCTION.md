# Prima installazione production — Telecom/lab P3.2

Solo GitHub Free/Pages e Supabase Free, costo obbligatorio **0 €**. Nessuna risorsa a pagamento o upgrade. Il database è persistente: seguire sempre [PRODUCTION DATA SAFETY](../AGENTS.md).

## Stato e controlli locali

`npm ci`, `npm run check`, `npm run test:e2e`. Il gate `check` include typecheck, lint, unit/PostgreSQL e build. Gli E2E live sono locali e richiedono Auth/Edge locali; non usarli contro production. Configurazione production convalidata separatamente da `npm run check:production`: verifica URL HTTPS e chiave publishable/anon senza stamparli. Il workflow si ferma con variables mancanti o chiave privilegiata, prima di caricare il sito.

CLI verificata: `npx --yes supabase@2.119.0`. Versione fissata nel comando dry run. Nessuna dipendenza runtime Supabase CLI nel frontend. Autenticazione interattiva: `npx --yes supabase@2.119.0 login`; il token viene gestito dalla CLI, mai incollato in chat o committato. Se non esiste progetto Free, crearne uno in una organizzazione Free e fermarsi se il servizio richiede pagamento.

## Supabase: ispezione prima di scrivere

1. Dopo login, `npx --yes supabase@2.119.0 projects list`. Individuare il progetto corretto; se ambiguo scegliere con l’utente. Verificare il piano Free nell’organizzazione.
2. Collegare con `npx --yes supabase@2.119.0 link --project-ref <ref>`. Eventuale database password soltanto nel prompt interattivo, non nella riga comando/chat.
3. `npx --yes supabase@2.119.0 migration list --linked`, controllo history/schema e backup prima di rischio. Prima installazione vuota: tutte le sette migration nell’ordine. Upgrade P3.1: soltanto 005/006/007 non applicate.
4. `npm run migration:dry-run`. Nessun `--include-seed`, `--include-all`, reset o repair automatico. `--skip-vault` impedisce aggiornamenti di Vault dal config. Dry run elenca le migration previste: **non sostituisce la revisione SQL e lo stato effettivo remoto**. History divergente o schema inatteso: fermarsi, senza forzare.
5. Dopo revisione, applicare esplicitamente `npx --yes supabase@2.119.0 db push --linked --skip-vault`, senza seed. Operazioni distruttive non previste richiedono backup e approvazione. Le vecchie migration restano immutate.
6. Verificare history, tabelle/RLS, grants/EXECUTE, funzioni privilegiate, schemi esposti e Security Advisor. `app_private` non deve essere esposto dalla Data API. Account e catalogo devono restare vuoti su installazione iniziale, salvo bootstrap strutturale delle migration.

`config.toml` disabilita seed/signup anonimo nello sviluppo locale. Non prova che i valori remoti siano già applicati: verificare esplicitamente Authentication/API settings del progetto remoto e disabilitare la registrazione pubblica. Non usare `config push` indiscriminatamente su un progetto esistente.

## Edge e Owner

Distribuire `admin-accounts` e `change-password`, le uniche Edge Functions del repository, tramite CLI; `--use-api` consente deploy senza Docker se supportato dalla CLI. `verify_jwt=false` nel config è intenzionale: ogni funzione verifica il bearer tramite `Auth.getUser`, stato account e scope server-side. Non sono endpoint di signup/promozione pubblica.

Unico secret custom richiesto: `ALLOWED_ORIGINS`, prima localhost/127.0.0.1 sulle porte usate, poi aggiungere l’origine HTTPS Pages effettiva. L’origine è schema + host, **senza percorso repository**. Le chiavi Supabase privilegiate vengono iniettate nel runtime dal provider; non copiarle nel frontend o nelle variables pubbliche. Usare prompt/file temporaneo escluso se fosse necessario configurare segreti; mai inserirli in commit.

Creare l’identità Auth iniziale tramite la procedura amministrativa e applicare [bootstrap-first-manager.sql](../supabase/bootstrap-first-manager.sql), adattando soltanto i quattro campi dichiarati. Lo script rifiuta un manager già presente, risolve UUID Auth e crea membership Owner nello workspace iniziale. Nessuna password nel SQL. Verificare ruolo e cambio password obbligatorio. Nessuna backdoor o auto-promozione. Signup pubblico deve essere disabilitato.

## GitHub Pages

Autenticare GitHub solo quando necessario. Repository pubblico GitHub Free; usare il remoto esistente se disponibile. Configurare Pages con build GitHub Actions, variables `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` pubbliche. Il workflow esistente determina il base path dal nome repository, esegue gate/E2E e distribuisce `dist`. **Nessuna migration o credenziale Supabase privilegiata nel workflow.**

Prima di commit controllare status/diff e file tracciati: `.env.example` vuoto ammesso; `.env.local`, `.temp`, token, password e segreti esclusi. Push main solo dopo gate e revisione migration remota. Attendere workflow e URL Pages effettivo. Aggiungere quell’origine esatta ad ALLOWED_ORIGINS e verificare nuovamente le funzioni.

## Smoke production e chiusura

Controlli in lettura: HTTPS sito, asset/base path, route/login, network/console, endpoint Auth/REST, preflight Edge origine autorizzata, rifiuto chiamate prive di bearer, history migration, RLS e Owner. Nessun account reale usato per test distruttivi; test autenticati solo con credenziali e scope di test esplicitamente autorizzati. Nessun demo/fixture scritto.

Registrare URL reale, progetto/piano, migration applicate, funzioni/versioni, workflow, esiti gate/smoke, bootstrap Owner e limiti. Login mancanti o progetto non disponibile sono passaggi bloccanti: nessuna pubblicazione completa dichiarata prima della verifica.

Riferimenti: [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), [migration](https://supabase.com/docs/guides/local-development/database-migrations), [Edge deploy](https://supabase.com/docs/guides/functions/deploy).
