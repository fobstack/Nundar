import type { ComponentType, ReactNode } from "react";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import type {
  ProductDetail,
  ProductListItem,
  ProductUseCase,
} from "@/lib/queries/products";

/**
 * The theme contract.
 *
 * The route layer fetches data, produces the SEO metadata (hreflang, canonical,
 * JSON-LD) and computes paths. A theme decides only how things look. That way
 * swapping themes can never touch the SEO logic, which is the whole long-tail
 * strategy — giving theme authors the opportunity to break it is not an
 * acceptable trade.
 *
 * Once published, these types are a public interface: changing one affects
 * every theme at once and is a breaking change.
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
  urls: SiteUrls;
  children: ReactNode;
};

export type HomeViewProps = {
  locale: Locale;
  currency: Currency;
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
  products: ProductListItem[];
  urls: SiteUrls & {
    product: (slug: string) => string;
  };
};

export type ProductDetailViewProps = {
  locale: Locale;
  currency: Currency;
  product: ProductDetail;
  urls: SiteUrls & {
    useCase: (scenarioSlug: string) => string;
  };
};

export type UseCaseViewProps = {
  locale: Locale;
  currency: Currency;
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
  urls: SiteUrls;
};

export type CheckoutViewProps = {
  locale: Locale;
  currency: Currency;
  urls: SiteUrls;
};

export type OrderViewProps = {
  locale: Locale;
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
