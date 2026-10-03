# PRODUCTION DATA SAFETY

Il database production contiene dati persistenti e non sacrificabili.

- Migration applicata = immutabile. Ogni modifica futura usa una nuova migration incrementale.
- Mai `supabase db reset --linked` o reset di database remoti.
- Mai TRUNCATE/DROP production senza migration esplicita, backup e approvazione umana.
- Mai seed, demo o fixture in production. Le fixture appartengono esclusivamente ai test.
- Git push e GitHub Actions distribuiscono solo il frontend: non cancellano dati né applicano migration Supabase automaticamente.
- Prima di migration potenzialmente rischiose: backup amministrativo, verifica stato/history, `db push --dry-run`, revisione SQL e approvazione se distruttiva.
- Preservare account, workspace, enrollment, contenuti, release, Assignment, tentativi, review, attività e storico.
- Non committare `.env.local`, password, service-role/secret key, database password, access token o file di credenziali. Non stamparli nei log.
- Nel frontend/repository variables soltanto URL progetto e chiave publishable/anon; mai chiavi privilegiate.
- Costo obbligatorio 0 €: esclusivamente piani Free, nessun upgrade automatico o risorsa a pagamento.
- Non eseguire gli E2E con fixture/account creati automaticamente contro production. I test live esistenti accettano solo Supabase locale.
- Controlli prima di push su main: typecheck, lint, unit/database test, E2E eseguibili, build e verifica migration. Non dichiarare superato un gate non eseguito.

Seguire [procedura production](docs/PRODUCTION.md). `npm run migration:dry-run` è soltanto una preview; nessuno script applica migration o reset automaticamente.
