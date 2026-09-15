export const isPreviewHost = (url) => {
  const host = url.hostname;
  return host.endsWith(".pages.dev") || host.endsWith(".workers.dev");
};

export const isLocalHost = (url) => {
  const host = url.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
};

export const canonicalHost = (env) => env.CANONICAL_HOST || "airthere.com.au";

export const isSecureRequest = (url) => url.protocol === "https:";
