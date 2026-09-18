import { documentPage } from "./pages.js";
import { formatDisplayDate } from "./validate.js";
import { maskEmail } from "./share.js";

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const shareDocument = ({ title, view, token, imageId = "", authed = false, gallery = null, body }) =>
  documentPage({
    title,
    extraHead: `
    <link rel="stylesheet" href="/assets/share.css" />
    <script src="/assets/lightbox.js" defer></script>
    <script src="/assets/share.js" defer></script>
    `,
    bodyClass: "share-body",
    bodyAttrs: `data-view="${escapeHtml(view)}" data-token="${escapeHtml(
      token
    )}" data-image-id="${escapeHtml(imageId)}" data-authed="${authed ? "true" : "false"}"`,
    body: `
    ${
      gallery
        ? `<script type="application/json" id="share-gallery">${JSON.stringify(gallery).replaceAll(
            "<",
            "\\u003c"
          )}</script>`
        : ""
    }
    ${body}
    `,
  });

const chrome = () => `
  <header class="share-header">
    <img class="share-brand" src="/assets/airthere-logo.svg" alt="AirThere" />
    <img class="share-oversite" src="/assets/oversite-logo.png" alt="OVERSITE" />
  </header>
`;

export const shareMissingPage = () =>
  shareDocument({
    title: "Report unavailable — OVERSITE",
    view: "missing",
    token: "",
    body: `
    ${chrome()}
    <main class="share-main">
      <section class="share-card">
        <p class="share-kicker">OVERSITE</p>
        <h1>This report link is not available.</h1>
        <p class="share-copy">The link may be incorrect, or this report is no longer available.</p>
      </section>
    </main>
    `,
  });

export const shareVerifyPage = ({ share, token, error = "", nextPath = "" }) =>
  shareDocument({
    title: "Verify to view report — OVERSITE",
    view: "verify",
    token,
    body: `
    ${chrome()}
    <main class="share-main">
      <section class="share-card">
        <p class="share-kicker">OVERSITE</p>
        <h1>Project Progress Report</h1>
        <p class="share-copy">${escapeHtml(share.customer_name)} · ${escapeHtml(
          share.project_name
        )} · ${escapeHtml(formatDisplayDate(share.shoot_date))}</p>
        <p class="share-hint">We’ll send a verification code to ${escapeHtml(
          maskEmail(share.recipient_email)
        )}.</p>
        ${error ? `<p class="share-error" role="alert">${escapeHtml(error)}</p>` : ""}
        <form class="share-otp-form" id="share-otp-form">
          <input type="hidden" name="next" value="${escapeHtml(nextPath)}" />
          <label class="share-label" for="share-otp">Verification code</label>
          <input
            id="share-otp"
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            maxlength="6"
            minlength="6"
            required
          />
          <button class="button" type="submit">View Report</button>
        </form>
        <button class="share-resend" type="button" id="share-resend">Resend code</button>
        <p class="share-status" id="share-status" role="status"></p>
      </section>
    </main>
    `,
  });

export const shareReportPage = ({ share, token, gallery }) =>
  shareDocument({
    title: "Project Progress Report — OVERSITE",
    view: "report",
    token,
    authed: true,
    gallery,
    body: `
    ${chrome()}
    <main class="share-main">
      <section class="share-card share-report">
        <p class="share-kicker">OVERSITE</p>
        <h1>Project Progress Report</h1>
        <dl class="share-meta">
          <div><dt>Client</dt><dd>${escapeHtml(share.customer_name)}</dd></div>
          <div><dt>Project</dt><dd>${escapeHtml(share.project_name)}</dd></div>
          <div><dt>Capture Date</dt><dd>${escapeHtml(formatDisplayDate(share.shoot_date))}</dd></div>
        </dl>
        <div class="share-actions">
          <a class="button" href="/share/${escapeHtml(token)}/report" target="_blank" rel="noopener">View Report</a>
          <a class="button-secondary" href="/share/${escapeHtml(token)}/report?download=1">Download PDF</a>
        </div>
      </section>
    </main>
    `,
  });

export const shareImagePage = ({ share, token, imageId, gallery }) =>
  shareDocument({
    title: "Project photograph — OVERSITE",
    view: "image",
    token,
    imageId,
    authed: true,
    gallery,
    body: `
    ${chrome()}
    <main class="share-main">
      <section class="share-card share-report">
        <p class="share-kicker">OVERSITE</p>
        <h1>Project Progress Report</h1>
        <p class="share-copy">${escapeHtml(share.customer_name)} · ${escapeHtml(
          share.project_name
        )} · ${escapeHtml(formatDisplayDate(share.shoot_date))}</p>
        <p class="share-copy">Opening the project photograph…</p>
        <p><a class="text-link" href="/share/${escapeHtml(token)}">Back to report</a></p>
      </section>
    </main>
    `,
  });

export const shareMessagePage = ({ title, heading, copy, token = "" }) =>
  shareDocument({
    title,
    view: "message",
    token,
    body: `
    ${chrome()}
    <main class="share-main">
      <section class="share-card">
        <p class="share-kicker">OVERSITE</p>
        <h1>${escapeHtml(heading)}</h1>
        <p class="share-copy">${escapeHtml(copy)}</p>
      </section>
    </main>
    `,
  });
