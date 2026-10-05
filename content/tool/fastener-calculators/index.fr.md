---
title: Calculateurs techniques pour fixations en titane
description: Formules, constantes et tableaux de référence pour le gain de masse, le couple de serrage, la précharge et la profondeur en prise des fixations en titane.
slug: calculateurs-de-fixations
calculators: fasteners
---

Trois questions accompagnent presque toute fixation en titane : quelle masse le remplacement de l'acier fait gagner, quel couple de serrage donne la précharge voulue, et sur quelle profondeur le filetage doit être en prise dans le carter. Pour chacune, cette page donne la formule, toutes les constantes sur lesquelles elle repose et un tableau de résultats pour les dimensions métriques standard, afin que chaque valeur puisse être vérifiée à la main.

## Dimensions de filetage utilisées sur cette page

Les trois calculs utilisent le diamètre nominal et le pas gros de ces huit filetages métriques.

| Filetage | Diamètre nominal d | Pas p |
| --- | ---: | ---: |
| M3 | 3,0 mm | 0,5 mm |
| M4 | 4,0 mm | 0,7 mm |
| M5 | 5,0 mm | 0,8 mm |
| M6 | 6,0 mm | 1,0 mm |
| M8 | 8,0 mm | 1,25 mm |
| M10 | 10,0 mm | 1,5 mm |
| M12 | 12,0 mm | 1,75 mm |
| M16 | 16,0 mm | 2,0 mm |

## Réduction de masse du titane par rapport à l'acier

### À quoi il répond

De combien un ensemble s'allège-t-il lorsque ses fixations en acier à haute résistance sont remplacées par des fixations en titane grade 5 (Ti-6Al-4V) de même dimension ? Un ingénieur a besoin de ce chiffre pour boucler un bilan de masse, partout où chaque kilogramme a un coût. Le calcul exprime aussi le gain sous forme de coût de lancement, pour une pénalité typique de charge utile au lancement de 10 000 $ par kg.

### Formule

- `V = π × (d ÷ 2)² × L ÷ 1000 × H`
- `m = V × ρ`
- `M = m × N ÷ 1000`
- `gain = M du métal de référence − M du titane grade 5`
- `réduction (%) = (ρ du métal de référence − ρ du titane grade 5) ÷ ρ du métal de référence × 100`
- `équivalent en coût de lancement ($) = gain × 10 000`

Les symboles sont :

- `V` : volume d'une fixation, en cm³ ;
- `d` : diamètre nominal du filetage, en mm ;
- `L` : longueur de la fixation, en mm ;
- `H` : facteur de géométrie de tête, une majoration pour la tête qui s'ajoute au volume de la tige ;
- `ρ` : masse volumique du métal, en g/cm³ ;
- `m` : masse d'une fixation, en g ;
- `N` : nombre de fixations ;
- `M` : masse totale, en kg ;
- `gain` : masse retirée de l'ensemble, en kg.

### Constantes

| Constante | Valeur | Unité |
| --- | ---: | --- |
| Masse volumique de l'acier au carbone 10.9 (référence) | 7,85 | g/cm³ |
| Masse volumique de l'acier inoxydable 316 (référence) | 8,00 | g/cm³ |
| Masse volumique du titane grade 5 (Ti-6Al-4V) | 4,43 | g/cm³ |
| Masse volumique du titane grade 2 (commercialement pur) | 4,51 | g/cm³ |
| Masse volumique de l'aluminium aéronautique 7075-T6 | 2,81 | g/cm³ |
| Facteur de tête H, vis à tête cylindrique à six pans creux (cylindrique standard) | 1,25 | aucune |
| Facteur de tête H, vis à tête bombée (profil bas) | 1,15 | aucune |
| Facteur de tête H, tête fraisée plate à 90° | 1,10 | aucune |
| Facteur de tête H, vis lourde à tête hexagonale à embase | 1,35 | aucune |
| Pénalité de charge utile au lancement | 10 000 | $ par kg |
| Longueur L, plage acceptée | 6 à 150 | mm |
| Quantité N, plage acceptée | 1 à 50 000 | fixations |

### Tableaux de référence

Masse d'une fixation dans chaque métal. Données d'entrée : vis à tête cylindrique à six pans creux (H = 1,25), une fixation.

| Fixation | Acier au carbone 10.9 | Acier inoxydable 316 | Titane grade 5 | Titane grade 2 | Aluminium 7075-T6 |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 0,69 g | 0,71 g | 0,39 g | 0,40 g | 0,25 g |
| M4 × 12 mm | 1,48 g | 1,51 g | 0,84 g | 0,85 g | 0,53 g |
| M5 × 20 mm | 3,85 g | 3,93 g | 2,17 g | 2,21 g | 1,38 g |
| M6 × 30 mm | 8,32 g | 8,48 g | 4,70 g | 4,78 g | 2,98 g |
| M8 × 30 mm | 14,80 g | 15,08 g | 8,35 g | 8,50 g | 5,30 g |
| M10 × 40 mm | 30,83 g | 31,42 g | 17,40 g | 17,71 g | 11,03 g |
| M12 × 50 mm | 55,49 g | 56,55 g | 31,31 g | 31,88 g | 19,86 g |
| M16 × 60 mm | 118,38 g | 120,64 g | 66,80 g | 68,01 g | 42,37 g |

Masse de 100 fixations par rapport à l'acier au carbone. Données d'entrée : vis à tête cylindrique à six pans creux (H = 1,25), N = 100, référence acier au carbone 10.9 (7,85 g/cm³).

| Fixation | Acier au carbone 10.9 | Titane grade 5 | Masse gagnée | Réduction | Équivalent en coût de lancement |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 69,4 g | 39,1 g | 30,2 g | 43,6 % | 302 $ |
| M4 × 12 mm | 148,0 g | 83,5 g | 64,5 g | 43,6 % | 645 $ |
| M5 × 20 mm | 385,3 g | 217,5 g | 167,9 g | 43,6 % | 1 679 $ |
| M6 × 30 mm | 832,3 g | 469,7 g | 362,6 g | 43,6 % | 3 626 $ |
| M8 × 30 mm | 1,480 kg | 835,0 g | 644,7 g | 43,6 % | 6 447 $ |
| M10 × 40 mm | 3,083 kg | 1,740 kg | 1,343 kg | 43,6 % | 13 430 $ |
| M12 × 50 mm | 5,549 kg | 3,131 kg | 2,417 kg | 43,6 % | 24 175 $ |
| M16 × 60 mm | 11,838 kg | 6,680 kg | 5,157 kg | 43,6 % | 51 572 $ |

Masse de 100 fixations par rapport à l'acier inoxydable. Données d'entrée : vis à tête cylindrique à six pans creux (H = 1,25), N = 100, référence acier inoxydable 316 (8,00 g/cm³).

| Fixation | Acier inoxydable 316 | Titane grade 5 | Masse gagnée | Réduction | Équivalent en coût de lancement |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 70,7 g | 39,1 g | 31,5 g | 44,6 % | 315 $ |
| M4 × 12 mm | 150,8 g | 83,5 g | 67,3 g | 44,6 % | 673 $ |
| M5 × 20 mm | 392,7 g | 217,5 g | 175,2 g | 44,6 % | 1 752 $ |
| M6 × 30 mm | 848,2 g | 469,7 g | 378,5 g | 44,6 % | 3 785 $ |
| M8 × 30 mm | 1,508 kg | 835,0 g | 672,9 g | 44,6 % | 6 729 $ |
| M10 × 40 mm | 3,142 kg | 1,740 kg | 1,402 kg | 44,6 % | 14 019 $ |
| M12 × 50 mm | 5,655 kg | 3,131 kg | 2,523 kg | 44,6 % | 25 235 $ |
| M16 × 60 mm | 12,064 kg | 6,680 kg | 5,383 kg | 44,6 % | 53 834 $ |

Effet de la géométrie de tête. Données d'entrée : M6 × 30 mm, N = 100, référence acier au carbone 10.9 (7,85 g/cm³).

| Géométrie de tête | Facteur de tête H | Acier au carbone 10.9 | Titane grade 5 | Masse gagnée |
| --- | ---: | ---: | ---: | ---: |
| Vis à tête cylindrique à six pans creux | 1,25 | 832,3 g | 469,7 g | 362,6 g |
| Vis à tête bombée | 1,15 | 765,7 g | 432,1 g | 333,6 g |
| Tête fraisée plate à 90° | 1,10 | 732,4 g | 413,3 g | 319,1 g |
| Vis lourde à tête hexagonale à embase | 1,35 | 898,9 g | 507,3 g | 391,6 g |

Les masses d'une fixation sont arrondies à 0,01 g. Les totaux inférieurs à 1 kg sont donnés en grammes à 0,1 g près, les totaux à partir de 1 kg en kilogrammes à 0,001 kg près. Chaque valeur est arrondie séparément, de sorte que la différence entre deux totaux affichés peut s'écarter du gain affiché sur le dernier chiffre.

### Hypothèses

- La fixation est assimilée à un cylindre plein au diamètre nominal du filetage sur toute sa longueur. La tête est un facteur de majoration appliqué à ce volume (25 % pour une vis à tête cylindrique à six pans creux), et non une tête mesurée. La forme du filet et l'empreinte ne font pas partie du modèle.
- La réduction en pourcentage ne dépend que des deux masses volumiques ; elle est donc la même pour toutes les dimensions : 43,6 % par rapport à l'acier au carbone 10.9 et 44,6 % par rapport à l'acier inoxydable 316.
- L'équivalent en coût de lancement multiplie le gain par une pénalité typique de charge utile au lancement. C'est une indication pour les lanceurs et les engins spatiaux, pas un prix.
- Les masses sont des estimations destinées à comparer les métaux. Ce ne sont pas des poids de catalogue.

## Couple de serrage et précharge

### À quoi il répond

Quel couple de serrage amène une fixation en titane à la précharge voulue, compte tenu du lubrifiant présent sur ses filets ? Un ingénieur a besoin de ce chiffre pour inscrire un couple de montage sur un plan ou dans une instruction de travail. Le lubrifiant change la réponse : la pâte antigrippante abaisse le facteur d'écrou, et le couple doit donc être abaissé d'autant pour éviter un serrage excessif.

### Formule

- `As = 0,7854 × (d − 0,9382 × p)²`
- `σ = Sy × P ÷ 100`
- `Fi = As × σ ÷ 1000`
- `T = K × Fi × d`
- `T en lbf·in = T × 8,8507`
- `T en lbf·ft = T × 0,73756`

Les symboles sont :

- `As` : section résistante du filetage, en mm² ;
- `d` : diamètre nominal du filetage, en mm ;
- `p` : pas du filetage, en mm ;
- `Sy` : limite d'élasticité de la nuance de titane, en MPa (N/mm²) ;
- `P` : pourcentage de précharge, la part de la limite d'élasticité à laquelle la fixation est serrée ;
- `σ` : contrainte visée dans la fixation, en MPa ;
- `Fi` : précharge de serrage induite, en kN ;
- `K` : facteur d'écrou (coefficient de couple) de l'état de lubrification, sans unité ;
- `T` : couple de serrage, en N·m. Avec `Fi` en kN et `d` en mm, le produit est directement en N·m.

### Constantes

| Constante | Valeur | Unité |
| --- | ---: | --- |
| Limite d'élasticité Sy, titane grade 5 | 828 | MPa |
| Limite d'élasticité Sy, titane grade 2 commercialement pur | 275 | MPa |
| Facteur d'écrou K, pâte antigrippante au bisulfure de molybdène (MoS2) (recommandée) | 0,11 | aucune |
| Facteur d'écrou K, composé antigrippant à base de cuivre | 0,13 | aucune |
| Facteur d'écrou K, huile de machine légère SAE 30 | 0,16 | aucune |
| Facteur d'écrou K, à sec / état de livraison (risque élevé de grippage) | 0,22 | aucune |
| Pourcentage de précharge P, valeur par défaut | 70 | % de la limite d'élasticité |
| Pourcentage de précharge P, valeurs minimale et maximale acceptées | 50 et 85 | % de la limite d'élasticité |
| Coefficient de la section résistante | 0,7854 | aucune |
| Coefficient de pas de la section résistante | 0,9382 | aucune |
| Conversion, N·m en lbf·in | 8,8507 | lbf·in par N·m |
| Conversion, N·m en lbf·ft | 0,73756 | lbf·ft par N·m |

### Tableaux de référence pour le titane grade 5

Données d'entrée des trois tableaux : titane grade 5 (Sy = 828 MPa), pourcentage de précharge P = 70 %, soit une contrainte visée de 579,6 MPa ; pas gros tel qu'indiqué.

Couple en N·m, avec la section résistante et la précharge qu'il produit :

| Filetage | Pas p | Section résistante As | Précharge Fi | Pâte MoS2, K = 0,11 | Antigrippant cuivre, K = 0,13 | Huile SAE 30, K = 0,16 | À sec, K = 0,22 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M3 | 0,5 mm | 5,03 mm² | 2,92 kN | 1,0 N·m | 1,1 N·m | 1,4 N·m | 1,9 N·m |
| M4 | 0,7 mm | 8,78 mm² | 5,09 kN | 2,2 N·m | 2,6 N·m | 3,3 N·m | 4,5 N·m |
| M5 | 0,8 mm | 14,18 mm² | 8,22 kN | 4,5 N·m | 5,3 N·m | 6,6 N·m | 9,0 N·m |
| M6 | 1,0 mm | 20,12 mm² | 11,66 kN | 7,7 N·m | 9,1 N·m | 11,2 N·m | 15,4 N·m |
| M8 | 1,25 mm | 36,61 mm² | 21,22 kN | 18,7 N·m | 22,1 N·m | 27,2 N·m | 37,3 N·m |
| M10 | 1,5 mm | 57,99 mm² | 33,61 kN | 37,0 N·m | 43,7 N·m | 53,8 N·m | 73,9 N·m |
| M12 | 1,75 mm | 84,27 mm² | 48,84 kN | 64,5 N·m | 76,2 N·m | 93,8 N·m | 128,9 N·m |
| M16 | 2,0 mm | 156,67 mm² | 90,81 kN | 159,8 N·m | 188,9 N·m | 232,5 N·m | 319,6 N·m |

Le même couple en lbf·in :

| Filetage | Pâte MoS2, K = 0,11 | Antigrippant cuivre, K = 0,13 | Huile SAE 30, K = 0,16 | À sec, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 8,5 lbf·in | 10,1 lbf·in | 12,4 lbf·in | 17,0 lbf·in |
| M4 | 19,8 lbf·in | 23,4 lbf·in | 28,8 lbf·in | 39,6 lbf·in |
| M5 | 40,0 lbf·in | 47,3 lbf·in | 58,2 lbf·in | 80,0 lbf·in |
| M6 | 68,1 lbf·in | 80,5 lbf·in | 99,1 lbf·in | 136,3 lbf·in |
| M8 | 165,3 lbf·in | 195,3 lbf·in | 240,4 lbf·in | 330,5 lbf·in |
| M10 | 327,2 lbf·in | 386,7 lbf·in | 476,0 lbf·in | 654,5 lbf·in |
| M12 | 570,6 lbf·in | 674,4 lbf·in | 830,0 lbf·in | 1141,2 lbf·in |
| M16 | 1414,5 lbf·in | 1671,7 lbf·in | 2057,4 lbf·in | 2829,0 lbf·in |

Le même couple en lbf·ft :

| Filetage | Pâte MoS2, K = 0,11 | Antigrippant cuivre, K = 0,13 | Huile SAE 30, K = 0,16 | À sec, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 0,71 lbf·ft | 0,84 lbf·ft | 1,03 lbf·ft | 1,42 lbf·ft |
| M4 | 1,65 lbf·ft | 1,95 lbf·ft | 2,40 lbf·ft | 3,30 lbf·ft |
| M5 | 3,33 lbf·ft | 3,94 lbf·ft | 4,85 lbf·ft | 6,67 lbf·ft |
| M6 | 5,68 lbf·ft | 6,71 lbf·ft | 8,26 lbf·ft | 11,36 lbf·ft |
| M8 | 13,77 lbf·ft | 16,28 lbf·ft | 20,03 lbf·ft | 27,54 lbf·ft |
| M10 | 27,27 lbf·ft | 32,23 lbf·ft | 39,66 lbf·ft | 54,54 lbf·ft |
| M12 | 47,55 lbf·ft | 56,20 lbf·ft | 69,16 lbf·ft | 95,10 lbf·ft |
| M16 | 117,87 lbf·ft | 139,31 lbf·ft | 171,45 lbf·ft | 235,75 lbf·ft |

### Tableaux de référence pour le titane grade 2

Données d'entrée des trois tableaux : titane grade 2 commercialement pur (Sy = 275 MPa), pourcentage de précharge P = 70 %, soit une contrainte visée de 192,5 MPa ; pas gros tel qu'indiqué.

Couple en N·m, avec la section résistante et la précharge qu'il produit :

| Filetage | Pas p | Section résistante As | Précharge Fi | Pâte MoS2, K = 0,11 | Antigrippant cuivre, K = 0,13 | Huile SAE 30, K = 0,16 | À sec, K = 0,22 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M3 | 0,5 mm | 5,03 mm² | 0,97 kN | 0,3 N·m | 0,4 N·m | 0,5 N·m | 0,6 N·m |
| M4 | 0,7 mm | 8,78 mm² | 1,69 kN | 0,7 N·m | 0,9 N·m | 1,1 N·m | 1,5 N·m |
| M5 | 0,8 mm | 14,18 mm² | 2,73 kN | 1,5 N·m | 1,8 N·m | 2,2 N·m | 3,0 N·m |
| M6 | 1,0 mm | 20,12 mm² | 3,87 kN | 2,6 N·m | 3,0 N·m | 3,7 N·m | 5,1 N·m |
| M8 | 1,25 mm | 36,61 mm² | 7,05 kN | 6,2 N·m | 7,3 N·m | 9,0 N·m | 12,4 N·m |
| M10 | 1,5 mm | 57,99 mm² | 11,16 kN | 12,3 N·m | 14,5 N·m | 17,9 N·m | 24,6 N·m |
| M12 | 1,75 mm | 84,27 mm² | 16,22 kN | 21,4 N·m | 25,3 N·m | 31,1 N·m | 42,8 N·m |
| M16 | 2,0 mm | 156,67 mm² | 30,16 kN | 53,1 N·m | 62,7 N·m | 77,2 N·m | 106,2 N·m |

Le même couple en lbf·in :

| Filetage | Pâte MoS2, K = 0,11 | Antigrippant cuivre, K = 0,13 | Huile SAE 30, K = 0,16 | À sec, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 2,8 lbf·in | 3,3 lbf·in | 4,1 lbf·in | 5,7 lbf·in |
| M4 | 6,6 lbf·in | 7,8 lbf·in | 9,6 lbf·in | 13,2 lbf·in |
| M5 | 13,3 lbf·in | 15,7 lbf·in | 19,3 lbf·in | 26,6 lbf·in |
| M6 | 22,6 lbf·in | 26,7 lbf·in | 32,9 lbf·in | 45,3 lbf·in |
| M8 | 54,9 lbf·in | 64,9 lbf·in | 79,8 lbf·in | 109,8 lbf·in |
| M10 | 108,7 lbf·in | 128,4 lbf·in | 158,1 lbf·in | 217,4 lbf·in |
| M12 | 189,5 lbf·in | 224,0 lbf·in | 275,7 lbf·in | 379,0 lbf·in |
| M16 | 469,8 lbf·in | 555,2 lbf·in | 683,3 lbf·in | 939,6 lbf·in |

Le même couple en lbf·ft :

| Filetage | Pâte MoS2, K = 0,11 | Antigrippant cuivre, K = 0,13 | Huile SAE 30, K = 0,16 | À sec, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 0,24 lbf·ft | 0,28 lbf·ft | 0,34 lbf·ft | 0,47 lbf·ft |
| M4 | 0,55 lbf·ft | 0,65 lbf·ft | 0,80 lbf·ft | 1,10 lbf·ft |
| M5 | 1,11 lbf·ft | 1,31 lbf·ft | 1,61 lbf·ft | 2,22 lbf·ft |
| M6 | 1,89 lbf·ft | 2,23 lbf·ft | 2,74 lbf·ft | 3,77 lbf·ft |
| M8 | 4,57 lbf·ft | 5,41 lbf·ft | 6,65 lbf·ft | 9,15 lbf·ft |
| M10 | 9,06 lbf·ft | 10,70 lbf·ft | 13,17 lbf·ft | 18,11 lbf·ft |
| M12 | 15,79 lbf·ft | 18,66 lbf·ft | 22,97 lbf·ft | 31,59 lbf·ft |
| M16 | 39,15 lbf·ft | 46,27 lbf·ft | 56,94 lbf·ft | 78,30 lbf·ft |

La section résistante et la précharge sont arrondies à 0,01, le couple à 0,1 N·m, 0,1 lbf·in et 0,01 lbf·ft. Les valeurs impériales sont converties à partir du couple non arrondi.

### Hypothèses et avertissements

- Les valeurs de couple supposent des filets roulés 6g lisses et une clé dynamométrique numérique étalonnée.
- Si des fixations en titane sont utilisées dans des trous taraudés borgnes, vérifiez toujours que le trou est exempt de fluide de coupe avant d'appliquer la pâte antigrippante spécifiée.
- Avertissement critique : le montage à sec de filetages en titane entraîne un soudage à froid sévère et un grippage des filets sous précharge. Spécifiez toujours une pâte pour titane ou du MoS2. La colonne « à sec » figure à titre de référence et ne constitue pas une recommandation.
- La pâte antigrippante au bisulfure de molybdène (K = 0,11) est l'état de lubrification recommandé.
- La seule marge du calcul est le pourcentage de précharge : aucun autre coefficient de sécurité n'est appliqué.

## Profondeur de filetage en prise au cisaillement

### À quoi il répond

Quelle est la profondeur minimale de filetage taraudé dans un carter en aluminium, en magnésium, en titane ou en acier pour que le filetage ne s'arrache pas ? Un ingénieur a besoin de ce chiffre lorsqu'une vis en titane est vissée dans un trou taraudé, surtout dans un matériau support plus tendre tel que l'aluminium ou le magnésium : la profondeur doit être suffisante pour que la vis casse avant que le taraudage ne s'arrache.

### Formule

- `Le = R × d`
- `n = Le ÷ p, arrondi au filet entier supérieur`

Les symboles sont :

- `Le` : longueur minimale de filetage en prise, en mm ;
- `R` : rapport de prise du matériau du carter, rapporté au diamètre extérieur du filetage ;
- `d` : diamètre nominal du filetage, en mm ;
- `p` : pas du filetage, en mm ;
- `n` : nombre minimal de filets complets en prise.

### Constantes

| Matériau du carter | Rapport de prise R | Règle pratique d'ingénierie |
| --- | ---: | --- |
| Aluminium aéronautique 6061-T6 / 7075-T6 | 1,8 | La résistance au cisaillement plus faible des filets femelles en aluminium exige environ 1,8× le diamètre pour garantir que la vis casse avant que le taraudage ne s'arrache. |
| Fonderie de magnésium (AZ91D / ZE41) | 2,2 | Le magnésium, matériau de base tendre, exige une profondeur de taraudage plus importante, d'environ 2,2× le diamètre, pour éviter l'arrachement des filets. |
| Titane grade 5 (Ti-6Al-4V) | 1,2 | Des résistances au cisaillement équivalentes autorisent la profondeur en prise standard de 1,2× le diamètre. |
| Acier 4140 à haute résistance / Inconel | 1,0 | Une limite d'élasticité en cisaillement élevée autorise une prise de filetage compacte de 1,0× le diamètre. |

### Tableaux de référence

Longueur minimale de filetage en prise. Données d'entrée : chaque matériau de carter avec son rapport, diamètre nominal tel qu'indiqué.

| Filetage | Diamètre nominal d | Aluminium, R = 1,8 | Magnésium, R = 2,2 | Titane grade 5, R = 1,2 | Acier, R = 1,0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 | 3,0 mm | 5,4 mm | 6,6 mm | 3,6 mm | 3,0 mm |
| M4 | 4,0 mm | 7,2 mm | 8,8 mm | 4,8 mm | 4,0 mm |
| M5 | 5,0 mm | 9,0 mm | 11,0 mm | 6,0 mm | 5,0 mm |
| M6 | 6,0 mm | 10,8 mm | 13,2 mm | 7,2 mm | 6,0 mm |
| M8 | 8,0 mm | 14,4 mm | 17,6 mm | 9,6 mm | 8,0 mm |
| M10 | 10,0 mm | 18,0 mm | 22,0 mm | 12,0 mm | 10,0 mm |
| M12 | 12,0 mm | 21,6 mm | 26,4 mm | 14,4 mm | 12,0 mm |
| M16 | 16,0 mm | 28,8 mm | 35,2 mm | 19,2 mm | 16,0 mm |

Nombre minimal de filets complets en prise. Données d'entrée : les longueurs en prise ci-dessus, divisées par le pas gros et arrondies à l'entier supérieur.

| Filetage | Pas p | Aluminium, R = 1,8 | Magnésium, R = 2,2 | Titane grade 5, R = 1,2 | Acier, R = 1,0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 | 0,5 mm | 11 | 14 | 8 | 6 |
| M4 | 0,7 mm | 11 | 13 | 7 | 6 |
| M5 | 0,8 mm | 12 | 14 | 8 | 7 |
| M6 | 1,0 mm | 11 | 14 | 8 | 6 |
| M8 | 1,25 mm | 12 | 15 | 8 | 7 |
| M10 | 1,5 mm | 12 | 15 | 8 | 7 |
| M12 | 1,75 mm | 13 | 16 | 9 | 7 |
| M16 | 2,0 mm | 15 | 18 | 10 | 8 |

Les longueurs en prise sont arrondies à 0,1 mm.

### Hypothèses

- Les profondeurs sont calculées pour que les vis en titane grade 5 développent toute leur résistance à la traction sans arracher les filets taraudés.
- Les rapports sont des règles pratiques d'ingénierie pour chaque famille de matériau de carter. Ils ne sont pas déduits de la résistance au cisaillement d'un alliage ou d'un état métallurgique particulier.
- Le nombre de filets utilise le pas gros de chaque dimension.

## Du calcul à la pièce

Les dimensions standard figurent au catalogue : [vis à tête cylindrique à six pans creux](/fr/collections/vis-a-tete-cylindrique-six-pans-creux), [vis à tête bombée](/fr/collections/vis-a-tete-bombee), [vis à tête fraisée](/fr/collections/vis-a-tete-fraisee), [vis à tête hexagonale](/fr/collections/vis-a-tete-hexagonale) et [vis à épaulement](/fr/collections/vis-a-epaulement). Lorsque la profondeur en prise exige une longueur que le catalogue ne propose pas, nous la réalisons sur commande : voir [fabrication sur mesure](/fr/fabrication-sur-mesure). Les propriétés de chaque nuance de titane figurent dans le [guide des matériaux](/fr/guide-des-materiaux).
