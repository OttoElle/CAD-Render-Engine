# CAD Render Engine

Eine leichtgewichtige Web-App, um aus CAD-Modellen (STEP) Renderings für
Präsentationen und Dokumentationen zu erstellen. Alles läuft lokal im Browser:
Die Modelle verlassen den Rechner nicht, und es gibt kein Backend.

## Stand

- [x] **Schritt 1:** STEP-Import und Echtzeit-Ansicht
- [ ] **Schritt 2:** Materialien pro Bauteil und Lichtvorlagen
- [ ] **Schritt 3:** Fotorealistisches Rendern (Path Tracing auf der GPU) und PNG-Export
- [ ] **Schritt 4:** Baugruppen-Komfort und Feinschliff

## Starten

Voraussetzung ist [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm run dev
```

Danach die angezeigte Adresse im Browser öffnen (normalerweise
http://localhost:5173) und eine STEP-Datei in das Fenster ziehen. Ein
Testmodell liegt unter `samples/Bracket.step`.

`npm run build` erzeugt in `dist/` eine rein statische Version der App.

## Bedienung

| Aktion | Eingabe |
| --- | --- |
| Drehen | Linke Maustaste ziehen |
| Verschieben | Rechte Maustaste ziehen |
| Zoomen | Mausrad |
| Bauteil auswählen | Klick im Modell oder in der Liste |
| Bauteil ein- und ausblenden | Doppelklick in der Liste |
| Modell einpassen | `F` |
| Kanten ein- und ausblenden | `E` |
| Auswahl aufheben | `Esc` |

## Aufbau

- `src/step-worker.js` liest STEP-Dateien mit OpenCascade (WebAssembly, über
  [occt-import-js](https://github.com/kovacsv/occt-import-js)) in einem Web
  Worker und berechnet die CAD-Kanten aus den Flächengrenzen.
- `src/step-loader.js` wandelt das Ergebnis in three.js-Geometrie um, ein Mesh
  pro Bauteil.
- `src/viewer.js` ist die Echtzeit-Ansicht mit Kamera, Auswahl und
  Standardansichten.
- `src/main.js` verbindet Oberfläche und Ansicht.
