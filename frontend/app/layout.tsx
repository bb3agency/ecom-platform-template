import type { Metadata } from "next";
import { interFont } from "@/lib/fonts";
import { APP_NAME, BRAND_LOGO_SRC } from "@/lib/constants";
import { getSiteUrl } from "@/lib/seo";
import { MaintenanceBanner } from "@/components/maintenance/MaintenanceBanner";
import { Toaster } from "@/components/ui/Toaster";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: `Premium naturally grown, lab-tested products from ${APP_NAME}.`,
  icons: {
    icon: BRAND_LOGO_SRC,
    shortcut: BRAND_LOGO_SRC,
    apple: BRAND_LOGO_SRC,
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    siteName: APP_NAME,
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${interFont.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/*
        `overflow-x-clip`, never `overflow-x-hidden`. Per the CSS overflow spec a
        non-`visible`/`clip` value on one axis forces the other axis to compute
        to `auto`, so `overflow-x: hidden` silently turns <body> into a scroll
        container. That breaks `position: sticky` against the viewport and
        competes with any root-level custom scroller a client theme installs.
        `clip` suppresses the same horizontal overflow without establishing a
        scroll container.
      */}
      <body className="min-h-full flex flex-col font-sans overflow-x-clip" suppressHydrationWarning>
        {/*
          Global maintenance banner. Self-hides on /ops/* routes (operators
          already see the load-shed panel) and on `normal|reduced|emergency`
          modes. Polls every 60s in steady state, escalates to 5s when a
          maintenance window is pending so the countdown stays accurate.
        */}
        <MaintenanceBanner />
        {children}
        {/* Global toast popups — small, left-anchored, viewport-aware, ~3s auto-dismiss. */}
        <Toaster />
      </body>
    </html>
  );
}
