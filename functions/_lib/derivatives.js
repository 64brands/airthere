import { json } from "./http.js";
import { webObjectKey } from "./names.js";

const JPEG_CONTENT_TYPE = "image/jpeg";

export const STANDARD_LONG_EDGE = 2000;
export const STANDARD_JPEG_QUALITY = 85;
export const MAX_STANDARD_SOURCE_BYTES = 20 * 1024 * 1024;

const toStream = (bytes) => new Blob([bytes]).stream();

export const standardStatus = (image) => {
  if (image?.web_key && (image.web_status === "ready" || !image.web_status)) return "ready";
  if (image?.web_status === "failed") return "failed";
  if (image?.web_status === "pending") return "pending";
  if (image?.verified_at) return "pending";
  return null;
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

const encodeJpeg = async (handle) =>
  handle.output({ format: "image/jpeg", quality: STANDARD_JPEG_QUALITY });

const resizeOptions = (width, height) => {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (w < 1 || h < 1) return {};
  if (w >= h && w > STANDARD_LONG_EDGE) return { width: STANDARD_LONG_EDGE };
  if (h > w && h > STANDARD_LONG_EDGE) return { height: STANDARD_LONG_EDGE };
  if (w === h && w > STANDARD_LONG_EDGE) return { width: STANDARD_LONG_EDGE };
  return {};
};

export const generateStandardForImage = async ({ db, bucket, transform, archive, image }) => {
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

  if (!transform) {
    throw new Error("Image transform is not bound.");
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

    const info = await transform.info(toStream(source));
    const sourceWidth = Number(info.width || 0);
    const sourceHeight = Number(info.height || 0);
    const ops = resizeOptions(sourceWidth, sourceHeight);
    let handle = transform.input(toStream(source));
    if (ops.width || ops.height) handle = handle.transform(ops);
    const encoded = await encodeJpeg(handle);
    const response = encoded.response();
    const webBytes = new Uint8Array(await response.arrayBuffer());
    if (!webBytes.byteLength) throw new Error("Standard JPEG was empty.");

    let webWidth = ops.width || sourceWidth;
    let webHeight = ops.height || sourceHeight;
    try {
      const webInfo = await transform.info(toStream(webBytes));
      webWidth = Number(webInfo.width || webWidth);
      webHeight = Number(webInfo.height || webHeight);
    } catch {
      /* local low-fidelity info is enough when present */
    }

    await bucket.put(webKey, webBytes, {
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
      width: webWidth,
      height: webHeight,
      byte_size: webBytes.byteLength,
      source_width: sourceWidth,
      source_height: sourceHeight,
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
  transform,
  shootId,
  retry = false,
  skipIds = [],
}) => {
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);
  if (!transform) return json({ error: "Image transform is not bound." }, 503);

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
    transform,
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
