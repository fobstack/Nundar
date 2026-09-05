import type { Locale } from "@/config/locales";

/**
 * Storefront interface strings.
 *
 * These are the words the storefront needs in order to be *correct*, as opposed
 * to the words that give it a voice: breadcrumb labels, commerce vocabulary
 * (minimum order, lead time, price on request), and page titles.
 *
 * They live here rather than inside a theme because a theme that carried them
 * would make every theme author a translator into four languages. That is not a
 * hypothetical cost — before this module existed, the breadcrumb read
 * `locale === "de" ? "Produkte" : "Products"`, so French and Spanish visitors
 * saw an English breadcrumb, and the `BreadcrumbList` structured data emitted
 * the English "Products" on all four language versions.
 *
 * **A theme still owns its voice.** Hero copy, section headings and taglines
 * stay in the theme, because two themes may legitimately say different things
 * there. The rule is: if getting it wrong is a bug, it belongs here; if getting
 * it different is a design choice, it belongs in the theme.
 *
 * The route layer reads this too, so structured data and visible text can never
 * disagree about what a breadcrumb says.
 */
const MESSAGES = {
  en: {
    nav: {
      products: "Products",
      cart: "Cart",
      checkout: "Checkout",
    },
    product: {
      minimumOrder: "Minimum order",
      leadTime: "Lead time",
      stock: "Stock",
      businessDays: "business days",
      inStock: "in stock",
      outOfStock: "Out of stock",
      perUnit: "per unit",
      perUnitNet: "per unit · excl. VAT and freight",
      priceOnRequest: "Price on request",
      from: "from",
      viewProduct: "View product",
    },
    useCase: {
      note: "Application note",
      thePart: "The part discussed here",
      otherApplications: "Other applications",
      readMore: "Read the full application note",
    },
    list: {
      empty: "No products yet.",
    },
    page: {
      cart: "Cart",
      checkout: "Checkout",
      orderThankYou: "Thank you",
    },
    language: {
      en: "English",
      de: "Deutsch",
      fr: "Français",
      es: "Español",
    },
  },
  de: {
    nav: {
      products: "Produkte",
      cart: "Warenkorb",
      checkout: "Kasse",
    },
    product: {
      minimumOrder: "Mindestbestellmenge",
      leadTime: "Lieferzeit",
      stock: "Lagerbestand",
      businessDays: "Werktage",
      inStock: "auf Lager",
      outOfStock: "Nicht auf Lager",
      perUnit: "pro Stück",
      perUnitNet: "pro Stück · zzgl. MwSt. und Fracht",
      priceOnRequest: "Preis auf Anfrage",
      from: "ab",
      viewProduct: "Produkt ansehen",
    },
    useCase: {
      note: "Anwendungsnotiz",
      thePart: "Das hier besprochene Teil",
      otherApplications: "Weitere Anwendungen",
      readMore: "Vollständige Anwendungsnotiz lesen",
    },
    list: {
      empty: "Noch keine Produkte.",
    },
    page: {
      cart: "Warenkorb",
      checkout: "Kasse",
      orderThankYou: "Vielen Dank",
    },
    language: {
      en: "English",
      de: "Deutsch",
      fr: "Français",
      es: "Español",
    },
  },
  fr: {
    nav: {
      products: "Produits",
      cart: "Panier",
      checkout: "Commande",
    },
    product: {
      minimumOrder: "Quantité minimale",
      leadTime: "Délai",
      stock: "Stock",
      businessDays: "jours ouvrés",
      inStock: "en stock",
      outOfStock: "Rupture de stock",
      perUnit: "à l'unité",
      perUnitNet: "à l'unité · hors TVA et transport",
      priceOnRequest: "Prix sur demande",
      from: "à partir de",
      viewProduct: "Voir le produit",
    },
    useCase: {
      note: "Note d'application",
      thePart: "La pièce concernée",
      otherApplications: "Autres applications",
      readMore: "Lire la note d'application complète",
    },
    list: {
      empty: "Aucun produit.",
    },
    page: {
      cart: "Panier",
      checkout: "Commande",
      orderThankYou: "Merci",
    },
    language: {
      en: "English",
      de: "Deutsch",
      fr: "Français",
      es: "Español",
    },
  },
  es: {
    nav: {
      products: "Productos",
      cart: "Carrito",
      checkout: "Pago",
    },
    product: {
      minimumOrder: "Pedido mínimo",
      leadTime: "Plazo de entrega",
      stock: "Existencias",
      businessDays: "días hábiles",
      inStock: "en stock",
      outOfStock: "Agotado",
      perUnit: "por unidad",
      perUnitNet: "por unidad · sin IVA ni transporte",
      priceOnRequest: "Precio a consultar",
      from: "desde",
      viewProduct: "Ver producto",
    },
    useCase: {
      note: "Nota de aplicación",
      thePart: "La pieza tratada aquí",
      otherApplications: "Otras aplicaciones",
      readMore: "Leer la nota de aplicación completa",
    },
    list: {
      empty: "Aún no hay productos.",
    },
    page: {
      cart: "Carrito",
      checkout: "Pago",
      orderThankYou: "Gracias",
    },
    language: {
      en: "English",
      de: "Deutsch",
      fr: "Français",
      es: "Español",
    },
  },
} as const;

/**
 * English defines the authoritative shape; every other language must match it
 * key for key. Widening the literal types compares structure without demanding
 * that a translation equal the English string, so a language missing an entry
 * fails to compile instead of rendering undefined on a live page.
 */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

export type StorefrontMessages = Widen<(typeof MESSAGES)["en"]>;

const CATALOGUE: Record<Locale, StorefrontMessages> = MESSAGES;

export function getStorefrontMessages(locale: Locale): StorefrontMessages {
  return CATALOGUE[locale];
}
