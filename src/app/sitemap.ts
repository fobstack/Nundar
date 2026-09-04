import type { MetadataRoute } from "next";
import { getDbAsync } from "@/db/client";
import { buildSitemapEntries } from "@/lib/seo/sitemap";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = await getDbAsync();
  return buildSitemapEntries(db);
}
