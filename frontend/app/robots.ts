import type { MetadataRoute } from "next";
import {
  absoluteUrl,
  getSiteUrl,
  isProductionIndexableSite,
  ROBOTS_DISALLOW_PATHS,
} from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  if (!isProductionIndexableSite()) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...ROBOTS_DISALLOW_PATHS],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: getSiteUrl(),
  };
}
