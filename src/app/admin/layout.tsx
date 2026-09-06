import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";

/**
 * Public Sans, the face of the US design system, built for dense
 * administrative interfaces and carrying real tabular figures — which this
 * admin needs, because prices and stock are read down a column rather than one
 * at a time. The storefront uses IBM Plex; the two surfaces should not be
 * mistaken for each other.
 */
const publicSans = Public_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // Nothing in the admin is indexed; robots.txt disallows /admin as well, and both
  // belts are deliberate
  robots: { index: false, follow: false },
};

/**
 * The frame every admin page shares: the typeface, the surface colour, and
 * staying out of the index.
 *
 * The navigation rail is not here — signing in and first-run setup have no shop
 * to navigate yet, and showing them a rail full of links they cannot follow was
 * a real defect in the previous layout.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${publicSans.variable} min-h-screen bg-muted/40 font-sans`}>
      {children}
    </div>
  );
}
