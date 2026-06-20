import { Inter } from "next/font/google";

/** Site-wide Inter — body, headings, admin, ops, storefront. */
export const interFont = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

/** @deprecated Use `interFont` — kept for imports that expect separate body/heading tokens. */
export const bodyFont = interFont;

/** @deprecated Use `interFont` — kept for imports that expect separate body/heading tokens. */
export const headingFont = interFont;
