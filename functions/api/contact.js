const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const clean = (value, limit) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY) {
    return json({ error: "Email service is not configured." }, 503);
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid form submission." }, 400);
  }

  if (clean(payload.website, 200)) {
    return json({ ok: true });
  }

  const name = clean(payload.name, 120);
  const company = clean(payload.company, 160);
  const email = clean(payload.email, 254);
  const phone = clean(payload.phone, 60);
  const location = clean(payload.location, 160);
  const message = clean(payload.message, 5000);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!name || !emailPattern.test(email) || !message) {
    return json({ error: "Please complete the required fields." }, 400);
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "AirThere Website <website@send.airthere.com.au>",
      to: ["data@airthere.com.au"],
      reply_to: email,
      subject: `New project enquiry — ${company || name}`,
      html: `
        <h2>New AirThere project enquiry</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Company:</strong> ${escapeHtml(company || "Not provided")}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(phone || "Not provided")}</p>
        <p><strong>Project location:</strong> ${escapeHtml(location || "Not provided")}</p>
        <p><strong>Project details:</strong></p>
        <p>${escapeHtml(message).replaceAll("\n", "<br>")}</p>
      `,
    }),
  });

  if (!response.ok) {
    return json({ error: "We couldn't send your enquiry. Please try again." }, 502);
  }

  return json({ ok: true });
}
