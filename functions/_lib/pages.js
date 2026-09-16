import { html } from "./http.js";

const fontLinks = `
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" />
    <link rel="icon" href="/assets/airthere-logo.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles.css" />
`;

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const documentPage = ({
  title,
  robots = "noindex, nofollow",
  body,
  extraHead = "",
  bodyClass = "",
  bodyAttrs = "",
}) => `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="${robots}" />
    <meta name="theme-color" content="#1f3356" />
    <title>${escapeHtml(title)}</title>
    ${fontLinks}
    ${extraHead}
  </head>
  <body${bodyClass ? ` class="${escapeHtml(bodyClass)}"` : ""}${bodyAttrs ? ` ${bodyAttrs}` : ""}>
    ${body}
  </body>
</html>`;

export const notFoundPage = () =>
  documentPage({
    title: "Page not found — AirThere",
    body: `
    <header class="site-header app-header">
      <a class="brand" href="/" aria-label="AirThere home">
        <img src="/assets/airthere-logo.svg" alt="AirThere" />
      </a>
    </header>
    <main class="app-page">
      <p class="eyebrow">404</p>
      <h1>This page is not available.</h1>
      <p class="app-copy">The address may be incorrect, or this part of AirThere has not been published yet.</p>
      <p><a class="button" href="/">Back to AirThere</a></p>
    </main>
    `,
  });

export const accessRequiredPage = () =>
  documentPage({
    title: "AirThere Admin",
    body: `
    <header class="site-header app-header">
      <a class="brand" href="/" aria-label="AirThere home">
        <img src="/assets/airthere-logo.svg" alt="AirThere" />
      </a>
    </header>
    <main class="app-page">
      <p class="eyebrow">Private operations</p>
      <h1>Admin requires Cloudflare Access.</h1>
      <p class="app-copy">
        AirThere Admin is protected by Cloudflare Access. Operational access also
        requires an active AirThere operator record. It is not available on
        preview deployments.
      </p>
      <p><a class="button" href="/">Back to AirThere</a></p>
    </main>
    `,
  });

export const operatorDeniedPage = () =>
  documentPage({
    title: "AirThere Admin",
    body: `
    <header class="site-header app-header">
      <a class="brand" href="/" aria-label="AirThere home">
        <img src="/assets/airthere-logo.svg" alt="AirThere" />
      </a>
    </header>
    <main class="app-page">
      <p class="eyebrow">Private operations</p>
      <h1>This identity is not authorised for AirThere Admin.</h1>
      <p class="app-copy">
        Cloudflare Access authenticated the request, but AirThere does not have
        an active operator record for that identity.
      </p>
      <p><a class="button" href="/">Back to AirThere</a></p>
    </main>
    `,
  });

export const previewBlockedPage = () =>
  documentPage({
    title: "AirThere Admin",
    body: `
    <header class="site-header app-header">
      <a class="brand" href="/" aria-label="AirThere home">
        <img src="/assets/airthere-logo.svg" alt="AirThere" />
      </a>
    </header>
    <main class="app-page">
      <p class="eyebrow">Preview</p>
      <h1>Admin is only available on airthere.com.au.</h1>
      <p class="app-copy">Preview deployments cannot open customer records or imagery.</p>
    </main>
    `,
  });

export const portalPage = ({
  customerName,
  slug,
  loggedIn,
  error = "",
  projectCode = "",
  shootDate = "",
}) =>
  documentPage({
    title: `${customerName} — AirThere`,
    extraHead: `
    <link rel="stylesheet" href="/portal/portal.css" />
    <script src="/assets/lightbox.js" defer></script>
    <script src="/portal/portal.js" defer></script>
    `,
    bodyClass: "portal-body",
    bodyAttrs: `data-slug="${escapeHtml(slug)}" data-name="${escapeHtml(
      customerName
    )}" data-authed="${loggedIn ? "true" : "false"}" data-project="${escapeHtml(
      projectCode
    )}" data-date="${escapeHtml(shootDate)}"`,
    body: `
    <a class="skip-link" href="#portal-main">Skip to content</a>
    <header class="portal-header">
      <a class="portal-brand" href="/${escapeHtml(slug)}" aria-label="AirThere">
        <img src="/assets/airthere-logo.svg" alt="AirThere" />
      </a>
      ${
        loggedIn
          ? `<div class="portal-header-meta">
               <p class="portal-header-customer">${escapeHtml(customerName)}</p>
               <form method="post" action="/api/portal/logout">
                 <input type="hidden" name="slug" value="${escapeHtml(slug)}" />
                 <button class="portal-signout" type="submit">Sign out</button>
               </form>
             </div>`
          : ""
      }
    </header>
    <main id="portal-main" class="portal-main">
      ${
        loggedIn
          ? `<div id="portal-app" class="portal-app"><p class="portal-quiet">Loading…</p></div>`
          : `<section class="portal-login">
               <p class="portal-kicker">Private record</p>
               <h1>${escapeHtml(customerName)}</h1>
               ${error ? `<p class="portal-error" role="alert">${escapeHtml(error)}</p>` : ""}
               <form class="portal-login-form" method="post" action="/api/portal/login">
                 <input type="hidden" name="slug" value="${escapeHtml(slug)}" />
                 <label class="sr-only" for="portal-password">Password</label>
                 <input
                   id="portal-password"
                   type="password"
                   name="password"
                   autocomplete="current-password"
                   placeholder="Password"
                   required
                 />
                 <button class="button" type="submit">View project</button>
               </form>
             </section>`
      }
    </main>
    `,
  });

export const notFoundResponse = () => html(notFoundPage(), 404);
export const accessRequiredResponse = () => html(accessRequiredPage(), 401);
export const operatorDeniedResponse = () => html(operatorDeniedPage(), 403);
export const previewBlockedResponse = () => html(previewBlockedPage(), 403);
export const portalResponse = (opts, status = 200) => html(portalPage(opts), status);
