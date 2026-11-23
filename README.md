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
- [x] **Schritt 15:** Bauteile drehen (Zahlen und Drehringe im Viewport),
  Hilfslinien über dem Bildausschnitt, Rendern läuft im Hintergrund-Tab weiter,
  englische Namen auch in älteren Projekten
- [x] **Schritt 16:** Neuer Tree (Kategorien als Titel ohne eigenes Panel,
  keine Häkchen, Schnellaktionen an den Einträgen), einheitlicher Baukasten
  für alle Panels mit Beschriftung links, Icon-Set, Einstellungen mit
  Rendering-Gerät und änderbaren Tastenkürzeln
- [x] **Schritt 17:** Plus-Menüs zum Hinzufügen und Entfernen (Explosionsansicht,
  Boden, Tiefenunschärfe, Lichtarten, Materialien nach Gruppen), Bauteile
  löschen und mehrere zusammen auswählen, kombiniertes Werkzeug zum
  Verschieben und Drehen mit Werteingabe im Viewport, Schraffur auf
  Schnittflächen, einstellbarer Bodenschatten
- [x] **Schritt 18:** Ein Weg pro Einstellung: Plus nur mit sinnvollen
  Optionen (bei einer direkt hinzufügen), weitere Bauteile aus STEP-Dateien
  hinzufügen, Explosionsansicht nur noch unter Geometry, Hilfslinien nur in der
  Werkzeugleiste, Material nur im Material-Panel zuweisen
- [x] **Schritt 19:** Ladeanzeige mit Fortschrittsbalken, Werte in allen
  Reglern direkt eintippen, Material und Oberfläche getrennt wählen,
  Schraffur mit Linienbreite, automatischer Kontrastfarbe und Umrandung der
  Schnittflächen, überlappende Bauteile im Schnitt rot markiert, Kantenlinien
  im Rendering, Bild oder Drehteller direkt über das Plus bei Output
- [x] **Schritt 20:** Zentrieren getrennt vom Einpassen, Zoomen zur Bildmitte
  als Einstellung, Kantenlinien im Rendering ohne verdeckte Kanten und mit
  Umrisslinien gewölbter Flächen, Render-Jobs und gespeicherte Ansichten auf die
  aktuelle Ansicht aktualisieren
- [x] **Schritt 21:** Freies Drehen wie in Onshape als Voreinstellung
  (Drehteller mit waagrechtem Horizont als Einstellung), Drehgeschwindigkeit
  passend zur Fenstergröße, sichtbarer Drehpunkt beim Ziehen

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

Die schwebende Seitenleiste zeigt das Projekt als Baum. Die Kategorien
(Geometry, Materials, Scene, Lighting, Camera, Output, Renders) sind nur
Überschriften: ein Klick klappt sie auf und zu, das Plus fügt etwas hinzu.
Gibt es dort mehrere Dinge, öffnet es ein kleines Menü, bei einem fügt es
direkt hinzu, und wo nichts dazukommen kann, fehlt es. Was ein Eintrag in
seinem Panel ohnehin einstellt (Achse eines Schnitts, Art des Materials,
Bodenform, Bild oder Drehteller), fragt das Plus nicht vorher ab: jede
Einstellung hat genau einen Ort. Angelegt ist nur, was jedes Projekt braucht
(Hintergrund, Lichtvorlage, Objektiv, CAD-Farben); alles andere kommt über das
Plus dazu und lässt sich über „⋯“ oder „Remove“ unten im Panel wieder
entfernen. Ein
Play-Symbol bei Output rendert alle Jobs, das Download-Symbol bei Renders
speichert alle Bilder. Ein Klick auf einen Eintrag öffnet seine Einstellungen
daneben. Beim Überfahren zeigen Einträge ihre Schnellaktionen: Auge zum Ein-
und Ausblenden, Play zum Rendern oder Anzeigen und „⋯“ für Duplizieren und
Löschen. Rechts in jeder Zeile steht eine kurze Info; ein oranges Dreieck
weist auf etwas hin, das Aufmerksamkeit braucht (z. B. ein Material ohne
Bauteile), ein Ring zeigt den Fortschritt eines Renderings. Oben rechts im
Panel übernimmt der Haken die Änderungen, das Kreuz verwirft alles, was seit
dem Öffnen des Panels geändert wurde. Unten im Panel stehen die Aktionen wie
Rendern, Zurücksetzen und Löschen.

Das Zahnrad oben rechts öffnet die Einstellungen der App: wo gerendert wird
(Grafikkarte oder CPU, schonender Modus) und die Tastenkürzel, die sich dort
ändern lassen. Beides gilt für alle Projekte in diesem Browser.

1. **Geometrie (Geometry):** STEP-Datei öffnen (Eintrag ganz oben oder
   Drag-and-drop); dieser Eintrag enthält auch Hochachse und Achsen. Darunter
   stehen die Bauteile (Parts) und, wenn hinzugefügt, die Explosionsansicht
   (Exploded view: Abstand, Richtung und ein Bauteil als Zentrum) und die
   Schnitte. Das Plus fügt ein Bauteil aus einer weiteren STEP-Datei hinzu
   (es wird mit dem Projekt gespeichert und exportiert), einen Schnitt oder die
   Explosionsansicht; sie gilt für die Ansicht und alle Renderings. Bauteile lassen sich im Baum oder direkt
   im Modell anklicken; unter dem Mauszeiger leuchten sie auf. Mit Strg oder
   Shift gedrückt kommen weitere Bauteile zur Auswahl dazu oder fallen wieder
   heraus; das Panel gilt dann für alle zusammen (Material, Ein- und
   Ausblenden, gemeinsam verschieben und drehen, löschen). Gelöschte Bauteile
   holt „⋯“ an „Parts“ oder der Hinweis im Geometry-Panel zurück. Im
   Bauteil-Panel stehen Sichtbarkeit, Material, Position und Drehung
   („Position and rotation“: Versatz in X, Y, Z und Winkel um die CAD-Achsen,
   gedreht um die Mitte des Bauteils) und eigene Einstellungen für die
   Explosionsansicht. „Move and rotate“ (oder `M`) zeigt im Viewport ein
   Werkzeug wie in CAD-Programmen: Pfeile verschieben entlang einer Achse,
   Quadrate in einer Ebene, die Viertelringe drehen um eine Achse, die Kugel in
   der Mitte verschiebt frei. Beim Ziehen steht der Wert neben dem Mauszeiger;
   danach lässt sich der genaue Abstand oder Winkel eintippen und mit Enter
   übernehmen. Shift rastet auf 1 mm bzw. 15° ein. Mehrere Bauteile drehen sich
   um ihre gemeinsame Mitte. Schnitte gehen durch die
   Baugruppe, wie sie ausgerichtet ist; verschobene und gedrehte Bauteile
   werden in derselben Ebene geschnitten wie alle anderen. Ein Schnitt liegt senkrecht zu einer Achse und ist per Regler verschiebbar.
   Die Schnittflächen werden geschlossen, im Material des Bauteils oder in
   eigener Farbe, auf Wunsch schraffiert (Linien oder gekreuzt, mit Abstand,
   Linienbreite in mm und Winkel; benachbarte Bauteile bekommen abwechselnd um
   90° gedrehte Linien wie in einer technischen Zeichnung). Die Linienfarbe ist
   entweder ein dunklerer Ton der Schnittfläche (auf dunklen Teilen ein
   hellerer), z. B. dunkelblau auf einem blauen Teil, oder eine eigene Farbe.
   Schraffierte Schnittflächen bekommen eine Umrandung entlang ihrer Kanten.
   Wo sich zwei Bauteile im CAD-Modell überschneiden (z. B. ein Gewinde, das
   größer gezeichnet ist als die Kernlochbohrung), wird die Überlappung im
   Schnitt rot markiert, statt dass mal das eine, mal das andere Teil
   durchscheint. Bauteile, die sich nur berühren, bleiben unmarkiert. Schraffur,
   Umrandung und Markierung erscheinen auch im Rendering. Ein Klick auf ein
   Bauteil im Modell nimmt es vom Schnitt aus oder schneidet es wieder.
2. **Materialien (Materials):** Das Plus legt ein Material an. Im Panel wählt
   man den Werkstoff (Aluminium, Stahl, Edelstahl, Guss, Titan, Messing,
   Kupfer, Gold, Kunststoff, klarer Kunststoff, Gummi, Lack, Glas, Keramik) und
   getrennt davon seine Oberfläche (bei Metallen z. B. satiniert, poliert,
   gestrahlt, gebürstet, gedreht, dazu eloxiert bei Aluminium oder brüniert,
   verzinkt und verchromt bei Stahl). Ältere Projekte mit Materialien wie
   „Aluminium gebürstet“ öffnen mit dem passenden Werkstoff und der passenden
   Oberfläche. Bauteile
   werden im Modell angeklickt oder in der Liste angehakt; die zugewiesenen
   stehen als Auswahl-Box mit Entfernen-Knopf da, „Clear list“ leert sie.
   Gleiche Bauteile werden auf Wunsch gemeinsam zugewiesen. Regler für
   Rauheit, Metallisch und Klarlack sowie Richtung und Stärke bei gebürsteten
   und gedrehten Oberflächen passen jedes Material an; „Reset to defaults“ setzt Farbe und Regler
   jederzeit auf die Werte der Bibliothek zurück.
3. **Szene (Scene):** „Background“: Farbe (hell, weiß, grau, dunkel, eigene
   Farbe oder Farbverlauf) oder Szene (die Lichtumgebung bzw. eine HDRI als
   Hintergrund). „Floor“ (fehlt er, fügt das Plus ihn wieder hinzu):
   Bodenform (flacher Boden oder Hohlkehle), Stärke des Schattens sowie Stärke
   und Unschärfe der Spiegelung. Wie weich der Schatten ist, bestimmen die
   Größen der Lichter.
4. **Beleuchtung (Lighting):** „Light setup“: Lichtvorlage oder eigene
   HDRI-Datei, Drehung und Belichtung in Blendenstufen. Das Plus fügt eine
   Softbox hinzu; Form und Größe stellt ihr Panel ein. Die Softboxen stehen als Einträge
   darunter und lassen sich einzeln verschieben, vergrößern, färben, dimmen
   und ausschalten. „Place highlight“ legt das Glanzlicht einer Softbox auf
   den angeklickten Punkt.
5. **Kamera (Camera):** „Lens“: Brennweite oder Parallelprojektion und Kamera
   in Zahlen. Das Plus speichert die aktuelle Ansicht oder fügt die
   Tiefenunschärfe (Depth of field: Blende und Fokuspunkt) hinzu.
6. **Output:** Hier entstehen Render-Jobs. Ein Job ist ein Bild oder ein
   Drehteller und merkt sich Kamera, Seitenverhältnis,
   Auflösung, Qualität und Transparenz. PNG oder JPG wählt man erst beim
   Speichern des fertigen Renderings. Solange ein Job offen
   ist, nimmt er die Kamera mit, und ein Rahmen zeigt den Bildausschnitt.
   „Guides“ oben wählt Hilfslinien über dem Bildausschnitt (Drittel, Goldener
   Schnitt, Raster oder Mitte und Diagonalen) oder schaltet sie aus, `G`
   blendet sie ein und aus. Die Linien erscheinen nicht im Bild. Das Plus legt
   einen Job an: ein Bild (Image), einen Drehteller (Turntable) oder, mit
   gespeicherten Ansichten, ein Bild pro Ansicht. Das Play-Symbol schickt alle
   Jobs in die Warteschlange. Unter „Edge lines“ bekommt ein Job auf Wunsch
   Kantenlinien wie in einer CAD-Ansicht (CAD-Kanten, Umrisslinien gewölbter
   Flächen und Umrisse der Schnittflächen, verdeckte Kanten bleiben
   unsichtbar), mit Farbe und Linienbreite; sie werden nach dem Rendern über
   das Bild gelegt. „⋯“ an einem Job oder einer gespeicherten Ansicht und dann
   „Update to the current view“ übernimmt die Kamera, wie sie gerade ist. Der Drehteller dreht
   das Modell einmal um die senkrechte Achse (24 bis 120 Bilder, eine Umdrehung
   in 4 bis 12 Sekunden); den Blickwinkel bestimmt die Kamerahöhe.
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
Edge. Es läuft weiter, wenn der Tab im Hintergrund liegt oder das Fenster
minimiert ist. Den Energiesparmodus und das Speichersparen von Chrome
(„Leistung“ in den Einstellungen) kann das nicht überstimmen; dort lässt sich
`localhost` unter „Diese Websites immer aktiv lassen“ eintragen. Die Echtzeit-Ansicht läuft in jedem aktuellen Browser. Das Rendern auf
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

### Online über GitHub Pages

Jeder Push auf `main` baut die App per GitHub Actions
(`.github/workflows/pages.yml`) und veröffentlicht sie unter
https://ottoelle.github.io/CAD-Render-Engine/. Einmalig muss dafür unter
Settings > Pages die Quelle auf "GitHub Actions" stehen. Projekte liegen im
Browser-Speicher der jeweiligen Adresse; Projekte von `localhost` erscheinen
online also nicht und lassen sich über Projektdateien (`.clearcoat`) mitnehmen.

## Bedienung der Ansicht

| Aktion | Eingabe |
| --- | --- |
| Drehen (um den Punkt unter der Maus, sonst um die Modellmitte; ein Punkt zeigt den Drehpunkt) | Linke Maustaste ziehen |
| Verschieben | Rechte oder mittlere Maustaste ziehen, oder Shift + linke Maustaste |
| Zoomen (zum Mauszeiger hin oder, unter dem Zahnrad einstellbar, zur Bildmitte) | Mausrad |
| Standardansichten | Flächen, Kanten und Ecken des Würfels unten rechts anklicken |
| In 15°-Schritten drehen | Pfeile am Würfel |
| In 15°-Schritten rollen | Runde Pfeile am Würfel |
| Zurück zur Standardansicht | Haus am Würfel |
| Modell einpassen (zentrieren und zoomen) | `F` |
| Modell zentrieren, Zoom bleibt | `C` |
| Kanten ein- und ausblenden | `E` |
| Koordinatensystem ein- und ausblenden | `A` |
| Hilfslinien ein- und ausblenden (Art über „Guides“) | `G` |
| Werkzeug zum Verschieben und Drehen der gewählten Bauteile | `M` |
| Weitere Bauteile auswählen | Strg oder Shift + Klick |

Die Tastenkürzel lassen sich unter dem Zahnrad oben rechts ändern. Dort
steht auch, wie gedreht wird: frei wie in Onshape (Voreinstellung; das Modell
folgt der Maus in jede Richtung) oder mit waagrechtem Horizont wie auf einem
Drehteller (seitlich um die Hochachse, ohne Anschlag oben und unten), und
wohin das Mausrad zoomt.

## Aufbau

- `src/step-worker.js` liest STEP-Dateien mit OpenCascade (WebAssembly, über
  [occt-import-js](https://github.com/kovacsv/occt-import-js)) in einem Web
  Worker und berechnet die CAD-Kanten aus den Flächengrenzen.
- `src/step-loader.js` wandelt das Ergebnis in three.js-Geometrie um, ein Mesh
  pro Bauteil.
- `src/viewer.js` ist die Echtzeit-Ansicht (WebGL) mit Kamera, Boden,
  Bildausschnitt und Achsen, `src/cad-controls.js` die
  Maussteuerung, `src/viewcube.js` der Steuerungswürfel, `src/icons.js` die Symbole.
- `src/section.js` schneidet Geometrie an Ebenen, schließt die Schnittflächen
  und umrandet sie, `src/hatch.js` schraffiert sie, `src/overlap.js` findet
  überlappende Schnittflächen verschiedener Bauteile.
- `src/edge-overlay.js` zeichnet die Kantenlinien für ein Rendering,
  `src/loading.js` die Ladeanzeige beim Öffnen einer STEP-Datei.
- `src/manipulator.js` ist das Werkzeug zum Verschieben und Drehen im Viewport.
- `src/backdrop.js` baut Boden, Hohlkehle und Farbverläufe für Ansicht und Rendering.
- `src/explode.js` berechnet die Verschiebungen der Explosionsansicht.
- `src/adjust.js` enthält die Bildbearbeitung für fertige Renderings,
  `src/guides.js` die Hilfslinien über dem Bildausschnitt.
- `src/export.js` speichert Bilder als PNG oder JPG, packt und liest
  ZIP-Archive und nimmt Drehteller-Videos auf, ohne zusätzliche Bibliotheken.
- `src/materials.js` enthält die Materialbibliothek und die Schliffbilder,
  `src/environment.js` erzeugt die Lichtvorlagen und Softboxen als
  HDR-Umgebung direkt im Code.
- `src/render.js` rendert das Endbild mit
  [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)
  auf WebGPU in einer eigenen, unsichtbaren Zeichenfläche; `src/background.js`
  hält es in einem Hintergrund-Tab am Laufen.
  Das Entrauschen übernimmt Open Image Denoise, das Modell dazu liegt unter
  `public/oidn/`.
- `src/persistence.js` speichert Projekte und Vorlagen im Browser,
  `src/overview.js` zeigt die Projektübersicht, `src/project-file.js` packt ein Projekt in eine `.clearcoat`-Datei und liest
  sie wieder.
- `src/state.js` hält alle Einstellungen, `src/tree.js` zeichnet den Baum,
  `src/panels.js` die Einstellungen zum gewählten Eintrag (mit den Bausteinen
  des UI-Baukastens am Anfang der Datei), `src/menu.js` die kleinen Menüs,
  `src/settings.js` und `src/shortcuts.js` die App-Einstellungen,
  `src/main.js` verbindet alles.
