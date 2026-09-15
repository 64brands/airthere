export const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      ...extraHeaders,
    },
  });

export const html = (body, status = 200, extraHeaders = {}) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      ...extraHeaders,
    },
  });

export const noStore = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export const nowIso = () => new Date().toISOString();

export const newId = () => crypto.randomUUID();

export const splat = (params, key = "path") => {
  const value = params?.[key];
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value).split("/").filter(Boolean);
};

export const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

export const methodNotAllowed = (allow) =>
  json({ error: "Method not allowed." }, 405, { Allow: allow });
