# CAD Render Engine

Eine leichtgewichtige Web-App, um aus CAD-Modellen (STEP) Renderings für
Präsentationen und Dokumentationen zu erstellen. Alles läuft lokal im Browser:
Die Modelle verlassen den Rechner nicht, und es gibt kein Backend.

## Stand

- [x] **Schritt 1:** STEP-Import und Echtzeit-Ansicht
- [x] **Schritt 2:** Materialien pro Bauteil und Lichtvorlagen
- [x] **Schritt 3:** Fotorealistisches Rendern (Path Tracing auf der GPU) und PNG-Export,
  geführter Baum und Steuerungswürfel
- [x] **Schritt 4:** Entrauschen, eigene HDRI-Umgebungen, gespeicherte Einstellungen

## Ablauf

Die linke Seitenleiste führt als Baum durch alle Schritte. Jeder Eintrag hat
sinnvolle Standardwerte, sodass man direkt rendern kann. Ein Klick öffnet die
Einstellungen daneben, das Plus legt einen neuen Untereintrag an.

1. **Geometrie:** STEP-Datei öffnen (Plus oder Drag-and-drop), Bauteile ein- und ausblenden.
2. **Materialien:** Das Plus legt ein Material an. Bauteile werden in der Liste
   angehakt oder direkt im Modell angeklickt. Gleiche Bauteile, etwa alle
   Schrauben einer Größe, werden auf Wunsch gemeinsam zugewiesen. Bauteile
   ohne Material behalten ihre CAD-Farbe.
3. **Szene:** Hintergrundfarbe und Boden mit Schatten.
4. **Beleuchtung:** Lichtvorlage oder eigene HDRI-Datei (.hdr, .exr), Drehung und Helligkeit.
   Eine HDRI-Datei lässt sich auch einfach ins Fenster ziehen.
5. **Perspektive:** Blickwinkel einstellen, das Plus speichert die aktuelle Ansicht.
6. **Output:** Bildgröße, Qualität, transparenter Hintergrund und Entrauschen.
   Ein Rahmen in der Ansicht zeigt genau den Bildausschnitt, der gerendert
   wird. Der schonende Modus hilft auf Laptops und schwächeren Grafikkarten.
7. **Renderings:** Das Plus startet ein Rendering. Fertige Bilder bleiben als
   Einträge stehen und lassen sich als PNG speichern.

Szene, Beleuchtung und Output bleiben beim Neuladen erhalten, Materialien und
gespeicherte Ansichten merkt sich die App pro STEP-Datei (im Browser, über den
Dateinamen).

Das Rendern braucht einen Browser mit WebGPU, also ein aktuelles Chrome oder
Edge. Die Echtzeit-Ansicht läuft in jedem aktuellen Browser.

## Starten

Voraussetzung ist [Node.js](https://nodejs.org) ab Version 20.

Unter Windows genügt ein Doppelklick auf `start.bat`. Die Datei gleicht bei
jedem Start die Abhängigkeiten ab und öffnet die App im Browser.

Alternativ von Hand:

```bash
npm install
npm run dev
```

Danach die angezeigte Adresse im Browser öffnen (normalerweise
http://localhost:5173) und eine STEP-Datei in das Fenster ziehen. Ein
Testmodell liegt unter `samples/Bracket.step`.

`npm run build` erzeugt in `dist/` eine rein statische Version der App.

## Bedienung der Ansicht

| Aktion | Eingabe |
| --- | --- |
| Drehen | Linke Maustaste ziehen |
| Verschieben | Rechte Maustaste ziehen |
| Zoomen | Mausrad |
| Standardansichten | Flächen und Ecken des Würfels oben rechts anklicken |
| In 15°-Schritten drehen | Pfeile am Würfel |
| Modell einpassen | `F` |
| Kanten ein- und ausblenden | `E` |

## Aufbau

- `src/step-worker.js` liest STEP-Dateien mit OpenCascade (WebAssembly, über
  [occt-import-js](https://github.com/kovacsv/occt-import-js)) in einem Web
  Worker und berechnet die CAD-Kanten aus den Flächengrenzen.
- `src/step-loader.js` wandelt das Ergebnis in three.js-Geometrie um, ein Mesh
  pro Bauteil.
- `src/viewer.js` ist die Echtzeit-Ansicht (WebGL) mit Kamera, Boden und
  Bildausschnitt, `src/viewcube.js` der Steuerungswürfel.
- `src/materials.js` enthält die Materialbibliothek, `src/environment.js`
  erzeugt die Lichtvorlagen als HDR-Umgebung direkt im Code.
- `src/render.js` rendert das Endbild mit
  [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)
  auf WebGPU in einer eigenen, unsichtbaren Zeichenfläche.
  Das Entrauschen übernimmt Open Image Denoise, das Modell dazu liegt unter
  `public/oidn/`.
- `src/persistence.js` speichert Einstellungen im Browser.
- `src/state.js` hält alle Einstellungen, `src/tree.js` zeichnet den Baum,
  `src/panels.js` die Einstellungen zum gewählten Eintrag, `src/main.js`
  verbindet alles.
