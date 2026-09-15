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

export const documentPage = ({ title, robots = "noindex, nofollow", body, extraHead = "" }) => `<!doctype html>
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
  <body>
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
        AirThere Admin is protected by Cloudflare Access using Google Workspace.
        It is not available until Access is enabled on this domain, and it is
        not available on preview deployments.
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

export const portalPage = ({ customerName, slug, loggedIn, error = "" }) =>
  documentPage({
    title: `${customerName} — AirThere`,
    extraHead: `<link rel="stylesheet" href="/admin/admin.css" />`,
    body: `
    <header class="site-header app-header">
      <a class="brand" href="/" aria-label="AirThere home">
        <img src="/assets/airthere-logo.svg" alt="AirThere" />
      </a>
    </header>
    <main class="app-page portal-page">
      <p class="eyebrow">${escapeHtml(customerName)}</p>
      <h1>${loggedIn ? "Portal" : "Client portal"}</h1>
      ${
        loggedIn
          ? `<p class="app-copy">You are signed in. Project history and shoot galleries will appear here in a later AirThere release.</p>
             <form method="post" action="/api/portal/logout">
               <input type="hidden" name="slug" value="${escapeHtml(slug)}" />
               <button class="button" type="submit">Sign out</button>
             </form>`
          : `<p class="app-copy">This portal is private. Enter the shared AirThere password for this project group.</p>
             ${error ? `<p class="form-error" role="alert">${escapeHtml(error)}</p>` : ""}
             <form class="portal-form" method="post" action="/api/portal/login">
               <input type="hidden" name="slug" value="${escapeHtml(slug)}" />
               <label>
                 <span>Password</span>
                 <input type="password" name="password" autocomplete="current-password" required />
               </label>
               <button class="button" type="submit">Enter portal</button>
             </form>`
      }
    </main>
    `,
  });

export const notFoundResponse = () => html(notFoundPage(), 404);
export const accessRequiredResponse = () => html(accessRequiredPage(), 401);
export const previewBlockedResponse = () => html(previewBlockedPage(), 403);
export const portalResponse = (opts, status = 200) => html(portalPage(opts), status);
