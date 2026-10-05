---
title: Calculadoras de ingeniería para fijaciones de titanio
description: "Fórmulas, constantes y tablas de referencia para fijaciones de titanio: reducción de masa, par de apriete y precarga, y profundidad de rosca acoplada."
slug: calculadoras-de-fijaciones
---

Casi toda fijación de titanio viene acompañada de tres preguntas: cuánta masa elimina el cambio desde el acero, qué par de apriete proporciona la precarga prevista y qué profundidad debe acoplar la rosca en la carcasa. Para cada una, esta página ofrece la fórmula, todas las constantes en que se basa y una tabla de resultados para las medidas métricas estándar, de modo que cualquier valor pueda comprobarse a mano.

## Medidas de rosca utilizadas en esta página

Los tres cálculos utilizan el diámetro nominal y el paso grueso de estas ocho roscas métricas.

| Rosca | Diámetro nominal d | Paso p |
| --- | ---: | ---: |
| M3 | 3,0 mm | 0,5 mm |
| M4 | 4,0 mm | 0,7 mm |
| M5 | 5,0 mm | 0,8 mm |
| M6 | 6,0 mm | 1,0 mm |
| M8 | 8,0 mm | 1,25 mm |
| M10 | 10,0 mm | 1,5 mm |
| M12 | 12,0 mm | 1,75 mm |
| M16 | 16,0 mm | 2,0 mm |

## Reducción de masa del titanio frente al acero

### A qué responde

¿Cuánto más ligero queda un conjunto cuando sus fijaciones de acero de alta resistencia se sustituyen por fijaciones de titanio grado 5 (Ti-6Al-4V) de la misma medida? Un ingeniero necesita el dato al cerrar un presupuesto de masa, allí donde cada kilogramo tiene un coste. El cálculo expresa además el ahorro como coste de lanzamiento, con una penalización típica por carga útil en el lanzamiento de 10.000 $ por kg.

### Fórmula

- `V = π × (d ÷ 2)² × L ÷ 1000 × H`
- `m = V × ρ`
- `M = m × N ÷ 1000`
- `ahorro = M del metal de referencia − M del titanio grado 5`
- `reducción (%) = (ρ del metal de referencia − ρ del titanio grado 5) ÷ ρ del metal de referencia × 100`
- `coste de lanzamiento equivalente ($) = ahorro × 10.000`

Los símbolos son:

- `V`: volumen de una fijación, en cm³;
- `d`: diámetro nominal de la rosca, en mm;
- `L`: longitud de la fijación, en mm;
- `H`: factor de geometría de la cabeza, un suplemento por la cabeza que se añade al volumen de la caña;
- `ρ`: densidad del metal, en g/cm³;
- `m`: masa de una fijación, en g;
- `N`: número de fijaciones;
- `M`: masa total, en kg;
- `ahorro`: masa eliminada del conjunto, en kg.

### Constantes

| Constante | Valor | Unidad |
| --- | ---: | --- |
| Densidad del acero al carbono 10.9 (referencia) | 7,85 | g/cm³ |
| Densidad del acero inoxidable 316 (referencia) | 8,00 | g/cm³ |
| Densidad del titanio grado 5 (Ti-6Al-4V) | 4,43 | g/cm³ |
| Densidad del titanio grado 2 (comercialmente puro) | 4,51 | g/cm³ |
| Densidad del aluminio aeroespacial 7075-T6 | 2,81 | g/cm³ |
| Factor de cabeza H, tornillo de cabeza cilíndrica Allen (cilíndrica estándar) | 1,25 | ninguna |
| Factor de cabeza H, tornillo de cabeza abombada (perfil bajo) | 1,15 | ninguna |
| Factor de cabeza H, cabeza avellanada plana de 90° | 1,10 | ninguna |
| Factor de cabeza H, tornillo pesado de cabeza hexagonal con brida | 1,35 | ninguna |
| Penalización por carga útil en el lanzamiento | 10.000 | $ por kg |
| Longitud L, intervalo admitido | de 6 a 150 | mm |
| Cantidad N, intervalo admitido | de 1 a 50.000 | fijaciones |

### Tablas de referencia

Masa de una fijación en cada metal. Datos de entrada: tornillo de cabeza cilíndrica Allen (H = 1,25), una fijación.

| Fijación | Acero al carbono 10.9 | Acero inoxidable 316 | Titanio grado 5 | Titanio grado 2 | Aluminio 7075-T6 |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 0,69 g | 0,71 g | 0,39 g | 0,40 g | 0,25 g |
| M4 × 12 mm | 1,48 g | 1,51 g | 0,84 g | 0,85 g | 0,53 g |
| M5 × 20 mm | 3,85 g | 3,93 g | 2,17 g | 2,21 g | 1,38 g |
| M6 × 30 mm | 8,32 g | 8,48 g | 4,70 g | 4,78 g | 2,98 g |
| M8 × 30 mm | 14,80 g | 15,08 g | 8,35 g | 8,50 g | 5,30 g |
| M10 × 40 mm | 30,83 g | 31,42 g | 17,40 g | 17,71 g | 11,03 g |
| M12 × 50 mm | 55,49 g | 56,55 g | 31,31 g | 31,88 g | 19,86 g |
| M16 × 60 mm | 118,38 g | 120,64 g | 66,80 g | 68,01 g | 42,37 g |

Masa de 100 fijaciones frente al acero al carbono. Datos de entrada: tornillo de cabeza cilíndrica Allen (H = 1,25), N = 100, referencia acero al carbono 10.9 (7,85 g/cm³).

| Fijación | Acero al carbono 10.9 | Titanio grado 5 | Masa ahorrada | Reducción | Coste de lanzamiento equivalente |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 69,4 g | 39,1 g | 30,2 g | 43,6 % | 302 $ |
| M4 × 12 mm | 148,0 g | 83,5 g | 64,5 g | 43,6 % | 645 $ |
| M5 × 20 mm | 385,3 g | 217,5 g | 167,9 g | 43,6 % | 1.679 $ |
| M6 × 30 mm | 832,3 g | 469,7 g | 362,6 g | 43,6 % | 3.626 $ |
| M8 × 30 mm | 1,480 kg | 835,0 g | 644,7 g | 43,6 % | 6.447 $ |
| M10 × 40 mm | 3,083 kg | 1,740 kg | 1,343 kg | 43,6 % | 13.430 $ |
| M12 × 50 mm | 5,549 kg | 3,131 kg | 2,417 kg | 43,6 % | 24.175 $ |
| M16 × 60 mm | 11,838 kg | 6,680 kg | 5,157 kg | 43,6 % | 51.572 $ |

Masa de 100 fijaciones frente al acero inoxidable. Datos de entrada: tornillo de cabeza cilíndrica Allen (H = 1,25), N = 100, referencia acero inoxidable 316 (8,00 g/cm³).

| Fijación | Acero inoxidable 316 | Titanio grado 5 | Masa ahorrada | Reducción | Coste de lanzamiento equivalente |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 70,7 g | 39,1 g | 31,5 g | 44,6 % | 315 $ |
| M4 × 12 mm | 150,8 g | 83,5 g | 67,3 g | 44,6 % | 673 $ |
| M5 × 20 mm | 392,7 g | 217,5 g | 175,2 g | 44,6 % | 1.752 $ |
| M6 × 30 mm | 848,2 g | 469,7 g | 378,5 g | 44,6 % | 3.785 $ |
| M8 × 30 mm | 1,508 kg | 835,0 g | 672,9 g | 44,6 % | 6.729 $ |
| M10 × 40 mm | 3,142 kg | 1,740 kg | 1,402 kg | 44,6 % | 14.019 $ |
| M12 × 50 mm | 5,655 kg | 3,131 kg | 2,523 kg | 44,6 % | 25.235 $ |
| M16 × 60 mm | 12,064 kg | 6,680 kg | 5,383 kg | 44,6 % | 53.834 $ |

Efecto de la geometría de la cabeza. Datos de entrada: M6 × 30 mm, N = 100, referencia acero al carbono 10.9 (7,85 g/cm³).

| Geometría de la cabeza | Factor de cabeza H | Acero al carbono 10.9 | Titanio grado 5 | Masa ahorrada |
| --- | ---: | ---: | ---: | ---: |
| Tornillo de cabeza cilíndrica Allen | 1,25 | 832,3 g | 469,7 g | 362,6 g |
| Tornillo de cabeza abombada | 1,15 | 765,7 g | 432,1 g | 333,6 g |
| Cabeza avellanada plana de 90° | 1,10 | 732,4 g | 413,3 g | 319,1 g |
| Tornillo pesado de cabeza hexagonal con brida | 1,35 | 898,9 g | 507,3 g | 391,6 g |

Las masas de una fijación se redondean a 0,01 g. Los totales inferiores a 1 kg se dan en gramos con precisión de 0,1 g y los totales a partir de 1 kg, en kilogramos con precisión de 0,001 kg. Cada valor se redondea por separado, de modo que la diferencia entre dos totales impresos puede diferir del ahorro impreso en la última cifra.

### Supuestos

- La fijación se trata como un cilindro liso del diámetro nominal de la rosca en toda su longitud. La cabeza es un factor de suplemento sobre ese volumen (un 25 % para un tornillo de cabeza cilíndrica Allen), no una cabeza medida. La forma de la rosca y el hueco de accionamiento no forman parte del modelo.
- La reducción porcentual depende solo de las dos densidades, por lo que es la misma para todas las medidas: un 43,6 % frente al acero al carbono 10.9 y un 44,6 % frente al acero inoxidable 316.
- El coste de lanzamiento equivalente multiplica el ahorro por una penalización típica por carga útil en el lanzamiento. Es una indicación para vehículos de lanzamiento y vehículos espaciales, no un precio.
- Las masas son estimaciones para comparar metales. No son pesos de catálogo.

## Par de apriete y precarga

### A qué responde

¿Qué par de apriete lleva una fijación de titanio a la precarga prevista, según el lubricante de sus roscas? Un ingeniero necesita el dato al anotar un par de montaje en un plano o en una instrucción de trabajo. El lubricante cambia la respuesta: la pasta antigripante reduce el factor de tuerca, por lo que el par debe reducirse con él para evitar una tensión excesiva.

### Fórmula

- `As = 0,7854 × (d − 0,9382 × p)²`
- `σ = Sy × P ÷ 100`
- `Fi = As × σ ÷ 1000`
- `T = K × Fi × d`
- `T en lbf·in = T × 8,8507`
- `T en lbf·ft = T × 0,73756`

Los símbolos son:

- `As`: sección resistente a tracción de la rosca, en mm²;
- `d`: diámetro nominal de la rosca, en mm;
- `p`: paso de la rosca, en mm;
- `Sy`: límite elástico del grado de titanio, en MPa (N/mm²);
- `P`: porcentaje de precarga, la fracción del límite elástico hasta la que se aprieta la fijación;
- `σ`: tensión objetivo en la fijación, en MPa;
- `Fi`: precarga de apriete inducida, en kN;
- `K`: factor de tuerca (coeficiente de par) de la condición de lubricación, sin unidad;
- `T`: par de apriete, en N·m. Con `Fi` en kN y `d` en mm, el producto queda directamente en N·m.

### Constantes

| Constante | Valor | Unidad |
| --- | ---: | --- |
| Límite elástico Sy, titanio grado 5 | 828 | MPa |
| Límite elástico Sy, titanio grado 2 comercialmente puro | 275 | MPa |
| Factor de tuerca K, pasta antigripante de disulfuro de molibdeno (MoS2) (recomendada) | 0,11 | ninguna |
| Factor de tuerca K, compuesto antigripante a base de cobre | 0,13 | ninguna |
| Factor de tuerca K, aceite ligero de máquinas SAE 30 | 0,16 | ninguna |
| Factor de tuerca K, en seco / tal como se recibe (alto riesgo de gripado) | 0,22 | ninguna |
| Porcentaje de precarga P, valor por defecto | 70 | % del límite elástico |
| Porcentaje de precarga P, mínimo y máximo admitidos | 50 y 85 | % del límite elástico |
| Coeficiente de la sección resistente | 0,7854 | ninguna |
| Coeficiente de paso de la sección resistente | 0,9382 | ninguna |
| Conversión, de N·m a lbf·in | 8,8507 | lbf·in por N·m |
| Conversión, de N·m a lbf·ft | 0,73756 | lbf·ft por N·m |

### Tablas de referencia para el titanio grado 5

Datos de entrada para las tres tablas: titanio grado 5 (Sy = 828 MPa), porcentaje de precarga P = 70 %, es decir, una tensión objetivo de 579,6 MPa; paso grueso según la lista.

Par en N·m, con la sección resistente y la precarga que produce:

| Rosca | Paso p | Sección resistente As | Precarga Fi | Pasta de MoS2, K = 0,11 | Antigripante de cobre, K = 0,13 | Aceite SAE 30, K = 0,16 | En seco, K = 0,22 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M3 | 0,5 mm | 5,03 mm² | 2,92 kN | 1,0 N·m | 1,1 N·m | 1,4 N·m | 1,9 N·m |
| M4 | 0,7 mm | 8,78 mm² | 5,09 kN | 2,2 N·m | 2,6 N·m | 3,3 N·m | 4,5 N·m |
| M5 | 0,8 mm | 14,18 mm² | 8,22 kN | 4,5 N·m | 5,3 N·m | 6,6 N·m | 9,0 N·m |
| M6 | 1,0 mm | 20,12 mm² | 11,66 kN | 7,7 N·m | 9,1 N·m | 11,2 N·m | 15,4 N·m |
| M8 | 1,25 mm | 36,61 mm² | 21,22 kN | 18,7 N·m | 22,1 N·m | 27,2 N·m | 37,3 N·m |
| M10 | 1,5 mm | 57,99 mm² | 33,61 kN | 37,0 N·m | 43,7 N·m | 53,8 N·m | 73,9 N·m |
| M12 | 1,75 mm | 84,27 mm² | 48,84 kN | 64,5 N·m | 76,2 N·m | 93,8 N·m | 128,9 N·m |
| M16 | 2,0 mm | 156,67 mm² | 90,81 kN | 159,8 N·m | 188,9 N·m | 232,5 N·m | 319,6 N·m |

El mismo par en lbf·in:

| Rosca | Pasta de MoS2, K = 0,11 | Antigripante de cobre, K = 0,13 | Aceite SAE 30, K = 0,16 | En seco, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 8,5 lbf·in | 10,1 lbf·in | 12,4 lbf·in | 17,0 lbf·in |
| M4 | 19,8 lbf·in | 23,4 lbf·in | 28,8 lbf·in | 39,6 lbf·in |
| M5 | 40,0 lbf·in | 47,3 lbf·in | 58,2 lbf·in | 80,0 lbf·in |
| M6 | 68,1 lbf·in | 80,5 lbf·in | 99,1 lbf·in | 136,3 lbf·in |
| M8 | 165,3 lbf·in | 195,3 lbf·in | 240,4 lbf·in | 330,5 lbf·in |
| M10 | 327,2 lbf·in | 386,7 lbf·in | 476,0 lbf·in | 654,5 lbf·in |
| M12 | 570,6 lbf·in | 674,4 lbf·in | 830,0 lbf·in | 1141,2 lbf·in |
| M16 | 1414,5 lbf·in | 1671,7 lbf·in | 2057,4 lbf·in | 2829,0 lbf·in |

El mismo par en lbf·ft:

| Rosca | Pasta de MoS2, K = 0,11 | Antigripante de cobre, K = 0,13 | Aceite SAE 30, K = 0,16 | En seco, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 0,71 lbf·ft | 0,84 lbf·ft | 1,03 lbf·ft | 1,42 lbf·ft |
| M4 | 1,65 lbf·ft | 1,95 lbf·ft | 2,40 lbf·ft | 3,30 lbf·ft |
| M5 | 3,33 lbf·ft | 3,94 lbf·ft | 4,85 lbf·ft | 6,67 lbf·ft |
| M6 | 5,68 lbf·ft | 6,71 lbf·ft | 8,26 lbf·ft | 11,36 lbf·ft |
| M8 | 13,77 lbf·ft | 16,28 lbf·ft | 20,03 lbf·ft | 27,54 lbf·ft |
| M10 | 27,27 lbf·ft | 32,23 lbf·ft | 39,66 lbf·ft | 54,54 lbf·ft |
| M12 | 47,55 lbf·ft | 56,20 lbf·ft | 69,16 lbf·ft | 95,10 lbf·ft |
| M16 | 117,87 lbf·ft | 139,31 lbf·ft | 171,45 lbf·ft | 235,75 lbf·ft |

### Tablas de referencia para el titanio grado 2

Datos de entrada para las tres tablas: titanio grado 2 comercialmente puro (Sy = 275 MPa), porcentaje de precarga P = 70 %, es decir, una tensión objetivo de 192,5 MPa; paso grueso según la lista.

Par en N·m, con la sección resistente y la precarga que produce:

| Rosca | Paso p | Sección resistente As | Precarga Fi | Pasta de MoS2, K = 0,11 | Antigripante de cobre, K = 0,13 | Aceite SAE 30, K = 0,16 | En seco, K = 0,22 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M3 | 0,5 mm | 5,03 mm² | 0,97 kN | 0,3 N·m | 0,4 N·m | 0,5 N·m | 0,6 N·m |
| M4 | 0,7 mm | 8,78 mm² | 1,69 kN | 0,7 N·m | 0,9 N·m | 1,1 N·m | 1,5 N·m |
| M5 | 0,8 mm | 14,18 mm² | 2,73 kN | 1,5 N·m | 1,8 N·m | 2,2 N·m | 3,0 N·m |
| M6 | 1,0 mm | 20,12 mm² | 3,87 kN | 2,6 N·m | 3,0 N·m | 3,7 N·m | 5,1 N·m |
| M8 | 1,25 mm | 36,61 mm² | 7,05 kN | 6,2 N·m | 7,3 N·m | 9,0 N·m | 12,4 N·m |
| M10 | 1,5 mm | 57,99 mm² | 11,16 kN | 12,3 N·m | 14,5 N·m | 17,9 N·m | 24,6 N·m |
| M12 | 1,75 mm | 84,27 mm² | 16,22 kN | 21,4 N·m | 25,3 N·m | 31,1 N·m | 42,8 N·m |
| M16 | 2,0 mm | 156,67 mm² | 30,16 kN | 53,1 N·m | 62,7 N·m | 77,2 N·m | 106,2 N·m |

El mismo par en lbf·in:

| Rosca | Pasta de MoS2, K = 0,11 | Antigripante de cobre, K = 0,13 | Aceite SAE 30, K = 0,16 | En seco, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 2,8 lbf·in | 3,3 lbf·in | 4,1 lbf·in | 5,7 lbf·in |
| M4 | 6,6 lbf·in | 7,8 lbf·in | 9,6 lbf·in | 13,2 lbf·in |
| M5 | 13,3 lbf·in | 15,7 lbf·in | 19,3 lbf·in | 26,6 lbf·in |
| M6 | 22,6 lbf·in | 26,7 lbf·in | 32,9 lbf·in | 45,3 lbf·in |
| M8 | 54,9 lbf·in | 64,9 lbf·in | 79,8 lbf·in | 109,8 lbf·in |
| M10 | 108,7 lbf·in | 128,4 lbf·in | 158,1 lbf·in | 217,4 lbf·in |
| M12 | 189,5 lbf·in | 224,0 lbf·in | 275,7 lbf·in | 379,0 lbf·in |
| M16 | 469,8 lbf·in | 555,2 lbf·in | 683,3 lbf·in | 939,6 lbf·in |

El mismo par en lbf·ft:

| Rosca | Pasta de MoS2, K = 0,11 | Antigripante de cobre, K = 0,13 | Aceite SAE 30, K = 0,16 | En seco, K = 0,22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 0,24 lbf·ft | 0,28 lbf·ft | 0,34 lbf·ft | 0,47 lbf·ft |
| M4 | 0,55 lbf·ft | 0,65 lbf·ft | 0,80 lbf·ft | 1,10 lbf·ft |
| M5 | 1,11 lbf·ft | 1,31 lbf·ft | 1,61 lbf·ft | 2,22 lbf·ft |
| M6 | 1,89 lbf·ft | 2,23 lbf·ft | 2,74 lbf·ft | 3,77 lbf·ft |
| M8 | 4,57 lbf·ft | 5,41 lbf·ft | 6,65 lbf·ft | 9,15 lbf·ft |
| M10 | 9,06 lbf·ft | 10,70 lbf·ft | 13,17 lbf·ft | 18,11 lbf·ft |
| M12 | 15,79 lbf·ft | 18,66 lbf·ft | 22,97 lbf·ft | 31,59 lbf·ft |
| M16 | 39,15 lbf·ft | 46,27 lbf·ft | 56,94 lbf·ft | 78,30 lbf·ft |

La sección resistente y la precarga se redondean a 0,01; el par, a 0,1 N·m, 0,1 lbf·in y 0,01 lbf·ft. Los valores imperiales se convierten a partir del par sin redondear.

### Supuestos y advertencias

- Los valores de par presuponen roscas 6g laminadas y lisas, y una llave dinamométrica digital calibrada.
- Si se utilizan fijaciones de titanio en agujeros roscados ciegos, verifique siempre que el agujero esté libre de fluido de corte antes de aplicar la pasta antigripante especificada.
- Advertencia crítica: el montaje en seco de roscas de titanio provoca una soldadura en frío severa y el gripado de la rosca bajo precarga. Especifique siempre pasta para titanio o MoS2. La columna en seco se incluye como referencia y no es una recomendación.
- La pasta antigripante de disulfuro de molibdeno (K = 0,11) es la condición recomendada.
- El único margen del cálculo es el porcentaje de precarga: no se aplica ningún otro coeficiente de seguridad.

## Profundidad de acoplamiento de la rosca a cizalladura

### A qué responde

¿Cuál es la profundidad mínima de rosca en una carcasa de aluminio, magnesio, titanio o acero para que la rosca no se arranque? Un ingeniero necesita el dato cuando un tornillo de titanio se enrosca en un agujero roscado, sobre todo en un material base más blando como el aluminio o el magnesio: la profundidad debe ser suficiente para que el tornillo rompa antes de que se arranque la rosca del agujero.

### Fórmula

- `Le = R × d`
- `n = Le ÷ p, redondeado al alza hasta el siguiente filete entero`

Los símbolos son:

- `Le`: longitud mínima de acoplamiento de la rosca, en mm;
- `R`: relación de acoplamiento del material de la carcasa, respecto al diámetro exterior;
- `d`: diámetro nominal de la rosca, en mm;
- `p`: paso de la rosca, en mm;
- `n`: número mínimo de filetes completos acoplados.

### Constantes

| Material base de la carcasa | Relación de acoplamiento R | Regla práctica de ingeniería |
| --- | ---: | --- |
| Aluminio aeroespacial 6061-T6 / 7075-T6 | 1,8 | La menor resistencia a cizalladura de las roscas hembra de aluminio requiere en torno a 1,8× el diámetro para garantizar que el tornillo rompa antes de que se arranque la rosca del agujero. |
| Fundición de magnesio (AZ91D / ZE41) | 2,2 | El material base de magnesio, blando, requiere una profundidad de roscado mayor, de en torno a 2,2× el diámetro, para evitar el arrancamiento de la rosca. |
| Titanio grado 5 (Ti-6Al-4V) | 1,2 | La resistencia a cizalladura equiparada permite la profundidad de acoplamiento estándar de 1,2× el diámetro. |
| Acero 4140 de alta resistencia / Inconel | 1,0 | El alto límite elástico a cizalladura permite un acoplamiento de rosca compacto de 1,0× el diámetro. |

### Tablas de referencia

Longitud mínima de acoplamiento de la rosca. Datos de entrada: cada material de carcasa con su relación, diámetro nominal según la lista.

| Rosca | Diámetro nominal d | Aluminio, R = 1,8 | Magnesio, R = 2,2 | Titanio grado 5, R = 1,2 | Acero, R = 1,0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 | 3,0 mm | 5,4 mm | 6,6 mm | 3,6 mm | 3,0 mm |
| M4 | 4,0 mm | 7,2 mm | 8,8 mm | 4,8 mm | 4,0 mm |
| M5 | 5,0 mm | 9,0 mm | 11,0 mm | 6,0 mm | 5,0 mm |
| M6 | 6,0 mm | 10,8 mm | 13,2 mm | 7,2 mm | 6,0 mm |
| M8 | 8,0 mm | 14,4 mm | 17,6 mm | 9,6 mm | 8,0 mm |
| M10 | 10,0 mm | 18,0 mm | 22,0 mm | 12,0 mm | 10,0 mm |
| M12 | 12,0 mm | 21,6 mm | 26,4 mm | 14,4 mm | 12,0 mm |
| M16 | 16,0 mm | 28,8 mm | 35,2 mm | 19,2 mm | 16,0 mm |

Número mínimo de filetes completos acoplados. Datos de entrada: las longitudes de acoplamiento anteriores, divididas por el paso grueso y redondeadas al alza.

| Rosca | Paso p | Aluminio, R = 1,8 | Magnesio, R = 2,2 | Titanio grado 5, R = 1,2 | Acero, R = 1,0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 | 0,5 mm | 11 | 14 | 8 | 6 |
| M4 | 0,7 mm | 11 | 13 | 7 | 6 |
| M5 | 0,8 mm | 12 | 14 | 8 | 7 |
| M6 | 1,0 mm | 11 | 14 | 8 | 6 |
| M8 | 1,25 mm | 12 | 15 | 8 | 7 |
| M10 | 1,5 mm | 12 | 15 | 8 | 7 |
| M12 | 1,75 mm | 13 | 16 | 9 | 7 |
| M16 | 2,0 mm | 15 | 18 | 10 | 8 |

Las longitudes de acoplamiento se redondean a 0,1 mm.

### Supuestos

- Las profundidades se calculan para que los tornillos de titanio grado 5 desarrollen toda su resistencia a la tracción sin arrancar las roscas del agujero.
- Las relaciones son reglas prácticas de ingeniería para cada familia de material de carcasa. No se derivan de la resistencia a cizalladura de una aleación o un estado de tratamiento concretos.
- El número de filetes utiliza el paso grueso de cada medida.

## Del cálculo a la pieza

Las medidas estándar están en el catálogo: [tornillos de cabeza cilíndrica Allen](/es/collections/tornillos-de-cabeza-cilindrica-allen), [tornillos de cabeza abombada](/es/collections/tornillos-de-cabeza-abombada), [tornillos de cabeza avellanada](/es/collections/tornillos-de-cabeza-avellanada), [tornillos de cabeza hexagonal](/es/collections/tornillos-de-cabeza-hexagonal) y [tornillos de hombro](/es/collections/tornillos-de-hombro). Cuando la profundidad de acoplamiento exige una longitud que el catálogo no incluye, la fabricamos bajo pedido: consulte la [fabricación a medida](/es/fabricacion-a-medida). Las propiedades de cada grado de titanio están en la [guía de materiales](/es/guia-de-materiales).
