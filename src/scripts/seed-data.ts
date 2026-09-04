import type { Locale } from "@/config/locales";

type TranslationSeed = {
  name: string;
  summary: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
};

type FeatureSeed = { title: string; body: string };

type UseCaseSeed = {
  scenarioTitle: string;
  scenarioSlug: string;
  hasOwnPage: boolean;
  body: string;
};

export type ProductSeed = {
  id: string;
  slug: string;
  translations: Record<Locale, TranslationSeed>;
  features: Record<Locale, FeatureSeed[]>;
  useCases: Record<Locale, UseCaseSeed[]>;
  variants: {
    id: string;
    sku: string;
    stock: number;
    optionValues: Record<string, string>;
    moq: number;
    leadTimeDaysMin: number;
    leadTimeDaysMax: number;
    basePriceUsd: number;
  }[];
};

/**
 * 示例商品取工业阀门：它天然带 MOQ、交货周期与多种使用工况，
 * 能完整演示这套系统面向长尾词的内容结构。
 */
export const SEED_PRODUCTS: ProductSeed[] = [
  {
    id: "seed-ball-valve-dn50",
    slug: "stainless-ball-valve-dn50",
    translations: {
      en: {
        name: "Stainless Steel Ball Valve DN50",
        summary:
          "Full-bore 316L ball valve rated to 1000 PSI for corrosive media.",
        description:
          "A full-bore two-piece ball valve machined from 316L stainless steel. Rated to 1000 PSI at ambient temperature with a PTFE seat, it handles corrosive and food-grade media without contamination. Supplied with ISO 5211 mounting for direct actuator fitting.",
        seoTitle:
          "Stainless Steel Ball Valve DN50 (316L, 1000 PSI) | Manufacturer Direct",
        seoDescription:
          "316L stainless ball valve DN50, full bore, 1000 PSI, PTFE seat, ISO 5211 pad. Manufacturer direct pricing with 15-20 day lead time.",
      },
      de: {
        name: "Edelstahl-Kugelhahn DN50",
        summary:
          "Vollbohrung-Kugelhahn aus 316L, bis 69 bar für korrosive Medien.",
        description:
          "Zweiteiliger Kugelhahn mit Vollbohrung aus Edelstahl 316L. Ausgelegt bis 69 bar bei Umgebungstemperatur mit PTFE-Sitz, geeignet für korrosive und lebensmittelechte Medien. Mit ISO-5211-Anschluss zur direkten Antriebsmontage.",
        seoTitle: "Edelstahl-Kugelhahn DN50 (316L, 69 bar) | Direkt vom Hersteller",
        seoDescription:
          "Kugelhahn DN50 aus 316L, Vollbohrung, 69 bar, PTFE-Sitz, ISO-5211-Flansch. Herstellerpreise, Lieferzeit 15-20 Tage.",
      },
      fr: {
        name: "Vanne à bille inox DN50",
        summary:
          "Vanne à bille passage intégral 316L, 69 bar, pour fluides corrosifs.",
        description:
          "Vanne à bille deux pièces à passage intégral usinée en acier inoxydable 316L. Pression nominale 69 bar à température ambiante avec siège PTFE, adaptée aux fluides corrosifs et de qualité alimentaire. Platine ISO 5211 pour montage direct d'actionneur.",
        seoTitle: "Vanne à bille inox DN50 (316L, 69 bar) | Vente directe usine",
        seoDescription:
          "Vanne à bille DN50 en 316L, passage intégral, 69 bar, siège PTFE, platine ISO 5211. Prix usine, délai 15-20 jours.",
      },
      es: {
        name: "Válvula de bola de acero inoxidable DN50",
        summary:
          "Válvula de bola de paso total 316L, 69 bar, para fluidos corrosivos.",
        description:
          "Válvula de bola de dos piezas y paso total mecanizada en acero inoxidable 316L. Presión nominal de 69 bar a temperatura ambiente con asiento de PTFE, apta para fluidos corrosivos y de grado alimentario. Incluye brida ISO 5211 para montaje directo de actuador.",
        seoTitle:
          "Válvula de bola inoxidable DN50 (316L, 69 bar) | Venta directa de fábrica",
        seoDescription:
          "Válvula de bola DN50 en 316L, paso total, 69 bar, asiento PTFE, brida ISO 5211. Precio de fábrica, plazo de 15-20 días.",
      },
    },
    features: {
      en: [
        {
          title: "316L stainless body",
          body: "Resists chloride pitting in seawater and chemical service where 304 fails.",
        },
        {
          title: "Full bore, zero flow restriction",
          body: "The bore matches the pipe ID, so pressure drop across the valve is negligible.",
        },
      ],
      de: [
        {
          title: "Gehäuse aus Edelstahl 316L",
          body: "Beständig gegen Lochfraß durch Chloride in Meerwasser und Chemieanwendungen, wo 304 versagt.",
        },
        {
          title: "Vollbohrung ohne Querschnittsverengung",
          body: "Die Bohrung entspricht dem Rohrinnendurchmesser, der Druckverlust ist vernachlässigbar.",
        },
      ],
      fr: [
        {
          title: "Corps en inox 316L",
          body: "Résiste à la corrosion par piqûres due aux chlorures en eau de mer, là où le 304 cède.",
        },
        {
          title: "Passage intégral, sans perte de charge",
          body: "L'alésage correspond au diamètre intérieur du tube : la perte de charge est négligeable.",
        },
      ],
      es: [
        {
          title: "Cuerpo de acero inoxidable 316L",
          body: "Resiste la corrosión por picadura de cloruros en agua de mar, donde el 304 falla.",
        },
        {
          title: "Paso total, sin restricción de caudal",
          body: "El diámetro interior coincide con el del tubo, por lo que la pérdida de carga es insignificante.",
        },
      ],
    },
    useCases: {
      en: [
        {
          scenarioTitle: "Ball valves for offshore platform seawater lines",
          scenarioSlug: "offshore-seawater-lines",
          hasOwnPage: true,
          body: "Offshore seawater service combines chloride attack with constant vibration. The 316L body resists pitting that would perforate a 304 valve within a season, while the two-piece bolted construction allows seat replacement in place rather than cutting the valve out of the line. Specify the ISO 5211 pad option if the line will later be actuated for remote shutdown.",
        },
        {
          scenarioTitle: "Food-grade dosing and CIP circuits",
          scenarioSlug: "food-grade-dosing",
          hasOwnPage: false,
          body: "The PTFE seat carries no plasticiser migration risk, and the full bore leaves no dead volume where product can stagnate between CIP cycles.",
        },
      ],
      de: [
        {
          scenarioTitle:
            "Kugelhähne für Seewasserleitungen auf Offshore-Plattformen",
          scenarioSlug: "offshore-seewasserleitungen",
          hasOwnPage: true,
          body: "Der Seewasserbetrieb offshore verbindet Chloridangriff mit dauernder Vibration. Das 316L-Gehäuse widersteht dem Lochfraß, der einen 304-Hahn binnen einer Saison durchschlägt, und die zweiteilige Verschraubung erlaubt den Sitzwechsel vor Ort, ohne den Hahn aus der Leitung zu trennen.",
        },
        {
          scenarioTitle: "Dosier- und CIP-Kreisläufe in der Lebensmittelindustrie",
          scenarioSlug: "lebensmittel-dosierung",
          hasOwnPage: false,
          body: "Der PTFE-Sitz birgt kein Risiko der Weichmachermigration, und die Vollbohrung lässt kein Totvolumen, in dem Produkt zwischen CIP-Zyklen stehen bleibt.",
        },
      ],
      fr: [
        {
          scenarioTitle:
            "Vannes à bille pour circuits d'eau de mer en plateforme offshore",
          scenarioSlug: "circuits-eau-de-mer-offshore",
          hasOwnPage: true,
          body: "En service eau de mer offshore, l'attaque par les chlorures s'ajoute aux vibrations permanentes. Le corps 316L résiste aux piqûres qui perforeraient une vanne 304 en une saison, et la construction deux pièces boulonnée permet de remplacer le siège en ligne sans découper la vanne.",
        },
        {
          scenarioTitle: "Circuits de dosage alimentaire et NEP",
          scenarioSlug: "dosage-alimentaire",
          hasOwnPage: false,
          body: "Le siège PTFE n'entraîne aucun risque de migration de plastifiant, et le passage intégral ne laisse aucun volume mort où le produit stagnerait entre deux cycles NEP.",
        },
      ],
      es: [
        {
          scenarioTitle:
            "Válvulas de bola para líneas de agua de mar en plataformas offshore",
          scenarioSlug: "lineas-agua-de-mar-offshore",
          hasOwnPage: true,
          body: "El servicio con agua de mar en alta mar combina el ataque por cloruros con vibración constante. El cuerpo de 316L resiste la corrosión por picadura que perforaría una válvula de 304 en una temporada, y la construcción atornillada de dos piezas permite sustituir el asiento en línea sin cortar la válvula.",
        },
        {
          scenarioTitle: "Circuitos de dosificación alimentaria y CIP",
          scenarioSlug: "dosificacion-alimentaria",
          hasOwnPage: false,
          body: "El asiento de PTFE no presenta riesgo de migración de plastificantes, y el paso total no deja volumen muerto donde el producto quede estancado entre ciclos CIP.",
        },
      ],
    },
    variants: [
      {
        id: "seed-variant-dn50-threaded",
        sku: "BV-316L-DN50-NPT",
        stock: 120,
        optionValues: { connection: "NPT threaded" },
        moq: 10,
        leadTimeDaysMin: 15,
        leadTimeDaysMax: 20,
        basePriceUsd: 99,
      },
      {
        id: "seed-variant-dn50-flanged",
        sku: "BV-316L-DN50-FLG",
        stock: 40,
        optionValues: { connection: "ANSI 150 flanged" },
        moq: 5,
        leadTimeDaysMin: 25,
        leadTimeDaysMax: 35,
        basePriceUsd: 168,
      },
    ],
  },
];
