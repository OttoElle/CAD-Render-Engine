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
- [x] **Schritt 10:** Explosionsansicht für Baugruppen
- [x] **Schritt 11:** Warteschlange, alle Ansichten in einem Rutsch, JPG und
  Drehteller als Video oder Bildserie
- [x] **Schritt 12:** Projekte als Datei exportieren und importieren
- [x] **Schritt 13:** Projektübersicht, aufgeräumte Menüs mit einklappbaren
  Gruppen, Seitenverhältnis und Auflösung getrennt, Kanten am Würfel
- [x] **Schritt 14:** Oberfläche auf Englisch, Render-Jobs (Bild oder
  Drehteller) für die Warteschlange, Übernehmen/Verwerfen in jedem Panel,
  Bauteile im Viewport auswählen, Koordinatensystem mit verschiebbaren
  Bauteilen und wählbarer Hochachse, Explosionsansicht pro Bauteil, gespeicherte
  Renderings mit Galerie in der Übersicht und einfacher Bildbearbeitung,
  CAD-Navigation ohne Anschlag

## Ablauf

Die Oberfläche der App ist englisch; die Begriffe unten stehen deshalb in
Klammern so, wie sie in der App heißen.

„Projects“ oben links öffnet die Projektübersicht: alle Projekte als Kacheln
mit Vorschaubild, letzter Änderung und Inhalt, zum Öffnen, Anlegen,
Importieren, Duplizieren, Exportieren und Löschen. „New project“ fragt nach
Namen und Vorlage, der Stift an einer Kachel (oder ein Klick auf den
Projektnamen oben) ändert Namen und Vorlage später. Hat ein Projekt
Renderings, öffnet der Knopf auf seinem Vorschaubild eine Galerie, in der
sich die Bilder ansehen und herunterladen lassen, ohne das Projekt zu öffnen.
Unter den Projekten lassen sich Vorlagen speichern und löschen. Eine Vorlage
merkt sich Materialien, Szene, Licht, Objektiv und Output-Einstellungen ohne
Modell. „Export“ speichert ein Projekt samt STEP-Modell und eigener HDRI als
eine `.clearcoat`-Datei, „Import“ (oder die Datei ins Fenster ziehen) holt es
auf einem anderen Rechner wieder herein. Mit mehreren Projekten startet die
App in der Übersicht.

Die schwebende Seitenleiste führt als Baum durch alle Schritte. Jeder Eintrag
hat sinnvolle Standardwerte. Ein Klick öffnet die Einstellungen daneben, das
Plus legt einen neuen Untereintrag an. Oben rechts im Panel übernimmt der
Haken die Änderungen, das Kreuz verwirft alles, was seit dem Öffnen des Panels
geändert wurde (ein gerade angelegter Eintrag verschwindet dann wieder).

1. **Geometrie (Geometry):** STEP-Datei öffnen (Plus oder Drag-and-drop).
   Darunter stehen die Bauteile (Parts) und die Schnitte (Sections). Bauteile
   lassen sich im Baum oder direkt im Modell anklicken; unter dem Mauszeiger
   leuchten sie auf. Im Bauteil-Panel stehen Sichtbarkeit, Material, die
   Position als Versatz in X, Y, Z (auch mit Pfeilen im Viewport
   verschiebbar) und eigene Einstellungen für die Explosionsansicht. Unter
   „Coordinate system“ wird gewählt, welche CAD-Achse nach oben zeigt, und
   die Achsen lassen sich einblenden (auch über „Axes“ oder `A`).
   Schnitte: das Plus legt eine Schnittebene an, senkrecht zu einer Achse und
   per Regler verschiebbar. Die Schnittflächen werden geschlossen, im Material
   des Bauteils oder in eigener Farbe. Ein Klick auf ein Bauteil im Modell
   nimmt es vom Schnitt aus oder schneidet es wieder.
2. **Materialien (Materials):** Das Plus legt ein Material an. Bauteile
   werden im Modell angeklickt oder in der Liste angehakt; die zugewiesenen
   stehen als Auswahl-Box mit Entfernen-Knopf da, „Clear list“ leert sie.
   Gleiche Bauteile werden auf Wunsch gemeinsam zugewiesen. Regler für
   Rauheit, Metallisch und Klarlack sowie gebürstete und gedrehte Oberflächen
   passen jedes Material an; „Reset to defaults“ setzt Farbe und Regler
   jederzeit auf die Werte der Bibliothek zurück.
3. **Szene (Scene):** Zuerst die Wahl des Hintergrunds: Farbe (hell, weiß,
   grau, dunkel, eigene Farbe oder Farbverlauf) oder Szene (die
   Lichtumgebung bzw. eine HDRI als Hintergrund). Bei einer Farbe folgt die
   Bodenform (flacher Boden, Hohlkehle oder kein Boden), danach Stärke und
   Unschärfe der Spiegelung im Boden.
4. **Beleuchtung (Lighting):** Lichtvorlage oder eigene HDRI-Datei, Drehung
   und Belichtung in Blendenstufen. Die Softboxen stehen als Einträge
   darunter und lassen sich einzeln verschieben, vergrößern, färben, dimmen
   und ausschalten. „Place highlight“ legt das Glanzlicht einer Softbox auf
   den angeklickten Punkt.
5. **Kamera (Camera):** Brennweite oder Parallelprojektion, Kamera in Zahlen,
   Tiefenunschärfe und die Explosionsansicht (Abstand, Richtung und ein
   Bauteil als Zentrum). Das Plus speichert die aktuelle Ansicht.
6. **Output:** Hier entstehen Render-Jobs. Ein Job ist ein Bild oder ein
   Drehteller und merkt sich Kamera, Explosionsabstand, Seitenverhältnis,
   Auflösung, Qualität, Dateiformat und Transparenz. Solange ein Job offen
   ist, nimmt er die Kamera mit, und ein Rahmen zeigt den Bildausschnitt.
   Beliebig viele Jobs anlegen (auch einer pro gespeicherter Ansicht), dann
   „Render all jobs“: alle wandern in die Warteschlange. Der Drehteller dreht
   das Modell einmal um die senkrechte Achse (24 bis 120 Bilder, eine Umdrehung
   in 4 bis 12 Sekunden); den Blickwinkel bestimmt die Kamerahöhe. Unter
   „Rendering device“ stehen Grafikkarte oder CPU und der schonende Modus.
7. **Renderings (Renders):** Fertige Bilder bleiben mit dem Projekt
   gespeichert, auch nach einem Neustart. Im Bildbetrachter lassen sich
   Helligkeit, Kontrast, Sättigung, Wärme und Vignette einstellen; das gilt
   beim Speichern auch für die Einzelbilder und das Video eines Drehtellers.
   Bilder einzeln als PNG oder JPG, alle zusammen als ZIP, Drehteller als
   Video (MP4, sonst WebM) oder Bildserie.

Projekte und Vorlagen liegen im Speicher des Browsers (Einstellungen im
localStorage, STEP- und HDRI-Dateien sowie fertige Renderings in IndexedDB).
Sie gelten also pro Browser und Rechner; zwischen Rechnern wandern sie als
Projektdatei. Eine `.clearcoat`-Datei ist ein ZIP-Archiv mit `project.json`,
dem Modell und der HDRI; Renderings bleiben auf dem Rechner, auf dem sie
entstanden sind.

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
| Drehen (um den Punkt unter der Maus, ohne Anschlag) | Linke Maustaste ziehen |
| Verschieben | Rechte oder mittlere Maustaste ziehen, oder Shift + linke Maustaste |
| Zoomen (zum Mauszeiger hin) | Mausrad |
| Standardansichten | Flächen, Kanten und Ecken des Würfels unten rechts anklicken |
| In 15°-Schritten drehen | Pfeile am Würfel |
| In 15°-Schritten rollen | Runde Pfeile am Würfel |
| Zurück zur Standardansicht | Haus am Würfel |
| Modell einpassen | `F` |
| Kanten ein- und ausblenden | `E` |
| Koordinatensystem ein- und ausblenden | `A` |

## Aufbau

- `src/step-worker.js` liest STEP-Dateien mit OpenCascade (WebAssembly, über
  [occt-import-js](https://github.com/kovacsv/occt-import-js)) in einem Web
  Worker und berechnet die CAD-Kanten aus den Flächengrenzen.
- `src/step-loader.js` wandelt das Ergebnis in three.js-Geometrie um, ein Mesh
  pro Bauteil.
- `src/viewer.js` ist die Echtzeit-Ansicht (WebGL) mit Kamera, Boden,
  Bildausschnitt, Achsen und Verschiebe-Pfeilen, `src/cad-controls.js` die
  Maussteuerung, `src/viewcube.js` der Steuerungswürfel, `src/icons.js` die Symbole.
- `src/section.js` schneidet Geometrie an Ebenen und schließt die Schnittflächen.
- `src/backdrop.js` baut Boden, Hohlkehle und Farbverläufe für Ansicht und Rendering.
- `src/explode.js` berechnet die Verschiebungen der Explosionsansicht.
- `src/adjust.js` enthält die Bildbearbeitung für fertige Renderings.
- `src/export.js` speichert Bilder als PNG oder JPG, packt und liest
  ZIP-Archive und nimmt Drehteller-Videos auf, ohne zusätzliche Bibliotheken.
- `src/materials.js` enthält die Materialbibliothek und die Schliffbilder,
  `src/environment.js` erzeugt die Lichtvorlagen und Softboxen als
  HDR-Umgebung direkt im Code.
- `src/render.js` rendert das Endbild mit
  [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)
  auf WebGPU in einer eigenen, unsichtbaren Zeichenfläche.
  Das Entrauschen übernimmt Open Image Denoise, das Modell dazu liegt unter
  `public/oidn/`.
- `src/persistence.js` speichert Projekte und Vorlagen im Browser,
  `src/overview.js` zeigt die Projektübersicht, `src/project-file.js` packt ein Projekt in eine `.clearcoat`-Datei und liest
  sie wieder.
- `src/state.js` hält alle Einstellungen, `src/tree.js` zeichnet den Baum,
  `src/panels.js` die Einstellungen zum gewählten Eintrag, `src/main.js`
  verbindet alles.
