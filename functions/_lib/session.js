const encoder = new TextEncoder();
const COOKIE = "airthere_portal";
const SHARE_COOKIE = "airthere_share";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const SHARE_MAX_AGE_SECONDS = 60 * 60 * 24;

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const b64urlToBytes = (value) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const hmacKey = async (secret) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

const sign = async (secret, payload) => {
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(body))
  );
  return `${body}.${b64url(signature)}`;
};

const verify = async (secret, token) => {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlToBytes(signature),
    encoder.encode(body)
  );
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
  } catch {
    return null;
  }
};

export const createPortalCookie = async ({ secret, customerId, slug, secure }) => {
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const token = await sign(secret, { v: 1, cid: customerId, slug, exp });
  const parts = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
};

export const clearPortalCookie = (secure) => {
  const parts = [
    `${COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
};

export const readPortalSession = async (request, secret) => {
  if (!secret) return null;
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return null;
  const payload = await verify(secret, match[1]);
  if (!payload || payload.v !== 1 || !payload.cid || payload.kind) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
};

const cookieParts = (name, value, maxAge, secure) => {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
};

export const createShareCookie = async ({ secret, shareId, secure }) => {
  if (!secret || !shareId) return null;
  const exp = Math.floor(Date.now() / 1000) + SHARE_MAX_AGE_SECONDS;
  const token = await sign(secret, { v: 1, kind: "share", sid: shareId, exp });
  return cookieParts(SHARE_COOKIE, token, SHARE_MAX_AGE_SECONDS, secure);
};

export const clearShareCookie = (secure) => cookieParts(SHARE_COOKIE, "", 0, secure);

export const readShareSession = async (request, secret) => {
  if (!secret) return null;
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${SHARE_COOKIE}=([^;]+)`));
  if (!match) return null;
  const payload = await verify(secret, match[1]);
  if (!payload || payload.v !== 1 || payload.kind !== "share" || !payload.sid) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
};
