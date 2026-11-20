# Prospectly v2 – nur Cold Calls

Lokale App: Betriebe einer Stadt finden, per Klick in **Cold Calls** oder **Aussortiert** sortieren, anrufen, auswerten.
Kein `npm install` nötig, nur Node.js ab Version 18.

## Starten
- Windows: Doppelklick auf `start.bat`
- Sonst: `npm start` (öffnet http://localhost:3000)

## Die Tabs
- **Sortieren** – Leads suchen (auch „Alle Unternehmen“ einer Stadt) und sortieren. Tasten: `C`/`→` = Cold Call, `X`/`←` = aussortieren, `Z` = rückgängig. Gesucht wird mit Google Places (falls Key), sonst Geoapify, sonst OpenStreetMap.
- **Cold Calls** – deine Anrufliste mit Ergebnis (Nicht erreicht / Rückruf / Interessiert / Kein Interesse) und Notiz.
- **Aussortiert** – alles, was du aussortiert hast. Wiederherstellen oder endgültig löschen.
- **Analytics** – Erfolgsquote, Anrufe pro Tag und Uhrzeit, Erfolg nach Branche, Website-Qualität und Ort.
- **Einstellungen** – API-Keys eintragen und testen, Backup.

Bei jedem Lead führen **Google** und **Maps** mit einem Klick zur Google-Suche bzw. Karte. Mit Google-Places-Key zeigt der Lead zusätzlich Bewertung und Öffnungszeiten.

## „Alle Leads löschen“
Löscht nur den Sortier-Pool (die noch unsortierten Leads). **Cold Calls und Aussortiert bleiben erhalten.** Sortierte Leads tauchen im Pool und bei neuen Suchen nicht mehr auf.

## Daten
`data.json` (Leads, Zugangstoken, gespeicherte Keys) und `backups/` stehen in `.gitignore` und werden nicht geteilt.
Wer von Prospectly v1 kommt: die alte `data.json` in diesen Ordner kopieren. Leads der Anrufliste bleiben Cold Calls, aussortierte landen in „Aussortiert“, der Rest im Sortier-Pool. Mail-Daten werden ignoriert.
