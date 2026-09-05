import type { ComponentType, ReactNode } from "react";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import type {
  ProductDetail,
  ProductListItem,
  ProductUseCase,
} from "@/lib/queries/products";

/**
 * 主题契约。
 *
 * 路由层负责取数据、生成 SEO 元信息（hreflang / canonical / JSON-LD）与计算路径；
 * 主题只负责呈现。这样换主题永远不会动到 SEO 逻辑——那是整套长尾词策略的命脉，
 * 让主题作者有机会写坏它是不可接受的。
 *
 * 这些类型一旦发布就是公开接口：改动会同时波及所有主题，等同于破坏性变更。
 */

/** 站点级路径。由路由层算好传入，主题不拼 URL。 */
export type SiteUrls = {
  home: string;
  products: string;
  cart: string;
  checkout: string;
  /** 切到其他语言时当前页面的对应地址，缺失的语言不出现在表里 */
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
  /** 已提升为独立落地页的工况，用于首页导流 */
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
  /** 同商品下其他已成页的工况，用于站内互链 */
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
  /** 目录名，也是 THEME 环境变量的取值 */
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
