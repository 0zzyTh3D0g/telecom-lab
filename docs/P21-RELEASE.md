# P2.1 — audit e verifica

## Problemi trovati

- Helper `SECURITY DEFINER` nello schema `public`, grant impliciti troppo ampi e `search_path` non fissato; controllare solo la presenza di RLS non bastava.
- Tabelle di accesso e destinatari senza unicità logica; potevano contenere grant contraddittori.
- Importazione, creazione dei compiti e modifica dei grant eseguite in più query browser, con rischio di stato parziale.
- Versioni conservate ma senza flusso di aggiornamento/ripristino; import di slug esistente non gestito.
- Aperture e Practice non rappresentate dal modello di attività; viste gestione basate solo su attività esistenti, senza account autorizzati che non avevano aperto.
- Area gestione monolitica, query generali con limite a 1000, correzioni in formato JSON e navigazione poco adatta a molti contenuti.
- Numero di simulazioni fisso nella home, ricerca senza debounce, grafici sensibili a punti non finiti, stato Assignment poco chiaro.

## Interventi

- Migrazione additiva `202609300002_phase21_hardening.sql`: helper privilegiati in `app_private` non esposto, `search_path=''`, RPC pubbliche `SECURITY INVOKER`, grant espliciti, RLS riesaminate, indici unici parziali e audit delle operazioni sensibili.
- RPC transazionali per contenuti e versioni, rollback, accessi, assegnazioni, cambio gruppo, backup e cancellazione attività. Il ripristino del backup rifiuta collisioni e riporta i contenuti in bozza.
- Cronologia versioni, anteprima/avvisi dell'importatore, albero accessi con stato effettivo, tre viste di attività, correzioni filtrabili e leggibili, credenziali iniziali esportabili o stampabili.
- `open_count` con intervallo minimo di cinque minuti, tempo attivo stimato aggregato, `practice_progress` separato dagli Assignment. Il browser conserva temporaneamente in `sessionStorage` i secondi non inviati per riprovarli alla riapertura della lezione.
- Sidebar per anno e modulo, ricerca con debounce, feedback Assignment e grafici resilienti. Prompt Builder, registri delle simulazioni, contenuti vuoti in produzione e footer originale conservati.
- Playwright smoke responsivo nel workflow GitHub Actions; test live che copre i flussi manager/member e chiamate ostili, attivo solo su backend locale.

## Verifiche eseguite

| Controllo | Risultato |
| --- | --- |
| TypeScript | Passato |
| oxlint | Exit 0; rimangono avvisi React non bloccanti |
| Vitest + PostgreSQL embedded | 26 test passati, incluse policy negative, grant, scadenze, soluzioni, atomicità, versioni e tracking |
| Build Vite production | Passata |
| Playwright Chromium | Smoke passato a 320, 375, 768, 1024 e 1440 px |
| Playwright con Supabase locale reale | Non eseguito: istanza, CLI e credenziali non disponibili in questo ambiente |

## Prima del deploy

1. Eseguire un backup dell'installazione esistente e applicare **solo** la migrazione P2.1 su un ambiente di prova con schema Fase 2.
2. Verificare che `app_private` non sia tra gli schemi esposti nella Data API; distribuire le due Edge Functions e configurare `ALLOWED_ORIGINS`.
3. Eseguire `npm run test:e2e` con Supabase locale e variabili `E2E_*` descritte nel README. Il test rifiuta URL non locali.
4. Collaudare manualmente le sezioni con dati reali di prova a tutte le larghezze richieste, in particolare accessi, correzioni, grafici e tabelle.
5. Distribuire su GitHub Pages solo dopo la verifica del backend. Il codice non effettua upgrade o acquisti; il piano Supabase Free deve essere selezionato e mantenuto manualmente.

Il setup dettagliato e le limitazioni dell'export sono nel `README.md`.
