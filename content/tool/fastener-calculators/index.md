---
title: Titanium Fastener Engineering Calculators
description: Formulas, constants and reference tables for titanium fastener mass reduction, tightening torque and preload, and thread engagement depth.
calculators: fasteners
---

Three questions come with almost every titanium fastener: how much mass the change from steel removes, what tightening torque gives the intended preload, and how deep the thread must engage in the housing. For each one, this page gives the formula, every constant behind it and a table of results for standard metric sizes, so that any figure can be checked by hand.

## Thread sizes used on this page

All three calculations use the nominal diameter and the coarse pitch of these eight metric threads.

| Thread | Nominal diameter d | Pitch p |
| --- | ---: | ---: |
| M3 | 3.0 mm | 0.5 mm |
| M4 | 4.0 mm | 0.7 mm |
| M5 | 5.0 mm | 0.8 mm |
| M6 | 6.0 mm | 1.0 mm |
| M8 | 8.0 mm | 1.25 mm |
| M10 | 10.0 mm | 1.5 mm |
| M12 | 12.0 mm | 1.75 mm |
| M16 | 16.0 mm | 2.0 mm |

## Titanium versus steel mass reduction

### What it answers

How much lighter does an assembly become when its high-tensile steel fasteners are replaced with Grade 5 (Ti-6Al-4V) titanium fasteners of the same size? An engineer needs the figure when closing a mass budget, wherever each kilogram carries a cost. The calculation also expresses the saving as a launch cost, at a typical launch payload penalty of $10,000 per kg.

### Formula

- `V = π × (d ÷ 2)² × L ÷ 1000 × H`
- `m = V × ρ`
- `M = m × N ÷ 1000`
- `saving = M of the baseline metal − M of Grade 5 titanium`
- `reduction (%) = (ρ of the baseline metal − ρ of Grade 5 titanium) ÷ ρ of the baseline metal × 100`
- `launch cost equivalent ($) = saving × 10,000`

The symbols are:

- `V`: volume of one fastener, in cm³;
- `d`: nominal thread diameter, in mm;
- `L`: fastener length, in mm;
- `H`: head geometry factor, an allowance for the head on top of the shank volume;
- `ρ`: density of the metal, in g/cm³;
- `m`: mass of one fastener, in g;
- `N`: number of fasteners;
- `M`: total mass, in kg;
- `saving`: mass removed from the assembly, in kg.

### Constants

| Constant | Value | Unit |
| --- | ---: | --- |
| Density of carbon steel 10.9 (baseline) | 7.85 | g/cm³ |
| Density of stainless steel 316 (baseline) | 8.00 | g/cm³ |
| Density of Grade 5 titanium (Ti-6Al-4V) | 4.43 | g/cm³ |
| Density of Grade 2 titanium (commercially pure) | 4.51 | g/cm³ |
| Density of 7075-T6 aerospace aluminum | 2.81 | g/cm³ |
| Head factor H, socket head cap screw (standard cylindrical) | 1.25 | none |
| Head factor H, button head screw (low profile) | 1.15 | none |
| Head factor H, flat countersunk 90° head | 1.10 | none |
| Head factor H, hex flange heavy bolt | 1.35 | none |
| Launch payload penalty | 10,000 | $ per kg |
| Length L, accepted range | 6 to 150 | mm |
| Quantity N, accepted range | 1 to 50,000 | fasteners |

### Reference tables

Mass of one fastener in each metal. Inputs: socket head cap screw (H = 1.25), one fastener.

| Fastener | Carbon steel 10.9 | Stainless steel 316 | Grade 5 titanium | Grade 2 titanium | 7075-T6 aluminum |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 0.69 g | 0.71 g | 0.39 g | 0.40 g | 0.25 g |
| M4 × 12 mm | 1.48 g | 1.51 g | 0.84 g | 0.85 g | 0.53 g |
| M5 × 20 mm | 3.85 g | 3.93 g | 2.17 g | 2.21 g | 1.38 g |
| M6 × 30 mm | 8.32 g | 8.48 g | 4.70 g | 4.78 g | 2.98 g |
| M8 × 30 mm | 14.80 g | 15.08 g | 8.35 g | 8.50 g | 5.30 g |
| M10 × 40 mm | 30.83 g | 31.42 g | 17.40 g | 17.71 g | 11.03 g |
| M12 × 50 mm | 55.49 g | 56.55 g | 31.31 g | 31.88 g | 19.86 g |
| M16 × 60 mm | 118.38 g | 120.64 g | 66.80 g | 68.01 g | 42.37 g |

Mass of 100 fasteners against carbon steel. Inputs: socket head cap screw (H = 1.25), N = 100, baseline carbon steel 10.9 (7.85 g/cm³).

| Fastener | Carbon steel 10.9 | Grade 5 titanium | Mass saved | Reduction | Launch cost equivalent |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 69.4 g | 39.1 g | 30.2 g | 43.6% | $302 |
| M4 × 12 mm | 148.0 g | 83.5 g | 64.5 g | 43.6% | $645 |
| M5 × 20 mm | 385.3 g | 217.5 g | 167.9 g | 43.6% | $1,679 |
| M6 × 30 mm | 832.3 g | 469.7 g | 362.6 g | 43.6% | $3,626 |
| M8 × 30 mm | 1.480 kg | 835.0 g | 644.7 g | 43.6% | $6,447 |
| M10 × 40 mm | 3.083 kg | 1.740 kg | 1.343 kg | 43.6% | $13,430 |
| M12 × 50 mm | 5.549 kg | 3.131 kg | 2.417 kg | 43.6% | $24,175 |
| M16 × 60 mm | 11.838 kg | 6.680 kg | 5.157 kg | 43.6% | $51,572 |

Mass of 100 fasteners against stainless steel. Inputs: socket head cap screw (H = 1.25), N = 100, baseline stainless steel 316 (8.00 g/cm³).

| Fastener | Stainless steel 316 | Grade 5 titanium | Mass saved | Reduction | Launch cost equivalent |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 × 10 mm | 70.7 g | 39.1 g | 31.5 g | 44.6% | $315 |
| M4 × 12 mm | 150.8 g | 83.5 g | 67.3 g | 44.6% | $673 |
| M5 × 20 mm | 392.7 g | 217.5 g | 175.2 g | 44.6% | $1,752 |
| M6 × 30 mm | 848.2 g | 469.7 g | 378.5 g | 44.6% | $3,785 |
| M8 × 30 mm | 1.508 kg | 835.0 g | 672.9 g | 44.6% | $6,729 |
| M10 × 40 mm | 3.142 kg | 1.740 kg | 1.402 kg | 44.6% | $14,019 |
| M12 × 50 mm | 5.655 kg | 3.131 kg | 2.523 kg | 44.6% | $25,235 |
| M16 × 60 mm | 12.064 kg | 6.680 kg | 5.383 kg | 44.6% | $53,834 |

Effect of the head geometry. Inputs: M6 × 30 mm, N = 100, baseline carbon steel 10.9 (7.85 g/cm³).

| Head geometry | Head factor H | Carbon steel 10.9 | Grade 5 titanium | Mass saved |
| --- | ---: | ---: | ---: | ---: |
| Socket head cap screw | 1.25 | 832.3 g | 469.7 g | 362.6 g |
| Button head screw | 1.15 | 765.7 g | 432.1 g | 333.6 g |
| Flat countersunk 90° head | 1.10 | 732.4 g | 413.3 g | 319.1 g |
| Hex flange heavy bolt | 1.35 | 898.9 g | 507.3 g | 391.6 g |

Masses of one fastener are rounded to 0.01 g. Totals below 1 kg are given in grams to 0.1 g, totals from 1 kg in kilograms to 0.001 kg. Each figure is rounded on its own, so the difference between two printed totals can differ from the printed saving in the last digit.

### Assumptions

- The fastener is treated as a plain cylinder of the nominal thread diameter over its full length. The head is an allowance factor on that volume (25% for a socket head cap screw), not a measured head. Thread form and drive recess are not part of the model.
- The percentage reduction depends only on the two densities, so it is the same for every size: 43.6% against carbon steel 10.9 and 44.6% against stainless steel 316.
- The launch cost equivalent multiplies the saving by a typical launch payload penalty. It is an indication for launch vehicles and spacecraft, not a price.
- The masses are estimates for comparing metals. They are not catalog weights.

## Tightening torque and preload

### What it answers

What tightening torque brings a titanium fastener to the intended preload, for the lubricant on its threads? An engineer needs the figure when writing an assembly torque into a drawing or a work instruction. The lubricant changes the answer: anti-seize paste lowers the nut factor, so the torque has to be lowered with it to prevent over-tensioning.

### Formula

- `As = 0.7854 × (d − 0.9382 × p)²`
- `σ = Sy × P ÷ 100`
- `Fi = As × σ ÷ 1000`
- `T = K × Fi × d`
- `T in lbf·in = T × 8.8507`
- `T in lbf·ft = T × 0.73756`

The symbols are:

- `As`: tensile stress area of the thread, in mm²;
- `d`: nominal thread diameter, in mm;
- `p`: thread pitch, in mm;
- `Sy`: yield strength of the titanium grade, in MPa (N/mm²);
- `P`: preload percentage, the share of the yield strength the fastener is tightened to;
- `σ`: target stress in the fastener, in MPa;
- `Fi`: induced clamping preload, in kN;
- `K`: nut factor (torque coefficient) of the lubricant condition, without unit;
- `T`: tightening torque, in N·m. With `Fi` in kN and `d` in mm the product is directly in N·m.

### Constants

| Constant | Value | Unit |
| --- | ---: | --- |
| Yield strength Sy, Grade 5 titanium | 828 | MPa |
| Yield strength Sy, Grade 2 commercially pure titanium | 275 | MPa |
| Nut factor K, molybdenum disulfide (MoS2) anti-seize paste (recommended) | 0.11 | none |
| Nut factor K, copper based anti-seize compound | 0.13 | none |
| Nut factor K, light SAE 30 machine oil | 0.16 | none |
| Nut factor K, dry / as-received (high galling risk) | 0.22 | none |
| Preload percentage P, default | 70 | % of yield strength |
| Preload percentage P, lowest and highest accepted | 50 and 85 | % of yield strength |
| Stress area coefficient | 0.7854 | none |
| Stress area pitch coefficient | 0.9382 | none |
| Conversion, N·m to lbf·in | 8.8507 | lbf·in per N·m |
| Conversion, N·m to lbf·ft | 0.73756 | lbf·ft per N·m |

### Reference tables for Grade 5 titanium

Inputs for the three tables: Grade 5 titanium (Sy = 828 MPa), preload percentage P = 70%, so a target stress of 579.6 MPa; coarse pitch as listed.

Torque in N·m, with the stress area and the preload it produces:

| Thread | Pitch p | Stress area As | Preload Fi | MoS2 paste, K = 0.11 | Copper anti-seize, K = 0.13 | SAE 30 oil, K = 0.16 | Dry, K = 0.22 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M3 | 0.5 mm | 5.03 mm² | 2.92 kN | 1.0 N·m | 1.1 N·m | 1.4 N·m | 1.9 N·m |
| M4 | 0.7 mm | 8.78 mm² | 5.09 kN | 2.2 N·m | 2.6 N·m | 3.3 N·m | 4.5 N·m |
| M5 | 0.8 mm | 14.18 mm² | 8.22 kN | 4.5 N·m | 5.3 N·m | 6.6 N·m | 9.0 N·m |
| M6 | 1.0 mm | 20.12 mm² | 11.66 kN | 7.7 N·m | 9.1 N·m | 11.2 N·m | 15.4 N·m |
| M8 | 1.25 mm | 36.61 mm² | 21.22 kN | 18.7 N·m | 22.1 N·m | 27.2 N·m | 37.3 N·m |
| M10 | 1.5 mm | 57.99 mm² | 33.61 kN | 37.0 N·m | 43.7 N·m | 53.8 N·m | 73.9 N·m |
| M12 | 1.75 mm | 84.27 mm² | 48.84 kN | 64.5 N·m | 76.2 N·m | 93.8 N·m | 128.9 N·m |
| M16 | 2.0 mm | 156.67 mm² | 90.81 kN | 159.8 N·m | 188.9 N·m | 232.5 N·m | 319.6 N·m |

The same torque in lbf·in:

| Thread | MoS2 paste, K = 0.11 | Copper anti-seize, K = 0.13 | SAE 30 oil, K = 0.16 | Dry, K = 0.22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 8.5 lbf·in | 10.1 lbf·in | 12.4 lbf·in | 17.0 lbf·in |
| M4 | 19.8 lbf·in | 23.4 lbf·in | 28.8 lbf·in | 39.6 lbf·in |
| M5 | 40.0 lbf·in | 47.3 lbf·in | 58.2 lbf·in | 80.0 lbf·in |
| M6 | 68.1 lbf·in | 80.5 lbf·in | 99.1 lbf·in | 136.3 lbf·in |
| M8 | 165.3 lbf·in | 195.3 lbf·in | 240.4 lbf·in | 330.5 lbf·in |
| M10 | 327.2 lbf·in | 386.7 lbf·in | 476.0 lbf·in | 654.5 lbf·in |
| M12 | 570.6 lbf·in | 674.4 lbf·in | 830.0 lbf·in | 1141.2 lbf·in |
| M16 | 1414.5 lbf·in | 1671.7 lbf·in | 2057.4 lbf·in | 2829.0 lbf·in |

The same torque in lbf·ft:

| Thread | MoS2 paste, K = 0.11 | Copper anti-seize, K = 0.13 | SAE 30 oil, K = 0.16 | Dry, K = 0.22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 0.71 lbf·ft | 0.84 lbf·ft | 1.03 lbf·ft | 1.42 lbf·ft |
| M4 | 1.65 lbf·ft | 1.95 lbf·ft | 2.40 lbf·ft | 3.30 lbf·ft |
| M5 | 3.33 lbf·ft | 3.94 lbf·ft | 4.85 lbf·ft | 6.67 lbf·ft |
| M6 | 5.68 lbf·ft | 6.71 lbf·ft | 8.26 lbf·ft | 11.36 lbf·ft |
| M8 | 13.77 lbf·ft | 16.28 lbf·ft | 20.03 lbf·ft | 27.54 lbf·ft |
| M10 | 27.27 lbf·ft | 32.23 lbf·ft | 39.66 lbf·ft | 54.54 lbf·ft |
| M12 | 47.55 lbf·ft | 56.20 lbf·ft | 69.16 lbf·ft | 95.10 lbf·ft |
| M16 | 117.87 lbf·ft | 139.31 lbf·ft | 171.45 lbf·ft | 235.75 lbf·ft |

### Reference tables for Grade 2 titanium

Inputs for the three tables: Grade 2 commercially pure titanium (Sy = 275 MPa), preload percentage P = 70%, so a target stress of 192.5 MPa; coarse pitch as listed.

Torque in N·m, with the stress area and the preload it produces:

| Thread | Pitch p | Stress area As | Preload Fi | MoS2 paste, K = 0.11 | Copper anti-seize, K = 0.13 | SAE 30 oil, K = 0.16 | Dry, K = 0.22 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M3 | 0.5 mm | 5.03 mm² | 0.97 kN | 0.3 N·m | 0.4 N·m | 0.5 N·m | 0.6 N·m |
| M4 | 0.7 mm | 8.78 mm² | 1.69 kN | 0.7 N·m | 0.9 N·m | 1.1 N·m | 1.5 N·m |
| M5 | 0.8 mm | 14.18 mm² | 2.73 kN | 1.5 N·m | 1.8 N·m | 2.2 N·m | 3.0 N·m |
| M6 | 1.0 mm | 20.12 mm² | 3.87 kN | 2.6 N·m | 3.0 N·m | 3.7 N·m | 5.1 N·m |
| M8 | 1.25 mm | 36.61 mm² | 7.05 kN | 6.2 N·m | 7.3 N·m | 9.0 N·m | 12.4 N·m |
| M10 | 1.5 mm | 57.99 mm² | 11.16 kN | 12.3 N·m | 14.5 N·m | 17.9 N·m | 24.6 N·m |
| M12 | 1.75 mm | 84.27 mm² | 16.22 kN | 21.4 N·m | 25.3 N·m | 31.1 N·m | 42.8 N·m |
| M16 | 2.0 mm | 156.67 mm² | 30.16 kN | 53.1 N·m | 62.7 N·m | 77.2 N·m | 106.2 N·m |

The same torque in lbf·in:

| Thread | MoS2 paste, K = 0.11 | Copper anti-seize, K = 0.13 | SAE 30 oil, K = 0.16 | Dry, K = 0.22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 2.8 lbf·in | 3.3 lbf·in | 4.1 lbf·in | 5.7 lbf·in |
| M4 | 6.6 lbf·in | 7.8 lbf·in | 9.6 lbf·in | 13.2 lbf·in |
| M5 | 13.3 lbf·in | 15.7 lbf·in | 19.3 lbf·in | 26.6 lbf·in |
| M6 | 22.6 lbf·in | 26.7 lbf·in | 32.9 lbf·in | 45.3 lbf·in |
| M8 | 54.9 lbf·in | 64.9 lbf·in | 79.8 lbf·in | 109.8 lbf·in |
| M10 | 108.7 lbf·in | 128.4 lbf·in | 158.1 lbf·in | 217.4 lbf·in |
| M12 | 189.5 lbf·in | 224.0 lbf·in | 275.7 lbf·in | 379.0 lbf·in |
| M16 | 469.8 lbf·in | 555.2 lbf·in | 683.3 lbf·in | 939.6 lbf·in |

The same torque in lbf·ft:

| Thread | MoS2 paste, K = 0.11 | Copper anti-seize, K = 0.13 | SAE 30 oil, K = 0.16 | Dry, K = 0.22 |
| --- | ---: | ---: | ---: | ---: |
| M3 | 0.24 lbf·ft | 0.28 lbf·ft | 0.34 lbf·ft | 0.47 lbf·ft |
| M4 | 0.55 lbf·ft | 0.65 lbf·ft | 0.80 lbf·ft | 1.10 lbf·ft |
| M5 | 1.11 lbf·ft | 1.31 lbf·ft | 1.61 lbf·ft | 2.22 lbf·ft |
| M6 | 1.89 lbf·ft | 2.23 lbf·ft | 2.74 lbf·ft | 3.77 lbf·ft |
| M8 | 4.57 lbf·ft | 5.41 lbf·ft | 6.65 lbf·ft | 9.15 lbf·ft |
| M10 | 9.06 lbf·ft | 10.70 lbf·ft | 13.17 lbf·ft | 18.11 lbf·ft |
| M12 | 15.79 lbf·ft | 18.66 lbf·ft | 22.97 lbf·ft | 31.59 lbf·ft |
| M16 | 39.15 lbf·ft | 46.27 lbf·ft | 56.94 lbf·ft | 78.30 lbf·ft |

Stress area and preload are rounded to 0.01, torque to 0.1 N·m, 0.1 lbf·in and 0.01 lbf·ft. The imperial figures are converted from the unrounded torque.

### Assumptions and warnings

- Torque values assume smooth, rolled 6g threads and a calibrated digital torque wrench.
- If titanium fasteners are used in blind tapped holes, always verify that the hole is free of cutting fluid before applying the specified anti-seize paste.
- Critical warning: dry assembly of titanium threads leads to severe cold welding and thread galling under preload. Always specify Ti-paste or MoS2. The dry column is listed for reference and is not a recommendation.
- Molybdenum disulfide anti-seize paste (K = 0.11) is the recommended condition.
- The only margin in the calculation is the preload percentage: no further safety factor is applied.

## Thread shear engagement depth

### What it answers

What is the minimum tapped thread depth in an aluminum, magnesium, titanium or steel housing, so that the thread does not strip? An engineer needs the figure when a titanium bolt is screwed into a tapped hole, above all in a softer parent material such as aluminum or magnesium: the depth has to be enough for the bolt to break before the hole strips.

### Formula

- `Le = R × d`
- `n = Le ÷ p, rounded up to the next whole thread`

The symbols are:

- `Le`: minimum thread engagement length, in mm;
- `R`: engagement ratio of the housing material, relative to the major diameter;
- `d`: nominal thread diameter, in mm;
- `p`: thread pitch, in mm;
- `n`: minimum number of engaged full threads.

### Constants

| Parent housing material | Engagement ratio R | Engineering rule of thumb |
| --- | ---: | --- |
| 6061-T6 / 7075-T6 aerospace aluminum | 1.8 | Lower shear strength of aluminum female threads requires about 1.8× diameter to guarantee the bolt breaks before the hole strips. |
| Magnesium casting (AZ91D / ZE41) | 2.2 | Soft magnesium base material requires a deeper tap depth of about 2.2× diameter to prevent thread tear-out. |
| Grade 5 titanium (Ti-6Al-4V) | 1.2 | Matched shear strength allows the standard 1.2× diameter engagement depth. |
| High-strength 4140 steel / Inconel | 1.0 | High shear yield allows a compact 1.0× diameter thread engagement. |

### Reference tables

Minimum thread engagement length. Inputs: each housing material with its ratio, nominal diameter as listed.

| Thread | Nominal diameter d | Aluminum, R = 1.8 | Magnesium, R = 2.2 | Grade 5 titanium, R = 1.2 | Steel, R = 1.0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 | 3.0 mm | 5.4 mm | 6.6 mm | 3.6 mm | 3.0 mm |
| M4 | 4.0 mm | 7.2 mm | 8.8 mm | 4.8 mm | 4.0 mm |
| M5 | 5.0 mm | 9.0 mm | 11.0 mm | 6.0 mm | 5.0 mm |
| M6 | 6.0 mm | 10.8 mm | 13.2 mm | 7.2 mm | 6.0 mm |
| M8 | 8.0 mm | 14.4 mm | 17.6 mm | 9.6 mm | 8.0 mm |
| M10 | 10.0 mm | 18.0 mm | 22.0 mm | 12.0 mm | 10.0 mm |
| M12 | 12.0 mm | 21.6 mm | 26.4 mm | 14.4 mm | 12.0 mm |
| M16 | 16.0 mm | 28.8 mm | 35.2 mm | 19.2 mm | 16.0 mm |

Minimum engaged full threads. Inputs: the engagement lengths above, divided by the coarse pitch and rounded up.

| Thread | Pitch p | Aluminum, R = 1.8 | Magnesium, R = 2.2 | Grade 5 titanium, R = 1.2 | Steel, R = 1.0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| M3 | 0.5 mm | 11 | 14 | 8 | 6 |
| M4 | 0.7 mm | 11 | 13 | 7 | 6 |
| M5 | 0.8 mm | 12 | 14 | 8 | 7 |
| M6 | 1.0 mm | 11 | 14 | 8 | 6 |
| M8 | 1.25 mm | 12 | 15 | 8 | 7 |
| M10 | 1.5 mm | 12 | 15 | 8 | 7 |
| M12 | 1.75 mm | 13 | 16 | 9 | 7 |
| M16 | 2.0 mm | 15 | 18 | 10 | 8 |

Engagement lengths are rounded to 0.1 mm.

### Assumptions

- The depths are calculated for full tensile development of Grade 5 titanium bolts without stripping the tapped threads.
- The ratios are engineering rules of thumb for each family of housing material. They are not derived from the shear strength of one particular alloy or temper.
- The thread count uses the coarse pitch of each size.

## From the calculation to the part

Standard sizes are in the catalog: [socket head cap screws](/collections/socket-head-cap-screws), [button head screws](/collections/button-head-screws), [countersunk screws](/collections/countersunk-screws), [hex head screws](/collections/hex-head-screws) and [shoulder screws](/collections/shoulder-screws). When the engagement depth calls for a length the catalog does not list, we make it to order: see [custom manufacturing](/custom-manufacturing). The properties of each titanium grade are in the [material guide](/material-guide).
