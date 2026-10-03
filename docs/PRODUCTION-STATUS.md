# Prima installazione production — esito verificato

Aggiornato: **3 ottobre 2026**. Frontend pubblicato e smoke anonimo PASS.

- Sito: https://0zzyth3d0g.github.io/telecom-lab/
- Repository: https://github.com/0zzyTh3D0g/telecom-lab
- Deploy verificato: commit `3a803ff8b5bfa0efdeb292d9727b0c54bae8ee76`, workflow https://github.com/0zzyTh3D0g/telecom-lab/actions/runs/37104844507 — build e deploy **success**.
- Costo obbligatorio **0 €**: repository pubblico/Pages/Actions e Supabase FREE. Nessun upgrade, servizio premium o componente a pagamento introdotto.

## Supabase e sicurezza

Progetto `jmicelkavsdxtfzvlftq`, organizzazione `telecom-lab`, piano FREE verificato nella dashboard; regione eu-west-1, PostgreSQL 17.11. URL `https://jmicelkavsdxtfzvlftq.supabase.co`.

Preflight prima installazione: database applicativo vuoto, zero identità Auth e nessuna migration. Dry run esaminato: sette migration previste, nessun seed/ruolo aggiuntivo; applicazione riuscita senza reset. History locale/remota ricontrollata dopo il bootstrap: tutte allineate.

Migration applicate, ora immutabili:

1. `202609300001_phase2.sql`
2. `202609300002_phase21_hardening.sql`
3. `202610010003_phase3_workspace.sql`
4. `202610010004_phase31_context_curriculum.sql`
5. `202610010005_phase32_academic_lifecycle.sql`
6. `202610010006_phase32_activity_reports.sql`
7. `202610010007_phase32_integrity_guards.sql`

Verifica SQL remota del 3 ottobre (`supabase/production-check.sql`): tutte le tabelle applicative con RLS, zero SECURITY DEFINER in public, funzioni privilegiate private con search_path vuoto e owner postgres; nessun EXECUTE RPC applicativo/SELECT tabella ad anon. Una identità Auth, un profilo, un Owner, **zero contenuti** production. Security Advisor eseguito durante installazione: nessuna segnalazione WARN/ERROR.

Signup pubblico disabilitato mediante config push selettivo: modificata solo la proprietà dichiarata divergente, conservate dodici proprietà remote non dichiarate. `app_private` escluso dalla Data API, rifiuto remoto 406/PGRST106 verificato. Il primo probe sull’indice OpenAPI richiedeva una secret key; verificata invece la route di tabella, senza utilizzare chiavi privilegiate.

## Edge Functions e primo Owner

`admin-accounts` e `change-password`: entrambe ACTIVE, versione 1; Deno check PASS. Runtime keys gestite da Supabase. Unico secret custom `ALLOWED_ORIGINS`: localhost e 127.0.0.1 sulle porte 5173/4173, più `https://0zzyth3d0g.github.io` senza percorso repository.

Identità iniziale creata e confermata dall’utente, bootstrap eseguito tramite SQL esistente. Verifica ruolo: username `admin`, Owner nel workspace iniziale `10000000-0000-4000-8000-000000000001`, profilo/membership abilitati, `must_change_password=true`. Password non acquisita né conservata dall’agente. Non rieseguire il bootstrap.

## GitHub e protezione aggiornamenti

GitHub CLI autorizzata dall’utente. Nessun repository Telecom/lab preesistente nell’account: creata la repository pubblica `telecom-lab`, remoto origin e branch main. Configurate soltanto repository variables URL progetto e chiave publishable/anon. Pages usa GitHub Actions con HTTPS e base path `/telecom-lab/`.

`.env.local`, credenziali, cache Supabase CLI, node_modules e build esclusi da Git. Scansione dei sorgenti preparati senza credenziali private reali. Quattro migration pregresse confrontate con archivio P3.1 e indice Git: byte identici; nessuna migration modificata. AGENTS.md e docs/PRODUCTION.md documentano PRODUCTION DATA SAFETY. I push distribuiscono solo il frontend, senza migration/reset/seed automatici.

## Correzione trovata nello smoke

Prima pubblicazione `e63374f`, workflow `37104288883` riuscito. Smoke reale ha rilevato che `AuthSessionMissingError` sul primo accesso anonimo impediva il login. Corretto lo stato di sessione assente in `useInstitutions`; gli altri errori Auth restano segnalati. Aggiunto E2E senza sessione e senza mocking Auth per login e protezione Gestione. Seconda pubblicazione `3a803ff`, workflow `37104844507` riuscito; smoke ripetuto PASS.

## Controlli realmente eseguiti

| Controllo | Esito finale |
| --- | --- |
| npm ci | PASS; zero vulnerabilità riportate |
| typecheck | PASS locale e CI |
| lint | PASS; 13 warning React/Fast Refresh, zero errori |
| unit/database PostgreSQL/RLS PGlite | 37/37, 14 file; PASS locale e CI |
| configurazione production | 4/4; PASS locale e CI, chiavi privilegiate/missing config bloccate |
| E2E eseguibili | 10 PASS, 1 live locale skipped; locale 55 s, CI 36 s |
| production build | PASS locale e CI |
| Deno check due Edge | PASS |
| migration history e audit SQL remoto | PASS; sette versioni allineate |
| workflow Pages build/deploy | PASS |

Una prima esecuzione locale contemporanea dei gate e di quattro worker browser ha prodotto due timeout (test workspace 30 s, attesa PDF 10 s). Riesecuzioni separate: tutti i gate PASS, E2E con due worker come in CI. Nessun timeout aumentato o test rimosso.

Warning residui: 13 lint; bundle principale circa 523 kB/150 kB gzip oltre soglia Vite 500 kB; Actions preesistenti segnalano runtime Node 20 in transizione al runtime 24. Nessun warning nascosto aumentando limiti. Questi warning non hanno impedito il deploy.

## Smoke production finale

- HTTPS sito 200; frontend, asset/base path e footer corretto caricati.
- Login e Privacy raggiungibili; Gestione senza sessione presenta login.
- Login senza overflow a 320/375/768/1024/1440 px.
- Zero errori console/runtime, richieste fallite o HTTP inattesi nel frontend.
- Auth/settings 200, signup pubblico disabilitato.
- Entrambe Edge: CORS Pages consentito, POST senza bearer 403.
- Schema privato via Data API negato 406.

Smoke esclusivamente in lettura: zero scritture di test production. Report JSON e screenshot salvati fuori dal repository in outputs/production-smoke.json e outputs/production-login.png.

## Azione manuale residua e limiti

Accedere al sito con username `admin` e la password scelta durante la creazione Auth; completare il cambio password obbligatorio. Login autenticato e workflow didattico completo in production **non eseguiti**: l’agente non dispone della password. Il test live Auth/Edge locale resta skipped senza Supabase locale/Docker; i test fixture/PostgreSQL sono passati, ma non sostituiscono quel flusso Auth reale.

Nessun database remoto cancellato/reset, nessun seed/fixture production, nessuna migration già applicata modificata, nessun dato storico cancellato. Costo richiesto 0 € mantenuto.
