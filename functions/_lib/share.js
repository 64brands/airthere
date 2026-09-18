import { json, newId, nowIso } from "./http.js";
import { mailEscape, sendMail } from "./mail.js";
import { isClientShoot } from "./portal.js";
import { canonicalHost, isLocalHost } from "./preview.js";
import { shareImageViewUrl } from "./report-links.js";
import { readShareSession } from "./session.js";
import { formatDisplayDate } from "./validate.js";

const encoder = new TextEncoder();
const TOKEN_BYTES = 32;
const OTP_DIGITS = 6;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_MS = 45 * 1000;
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
export const SHARE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SHARE_TTL_DAYS = new Set([1, 7, 30]);
export const DEFAULT_SHARE_TTL_DAYS = 7;

const bytesToHex = (bytes) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

export const randomShareToken = () => b64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));

export const randomOtp = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const value = new DataView(bytes.buffer).getUint32(0, false) % 1_000_000;
  return String(value).padStart(OTP_DIGITS, "0");
};

export const hashToken = async (token) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(String(token || "")))
  );
  return bytesToHex(digest);
};

const hmacOtp = async (secret, shareId, otp) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`${shareId}:${otp}`))
  );
  return bytesToHex(signature);
};

const timingSafeEqual = (left, right) => {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const maskEmail = (email) => {
  const value = String(email || "");
  const at = value.indexOf("@");
  if (at < 1) return "the recipient";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!domain) return "the recipient";
  return `${local[0]}•••@${domain}`;
};

export const sharePublicOrigin = (request, env) => {
  const url = new URL(request.url);
  if (isLocalHost(url)) return url.origin;
  return `https://${canonicalHost(env)}`;
};

const shareSelect = `
  SELECT r.*,
         c.name AS customer_name,
         c.slug AS customer_slug,
         c.status AS customer_status,
         p.name AS project_name,
         p.code AS project_code,
         p.status AS project_status,
         s.shoot_date,
         s.status AS shoot_status
    FROM report_shares r
    JOIN customers c ON c.id = r.customer_id
    JOIN projects p ON p.id = r.project_id
    JOIN shoots s ON s.id = r.shoot_id
`;

export const parseShareTtlDays = (value) => {
  if (value === undefined || value === null || value === "") {
    return { value: DEFAULT_SHARE_TTL_DAYS };
  }
  const days = Number(value);
  if (!SHARE_TTL_DAYS.has(days)) return { error: "Choose 1, 7, or 30 days." };
  return { value: days };
};

export const shareAccessStatus = (share, now = Date.now()) => {
  if (share?.revoked_at) return "revoked";
  const expiresAt = share?.expires_at ? Date.parse(share.expires_at) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return "expired";
  return "active";
};

export const isShareLive = (share, now = Date.now()) => shareAccessStatus(share, now) === "active";

export const publicPortalShare = (share, now = Date.now()) => ({
  id: share.id,
  recipient_email: share.recipient_email,
  created_at: share.created_at,
  expires_at: share.expires_at,
  status: shareAccessStatus(share, now),
});

export const loadShareByToken = async (db, token) => {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;
  const tokenHash = await hashToken(token);
  const share = await db.prepare(`${shareSelect} WHERE r.token_hash = ?`).bind(tokenHash).first();
  if (!share) return null;
  if (share.customer_status !== "active" || share.project_status !== "active") return null;
  if (!isClientShoot({ status: share.shoot_status })) return null;
  if (!isShareLive(share)) return null;
  return share;
};

export const listShootShares = async (db, { customerId, projectId, shootId }) => {
  const rows = await db
    .prepare(
      `SELECT id, recipient_email, created_at, expires_at, revoked_at
       FROM report_shares
       WHERE customer_id = ? AND project_id = ? AND shoot_id = ?
       ORDER BY created_at DESC`
    )
    .bind(customerId, projectId, shootId)
    .all();
  const now = Date.now();
  return (rows.results || []).map((row) => publicPortalShare(row, now));
};

export const revokeReportShare = async (db, { customerId, projectId, shootId, shareId }) => {
  if (!SHARE_ID_PATTERN.test(shareId)) return { error: "Not found.", status: 404 };
  const row = await db
    .prepare(
      `SELECT id, recipient_email, created_at, expires_at, revoked_at
       FROM report_shares
       WHERE id = ? AND customer_id = ? AND project_id = ? AND shoot_id = ?`
    )
    .bind(shareId, customerId, projectId, shootId)
    .first();
  if (!row) return { error: "Not found.", status: 404 };
  if (shareAccessStatus(row) !== "active") {
    return { error: "This share is no longer active.", status: 409 };
  }
  const revokedAt = nowIso();
  await db.prepare(`UPDATE report_shares SET revoked_at = ? WHERE id = ?`).bind(revokedAt, row.id).run();
  return { ok: true, share: publicPortalShare({ ...row, revoked_at: revokedAt }) };
};

export const shareUnavailable = () =>
  json({ error: "This report is no longer available." }, 404);

export const requireShareSession = async ({ request, env, db, token }) => {
  const share = await loadShareByToken(db, token);
  if (!share) return { error: shareUnavailable() };
  const session = await readShareSession(request, env.SESSION_SECRET);
  if (!session || session.sid !== share.id || !isShareLive(share)) {
    return { error: json({ error: "Please verify to view this report." }, 401), share };
  }
  return { share, session };
};

export const imageForShare = async (db, share, imageId) => {
  if (!share || !imageId) return null;
  return db
    .prepare(
      `SELECT i.*
       FROM images i
       JOIN shoots s ON s.id = i.shoot_id
       JOIN projects p ON p.id = s.project_id
       WHERE i.id = ? AND i.shoot_id = ? AND s.project_id = ? AND p.customer_id = ?`
    )
    .bind(imageId, share.shoot_id, share.project_id, share.customer_id)
    .first();
};

const invitationHtml = ({ customerName, projectName, captureDate, viewUrl }) => `
  <div style="font-family:Inter,Arial,sans-serif;color:#1f3356;line-height:1.55;max-width:560px">
    <p style="margin:0 0 18px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#e15f28;font-weight:700">OVERSITE Project Progress Report</p>
    <p style="margin:0 0 22px;font-size:16px">${mailEscape(customerName)} has shared the Project Progress Report for ${mailEscape(projectName)} — ${mailEscape(captureDate)}.</p>
    <p style="margin:0 0 28px">
      <a href="${mailEscape(viewUrl)}" style="display:inline-block;background:#e15f28;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">View Report</a>
    </p>
    <p style="margin:0;color:#5d6570;font-size:13px">This link is for the intended recipient only. A verification code will be sent to this email address.</p>
  </div>
`;

const otpHtml = ({ code, customerName, projectName }) => `
  <div style="font-family:Inter,Arial,sans-serif;color:#1f3356;line-height:1.55;max-width:560px">
    <p style="margin:0 0 18px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#e15f28;font-weight:700">OVERSITE verification code</p>
    <p style="margin:0 0 16px;font-size:16px">Use this code to view the Project Progress Report from ${mailEscape(customerName)} for ${mailEscape(projectName)}.</p>
    <p style="margin:0 0 18px;font-size:28px;letter-spacing:.28em;font-weight:600">${mailEscape(code)}</p>
    <p style="margin:0;color:#5d6570;font-size:13px">This code expires in 10 minutes and can be used once.</p>
  </div>
`;

export const createReportShare = async ({
  db,
  customer,
  project,
  shoot,
  email,
  origin,
  env,
  request,
  expiresInDays = DEFAULT_SHARE_TTL_DAYS,
}) => {
  const ttl = parseShareTtlDays(expiresInDays);
  if (ttl.error) return { error: ttl.error, status: 400 };
  const token = randomShareToken();
  const tokenHash = await hashToken(token);
  const id = newId();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.parse(createdAt) + ttl.value * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO report_shares (
         id, customer_id, project_id, shoot_id, recipient_email, token_hash, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, customer.id, project.id, shoot.id, email, tokenHash, createdAt, expiresAt)
    .run();

  const captureDate = formatDisplayDate(shoot.shoot_date);
  const viewUrl = `${origin}/share/${token}`;
  const mailed = await sendMail({
    env,
    request,
    to: email,
    subject: "OVERSITE Project Progress Report",
    html: invitationHtml({
      customerName: customer.name,
      projectName: project.name,
      captureDate,
      viewUrl,
    }),
  });
  if (!mailed.ok) {
    await db.prepare(`DELETE FROM report_shares WHERE id = ?`).bind(id).run();
    return { error: mailed.error, status: 502 };
  }
  return {
    ok: true,
    id,
    share: publicPortalShare({
      id,
      recipient_email: email,
      created_at: createdAt,
      expires_at: expiresAt,
      revoked_at: null,
    }),
  };
};

const persistOtp = async (db, shareId, otpHash, expiresAt, sentAt) => {
  await db
    .prepare(
      `UPDATE report_shares
       SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0, otp_sent_at = ?
       WHERE id = ?`
    )
    .bind(otpHash, expiresAt, sentAt, shareId)
    .run();
};

export const issueShareOtp = async ({ db, env, request, share, force = false }) => {
  if (!env.SESSION_SECRET) {
    return { error: "This report is not available right now.", status: 503 };
  }
  const now = Date.now();
  const lastSent = share.otp_sent_at ? Date.parse(share.otp_sent_at) : 0;
  const expiresAtMs = share.otp_expires_at ? Date.parse(share.otp_expires_at) : 0;
  const hasLiveOtp = Boolean(share.otp_hash) && expiresAtMs > now;
  if (!force && hasLiveOtp && lastSent && now - lastSent < OTP_RESEND_MS) {
    return { ok: true, throttled: true };
  }
  if (force && lastSent && now - lastSent < OTP_RESEND_MS) {
    return { error: "Please wait a moment before requesting another code.", status: 429 };
  }

  const otp = randomOtp();
  const expiresAt = new Date(now + OTP_TTL_MS).toISOString();
  const otpHash = await hmacOtp(env.SESSION_SECRET, share.id, otp);
  const sentAt = nowIso();
  await persistOtp(db, share.id, otpHash, expiresAt, sentAt);

  const mailed = await sendMail({
    env,
    request,
    to: share.recipient_email,
    subject: "Your OVERSITE verification code",
    html: otpHtml({
      code: otp,
      customerName: share.customer_name,
      projectName: share.project_name,
    }),
  });
  if (!mailed.ok) {
    return { error: mailed.error, status: 502 };
  }
  return { ok: true };
};

export const verifyShareOtp = async ({ db, env, share, code }) => {
  if (!env.SESSION_SECRET) {
    return { error: "This report is not available right now.", status: 503 };
  }
  const otp = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(otp)) {
    return { error: "Enter the 6-digit code.", status: 400 };
  }
  if (!share.otp_hash || !share.otp_expires_at) {
    return { error: "Request a new code to continue.", status: 400 };
  }
  if (Number(share.otp_attempts || 0) >= OTP_MAX_ATTEMPTS) {
    return { error: "Too many attempts. Request a new code.", status: 429 };
  }
  if (Date.parse(share.otp_expires_at) <= Date.now()) {
    await db
      .prepare(`UPDATE report_shares SET otp_hash = NULL, otp_expires_at = NULL WHERE id = ?`)
      .bind(share.id)
      .run();
    return { error: "That code has expired. Request a new code.", status: 400 };
  }

  const expected = await hmacOtp(env.SESSION_SECRET, share.id, otp);
  if (!timingSafeEqual(expected, share.otp_hash)) {
    const attempts = Number(share.otp_attempts || 0) + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await db
        .prepare(
          `UPDATE report_shares
           SET otp_attempts = ?, otp_hash = NULL, otp_expires_at = NULL
           WHERE id = ?`
        )
        .bind(attempts, share.id)
        .run();
      return { error: "Too many attempts. Request a new code.", status: 429 };
    }
    await db
      .prepare(`UPDATE report_shares SET otp_attempts = ? WHERE id = ?`)
      .bind(attempts, share.id)
      .run();
    return { error: "That code is incorrect.", status: 401 };
  }

  await db
    .prepare(
      `UPDATE report_shares
       SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0
       WHERE id = ?`
    )
    .bind(share.id)
    .run();
  return { ok: true };
};

export const shareHrefForToken = (origin, token) => (image) =>
  shareImageViewUrl({ origin, token, imageId: image.id });
