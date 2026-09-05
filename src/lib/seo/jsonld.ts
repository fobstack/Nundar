import { CURRENCY_MINOR_UNITS, type Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import { fromMinor } from "@/lib/money";

type JsonLd = Record<string, unknown>;

type OfferVariant = {
  sku: string;
  stock: number;
  moq: number;
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
  priceMinor: number | null;
  priceCurrency: Currency | null;
};

/**
 * schema.org expects price as a decimal string in major units ("99.00").
 * Passing the minor-unit integer straight through makes Google read 9900.
 */
function priceString(minor: number, currency: Currency): string {
  return fromMinor(minor, currency).toFixed(CURRENCY_MINOR_UNITS[currency]);
}

function offerFor(variant: OfferVariant, productUrl: string): JsonLd | null {
  if (variant.priceMinor === null || variant.priceCurrency === null) {
    // An unpriced SKU emits no offer: a price of 0 raises a Google Merchant error
    return null;
  }

  const offer: JsonLd = {
    "@type": "Offer",
    sku: variant.sku,
    url: productUrl,
    price: priceString(variant.priceMinor, variant.priceCurrency),
    priceCurrency: variant.priceCurrency,
    availability:
      variant.stock > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
  };

  if (variant.moq > 1) {
    offer.eligibleQuantity = {
      "@type": "QuantitativeValue",
      minValue: variant.moq,
      unitCode: "C62", // UN/CEFACT code for "piece"
    };
  }

  if (variant.leadTimeDaysMin !== null && variant.leadTimeDaysMax !== null) {
    offer.shippingDetails = {
      "@type": "OfferShippingDetails",
      deliveryTime: {
        "@type": "ShippingDeliveryTime",
        transitTime: {
          "@type": "QuantitativeValue",
          minValue: variant.leadTimeDaysMin,
          maxValue: variant.leadTimeDaysMax,
          unitCode: "DAY",
        },
      },
    };
  }

  return offer;
}

export function productJsonLd(input: {
  name: string;
  description: string | null;
  url: string;
  images?: string[];
  variants: OfferVariant[];
}): JsonLd {
  const offers = input.variants
    .map((variant) => offerFor(variant, input.url))
    .filter((offer): offer is JsonLd => offer !== null);

  const ld: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    url: input.url,
  };

  if (input.description) {
    ld.description = input.description;
  }
  if (input.images?.length) {
    ld.image = input.images;
  }
  if (offers.length) {
    ld.offers = offers;
  }

  return ld;
}

export function breadcrumbJsonLd(
  items: { name: string; url: string }[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * Structured data for a use-case landing page.
 * mainEntityOfPage points at the landing page itself, not at the product page.
 * Pointing at the product page tells Google this page is an appendage of it,
 * forfeiting the independent ranking the long-tail term is there to win.
 */
export function buildUseCaseJsonLd(input: {
  headline: string;
  body: string | null;
  url: string;
  productName: string;
  productUrl: string;
  locale: Locale;
}): JsonLd {
  const ld: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    inLanguage: input.locale,
    mainEntityOfPage: input.url,
    about: {
      "@type": "Product",
      name: input.productName,
      url: input.productUrl,
    },
  };

  if (input.body) {
    ld.articleBody = input.body;
  }

  return ld;
}
