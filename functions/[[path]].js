import { notFoundResponse, portalResponse } from "./_lib/pages.js";
import { isPreviewHost } from "./_lib/preview.js";
import { isReservedSlug } from "./_lib/reserved.js";
import { readPortalSession } from "./_lib/session.js";
import { projectByCodeForCustomer, shootForCustomer } from "./_lib/ownership.js";
import { DATE_PATTERN, PROJECT_CODE_PATTERN, SLUG_PATTERN } from "./_lib/validate.js";

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  const segments = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    return context.next();
  }

  if (
    url.pathname === "/admin" ||
    url.pathname === "/admin/" ||
    url.pathname.startsWith("/admin/") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/media/")
  ) {
    return context.next();
  }

  if (isPreviewHost(url) || context.env.PREVIEW_LOCKDOWN === "true") {
    return notFoundResponse();
  }

  if (!segments.length || segments.length > 3) return notFoundResponse();

  const slug = segments[0];
  if (!SLUG_PATTERN.test(slug) || isReservedSlug(slug)) return notFoundResponse();

  if (segments[1] && !PROJECT_CODE_PATTERN.test(segments[1])) return notFoundResponse();
  if (segments[2] && !DATE_PATTERN.test(segments[2])) return notFoundResponse();

  const db = context.env.DB;
  if (!db) return notFoundResponse();

  const customer = await db
    .prepare(`SELECT id, name, slug, status FROM customers WHERE slug = ?`)
    .bind(slug)
    .first();

  if (!customer) return notFoundResponse();

  if (customer.status !== "active") return notFoundResponse();

  if (segments[1]) {
    const project = await projectByCodeForCustomer(db, customer.id, segments[1]);
    if (!project || project.status !== "active") return notFoundResponse();

    if (segments[2]) {
      const shoot = await db
        .prepare(
          `SELECT s.id
           FROM shoots s
           WHERE s.project_id = ? AND s.shoot_date = ?`
        )
        .bind(project.id, segments[2])
        .first();
      if (!shoot) return notFoundResponse();
      const owned = await shootForCustomer(db, customer.id, shoot.id);
      if (!owned) return notFoundResponse();
    }
  }

  const session = await readPortalSession(context.request, context.env.SESSION_SECRET);
  const loggedIn = Boolean(session && session.cid === customer.id);
  const errorParam = url.searchParams.get("error");
  const error =
    errorParam === "pending"
      ? "This portal password has not been set yet."
      : errorParam
        ? "Unable to sign in."
        : "";

  return portalResponse({
    customerName: customer.name,
    slug: customer.slug,
    loggedIn,
    error,
  });
};
