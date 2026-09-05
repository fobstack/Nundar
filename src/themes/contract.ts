import type { ComponentType, ReactNode } from "react";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import type {
  ProductDetail,
  ProductListItem,
  ProductUseCase,
} from "@/lib/queries/products";
import type { StorefrontMessages } from "@/lib/storefront/i18n";

/**
 * The theme contract.
 *
 * The route layer fetches data, produces the SEO metadata (hreflang, canonical,
 * JSON-LD), computes paths, and supplies the interface strings. A theme decides
 * only how things look. That way swapping themes can never touch the SEO logic,
 * which is the whole long-tail strategy — giving theme authors the opportunity
 * to break it is not an acceptable trade.
 *
 * A theme never assembles a URL and never translates an interface string. Both
 * arrive through these props, so a theme author needs no German to ship a
 * German-correct storefront. What a theme *does* own is voice: hero copy,
 * section headings, taglines. The rule is that getting a `t` string wrong is a
 * bug, while saying something different in a heading is a design choice.
 *
 * Once published, these types are a public interface: changing one affects
 * every theme at once and is a breaking change.
 *
 * ## The part TypeScript cannot enforce
 *
 * `LiveStock` replaces the stock and price baked into a static page after
 * hydration, and it finds what to replace through DOM attributes rather than
 * through props. A `ProductDetailView` must therefore mark up each SKU as:
 *
 * ```tsx
 * <div data-variant-id={variant.id}>
 *   <span data-price>…</span>
 *   <span data-stock>…</span>
 * </div>
 * ```
 *
 * Omitting them compiles, renders, and looks correct — the page simply keeps
 * showing whatever stock was true when it was generated, which is the failure
 * this whole mechanism exists to prevent. Both shipped themes emit them; a new
 * theme must too.
 *
 * ## Scoping
 *
 * A theme's stylesheet must declare everything under `.theme-<name>` and
 * nothing on `:root`. The registry imports every registered theme statically,
 * so all their stylesheets share one bundle regardless of which one THEME
 * selects, and tokens on the document root would collide with the last one
 * loaded winning. `tests/themes/contract.test.ts` enforces this.
 */

/** Site-level paths, computed by the route layer. A theme never assembles a URL. */
export type SiteUrls = {
  home: string;
  products: string;
  cart: string;
  checkout: string;
  /** Where this page lives in each other language; a missing language is simply absent */
  localeSwitch: Partial<Record<Locale, string>>;
};

export type ShellProps = {
  locale: Locale;
  currency: Currency;
  t: StorefrontMessages;
  urls: SiteUrls;
  children: ReactNode;
};

export type HomeViewProps = {
  locale: Locale;
  currency: Currency;
  t: StorefrontMessages;
  products: ProductListItem[];
  /** Use cases promoted to landing pages, for linking from the home page */
  applications: {
    title: string;
    productName: string;
    href: string;
  }[];
  urls: SiteUrls & {
    product: (slug: string) => string;
  };
};

export type ProductListViewProps = {
  locale: Locale;
  currency: Currency;
  t: StorefrontMessages;
  products: ProductListItem[];
  urls: SiteUrls & {
    product: (slug: string) => string;
  };
};

export type ProductDetailViewProps = {
  locale: Locale;
  currency: Currency;
  t: StorefrontMessages;
  product: ProductDetail;
  urls: SiteUrls & {
    useCase: (scenarioSlug: string) => string;
  };
};

export type UseCaseViewProps = {
  locale: Locale;
  currency: Currency;
  t: StorefrontMessages;
  product: ProductDetail;
  useCase: ProductUseCase;
  /** The product's other landing-page use cases, for internal linking */
  siblings: { title: string; href: string }[];
  urls: SiteUrls & {
    product: string;
    useCase: (scenarioSlug: string) => string;
  };
};

export type CartViewProps = {
  locale: Locale;
  currency: Currency;
  t: StorefrontMessages;
  urls: SiteUrls;
};

export type CheckoutViewProps = {
  locale: Locale;
  currency: Currency;
  t: StorefrontMessages;
  urls: SiteUrls;
};

export type OrderViewProps = {
  locale: Locale;
  t: StorefrontMessages;
  orderNo: string;
  urls: SiteUrls;
};

export type ThemeMeta = {
  /** The directory name, which is also the value of the THEME variable */
  name: string;
  description: string;
};

export type Theme = {
  meta: ThemeMeta;
  Shell: ComponentType<ShellProps>;
  HomeView: ComponentType<HomeViewProps>;
  ProductListView: ComponentType<ProductListViewProps>;
  ProductDetailView: ComponentType<ProductDetailViewProps>;
  UseCaseView: ComponentType<UseCaseViewProps>;
  CartView: ComponentType<CartViewProps>;
  CheckoutView: ComponentType<CheckoutViewProps>;
  OrderView: ComponentType<OrderViewProps>;
};
