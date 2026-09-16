import { json, methodNotAllowed, splat } from "../_lib/http.js";
import { JPEG_CONTENT_TYPE } from "../_lib/ingest.js";
import { imageForCustomer } from "../_lib/ownership.js";
import { isPreviewHost } from "../_lib/preview.js";
import { requirePortalCustomer } from "../_lib/portal.js";
import { standardStatus } from "../_lib/derivatives.js";

const safeFilename = (name) =>
  String(name || "standard.jpg").replace(/[^\w.-]+/g, "_");

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  if (isPreviewHost(url) || context.env.PREVIEW_LOCKDOWN === "true") {
    return json({ error: "Media is not available on preview deployments." }, 403);
  }
  if (context.request.method !== "GET") return methodNotAllowed("GET");

  const parts = splat(context.params);
  if (parts.length !== 2 || parts[0] !== "standard") {
    return json({ error: "Not found." }, 404);
  }

  const db = context.env.DB;
  const bucket = context.env.IMAGES;
  const auth = await requirePortalCustomer(context, db);
  if (auth.error) return auth.error;
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);

  const image = await imageForCustomer(db, auth.customer.id, parts[1]);
  if (!image || standardStatus(image) !== "ready" || !image.web_key) {
    return json({ error: "Not found." }, 404);
  }

  const object = await bucket.get(image.web_key);
  if (!object) return json({ error: "Not found." }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": JPEG_CONTENT_TYPE,
      "Cache-Control": "private, max-age=120",
      "Content-Disposition": `inline; filename="${safeFilename(image.generated_filename)}"`,
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
};
