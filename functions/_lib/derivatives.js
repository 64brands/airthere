import { json } from "./http.js";
import { webObjectKey } from "./names.js";

const JPEG_CONTENT_TYPE = "image/jpeg";
export const MAX_STANDARD_SOURCE_BYTES = 20 * 1024 * 1024;
const TRANSFORM_URL = "https://airthere-image-transform/v1/standard";
const REPORT_TRANSFORM_URL = "https://airthere-image-transform/v1/report";

export const REPORT_LONG_EDGE = 1000;
export const REPORT_JPEG_QUALITY = 72;

export const standardStatus = (image) => {
  if (image?.web_key && (image.web_status === "ready" || !image.web_status)) return "ready";
  if (image?.web_status === "failed") return "failed";
  if (image?.web_status === "pending") return "pending";
  if (image?.verified_at) return "pending";
  return null;
};

const safeFilename = (name) =>
  String(name || "standard.jpg").replace(/[^\w.-]+/g, "_");

export const serveStandardObject = async ({ db, bucket, shootId, imageId }) => {
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);
  const image = await db
    .prepare(`SELECT * FROM images WHERE id = ? AND shoot_id = ?`)
    .bind(imageId, shootId)
    .first();
  if (!image || standardStatus(image) !== "ready" || !image.web_key) {
    return json({ error: "Web image not found." }, 404);
  }
  const object = await bucket.get(image.web_key);
  if (!object) return json({ error: "Web image is not in the archive." }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": JPEG_CONTENT_TYPE,
      "Cache-Control": "private, max-age=120",
      "Content-Disposition": `inline; filename="${safeFilename(image.generated_filename)}"`,
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
};

export const standardSummary = (images = []) => {
  const expected = images.filter((image) => Boolean(image.verified_at)).length;
  const ready = images.filter((image) => standardStatus(image) === "ready").length;
  const failed = images.filter((image) => standardStatus(image) === "failed").length;
  const pending = Math.max(0, expected - ready - failed);
  return {
    standard_expected: expected,
    standard_ready: ready,
    standard_failed: failed,
    standard_pending: pending,
  };
};

const needsPendingStandard = (image, skip) =>
  Boolean(image.verified_at) && standardStatus(image) === "pending" && !skip.has(image.id);

const needsFailedRetry = (image, skip) =>
  standardStatus(image) === "failed" && !skip.has(image.id);

const transformerError = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null);
    if (payload?.error) return String(payload.error);
  }
  const text = await response.text().catch(() => "");
  return text ? text.slice(0, 300) : `Transformer returned ${response.status}.`;
};

const requestEncodedJpeg = async (transformer, url, source, emptyMessage) => {
  const response = await transformer.fetch(url, {
    method: "POST",
    headers: { "content-type": JPEG_CONTENT_TYPE },
    body: source,
  });
  if (!response.ok) throw new Error(await transformerError(response));
  const webBytes = new Uint8Array(await response.arrayBuffer());
  if (!webBytes.byteLength) throw new Error(emptyMessage);
  return {
    bytes: webBytes,
    sourceWidth: Number(response.headers.get("x-airthere-source-width") || 0),
    sourceHeight: Number(response.headers.get("x-airthere-source-height") || 0),
    width: Number(response.headers.get("x-airthere-width") || 0),
    height: Number(response.headers.get("x-airthere-height") || 0),
  };
};

const requestStandardJpeg = async (transformer, source) =>
  requestEncodedJpeg(transformer, TRANSFORM_URL, source, "Standard JPEG was empty.");

export const requestReportJpeg = async (transformer, source) =>
  requestEncodedJpeg(
    transformer,
    REPORT_TRANSFORM_URL,
    source,
    "Report JPEG was empty."
  );

export const generateStandardForImage = async ({
  db,
  bucket,
  transformer,
  archive,
  image,
}) => {
  const current = standardStatus(image);
  if (current === "ready" && image.web_key) {
    const head = await bucket.head(image.web_key);
    if (head) {
      return {
        image_id: image.id,
        seq: image.seq,
        skipped: true,
        status: "ready",
        web_key: image.web_key,
      };
    }
  }

  if (!image.verified_at) {
    return {
      image_id: image.id,
      seq: image.seq,
      skipped: true,
      status: current,
      error: "Original is not verified yet.",
    };
  }

  if (!transformer) {
    throw new Error("Image transformer is not bound.");
  }

  const webKey = webObjectKey(
    archive.customer_slug,
    archive.project_code,
    archive.shoot_date,
    image.generated_filename
  );

  await db.prepare(`UPDATE images SET web_status = 'pending' WHERE id = ?`).bind(image.id).run();

  try {
    const original = await bucket.get(image.original_key);
    if (!original) throw new Error("Original is not in the archive.");
    const source = new Uint8Array(await original.arrayBuffer());
    if (source.byteLength !== Number(image.byte_size)) {
      throw new Error("Original size no longer matches the archive record.");
    }
    if (source.byteLength > MAX_STANDARD_SOURCE_BYTES) {
      throw new Error("Original is larger than the 20 MB Standard processing limit.");
    }

    const encoded = await requestStandardJpeg(transformer, source);

    await bucket.put(webKey, encoded.bytes, {
      httpMetadata: { contentType: JPEG_CONTENT_TYPE },
    });
    await db
      .prepare(`UPDATE images SET web_key = ?, web_status = 'ready' WHERE id = ?`)
      .bind(webKey, image.id)
      .run();

    return {
      image_id: image.id,
      seq: image.seq,
      skipped: false,
      status: "ready",
      web_key: webKey,
      width: encoded.width,
      height: encoded.height,
      byte_size: encoded.bytes.byteLength,
      source_width: encoded.sourceWidth,
      source_height: encoded.sourceHeight,
    };
  } catch (error) {
    await db.prepare(`UPDATE images SET web_status = 'failed' WHERE id = ?`).bind(image.id).run();
    return {
      image_id: image.id,
      seq: image.seq,
      skipped: false,
      status: "failed",
      error: String(error?.message || error),
    };
  }
};

export const generateShootStandards = async ({
  db,
  bucket,
  transformer,
  shootId,
  retry = false,
  skipIds = [],
}) => {
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);
  if (!transformer) return json({ error: "Image transformer is not bound." }, 503);

  const archive = await db
    .prepare(
      `SELECT s.*,
              p.code AS project_code,
              c.slug AS customer_slug
       FROM shoots s
       JOIN projects p ON p.id = s.project_id
       JOIN customers c ON c.id = p.customer_id
       WHERE s.id = ?`
    )
    .bind(shootId)
    .first();
  if (!archive) return json({ error: "Shoot not found." }, 404);

  const images = (
    await db.prepare(`SELECT * FROM images WHERE shoot_id = ? ORDER BY seq ASC`).bind(shootId).all()
  ).results || [];
  const skip = new Set((skipIds || []).map(String));
  const pending = images.filter((image) => needsPendingStandard(image, skip));
  const failed = images.filter((image) => needsFailedRetry(image, skip));
  const queued = pending.length ? pending : retry ? failed : [];

  if (!queued.length) {
    const counts = standardSummary(images);
    return json({
      processed: [],
      remaining_pending: counts.standard_pending,
      remaining: counts.standard_pending + (retry ? counts.standard_failed : 0),
      ...counts,
    });
  }

  const processed = await generateStandardForImage({
    db,
    bucket,
    transformer,
    archive,
    image: queued[0],
  });
  if (processed instanceof Response) return processed;

  const refreshed =
    (await db.prepare(`SELECT * FROM images WHERE shoot_id = ? ORDER BY seq ASC`).bind(shootId).all())
      .results || [];
  const counts = standardSummary(refreshed);
  return json({
    processed: [processed],
    remaining_pending: counts.standard_pending,
    remaining: counts.standard_pending + (retry ? counts.standard_failed : 0),
    ...counts,
  });
};
