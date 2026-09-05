import type { Theme } from "@/themes/contract";
import { Shell } from "./layout/Shell";
import { CartView } from "./views/CartView";
import { CheckoutView } from "./views/CheckoutView";
import { HomeView } from "./views/HomeView";
import { OrderView } from "./views/OrderView";
import { ProductDetailView } from "./views/ProductDetailView";
import { ProductListView } from "./views/ProductListView";
import { UseCaseView } from "./views/UseCaseView";

export const defaultTheme: Theme = {
  meta: {
    name: "default",
    description:
      "Technical clean — IBM Plex, borders instead of shadows, specification-first layouts for industrial catalogues.",
  },
  Shell,
  HomeView,
  ProductListView,
  ProductDetailView,
  UseCaseView,
  CartView,
  CheckoutView,
  OrderView,
};
