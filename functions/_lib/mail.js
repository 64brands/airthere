import { json, newId, nowIso } from "./http.js";
import { isLocalHost } from "./preview.js";

const RESEND_URL = "https://api.resend.com/emails";
const FROM = "OVERSITE by AirThere <website@send.airthere.com.au>";

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const mailEscape = escapeHtml;

export const sendMail = async ({ env, request, to, subject, html }) => {
  const recipient = String(to || "").trim();
  if (!recipient || !subject || !html) {
    return { ok: false, error: "We couldn't send the email just now. Please try again." };
  }

  if (env.RESEND_API_KEY) {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [recipient],
        subject,
        html,
      }),
    });
    if (!response.ok) {
      return { ok: false, error: "We couldn't send the email just now. Please try again." };
    }
    return { ok: true, via: "resend" };
  }

  const url = request ? new URL(request.url) : null;
  const localSink =
    env.DEV_ADMIN_BYPASS === "local" && (!url || isLocalHost(url));
  if (!localSink || !env.DB) {
    return { ok: false, error: "Email service is not configured." };
  }

  await env.DB.prepare(
    `INSERT INTO share_outbound_mail (id, to_email, subject, html, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(newId(), recipient, subject, html, nowIso())
    .run();
  return { ok: true, via: "local" };
};
