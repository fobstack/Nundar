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
    cart: {
      loading: "Loading…",
      empty: "Your cart is empty.",
      browseProducts: "Browse products",
      remove: "Remove",
      subtotal: "Subtotal",
      loadFailed: "Could not load cart",
      updateFailed: "Could not update cart",
      belowMoq: "Minimum order quantity is {n}.",
      insufficientStock: "Only {n} left in stock.",
      unavailable: "This item is no longer available.",
      noPrice: "This item has no price for your currency yet.",
    },
    addToCart: {
      quantity: "Quantity",
      add: "Add to cart",
      adding: "Adding…",
      failed: "Could not add to cart",
    },
    checkout: {
      recipient: "Recipient",
      email: "Email",
      emailHint: "Order confirmation and shipping updates go here.",
      address: "Address",
      addressLine2: "Address line 2",
      city: "City",
      stateRegion: "State / region",
      postalCode: "Postal code",
      countryCode: "Country code",
      phone: "Phone",
      total: "Total",
      continueToPayment: "Continue to payment",
      redirecting: "Redirecting to payment…",
      stripeNote: "Payment is handled by Stripe. Card details never reach this site.",
      startFailed: "Could not start checkout",
    },
    orderStatus: {
      lookingUp: "Looking up your order…",
      pending: "Payment is being confirmed. This usually takes a few seconds.",
      paid: "Payment received. We are preparing your order.",
      shipped: "Your order is on its way.",
      delivered: "Your order has been delivered.",
      cancelled: "This order was cancelled.",
      refunded: "This order has been refunded.",
      oversold:
        "Payment went through but the stock sold out first. We are refunding you and will be in touch.",
      notFound: "We could not find that order number.",
      safeToClose:
        "You can safely close this page — we will email you once it is confirmed.",
      continueShopping: "Continue shopping",
    },
    page: {
      cart: "Cart",
      checkout: "Checkout",
      orderThankYou: "Thank you",
      order: "Order",
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
    cart: {
      loading: "Wird geladen…",
      empty: "Ihr Warenkorb ist leer.",
      browseProducts: "Produkte ansehen",
      remove: "Entfernen",
      subtotal: "Zwischensumme",
      loadFailed: "Warenkorb konnte nicht geladen werden",
      updateFailed: "Warenkorb konnte nicht aktualisiert werden",
      belowMoq: "Die Mindestbestellmenge beträgt {n}.",
      insufficientStock: "Nur noch {n} auf Lager.",
      unavailable: "Dieser Artikel ist nicht mehr verfügbar.",
      noPrice: "Für diese Währung ist noch kein Preis hinterlegt.",
    },
    addToCart: {
      quantity: "Menge",
      add: "In den Warenkorb",
      adding: "Wird hinzugefügt…",
      failed: "Konnte nicht in den Warenkorb gelegt werden",
    },
    checkout: {
      recipient: "Empfänger",
      email: "E-Mail",
      emailHint: "Bestellbestätigung und Versandbenachrichtigungen gehen an diese Adresse.",
      address: "Adresse",
      addressLine2: "Adresszusatz",
      city: "Stadt",
      stateRegion: "Bundesland / Region",
      postalCode: "Postleitzahl",
      countryCode: "Ländercode",
      phone: "Telefon",
      total: "Gesamt",
      continueToPayment: "Weiter zur Zahlung",
      redirecting: "Weiterleitung zur Zahlung…",
      stripeNote:
        "Die Zahlung wird von Stripe abgewickelt. Kartendaten erreichen diese Website nie.",
      startFailed: "Bezahlvorgang konnte nicht gestartet werden",
    },
    orderStatus: {
      lookingUp: "Bestellung wird gesucht…",
      pending: "Die Zahlung wird bestätigt. Das dauert meist nur wenige Sekunden.",
      paid: "Zahlung erhalten. Wir bereiten Ihre Bestellung vor.",
      shipped: "Ihre Bestellung ist unterwegs.",
      delivered: "Ihre Bestellung wurde zugestellt.",
      cancelled: "Diese Bestellung wurde storniert.",
      refunded: "Diese Bestellung wurde erstattet.",
      oversold:
        "Die Zahlung war erfolgreich, aber der Bestand war bereits verkauft. Wir erstatten den Betrag und melden uns bei Ihnen.",
      notFound: "Diese Bestellnummer wurde nicht gefunden.",
      safeToClose:
        "Sie können diese Seite bedenkenlos schließen — wir benachrichtigen Sie per E-Mail, sobald die Zahlung bestätigt ist.",
      continueShopping: "Weiter einkaufen",
    },
    page: {
      cart: "Warenkorb",
      checkout: "Kasse",
      orderThankYou: "Vielen Dank",
      order: "Bestellung",
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
    cart: {
      loading: "Chargement…",
      empty: "Votre panier est vide.",
      browseProducts: "Voir les produits",
      remove: "Retirer",
      subtotal: "Sous-total",
      loadFailed: "Impossible de charger le panier",
      updateFailed: "Impossible de mettre à jour le panier",
      belowMoq: "La quantité minimale de commande est de {n}.",
      insufficientStock: "Il ne reste que {n} en stock.",
      unavailable: "Cet article n'est plus disponible.",
      noPrice: "Aucun prix n'est encore défini pour cette devise.",
    },
    addToCart: {
      quantity: "Quantité",
      add: "Ajouter au panier",
      adding: "Ajout en cours…",
      failed: "Impossible d'ajouter au panier",
    },
    checkout: {
      recipient: "Destinataire",
      email: "E-mail",
      emailHint:
        "La confirmation de commande et le suivi d'expédition seront envoyés à cette adresse.",
      address: "Adresse",
      addressLine2: "Complément d'adresse",
      city: "Ville",
      stateRegion: "État / région",
      postalCode: "Code postal",
      countryCode: "Code pays",
      phone: "Téléphone",
      total: "Total",
      continueToPayment: "Passer au paiement",
      redirecting: "Redirection vers le paiement…",
      stripeNote:
        "Le paiement est traité par Stripe. Les données de carte n'atteignent jamais ce site.",
      startFailed: "Impossible de démarrer le paiement",
    },
    orderStatus: {
      lookingUp: "Recherche de votre commande…",
      pending:
        "Le paiement est en cours de confirmation. Cela prend généralement quelques secondes.",
      paid: "Paiement reçu. Nous préparons votre commande.",
      shipped: "Votre commande est en route.",
      delivered: "Votre commande a été livrée.",
      cancelled: "Cette commande a été annulée.",
      refunded: "Cette commande a été remboursée.",
      oversold:
        "Le paiement a abouti mais le stock était déjà épuisé. Nous vous remboursons et vous recontactons.",
      notFound: "Ce numéro de commande est introuvable.",
      safeToClose:
        "Vous pouvez fermer cette page — nous vous enverrons un e-mail dès la confirmation.",
      continueShopping: "Continuer mes achats",
    },
    page: {
      cart: "Panier",
      checkout: "Commande",
      orderThankYou: "Merci",
      order: "Commande",
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
    cart: {
      loading: "Cargando…",
      empty: "Su carrito está vacío.",
      browseProducts: "Ver productos",
      remove: "Quitar",
      subtotal: "Subtotal",
      loadFailed: "No se pudo cargar el carrito",
      updateFailed: "No se pudo actualizar el carrito",
      belowMoq: "El pedido mínimo es de {n}.",
      insufficientStock: "Solo quedan {n} en stock.",
      unavailable: "Este artículo ya no está disponible.",
      noPrice: "Todavía no hay precio para esta moneda.",
    },
    addToCart: {
      quantity: "Cantidad",
      add: "Añadir al carrito",
      adding: "Añadiendo…",
      failed: "No se pudo añadir al carrito",
    },
    checkout: {
      recipient: "Destinatario",
      email: "Correo electrónico",
      emailHint:
        "La confirmación del pedido y las actualizaciones de envío se enviarán a esta dirección.",
      address: "Dirección",
      addressLine2: "Dirección línea 2",
      city: "Ciudad",
      stateRegion: "Provincia / región",
      postalCode: "Código postal",
      countryCode: "Código de país",
      phone: "Teléfono",
      total: "Total",
      continueToPayment: "Continuar al pago",
      redirecting: "Redirigiendo al pago…",
      stripeNote:
        "El pago lo gestiona Stripe. Los datos de la tarjeta nunca llegan a este sitio.",
      startFailed: "No se pudo iniciar el pago",
    },
    orderStatus: {
      lookingUp: "Buscando su pedido…",
      pending: "Se está confirmando el pago. Suele tardar unos segundos.",
      paid: "Pago recibido. Estamos preparando su pedido.",
      shipped: "Su pedido está en camino.",
      delivered: "Su pedido ha sido entregado.",
      cancelled: "Este pedido fue cancelado.",
      refunded: "Este pedido ha sido reembolsado.",
      oversold:
        "El pago se realizó pero las existencias ya se habían agotado. Le estamos reembolsando y nos pondremos en contacto.",
      notFound: "No encontramos ese número de pedido.",
      safeToClose:
        "Puede cerrar esta página — le enviaremos un correo en cuanto se confirme.",
      continueShopping: "Seguir comprando",
    },
    page: {
      cart: "Carrito",
      checkout: "Pago",
      orderThankYou: "Gracias",
      order: "Pedido",
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
