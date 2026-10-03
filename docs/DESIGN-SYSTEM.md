# Telecom/lab · Design system P3

La P3 conserva la struttura applicativa e introduce un linguaggio visivo comune: superfici avorio, inchiostro verde, tipografia geometrica, bordi sottili e spazi ampi. La materia è riconoscibile attraverso nome e accento cromatico; il colore non è mai l’unica informazione.

## Token

I token attivi sono in `src/styles/p3.css`, dopo gli stili strutturali e didattici di `src/index.css`.

| Ruolo | Chiaro | Scuro |
| --- | --- | --- |
| Sfondo | `#f6f7f3` | `#101c1b` |
| Superficie | `#ffffff` | `#172624` |
| Superficie secondaria | `#eef1eb` | `#20322e` |
| Testo principale | `#172b29` | `#e8f0e7` |
| Testo secondario | `#5a6d67` | `#a6bbb1` |
| Accento | `#35674f` | `#b7d99d` |
| Linea | `#dce4dc` | `#31433c` |

Le materie hanno sei palette consentite: mineral, blue, violet, amber, rose, slate. I badge semantici distinguono neutral, positive, warning, danger, info. Usare sempre un’etichetta leggibile insieme al colore.

**Tipografia:** Manrope variabile 200–800, caricata localmente con `font-display: swap`, fallback system-ui. Testo ordinario 14 px; testo di supporto 12 px; etichette compatte 9–11 px. Titoli di sezione 23–32 px, titoli pagina 34–48 px, hero 36–67 px secondo viewport. Non usare etichette minute per istruzioni essenziali o risposte didattiche. Formule KaTeX conservano la loro tipografia matematica.

**Spaziatura:** unità di base 4 px; ritmi principali 8, 12, 16, 24, 32, 48, 64 px. Raggi 9/16/24/32 px. Le ombre sono leggere: `--shadow` per superfici, `--shadow-hover` per interazione. Non aggiungere ombre a ogni elemento annidato.

## Componenti e stati

- `ProductUI.tsx`: BrandMark, Badge, StatusBadge, EmptyState, Skeleton, Progress. Il progresso usa `<progress>` nativo con nome accessibile.
- Pulsanti: primary per l’azione principale, subtle per azioni secondarie, text-button per link contestuali. Stato disabled esplicito; feedback di pressione senza cambiare il layout.
- Card: materia, contenuto, statistica, staff, compito. Titolo e azione leggibili senza hover.
- Input: label visibile, bordo e focus distinti, messaggi di errore vicini al flusso. Checkbox e radio restano controlli nativi.
- Tabelle attività: contenitore scorrevole e trasformazione mobile ereditata dalla P2.1; nessun overflow dell’intera pagina.
- Accessi: albero materia/modulo/lezione/risorse, pulsanti con `aria-pressed`, badge di pubblicazione e blocco ereditato. L’abilitazione del grant non equivale alla disponibilità: data, pubblicazione e archiviazione restano visibili.
- Correzioni: risposta in testo leggibile, rubrica separata, giudizio libero, feedback e stato. Nessun voto predefinito imposto.
- Errori e notifiche: `role="alert"` per errori, `role="status"` per esiti; nessun toast che sparisce prima di poter essere letto.
- Grafici: SVG responsive e tabella accessibile conservati. I valori del simulatore si aggiornano subito; le animazioni decorative non ritardano la misura.

## Motion

Nessuna libreria aggiuntiva. Transizioni CSS con curva `cubic-bezier(.22,1,.36,1)`: 160 ms per controlli, 300 ms per navigazione e pannelli, 520 ms per ingresso card. Stagger limitato alle prime card (45/85 ms). La hero traccia l’onda una sola volta; niente loop decorativi continui. Gli skeleton animano solo mentre è necessario comunicare un caricamento.

Le pagine entrano con opacità e spostamento di 7 px. Le card usano al massimo 13 px in ingresso e 5 px al passaggio del puntatore. Sidebar: espansione con griglia `0fr → 1fr`, link collassati `inert`. Drawer mobile: trasformazione orizzontale, Escape, focus contenuto nel pannello e restituito al controllo di apertura.

`prefers-reduced-motion: reduce` elimina animazioni e transizioni, disattiva lo scroll animato e rende statici gli skeleton. L’informazione e la navigazione restano identiche. Non usare motion per comunicare da solo successo, errore o progresso.

## Responsive e accessibilità

Collaudo Chromium a 320, 375, 768, 1024 e 1440 px. Sidebar mobile sotto 900 px; card e moduli si impilano progressivamente. Stati light/dark, navigazione da tastiera, skip link, focus visibile, etichette, landmark e reduced motion sono parte del sistema. Il collaudo automatico non equivale a una certificazione WCAG o a una verifica completa con screen reader.

## Brand personale

La firma FM è presente in testata, footer, accesso e crediti. Il nome del prodotto rimane Telecom/lab. Asset e regole di utilizzo: `public/brand/README.md`; tavola visuale: `public/brand/index.html`.
