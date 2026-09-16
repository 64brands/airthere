import { json } from "./http.js";
import { isPreviewHost } from "./preview.js";
import { readPortalSession } from "./session.js";
import { standardStatus } from "./derivatives.js";
import { formatDisplayDate } from "./validate.js";

export const CLIENT_SHOOT_STATUSES = new Set(["verified", "published"]);

export const isClientShoot = (shoot) => CLIENT_SHOOT_STATUSES.has(shoot?.status);

export const standardSrc = (imageId) => `/media/standard/${imageId}`;

export const publicPortalCustomer = (customer) => ({
  id: customer.id,
  name: customer.name,
  slug: customer.slug,
});

export const publicPortalProject = (project) => ({
  name: project.name,
  code: project.code,
});

export const readyStandardImages = (images = []) =>
  (images || []).filter((image) => standardStatus(image) === "ready");

export const publicPortalShoot = (shoot, images = []) => {
  const ready = readyStandardImages(images);
  const cover = ready[0] || null;
  return {
    date: shoot.shoot_date,
    display_date: formatDisplayDate(shoot.shoot_date),
    image_count: ready.length,
    cover_src: cover ? standardSrc(cover.id) : null,
  };
};

export const publicPortalImage = (image) => ({
  id: image.id,
  seq: image.seq,
  src: standardSrc(image.id),
});

export const requirePortalCustomer = async (context, db) => {
  const url = new URL(context.request.url);
  if (isPreviewHost(url) || context.env.PREVIEW_LOCKDOWN === "true") {
    return { error: json({ error: "Portal is not available on preview deployments." }, 403) };
  }
  if (!db) return { error: json({ error: "Database is not bound." }, 503) };
  const payload = await readPortalSession(context.request, context.env.SESSION_SECRET);
  if (!payload?.cid) return { error: json({ error: "Sign in required." }, 401) };
  const customer = await db
    .prepare(`SELECT id, name, slug, status FROM customers WHERE id = ?`)
    .bind(payload.cid)
    .first();
  if (!customer || customer.status !== "active") {
    return { error: json({ error: "Sign in required." }, 401) };
  }
  return { customer };
};
