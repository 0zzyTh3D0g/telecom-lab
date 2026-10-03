# P3.2 — audit e invarianti prima delle modifiche

Base: P3.1 esistente. Verificati package/scripts/workflow, le quattro migrazioni in ordine, privilegi e policy, RPC e trigger, entrambe le Edge Functions e autenticazione, modello globale e membership, contesto, Management e componenti, renderer/Practice/Assignment, prompt/import, curriculum/libreria, backup, test PostgreSQL e browser, README e documentazione storica. Le quattro migrazioni applicate rimangono immutate.

## Problemi reali

- `set_member_group` elimina associazioni nello stesso anno: manca la successione temporale.
- Livelli vincolati a 3/4 nello schema, SQL, catalogo, navigazione, prompt e gestione.
- `content_resources` rappresenta sempre l'ultima bozza. Reimportare una lezione modifica il materiale distribuito e ne interrompe la pubblicazione.
- Practice e activity non identificano versione/anno/gruppo. Lo storico precedente non permette di inventare questa attribuzione.
- Reviewer autorizzato per materia può consultare risposte di tutti i gruppi della materia; editor legge tutti i gruppi.
- Mancano unicità dell'anno attivo e offerta formativa annuale.
- Identità globale e isolamento istituti già corretti; reset/delete condivisi già bloccati. La cancellazione fisica è inadatta a mantenere lo storico accademico.
- Slug univoco per istituto impedisce nomi identici in materie diverse.
- Recenti di altri istituti non risolvono etichette; il modello di contesto non conserva indirizzo.
- PDF non supportato. Il contratto didattico e l'assenza di API IA sono corretti.
- Query limitate evitano download illimitati ma alcuni cataloghi troncano senza paginazione. Export v5 non comprende libreria personale né lifecycle.
- Snapshot Assignment già separata dalla lezione; manca un vincolo di immutabilità per snapshot dopo pubblicazione.
- Bootstrap e Actions restano gratuiti. Catalogo production vuoto e footer conservati. Test live Supabase predisposti ma ambiente locale/Auth non disponibile.

## Invarianti adottate

A. Un'identità globale, più membership indipendenti. B. Operazioni A non cambiano B. C. Nessun account annuale duplicato. D. Iscrizioni concluse e documenti/versioni non si sovrascrivono. E. Accesso operativo solo da iscrizione temporalmente valida. F. Nuova bozza non aggiorna release. G. Snapshot Assignment pubblicata immutabile. H. Dati personali dello staff limitati a incarichi anno/materia/gruppo; authoring separato. I. Anno archiviato consultabile dallo staff autorizzato e non operativo. J. UI usa le medesime RPC e regole del database.

## Decisioni

Migrazione incrementale; livelli configurati e ordinati per indirizzo; colonne numeriche legacy conservate solo per compatibilità e verifica dei dati precedenti, senza vincoli 3/4. Iscrizioni storiche con data/provenienza della migrazione esplicite. Release append-only: aggiornamento sostituisce lo stato della vecchia distribuzione e crea una nuova release, lasciando identificatore/versione per tracking. Activity e Practice P3.1 conservate come storico non attribuibile; nuove registrazioni versionate. Rollover in transazione con lock e revisione della bozza; conferma esplicita e idempotente. Nessun grant/publicazione copiato implicitamente. PDF estratto nel browser con worker locale. Nessuna spesa, servizio aggiuntivo o upgrade.

Fonti tecniche: [Supabase functions](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html), [PDF.js](https://mozilla.github.io/pdf.js/examples/).
