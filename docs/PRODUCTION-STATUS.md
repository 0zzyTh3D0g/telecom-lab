# Preparazione prima installazione production

Aggiornato: 3 ottobre 2026. **Backend installato; pubblicazione frontend in corso.**

## Aggiornamento dopo autenticazione Supabase

- Progetto unico disponibile: `jmicelkavsdxtfzvlftq`, organizzazione `telecom-lab`, piano **FREE** verificato nella dashboard, regione eu-west-1, PostgreSQL 17.11.
- Repository collegato tramite CLI. Preflight remoto: nessuna tabella public, nessuna migration e zero identità Auth.
- `db push --dry-run --linked --skip-vault`: esattamente sette migration, zero seed/ruoli aggiuntivi. Revisione SQL senza cancellazione di tabelle/dati di questa installazione vuota.
- `db push --linked --skip-vault`: sette migration applicate con successo, da `202609300001` a `202610010007`. Nessun reset/seed.
- Verifica SQL remota: tutte le tabelle applicative con RLS; zero SECURITY DEFINER public; tutte le funzioni privilegiate private con search_path vuoto, owner postgres; nessun EXECUTE RPC o SELECT tabella ad anon. Catalogo e profili ancora vuoti.
- Security Advisor CLI: nessun problema WARN/ERROR segnalato.
- `admin-accounts` e `change-password`: entrambe **ACTIVE, versione 1**, distribuite tramite CLI/API. ALLOWED_ORIGINS configurato per localhost/127.0.0.1 sulle porte 5173/4173. Origine Pages da aggiungere quando nota.
- Config diff esaminato: una sola proprietà dichiarata diversa, `auth.enable_signup`. Push selettivo riuscito: signup pubblico disabilitato; dodici proprietà remote non dichiarate conservate. API schemas già corretti, app_private escluso.
- `.env.local` configurato con soli URL e chiave publishable/anon, escluso da Git; nessuna chiave privilegiata stampata o salvata. Controllo configurazione production PASS.
- Build con backend reale configurato PASS; bundle principale circa 523 kB/150 kB gzip. Vite segnala il chunk oltre 500 kB: warning dichiarato, non errore; nessun limite aumentato per nasconderlo.
- Smoke remoto: Auth raggiungibile e signup disabilitato; entrambe Edge raggiungibili, CORS localhost consentito e POST senza bearer rifiutato con 403. App_private respinto via Data API con 406/PGRST106. Il probe iniziale sull’indice OpenAPI richiedeva una secret key: verificata invece la route di tabella, senza utilizzare chiavi privilegiate.
- Primo Owner: identità Auth creata e confermata dall’utente; bootstrap eseguito con lo script esistente. Verifica SQL: username `admin`, ruolo `owner` nel workspace iniziale, profilo e membership abilitati, `must_change_password=true`. Password non acquisita né conservata dall’agente. Il primo accesso richiede il cambio password.
- GitHub CLI 2.102.0 installata come strumento locale da release ufficiale, SHA256 verificato. Nessuna autenticazione GitHub presente; nessun remoto/commit/push/Pages effettuato.

GitHub CLI autorizzata il 3 ottobre 2026. Repository pubblico `https://github.com/0zzyTh3D0g/telecom-lab` creato dopo verifica che non esistesse un repository Telecom/lab nell’account. Variables pubbliche configurate senza stamparne i valori. Pages configurato con GitHub Actions e HTTPS; URL assegnato `https://0zzyth3d0g.github.io/telecom-lab/`, raggiungibilità da verificare dopo il workflow. Nessuna richiesta di inviare password/token in chat.

## Audit e modifiche locali

- Base Telecom/lab P3.2, sette migration, due Edge Functions, bootstrap SQL Owner, hash routing e workflow Pages esistente verificati.
- Quattro migration precedenti confrontate con archivio P3.1: byte identici. Nessuna migration modificata in questa preparazione.
- Stato iniziale dell’audit: nessun remoto Git o progetto Supabase collegato; `.env.example` senza valori production. Successivamente Supabase collegato e Git inizializzato su `main`; 146 file preparati, senza commit/remoto/push. `.env.local`, cache CLI e file generati esclusi; scansione dei file preparati senza credenziali private reali.
- Aggiunti AGENTS.md con PRODUCTION DATA SAFETY, procedura production, script check/dry run e gate frontend contro configurazione mancante o chiavi privilegiate.
- Config locale: seed disabilitati, signup/anonymous sign-in disabilitati, app_private escluso dagli schemi API. Signup remoto e isolamento app_private verificati come riportato sopra.
- CLI Supabase 2.119.0 disponibile attraverso npx; deploy Edge via API disponibile senza Docker.

## Risultati realmente eseguiti

| Controllo | Esito |
| --- | --- |
| npm ci | PASS; 0 vulnerabilità segnalate |
| typecheck | PASS |
| lint | Exit 0; 13 warning React/Fast Refresh, 0 errori |
| unit/database | 37/37, 14 file; PostgreSQL/RLS reali PGlite |
| gate configurazione production | 4/4; blocca missing config e chiavi privilegiate, non stampa valori |
| build | PASS |
| E2E eseguibili | 9 PASS, 1 live locale skipped; circa 60 s |
| Deno check admin-accounts/change-password | PASS |

Il test live Auth/Edge resta saltato senza Supabase locale/Docker configurato. Il typecheck Deno è stato ora eseguito, diversamente dal precedente report di rilascio P3.2. Il controllo statico delle chiavi non dimostra la connessione a un progetto: questa verifica richiede i valori remoti corretti.

## Passaggi remoti residui

Commit/push, verifica workflow e raggiungibilità URL Pages, CORS dell’origine Pages, smoke frontend production e login autenticato autorizzato.

Nessun database remoto cancellato/reset, nessun seed remoto, nessun push GitHub eseguito. Il backend è installato; URL frontend production non disponibile. Nessuna risorsa a pagamento creata; vincolo costo 0 € mantenuto.
