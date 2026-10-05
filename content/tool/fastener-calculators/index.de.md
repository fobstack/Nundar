---
title: Schraubenrechner für Titan-Verbindungselemente
description: Formeln, Konstanten und Referenztabellen für Titan-Verbindungselemente zu Massenreduktion, Anzugsdrehmoment, Vorspannkraft und Einschraubtiefe.
slug: schraubenrechner
calculators: fasteners
---

Drei Fragen stellen sich bei fast jedem Titan-Verbindungselement: wie viel Masse der Wechsel von Stahl einspart, welches Anzugsdrehmoment die beabsichtigte Vorspannkraft ergibt und wie tief das Gewinde im Gehäuse eingeschraubt sein muss. Zu jeder Frage nennt diese Seite die Formel, jede Konstante dahinter und eine Ergebnistabelle für metrische Standardgrößen, sodass sich jeder Wert von Hand nachrechnen lässt.

## Auf dieser Seite verwendete Gewindegrößen

Alle drei Berechnungen verwenden den Nenndurchmesser und die Regelgewindesteigung dieser acht metrischen Gewinde.

| Gewinde | Nenndurchmesser d | Steigung p |
| --- | ---: | ---: |
| M3 | 3,0 mm | 0,5 mm |
| M4 | 4,0 mm | 0,7 mm |
| M5 | 5,0 mm | 0,8 mm |
| M6 | 6,0 mm | 1,0 mm |
| M8 | 8,0 mm | 1,25 mm |
| M10 | 10,0 mm | 1,5 mm |
| M12 | 12,0 mm | 1,75 mm |
| M16 | 16,0 mm | 2,0 mm |

## Massenreduktion Titan gegenüber Stahl

### Was die Berechnung beantwortet

Wie viel leichter wird eine Baugruppe, wenn ihre hochfesten Stahlschrauben durch gleich große Verbindungselemente aus Titan Grade 5 (Ti-6Al-4V) ersetzt werden? Ein Konstrukteur braucht den Wert, wenn er ein Massenbudget schließt, überall dort, wo jedes Kilogramm Kosten verursacht. Die Berechnung drückt die Einsparung außerdem als Startkosten aus, bei einem typischen Nutzlast-Kostenaufschlag beim Start von 10.000 $ pro kg.

### Formel

- `V = π × (d ÷ 2)² × L ÷ 1000 × H`
- `m = V × ρ`
- `M = m × N ÷ 1000`
- `Einsparung = M des Vergleichsmetalls − M von Titan Grade 5`
- `Reduktion (%) = (ρ des Vergleichsmetalls − ρ von Titan Grade 5) ÷ ρ des Vergleichsmetalls × 100`
- `Startkostenäquivalent ($) = Einsparung × 10.000`

Die Formelzeichen bedeuten:

- `V`: Volumen eines Verbindungselements, in cm³;
- `d`: Gewindenenndurchmesser, in mm;
- `L`: Länge des Verbindungselements, in mm;
- `H`: Kopfgeometriefaktor, ein Zuschlag für den Kopf auf das Schaftvolumen;
- `ρ`: Dichte des Metalls, in g/cm³;
- `m`: Masse eines Verbindungselements, in g;
- `N`: Anzahl der Verbindungselemente;
- `M`: Gesamtmasse, in kg;
- `Einsparung`: aus der Baugruppe entfernte Masse, in kg.

### Konstanten

| Konstante | Wert | Einheit |
| --- | ---: | --- |
| Dichte von Kohlenstoffstahl 10.9 (Vergleichsmetall) | 7,85 | g/cm³ |
| Dichte von Edelstahl 316 (Vergleichsmetall) | 8,00 | g/cm³ |
| Dichte von Titan Grade 5 (Ti-6Al-4V) | 4,43 | g/cm³ |
| Dichte von Titan Grade 2 (Reintitan) | 4,51 | g/cm³ |
| Dichte von Luftfahrtaluminium 7075-T6 | 2,81 | g/cm³ |
| Kopffaktor H, Zylinderschraube mit Innensechskant (zylindrischer Standardkopf) | 1,25 | keine |
| Kopffaktor H, Linsenkopfschraube (flacher Kopf) | 1,15 | keine |
| Kopffaktor H, Senkkopf 90° | 1,10 | keine |
| Kopffaktor H, schwere Sechskantschraube mit Flansch | 1,35 | keine |
| Nutzlast-Kostenaufschlag beim Start | 10.000 | $ pro kg |
| Länge L, zulässiger Bereich | 6 bis 150 | mm |
| Stückzahl N, zulässiger Bereich | 1 bis 50.000 | Verbindungselemente |

### Referenztabellen

Masse eines Verbindungselements in jedem Metall. Eingaben: Zylinderschraube mit Innensechskant (H = 1,25), ein Verbindungselement.

| Verbindungselement | Kohlenstoffstahl 10.9 | Edelstahl 316 | Titan Grade 5 | Titan Grade 2 | Aluminium 7075-T6 |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 0,69 g | 0,71 g | 0,39 g | 0,40 g | 0,25 g |
| M4 × 12 mm | 1,48 g | 1,51 g | 0,84 g | 0,85 g | 0,53 g |
| M5 × 20 mm | 3,85 g | 3,93 g | 2,17 g | 2,21 g | 1,38 g |
| M6 × 30 mm | 8,32 g | 8,48 g | 4,70 g | 4,78 g | 2,98 g |
| M8 × 30 mm | 14,80 g | 15,08 g | 8,35 g | 8,50 g | 5,30 g |
| M10 × 40 mm | 30,83 g | 31,42 g | 17,40 g | 17,71 g | 11,03 g |
| M12 × 50 mm | 55,49 g | 56,55 g | 31,31 g | 31,88 g | 19,86 g |
| M16 × 60 mm | 118,38 g | 120,64 g | 66,80 g | 68,01 g | 42,37 g |

Masse von 100 Verbindungselementen gegenüber Kohlenstoffstahl. Eingaben: Zylinderschraube mit Innensechskant (H = 1,25), N = 100, Vergleichsmetall Kohlenstoffstahl 10.9 (7,85 g/cm³).

| Verbindungselement | Kohlenstoffstahl 10.9 | Titan Grade 5 | Eingesparte Masse | Reduktion | Startkostenäquivalent |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 69,4 g | 39,1 g | 30,2 g | 43,6 % | 302 $ |
| M4 × 12 mm | 148,0 g | 83,5 g | 64,5 g | 43,6 % | 645 $ |
| M5 × 20 mm | 385,3 g | 217,5 g | 167,9 g | 43,6 % | 1.679 $ |
| M6 × 30 mm | 832,3 g | 469,7 g | 362,6 g | 43,6 % | 3.626 $ |
| M8 × 30 mm | 1,480 kg | 835,0 g | 644,7 g | 43,6 % | 6.447 $ |
| M10 × 40 mm | 3,083 kg | 1,740 kg | 1,343 kg | 43,6 % | 13.430 $ |
| M12 × 50 mm | 5,549 kg | 3,131 kg | 2,417 kg | 43,6 % | 24.175 $ |
| M16 × 60 mm | 11,838 kg | 6,680 kg | 5,157 kg | 43,6 % | 51.572 $ |

Masse von 100 Verbindungselementen gegenüber Edelstahl. Eingaben: Zylinderschraube mit Innensechskant (H = 1,25), N = 100, Vergleichsmetall Edelstahl 316 (8,00 g/cm³).

| Verbindungselement | Edelstahl 316 | Titan Grade 5 | Eingesparte Masse | Reduktion | Startkostenäquivalent |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 70,7 g | 39,1 g | 31,5 g | 44,6 % | 315 $ |
| M4 × 12 mm | 150,8 g | 83,5 g | 67,3 g | 44,6 % | 673 $ |
| M5 × 20 mm | 392,7 g | 217,5 g | 175,2 g | 44,6 % | 1.752 $ |
| M6 × 30 mm | 848,2 g | 469,7 g | 378,5 g | 44,6 % | 3.785 $ |
| M8 × 30 mm | 1,508 kg | 835,0 g | 672,9 g | 44,6 % | 6.729 $ |
| M10 × 40 mm | 3,142 kg | 1,740 kg | 1,402 kg | 44,6 % | 14.019 $ |
| M12 × 50 mm | 5,655 kg | 3,131 kg | 2,523 kg | 44,6 % | 25.235 $ |
| M16 × 60 mm | 12,064 kg | 6,680 kg | 5,383 kg | 44,6 % | 53.834 $ |

Einfluss der Kopfgeometrie. Eingaben: M6 × 30 mm, N = 100, Vergleichsmetall Kohlenstoffstahl 10.9 (7,85 g/cm³).

| Kopfgeometrie | Kopffaktor H | Kohlenstoffstahl 10.9 | Titan Grade 5 | Eingesparte Masse |
| --- | ---: | ---: | ---: | ---: |
| Zylinderschraube mit Innensechskant | 1,25 | 832,3 g | 469,7 g | 362,6 g |
| Linsenkopfschraube | 1,15 | 765,7 g | 432,1 g | 333,6 g |
| Senkkopf 90° | 1,10 | 732,4 g | 413,3 g | 319,1 g |
| Schwere Sechskantschraube mit Flansch | 1,35 | 898,9 g | 507,3 g | 391,6 g |

Massen eines einzelnen Verbindungselements sind auf 0,01 g gerundet. Summen unter 1 kg sind in Gramm auf 0,1 g angegeben, Summen ab 1 kg in Kilogramm auf 0,001 kg. Jeder Wert wird für sich gerundet, daher kann die Differenz zweier abgedruckter Summen in der letzten Stelle von der abgedruckten Einsparung abweichen.

### Annahmen

- Das Verbindungselement wird über seine volle Länge als glatter Zylinder mit dem Gewindenenndurchmesser behandelt. Der Kopf ist ein Zuschlagsfaktor auf dieses Volumen (25 % bei einer Zylinderschraube mit Innensechskant), kein vermessener Kopf. Gewindeform und Antriebsvertiefung sind nicht Teil des Modells.
- Die prozentuale Reduktion hängt nur von den beiden Dichten ab und ist deshalb für jede Größe gleich: 43,6 % gegenüber Kohlenstoffstahl 10.9 und 44,6 % gegenüber Edelstahl 316.
- Das Startkostenäquivalent multipliziert die Einsparung mit einem typischen Nutzlast-Kostenaufschlag beim Start. Es ist ein Anhaltswert für Trägerraketen und Raumfahrzeuge, kein Preis.
- Die Massen sind Schätzwerte zum Vergleich von Metallen. Sie sind keine Kataloggewichte.

## Anzugsdrehmoment und Vorspannkraft

### Was die Berechnung beantwortet

Welches Anzugsdrehmoment bringt ein Titan-Verbindungselement auf die beabsichtigte Vorspannkraft, bei dem Schmierstoff auf seinem Gewinde? Ein Konstrukteur braucht den Wert, wenn er ein Montagedrehmoment in eine Zeichnung oder eine Arbeitsanweisung schreibt. Der Schmierstoff verändert die Antwort: Anti-Seize-Paste senkt den K-Faktor, also muss das Drehmoment mit ihm gesenkt werden, um ein Überspannen zu vermeiden.

### Formel

- `As = 0,7854 × (d − 0,9382 × p)²`
- `σ = Sy × P ÷ 100`
- `Fi = As × σ ÷ 1000`
- `T = K × Fi × d`
- `T in lbf·in = T × 8,8507`
- `T in lbf·ft = T × 0,73756`

Die Formelzeichen bedeuten:

- `As`: Spannungsquerschnitt des Gewindes, in mm²;
- `d`: Gewindenenndurchmesser, in mm;
- `p`: Gewindesteigung, in mm;
- `Sy`: Streckgrenze der Titansorte, in MPa (N/mm²);
- `P`: Vorspanngrad in Prozent, der Anteil der Streckgrenze, auf den das Verbindungselement angezogen wird;
- `σ`: Zielspannung im Verbindungselement, in MPa;
- `Fi`: erzeugte Vorspannkraft, in kN;
- `K`: K-Faktor (Drehmomentbeiwert) des Schmierzustands, ohne Einheit;
- `T`: Anzugsdrehmoment, in N·m. Mit `Fi` in kN und `d` in mm ergibt das Produkt direkt N·m.

### Konstanten

| Konstante | Wert | Einheit |
| --- | ---: | --- |
| Streckgrenze Sy, Titan Grade 5 | 828 | MPa |
| Streckgrenze Sy, Reintitan Grade 2 | 275 | MPa |
| K-Faktor K, Anti-Seize-Paste mit Molybdändisulfid (MoS2) (empfohlen) | 0,11 | keine |
| K-Faktor K, Anti-Seize-Paste auf Kupferbasis | 0,13 | keine |
| K-Faktor K, leichtes Maschinenöl SAE 30 | 0,16 | keine |
| K-Faktor K, trocken / im Anlieferungszustand (hohe Fressgefahr) | 0,22 | keine |
| Vorspanngrad P, Standardwert | 70 | % der Streckgrenze |
| Vorspanngrad P, kleinster und größter zulässiger Wert | 50 und 85 | % der Streckgrenze |
| Koeffizient des Spannungsquerschnitts | 0,7854 | keine |
| Steigungskoeffizient des Spannungsquerschnitts | 0,9382 | keine |
| Umrechnung N·m in lbf·in | 8,8507 | lbf·in pro N·m |
| Umrechnung N·m in lbf·ft | 0,73756 | lbf·ft pro N·m |

### Referenztabellen für Titan Grade 5

Eingaben für die drei Tabellen: Titan Grade 5 (Sy = 828 MPa), Vorspanngrad P = 70 %, also eine Zielspannung von 579,6 MPa; Regelgewindesteigung wie aufgeführt.

Drehmoment in N·m, mit dem Spannungsquerschnitt und der erzeugten Vorspannkraft:

| Gewinde | Steigung p | Spannungsquerschnitt As | Vorspannkraft Fi | MoS2-Paste, K = 0,11 | Kupfer-Anti-Seize, K = 0,13 | Öl SAE 30, K = 0,16 | Trocken, K = 0,22 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M3 | 0,5 mm | 5,03 mm² | 2,92 kN | 1,0 N·m | 1,1 N·m | 1,4 N·m | 1,9 N·m |
| M4 | 0,7 mm | 8,78 mm² | 5,09 kN | 2,2 N·m | 2,6 N·m | 3,3 N·m | 4,5 N·m |
| M5 | 0,8 mm | 14,18 mm² | 8,22 kN | 4,5 N·m | 5,3 N·m | 6,6 N·m | 9,0 N·m |
| M6 | 1,0 mm | 20,12 mm² | 11,66 kN | 7,7 N·m | 9,1 N·m | 11,2 N·m | 15,4 N·m |
| M8 | 1,25 mm | 36,61 mm² | 21,22 kN | 18,7 N·m | 22,1 N·m | 27,2 N·m | 37,3 N·m |
| M10 | 1,5 mm | 57,99 mm² | 33,61 kN | 37,0 N·m | 43,7 N·m | 53,8 N·m | 73,9 N·m |
| M12 | 1,75 mm | 84,27 mm² | 48,84 kN | 64,5 N·m | 76,2 N·m | 93,8 N·m | 128,9 N·m |
| M16 | 2,0 mm | 156,67 mm² | 90,81 kN | 159,8 N·m | 188,9 N·m | 232,5 N·m | 319,6 N·m |

Dasselbe Drehmoment in lbf·in:

| Gewinde | MoS2-Paste, K = 0,11 | Kupfer-Anti-Seize, K = 0,13 | Öl SAE 30, K = 0,16 | Trocken, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 8,5 lbf·in | 10,1 lbf·in | 12,4 lbf·in | 17,0 lbf·in |
| M4 | 19,8 lbf·in | 23,4 lbf·in | 28,8 lbf·in | 39,6 lbf·in |
| M5 | 40,0 lbf·in | 47,3 lbf·in | 58,2 lbf·in | 80,0 lbf·in |
| M6 | 68,1 lbf·in | 80,5 lbf·in | 99,1 lbf·in | 136,3 lbf·in |
| M8 | 165,3 lbf·in | 195,3 lbf·in | 240,4 lbf·in | 330,5 lbf·in |
| M10 | 327,2 lbf·in | 386,7 lbf·in | 476,0 lbf·in | 654,5 lbf·in |
| M12 | 570,6 lbf·in | 674,4 lbf·in | 830,0 lbf·in | 1141,2 lbf·in |
| M16 | 1414,5 lbf·in | 1671,7 lbf·in | 2057,4 lbf·in | 2829,0 lbf·in |

Dasselbe Drehmoment in lbf·ft:

| Gewinde | MoS2-Paste, K = 0,11 | Kupfer-Anti-Seize, K = 0,13 | Öl SAE 30, K = 0,16 | Trocken, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 0,71 lbf·ft | 0,84 lbf·ft | 1,03 lbf·ft | 1,42 lbf·ft |
| M4 | 1,65 lbf·ft | 1,95 lbf·ft | 2,40 lbf·ft | 3,30 lbf·ft |
| M5 | 3,33 lbf·ft | 3,94 lbf·ft | 4,85 lbf·ft | 6,67 lbf·ft |
| M6 | 5,68 lbf·ft | 6,71 lbf·ft | 8,26 lbf·ft | 11,36 lbf·ft |
| M8 | 13,77 lbf·ft | 16,28 lbf·ft | 20,03 lbf·ft | 27,54 lbf·ft |
| M10 | 27,27 lbf·ft | 32,23 lbf·ft | 39,66 lbf·ft | 54,54 lbf·ft |
| M12 | 47,55 lbf·ft | 56,20 lbf·ft | 69,16 lbf·ft | 95,10 lbf·ft |
| M16 | 117,87 lbf·ft | 139,31 lbf·ft | 171,45 lbf·ft | 235,75 lbf·ft |

### Referenztabellen für Titan Grade 2

Eingaben für die drei Tabellen: Reintitan Grade 2 (Sy = 275 MPa), Vorspanngrad P = 70 %, also eine Zielspannung von 192,5 MPa; Regelgewindesteigung wie aufgeführt.

Drehmoment in N·m, mit dem Spannungsquerschnitt und der erzeugten Vorspannkraft:

| Gewinde | Steigung p | Spannungsquerschnitt As | Vorspannkraft Fi | MoS2-Paste, K = 0,11 | Kupfer-Anti-Seize, K = 0,13 | Öl SAE 30, K = 0,16 | Trocken, K = 0,22 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M3 | 0,5 mm | 5,03 mm² | 0,97 kN | 0,3 N·m | 0,4 N·m | 0,5 N·m | 0,6 N·m |
| M4 | 0,7 mm | 8,78 mm² | 1,69 kN | 0,7 N·m | 0,9 N·m | 1,1 N·m | 1,5 N·m |
| M5 | 0,8 mm | 14,18 mm² | 2,73 kN | 1,5 N·m | 1,8 N·m | 2,2 N·m | 3,0 N·m |
| M6 | 1,0 mm | 20,12 mm² | 3,87 kN | 2,6 N·m | 3,0 N·m | 3,7 N·m | 5,1 N·m |
| M8 | 1,25 mm | 36,61 mm² | 7,05 kN | 6,2 N·m | 7,3 N·m | 9,0 N·m | 12,4 N·m |
| M10 | 1,5 mm | 57,99 mm² | 11,16 kN | 12,3 N·m | 14,5 N·m | 17,9 N·m | 24,6 N·m |
| M12 | 1,75 mm | 84,27 mm² | 16,22 kN | 21,4 N·m | 25,3 N·m | 31,1 N·m | 42,8 N·m |
| M16 | 2,0 mm | 156,67 mm² | 30,16 kN | 53,1 N·m | 62,7 N·m | 77,2 N·m | 106,2 N·m |

Dasselbe Drehmoment in lbf·in:

| Gewinde | MoS2-Paste, K = 0,11 | Kupfer-Anti-Seize, K = 0,13 | Öl SAE 30, K = 0,16 | Trocken, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 2,8 lbf·in | 3,3 lbf·in | 4,1 lbf·in | 5,7 lbf·in |
| M4 | 6,6 lbf·in | 7,8 lbf·in | 9,6 lbf·in | 13,2 lbf·in |
| M5 | 13,3 lbf·in | 15,7 lbf·in | 19,3 lbf·in | 26,6 lbf·in |
| M6 | 22,6 lbf·in | 26,7 lbf·in | 32,9 lbf·in | 45,3 lbf·in |
| M8 | 54,9 lbf·in | 64,9 lbf·in | 79,8 lbf·in | 109,8 lbf·in |
| M10 | 108,7 lbf·in | 128,4 lbf·in | 158,1 lbf·in | 217,4 lbf·in |
| M12 | 189,5 lbf·in | 224,0 lbf·in | 275,7 lbf·in | 379,0 lbf·in |
| M16 | 469,8 lbf·in | 555,2 lbf·in | 683,3 lbf·in | 939,6 lbf·in |

Dasselbe Drehmoment in lbf·ft:

| Gewinde | MoS2-Paste, K = 0,11 | Kupfer-Anti-Seize, K = 0,13 | Öl SAE 30, K = 0,16 | Trocken, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 0,24 lbf·ft | 0,28 lbf·ft | 0,34 lbf·ft | 0,47 lbf·ft |
| M4 | 0,55 lbf·ft | 0,65 lbf·ft | 0,80 lbf·ft | 1,10 lbf·ft |
| M5 | 1,11 lbf·ft | 1,31 lbf·ft | 1,61 lbf·ft | 2,22 lbf·ft |
| M6 | 1,89 lbf·ft | 2,23 lbf·ft | 2,74 lbf·ft | 3,77 lbf·ft |
| M8 | 4,57 lbf·ft | 5,41 lbf·ft | 6,65 lbf·ft | 9,15 lbf·ft |
| M10 | 9,06 lbf·ft | 10,70 lbf·ft | 13,17 lbf·ft | 18,11 lbf·ft |
| M12 | 15,79 lbf·ft | 18,66 lbf·ft | 22,97 lbf·ft | 31,59 lbf·ft |
| M16 | 39,15 lbf·ft | 46,27 lbf·ft | 56,94 lbf·ft | 78,30 lbf·ft |

Spannungsquerschnitt und Vorspannkraft sind auf 0,01 gerundet, das Drehmoment auf 0,1 N·m, 0,1 lbf·in und 0,01 lbf·ft. Die angloamerikanischen Werte sind aus dem ungerundeten Drehmoment umgerechnet.

### Annahmen und Warnhinweise

- Die Drehmomentwerte setzen glatte, gerollte 6g-Gewinde und einen kalibrierten digitalen Drehmomentschlüssel voraus.
- Werden Titan-Verbindungselemente in Gewindesacklöchern eingesetzt, prüfen Sie stets, dass die Bohrung frei von Kühlschmierstoff ist, bevor Sie die vorgeschriebene Anti-Seize-Paste auftragen.
- Kritischer Warnhinweis: Die Trockenmontage von Titangewinden führt unter Vorspannung zu starkem Kaltverschweißen und Gewindefressen. Schreiben Sie stets Ti-Paste oder MoS2 vor. Die Spalte „Trocken“ dient nur als Referenz und ist keine Empfehlung.
- Anti-Seize-Paste mit Molybdändisulfid (K = 0,11) ist der empfohlene Zustand.
- Die einzige Reserve in der Berechnung ist der Vorspanngrad: Ein weiterer Sicherheitsfaktor wird nicht angesetzt.

## Einschraubtiefe gegen Gewindeausreißen

### Was die Berechnung beantwortet

Wie groß ist die Mindestgewindetiefe in einem Gehäuse aus Aluminium, Magnesium, Titan oder Stahl, damit das Gewinde nicht ausreißt? Ein Konstrukteur braucht den Wert, wenn eine Titanschraube in eine Gewindebohrung eingeschraubt wird, vor allem in einem weicheren Grundwerkstoff wie Aluminium oder Magnesium: Die Tiefe muss ausreichen, damit die Schraube bricht, bevor das Gewinde der Bohrung ausreißt.

### Formel

- `Le = R × d`
- `n = Le ÷ p, aufgerundet auf den nächsten ganzen Gewindegang`

Die Formelzeichen bedeuten:

- `Le`: Mindesteinschraubtiefe, in mm;
- `R`: Einschraubverhältnis des Gehäusewerkstoffs, bezogen auf den Außendurchmesser;
- `d`: Gewindenenndurchmesser, in mm;
- `p`: Gewindesteigung, in mm;
- `n`: Mindestzahl tragender voller Gewindegänge.

### Konstanten

| Grundwerkstoff des Gehäuses | Einschraubverhältnis R | Faustregel aus der Konstruktionspraxis |
| --- | ---: | --- |
| Luftfahrtaluminium 6061-T6 / 7075-T6 | 1,8 | Die geringere Scherfestigkeit von Aluminium-Innengewinden erfordert etwa 1,8× Durchmesser, damit die Schraube sicher bricht, bevor das Gewinde der Bohrung ausreißt. |
| Magnesiumguss (AZ91D / ZE41) | 2,2 | Der weiche Magnesium-Grundwerkstoff erfordert eine größere Gewindetiefe von etwa 2,2× Durchmesser, um ein Ausreißen des Gewindes zu verhindern. |
| Titan Grade 5 (Ti-6Al-4V) | 1,2 | Die gleichwertige Scherfestigkeit erlaubt die Standard-Einschraubtiefe von 1,2× Durchmesser. |
| Hochfester Stahl 4140 / Inconel | 1,0 | Die hohe Scherfließgrenze erlaubt eine kompakte Einschraubtiefe von 1,0× Durchmesser. |

### Referenztabellen

Mindesteinschraubtiefe. Eingaben: jeder Gehäusewerkstoff mit seinem Verhältnis, Nenndurchmesser wie aufgeführt.

| Gewinde | Nenndurchmesser d | Aluminium, R = 1,8 | Magnesium, R = 2,2 | Titan Grade 5, R = 1,2 | Stahl, R = 1,0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 | 3,0 mm | 5,4 mm | 6,6 mm | 3,6 mm | 3,0 mm |
| M4 | 4,0 mm | 7,2 mm | 8,8 mm | 4,8 mm | 4,0 mm |
| M5 | 5,0 mm | 9,0 mm | 11,0 mm | 6,0 mm | 5,0 mm |
| M6 | 6,0 mm | 10,8 mm | 13,2 mm | 7,2 mm | 6,0 mm |
| M8 | 8,0 mm | 14,4 mm | 17,6 mm | 9,6 mm | 8,0 mm |
| M10 | 10,0 mm | 18,0 mm | 22,0 mm | 12,0 mm | 10,0 mm |
| M12 | 12,0 mm | 21,6 mm | 26,4 mm | 14,4 mm | 12,0 mm |
| M16 | 16,0 mm | 28,8 mm | 35,2 mm | 19,2 mm | 16,0 mm |

Mindestzahl tragender voller Gewindegänge. Eingaben: die Einschraubtiefen oben, geteilt durch die Regelgewindesteigung und aufgerundet.

| Gewinde | Steigung p | Aluminium, R = 1,8 | Magnesium, R = 2,2 | Titan Grade 5, R = 1,2 | Stahl, R = 1,0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 | 0,5 mm | 11 | 14 | 8 | 6 |
| M4 | 0,7 mm | 11 | 13 | 7 | 6 |
| M5 | 0,8 mm | 12 | 14 | 8 | 7 |
| M6 | 1,0 mm | 11 | 14 | 8 | 6 |
| M8 | 1,25 mm | 12 | 15 | 8 | 7 |
| M10 | 1,5 mm | 12 | 15 | 8 | 7 |
| M12 | 1,75 mm | 13 | 16 | 9 | 7 |
| M16 | 2,0 mm | 15 | 18 | 10 | 8 |

Die Einschraubtiefen sind auf 0,1 mm gerundet.

### Annahmen

- Die Tiefen sind so berechnet, dass Schrauben aus Titan Grade 5 ihre volle Zugtragfähigkeit erreichen, ohne dass das Innengewinde ausreißt.
- Die Verhältnisse sind Faustregeln aus der Konstruktionspraxis für jede Familie von Gehäusewerkstoffen. Sie sind nicht aus der Scherfestigkeit einer bestimmten Legierung oder eines bestimmten Werkstoffzustands abgeleitet.
- Die Gewindegangzahl verwendet die Regelgewindesteigung jeder Größe.

## Von der Berechnung zum Teil

Standardgrößen stehen im Katalog: [Zylinderschrauben mit Innensechskant](/de/collections/zylinderschrauben-mit-innensechskant), [Linsenkopfschrauben](/de/collections/linsenkopfschrauben), [Senkschrauben](/de/collections/senkschrauben), [Sechskantschrauben](/de/collections/sechskantschrauben) und [Passschrauben](/de/collections/passschrauben). Wenn die Einschraubtiefe eine Länge verlangt, die der Katalog nicht führt, fertigen wir sie auf Bestellung: siehe [Sonderanfertigung](/de/sonderanfertigung). Die Eigenschaften jeder Titansorte stehen im [Werkstoffleitfaden](/de/werkstoffleitfaden).
