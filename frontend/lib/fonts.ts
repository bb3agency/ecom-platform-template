import localFont from "next/font/local";

/**
 * Inter is SELF-HOSTED, not fetched from Google at build time.
 *
 * `next/font/google` downloads each face from fonts.gstatic.com during the build, so
 * every production build depended on a network round trip to Google. When it failed the
 * build died with "Error while looking up import map: next/font/google queries have
 * exactly one entry" — an error that names nothing useful and reads like a code fault.
 * It broke a CI run and a VPS deploy on the same day; both passed on a retry, which is
 * the signature of a flaky fetch rather than a real problem.
 *
 * The .woff2 in ./../assets/fonts is the exact latin-subset variable file Google was
 * serving, so rendering is unchanged — the build just no longer needs the internet.
 * Inter is SIL Open Font License, which permits bundling.
 *
 * To add a weight or subset, download the matching .woff2 from Google and add it here
 * rather than reaching for `next/font/google`.
 */
export const interFont = localFont({
  src: [
    {
      // Variable file: one download covers weights 100-900, so the 400/500/600/700 the
      // design uses all resolve from it.
      path: "../assets/fonts/inter-latin-variable.woff2",
      style: "normal",
      weight: "100 900",
    },
  ],
  variable: "--font-inter",
  display: "swap",
  // Matches Google's own fallback metrics for Inter, so the swap from the fallback face
  // does not shift layout.
  adjustFontFallback: "Arial",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

/** @deprecated Use `interFont` — kept for imports that expect separate body/heading tokens. */
export const bodyFont = interFont;

/** @deprecated Use `interFont` — kept for imports that expect separate body/heading tokens. */
export const headingFont = interFont;
