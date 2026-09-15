import { authenticateOperationalRequest } from "./_lib/access.js";
import {
  accessRequiredResponse,
  operatorDeniedResponse,
  previewBlockedResponse,
} from "./_lib/pages.js";
import { canonicalHost, isPreviewHost } from "./_lib/preview.js";

const isAssetRequest = (pathname) =>
  pathname.startsWith("/assets/") ||
  pathname === "/styles.css" ||
  pathname === "/script.js" ||
  pathname === "/robots.txt" ||
  pathname === "/sitemap.xml" ||
  pathname === "/admin/admin.css" ||
  pathname === "/admin/admin.js";

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  const host = canonicalHost(context.env);

  if (url.hostname === `www.${host}`) {
    url.hostname = host;
    return Response.redirect(url.toString(), 301);
  }

  if (isAssetRequest(url.pathname)) {
    return context.next();
  }

  const path = url.pathname;
  const isAdmin =
    path === "/admin" || path === "/admin/" || path.startsWith("/admin/");
  const isAdminApi = path === "/api/admin" || path.startsWith("/api/admin/");
  const isPortalApi = path === "/api/portal" || path.startsWith("/api/portal/");
  const isMedia = path === "/media" || path.startsWith("/media/");

  if ((isAdmin || isAdminApi || isPortalApi || isMedia) && isPreviewHost(url)) {
    if (isAdmin) return previewBlockedResponse();
    return context.next();
  }

  if (isAdmin && context.request.method === "GET") {
    const identity = await authenticateOperationalRequest(context);
    if (identity.reason === "preview") return previewBlockedResponse();
    if (identity.reason === "not_an_operator" || identity.reason === "disabled") {
      return operatorDeniedResponse();
    }
    if (!identity.ok) return accessRequiredResponse();
    return context.next();
  }

  return context.next();
};
