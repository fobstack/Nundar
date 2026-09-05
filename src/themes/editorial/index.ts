import type { Theme } from "@/themes/contract";
import { Shell } from "./layout/Shell";
import { CartView } from "./views/CartView";
import { CheckoutView } from "./views/CheckoutView";
import { HomeView } from "./views/HomeView";
import { OrderView } from "./views/OrderView";
import { ProductDetailView } from "./views/ProductDetailView";
import { ProductListView } from "./views/ProductListView";
import { UseCaseView } from "./views/UseCaseView";

export const editorialTheme: Theme = {
  meta: {
    name: "editorial",
    description:
      "Editorial — serif display, warm paper, soft shadows over hairlines, and a home page that leads with application notes rather than the catalogue.",
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
