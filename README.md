# Clearcoat

<img src="public/logo/clearcoat-logo.svg" alt="Clearcoat" height="48" />

Eine leichtgewichtige Web-App, um aus CAD-Modellen (STEP) Renderings für
Präsentationen und Dokumentationen zu erstellen. Alles läuft lokal im Browser:
Die Modelle verlassen den Rechner nicht, und es gibt kein Backend.

## Stand

- [x] **Schritt 1:** STEP-Import und Echtzeit-Ansicht
- [x] **Schritt 2:** Materialien pro Bauteil und Lichtvorlagen
- [x] **Schritt 3:** Fotorealistisches Rendern (Path Tracing auf der GPU) und PNG-Export,
  geführter Baum und Steuerungswürfel
- [x] **Schritt 4:** Entrauschen, eigene HDRI-Umgebungen, gespeicherte Einstellungen
- [x] **Schritt 5:** Projekte und Vorlagen, helle Oberfläche mit schwebender
  Seitenleiste, genaue Kamerasteuerung mit Tiefenunschärfe, Wahl des Rendergeräts
- [x] **Schritt 6:** Schnittansichten mit geschlossenen Schnittflächen
- [x] **Schritt 7:** Material-Feintuning mit Reglern, gebürsteten und gedrehten
  Oberflächen und erweiterter Bibliothek
- [x] **Schritt 8:** Einzelne Softboxen, weitere Lichtvorlagen und Belichtung
- [x] **Schritt 9:** Farbverläufe, Hohlkehle und spiegelnder Boden

## Ablauf

Die schwebende Seitenleiste führt als Baum durch alle Schritte. Jeder Eintrag
hat sinnvolle Standardwerte, sodass man direkt rendern kann. Ein Klick öffnet
die Einstellungen daneben, das Plus legt einen neuen Untereintrag an.

1. **Projekt:** Ein Projekt ist ein Rendering-Auftrag mit Namen. Es merkt sich
   Modell, Materialien, Szene, Licht, Kamera, Ansichten und Output und öffnet
   sich beim nächsten Start wieder vollständig. Projekte lassen sich wechseln,
   duplizieren und löschen. Eine **Vorlage** speichert die Einstellungen ohne
   Modell, um sie in anderen Projekten wieder anzuwenden.
2. **Geometrie:** STEP-Datei öffnen (Plus oder Drag-and-drop). Die Bauteile
   stehen als aufklappbare Liste darunter, das Auge blendet sie ein und aus.
   Ein Klick auf ein Bauteil, im Baum oder im Modell, öffnet es mit Sichtbarkeit
   und Material.
3. **Schnitte:** Das Plus legt eine Schnittebene an, senkrecht zu einer Achse
   und per Regler verschiebbar. Die Schnittflächen werden geschlossen, wahlweise
   im Material des Bauteils oder in einer eigenen Farbe. Einzelne Bauteile,
   etwa Schrauben oder Wellen, lassen sich vom Schnitt ausnehmen. Schnitte
   gelten in der Ansicht und im fertigen Rendering.
4. **Materialien:** Das Plus legt ein Material an. Bauteile werden in der Liste
   angehakt oder direkt im Modell angeklickt. Gleiche Bauteile, etwa alle
   Schrauben einer Größe, werden auf Wunsch gemeinsam zugewiesen. Bauteile
   ohne Material behalten ihre CAD-Farbe. Die Bibliothek ist nach Metall,
   Kunststoff, Lack und Glas gegliedert. Regler für Rauheit, Metallisch und
   Klarlack passen jedes Material an. Gebürstete und gedrehte Oberflächen
   verziehen die Spiegelungen quer zu den Riefen. Die Schliffrichtung oder
   Drehachse ergibt sich automatisch aus der Form des Bauteils oder wird als
   Achse gewählt.
5. **Szene:** Hintergrund als Farbe oder Farbverlauf (von oben nach unten oder
   von der Mitte nach außen). Der Boden zeigt nur Schatten und geht nahtlos in
   den Hintergrund über, auch beim Farbverlauf. Er kann spiegeln, etwa wie
   schwarzes Acrylglas. Alternativ steht das Modell in einer Hohlkehle, die
   wie im Fotostudio hinter dem Modell nach oben läuft und sich mit der
   Kamera dreht.
6. **Beleuchtung:** Lichtvorlage (fünf Studio-Aufbauten, Tageslicht, bewölkter
   Himmel, Werkhalle) oder eigene HDRI-Datei (.hdr, .exr), Drehung und
   Belichtung in Blendenstufen. Eine HDRI-Datei lässt sich auch einfach ins
   Fenster ziehen. Die Softboxen einer Vorlage stehen als Einträge darunter
   und lassen sich einzeln verschieben, vergrößern, färben, dimmen und
   ausschalten. Das Plus legt weitere an, auch über einer HDRI-Datei.
   „Glanzlicht setzen“ richtet eine Softbox so aus, dass ihr Glanzlicht genau
   auf dem angeklickten Punkt des Modells liegt.
7. **Perspektive:** Brennweite oder Parallelprojektion, Kamera in Zahlen
   (Drehung, Höhe, Rollen, Abstand, Drehpunkt) und Tiefenunschärfe mit Blende
   und wählbarem Fokuspunkt. Das Plus speichert die aktuelle Ansicht.
8. **Output:** Bildgröße, Qualität, transparenter Hintergrund, Entrauschen und
   das Rendergerät (Grafikkarte oder CPU). Ein Rahmen in der Ansicht zeigt
   genau den Bildausschnitt, der gerendert wird. Der schonende Modus hilft auf
   Laptops und schwächeren Grafikkarten.
9. **Renderings:** Das Plus startet ein Rendering. Fertige Bilder bleiben als
   Einträge stehen und lassen sich als PNG speichern.

Projekte und Vorlagen liegen im Speicher des Browsers (Einstellungen im
localStorage, STEP- und HDRI-Dateien in IndexedDB). Sie gelten also pro
Browser und Rechner.

Das Rendern braucht einen Browser mit WebGPU, also ein aktuelles Chrome oder
Edge. Die Echtzeit-Ansicht läuft in jedem aktuellen Browser. Das Rendern auf
der CPU nutzt die Software-Umsetzung des Browsers und ist um ein Vielfaches
langsamer als eine Grafikkarte.

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
| Standardansichten | Flächen und Ecken des Würfels unten rechts anklicken |
| In 15°-Schritten drehen | Pfeile am Würfel |
| In 15°-Schritten rollen | Runde Pfeile am Würfel |
| Zurück zur Standardansicht | Haus am Würfel |
| Modell einpassen | `F` |
| Kanten ein- und ausblenden | `E` |

## Aufbau

- `src/step-worker.js` liest STEP-Dateien mit OpenCascade (WebAssembly, über
  [occt-import-js](https://github.com/kovacsv/occt-import-js)) in einem Web
  Worker und berechnet die CAD-Kanten aus den Flächengrenzen.
- `src/step-loader.js` wandelt das Ergebnis in three.js-Geometrie um, ein Mesh
  pro Bauteil.
- `src/viewer.js` ist die Echtzeit-Ansicht (WebGL) mit Kamera, Boden und
  Bildausschnitt, `src/viewcube.js` der Steuerungswürfel, `src/icons.js` die Symbole.
- `src/section.js` schneidet Geometrie an Ebenen und schließt die Schnittflächen.
- `src/backdrop.js` baut Boden, Hohlkehle und Farbverläufe für Ansicht und Rendering.
- `src/materials.js` enthält die Materialbibliothek und die Schliffbilder,
  `src/environment.js` erzeugt die Lichtvorlagen und Softboxen als
  HDR-Umgebung direkt im Code.
- `src/render.js` rendert das Endbild mit
  [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)
  auf WebGPU in einer eigenen, unsichtbaren Zeichenfläche.
  Das Entrauschen übernimmt Open Image Denoise, das Modell dazu liegt unter
  `public/oidn/`.
- `src/persistence.js` speichert Projekte und Vorlagen im Browser.
- `src/state.js` hält alle Einstellungen, `src/tree.js` zeichnet den Baum,
  `src/panels.js` die Einstellungen zum gewählten Eintrag, `src/main.js`
  verbindet alles.
