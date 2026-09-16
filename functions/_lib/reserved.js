export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "assets",
  "media",
  "portal",
  "login",
  "legal",
  "contact",
  "reporting",
  "static",
  "index",
  "index.html",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "styles.css",
  "script.js",
  "404",
  "404.html",
  "www",
  "cdn-cgi",
  "functions",
  "wrangler",
  "ovpg.html",
]);

export const isReservedSlug = (slug) =>
  RESERVED_SLUGS.has(String(slug || "").trim().toLowerCase());
