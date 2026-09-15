import { json } from "./http.js";
import {
  denyCapability,
  hasCapability,
  normalizeEmail,
  publicOperator,
} from "./authorize.js";
import { isLocalHost, isPreviewHost } from "./preview.js";
import { bindingPresence } from "./runtime.js";

const jwksCache = new Map();

const b64urlToBytes = (value) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const parseJsonB64 = (value) => JSON.parse(new TextDecoder().decode(b64urlToBytes(value)));

const getJwks = async (teamDomain) => {
  const cached = jwksCache.get(teamDomain);
  if (cached && cached.expires > Date.now()) return cached.keys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("Unable to load Access signing keys.");
  const data = await response.json();
  jwksCache.set(teamDomain, { keys: data.keys || [], expires: Date.now() + 60 * 60 * 1000 });
  return data.keys || [];
};

const importRsaKey = async (jwk) =>
  crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

const emailFromAccessPayload = (payload) =>
  normalizeEmail(payload?.email || payload?.identity?.email || "");

const teamHostname = (value) =>
  String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");

export const verifyAccessJwt = async (token, env) => {
  const teamDomain = teamHostname(env.CF_ACCESS_TEAM_DOMAIN);
  const aud = env.CF_ACCESS_AUD;
  if (!teamDomain || !aud) {
    return { ok: false, reason: "not_configured" };
  }
  if (!token) return { ok: false, reason: "unauthenticated" };

  const parts = String(token).split(".");
  if (parts.length !== 3) return { ok: false, reason: "unauthenticated" };

  let header;
  let payload;
  try {
    header = parseJsonB64(parts[0]);
    payload = parseJsonB64(parts[1]);
  } catch {
    return { ok: false, reason: "unauthenticated" };
  }

  if (header.alg !== "RS256" || !header.kid) {
    return { ok: false, reason: "unauthenticated" };
  }

  if (payload.exp && payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: "unauthenticated" };
  }

  const expectedIss = `https://${teamDomain}`;
  if (payload.iss && String(payload.iss).replace(/\/$/, "") !== expectedIss) {
    return { ok: false, reason: "unauthenticated" };
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return { ok: false, reason: "unauthenticated" };

  try {
    const keys = await getJwks(teamDomain);
    const jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) return { ok: false, reason: "unauthenticated" };
    const cryptoKey = await importRsaKey(jwk);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!ok) return { ok: false, reason: "unauthenticated" };
  } catch {
    return { ok: false, reason: "unauthenticated" };
  }

  const email = emailFromAccessPayload(payload);
  if (!email) return { ok: false, reason: "unauthenticated" };
  return { ok: true, email };
};

const findOperator = async (db, email) => {
  if (!db || !email) return null;
  return db
    .prepare(
      `SELECT id, email, name, role, status, created_at, updated_at
       FROM admin_users
       WHERE email = ?`
    )
    .bind(email)
    .first();
};

const resolveOperator = async (db, email) => {
  const user = await findOperator(db, email);
  if (!user) return { ok: false, reason: "not_an_operator" };
  if (user.status !== "active") return { ok: false, reason: "disabled" };
  return { ok: true, user, email: user.email };
};

export const authenticateOperationalRequest = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  if (isPreviewHost(url) || env.PREVIEW_LOCKDOWN === "true") {
    return { ok: false, reason: "preview" };
  }

  if (env.DEV_ADMIN_BYPASS === "local" && isLocalHost(url)) {
    const email = normalizeEmail(env.DEV_ADMIN_EMAIL);
    if (!email) return { ok: false, reason: "not_configured" };
    return resolveOperator(env.DB, email);
  }

  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    request.headers.get("cf-access-jwt-assertion");
  const verified = await verifyAccessJwt(token, env);
  if (!verified.ok) return verified;
  return resolveOperator(env.DB, verified.email);
};

export const getAdminIdentity = authenticateOperationalRequest;

export const requireAdmin = async (context, capability) => {
  const identity = await authenticateOperationalRequest(context);
  if (!identity.ok) {
    if (identity.reason === "preview") {
      return json(
        {
          error: "Admin is not available on preview deployments.",
          preview: true,
          bindings: bindingPresence(context.env),
        },
        403
      );
    }
    if (identity.reason === "not_configured") {
      return json(
        {
          error:
            "Cloudflare Access is not configured yet. Admin APIs will unlock after Access is enabled.",
        },
        503
      );
    }
    if (identity.reason === "not_an_operator" || identity.reason === "disabled") {
      return json({ error: "This identity is not authorised for AirThere Admin." }, 403);
    }
    return json({ error: "Unauthorized." }, 401);
  }

  if (capability) {
    if (!hasCapability(identity.user, capability)) {
      const denied = denyCapability(capability);
      return json({ error: denied.error }, denied.status);
    }
  }

  return { user: identity.user, operator: publicOperator(identity.user) };
};
