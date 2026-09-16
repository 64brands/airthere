import { json, newId, nowIso } from "./http.js";
import { compareSourceFilenames, generatedFilename, originalObjectKey } from "./names.js";

export const JPEG_CONTENT_TYPE = "image/jpeg";
export const MAX_ORIGINAL_BYTES = 100 * 1024 * 1024;
export const MAX_ORIGINALS = 200;

const COMPLETE_STATUSES = new Set(["uploaded", "verified", "published"]);
const LOCKED_STATUSES = new Set(["published"]);

export const isJpegFilename = (name) => {
  const lower = String(name || "").toLowerCase();
  return lower.endsWith(".jpg") || lower.endsWith(".jpeg");
};

export const isJpegBytes = (bytes) =>
  bytes &&
  bytes.length >= 3 &&
  bytes[0] === 0xff &&
  bytes[1] === 0xd8 &&
  bytes[2] === 0xff;

const sourceBasename = (name) => {
  const value = String(name || "").trim();
  if (!value || value.includes("/") || value.includes("\\") || value.includes("..")) {
    return "";
  }
  return value.slice(0, 180);
};

export const normalizeSourceFiles = (files) => {
  if (!Array.isArray(files) || files.length === 0) {
    return { error: "Select at least one JPEG." };
  }
  if (files.length > MAX_ORIGINALS) {
    return { error: `A shoot can take at most ${MAX_ORIGINALS} JPEGs in this upload.` };
  }

  const seen = new Set();
  const normalized = [];
  for (const file of files) {
    const originalFilename = sourceBasename(file?.original_filename || file?.name);
    if (!originalFilename) {
      return { error: "Each file needs an original filename." };
    }
    if (!isJpegFilename(originalFilename)) {
      return { error: `${originalFilename} is not a JPEG.` };
    }
    const byteSize = Number(file?.byte_size ?? file?.size);
    if (!Number.isInteger(byteSize) || byteSize < 1) {
      return { error: `${originalFilename} is missing a valid byte size.` };
    }
    if (byteSize > MAX_ORIGINAL_BYTES) {
      return { error: `${originalFilename} is larger than the 100 MB original limit.` };
    }
    const key = originalFilename.toLowerCase();
    if (seen.has(key)) {
      return { error: `Duplicate filename: ${originalFilename}` };
    }
    seen.add(key);
    normalized.push({ original_filename: originalFilename, byte_size: byteSize });
  }

  normalized.sort((left, right) =>
    compareSourceFilenames(left.original_filename, right.original_filename)
  );
  return { files: normalized };
};

export const publicImage = (row, extra = {}) => ({
  id: row.id,
  shoot_id: row.shoot_id,
  seq: row.seq,
  original_filename: row.original_filename,
  generated_filename: row.generated_filename,
  original_key: row.original_key,
  content_type: row.content_type,
  byte_size: Number(row.byte_size || 0),
  created_at: row.created_at,
  verified_at: row.verified_at || null,
  web_key: row.web_key || null,
  web_status: row.web_status || null,
  ...extra,
});

const filenameSet = (files) =>
  files.map((file) => file.original_filename.toLowerCase()).join("\n");

export const loadShootImages = async (db, shootId) => {
  const rows = await db
    .prepare(
      `SELECT * FROM images WHERE shoot_id = ? ORDER BY seq ASC`
    )
    .bind(shootId)
    .all();
  return rows.results || [];
};

const loadShootArchive = async (db, shootId) =>
  db
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

const shootHighWater = (shoot, images) => {
  const fromColumn = Number(shoot?.max_seq || 0);
  const fromRows = (images || []).reduce(
    (max, image) => Math.max(max, Number(image.seq || 0)),
    0
  );
  return Math.max(fromColumn, fromRows);
};

const insertImageStatement = (db, image) =>
  db
    .prepare(
      `INSERT INTO images (
         id, shoot_id, seq, original_filename, generated_filename, original_key,
         content_type, byte_size, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      image.id,
      image.shoot_id,
      image.seq,
      image.original_filename,
      image.generated_filename,
      image.original_key,
      image.content_type,
      image.byte_size,
      image.created_at
    );

const inspectHead = async (bucket, image) => {
  const head = await bucket.head(image.original_key);
  const stored = Boolean(head) && Number(head.size) === Number(image.byte_size);
  return {
    stored,
    stored_bytes: head ? Number(head.size) : 0,
    missing: !head,
    size_mismatch: Boolean(head) && Number(head.size) !== Number(image.byte_size),
  };
};

export const inspectOriginals = async (bucket, images) => {
  if (!bucket) {
    return images.map((image) =>
      publicImage(image, { stored: false, stored_bytes: 0, missing: true, size_mismatch: false })
    );
  }
  const flags = await Promise.all(images.map((image) => inspectHead(bucket, image)));
  return images.map((image, index) => publicImage(image, flags[index]));
};

const storedFlags = async (bucket, images) => inspectOriginals(bucket, images);

const verifiedRowCount = (images) =>
  (images || []).filter((image) => Boolean(image.verified_at)).length;

const persistShootArchiveState = async (
  db,
  shoot,
  images,
  { status, verifiedCount, verifiedAt }
) => {
  const highWater = shootHighWater(shoot, images);
  await db
    .prepare(
      `UPDATE shoots
       SET status = ?, expected_count = ?, verified_count = ?, verified_at = ?, max_seq = ?
       WHERE id = ?`
    )
    .bind(
      status,
      images.length,
      verifiedCount,
      verifiedAt,
      highWater,
      shoot.id
    )
    .run();
  return highWater;
};

const missingPayload = (image, reason) => ({
  seq: Number(image.seq),
  original_filename: image.original_filename,
  generated_filename: image.generated_filename,
  reason,
});

const verificationFailureMessage = (verifiedCount, expected, missing) => {
  if (expected === 0) return "This shoot has no originals to verify.";
  if (missing.length === 1 && missing[0].reason === "missing") {
    return "1 original is missing";
  }
  if (verifiedCount > 0) {
    return `Archive incomplete — ${verifiedCount} of ${expected} originals verified`;
  }
  return `Archive incomplete — ${missing.length} original${missing.length === 1 ? "" : "s"} not in the archive`;
};

export const startOriginalIngest = async ({ db, bucket, project, customer, shootDate, files }) => {
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);

  const planned = normalizeSourceFiles(files);
  if (planned.error) return json({ error: planned.error }, 400);

  const existing = await db
    .prepare(`SELECT * FROM shoots WHERE project_id = ? AND shoot_date = ?`)
    .bind(project.id, shootDate)
    .first();

  if (existing && COMPLETE_STATUSES.has(existing.status)) {
    return json({ error: "This project already has a shoot on that Shoot Date." }, 409);
  }

  if (existing) {
    const images = await loadShootImages(db, existing.id);
    const existingNames = filenameSet(
      images.map((image) => ({ original_filename: image.original_filename }))
    );
    const incomingNames = filenameSet(planned.files);
    if (images.length !== planned.files.length || existingNames !== incomingNames) {
      return json(
        {
          error:
            "An incomplete shoot already exists for this project and date. Re-select the same JPEGs to continue, or remove the incomplete shoot first.",
        },
        409
      );
    }
    if (existing.status === "draft") {
      await db
        .prepare(
          `UPDATE shoots SET status = 'uploading', expected_count = ?, max_seq = ? WHERE id = ?`
        )
        .bind(planned.files.length, planned.files.length, existing.id)
        .run();
      existing.status = "uploading";
      existing.expected_count = planned.files.length;
      existing.max_seq = planned.files.length;
    }
    return json({
      shoot_id: existing.id,
      reused: true,
      images: await storedFlags(bucket, images),
    });
  }

  const shootId = newId();
  const createdAt = nowIso();
  const imageRows = planned.files.map((file, index) => {
    const seq = index + 1;
    const filename = generatedFilename(project.code, shootDate, seq, "jpg");
    return {
      id: newId(),
      shoot_id: shootId,
      seq,
      original_filename: file.original_filename,
      generated_filename: filename,
      original_key: originalObjectKey(customer.slug, project.code, shootDate, filename),
      content_type: JPEG_CONTENT_TYPE,
      byte_size: file.byte_size,
      created_at: createdAt,
    };
  });

  const statements = [
    db
      .prepare(
        `INSERT INTO shoots (
           id, project_id, shoot_date, status, expected_count, verified_count, max_seq, created_at
         ) VALUES (?, ?, ?, 'uploading', ?, 0, ?, ?)`
      )
      .bind(shootId, project.id, shootDate, imageRows.length, imageRows.length, createdAt),
    ...imageRows.map((image) => insertImageStatement(db, image)),
  ];

  await db.batch(statements);

  return json(
    {
      shoot_id: shootId,
      reused: false,
      images: imageRows.map((image) => publicImage(image, { stored: false, stored_bytes: 0 })),
    },
    201
  );
};

export const storeOriginalObject = async ({ db, bucket, shootId, imageId, bytes }) => {
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);
  if (!isJpegBytes(bytes)) {
    return json({ error: "File is not a JPEG." }, 400);
  }
  if (bytes.length > MAX_ORIGINAL_BYTES) {
    return json({ error: "File is larger than the 100 MB original limit." }, 413);
  }

  const shoot = await db.prepare(`SELECT * FROM shoots WHERE id = ?`).bind(shootId).first();
  if (!shoot) return json({ error: "Shoot not found." }, 404);
  if (LOCKED_STATUSES.has(shoot.status)) {
    return json({ error: "This shoot can no longer be changed." }, 409);
  }

  const image = await db
    .prepare(`SELECT * FROM images WHERE id = ? AND shoot_id = ?`)
    .bind(imageId, shootId)
    .first();
  if (!image) return json({ error: "Image not found." }, 404);
  if (bytes.length !== Number(image.byte_size)) {
    return json(
      { error: "Uploaded bytes do not match the selected file size." },
      400
    );
  }

  const head = await bucket.head(image.original_key);
  if (head && Number(head.size) === bytes.length) {
    return json({
      image: publicImage(image, { stored: true, stored_bytes: Number(head.size), skipped: true }),
    });
  }
  if (head) {
    if (image.verified_at) {
      return json({ error: "A verified original cannot be replaced." }, 409);
    }
    return json(
      { error: "An original already exists at this archive path with a different size." },
      409
    );
  }

  await bucket.put(image.original_key, bytes, {
    httpMetadata: { contentType: JPEG_CONTENT_TYPE },
  });

  if (image.web_key) {
    try {
      await bucket.delete(image.web_key);
    } catch {
      /* stale Standard object should not block storing the original */
    }
  }
  await db
    .prepare(`UPDATE images SET web_key = NULL, web_status = NULL WHERE id = ?`)
    .bind(image.id)
    .run();
  image.web_key = null;
  image.web_status = null;

  if (image.verified_at) {
    await db.prepare(`UPDATE images SET verified_at = NULL WHERE id = ?`).bind(image.id).run();
    image.verified_at = null;
  }

  if (shoot.status === "verified" || shoot.verified_at) {
    await db
      .prepare(
        `UPDATE shoots SET status = 'uploading', verified_at = NULL WHERE id = ?`
      )
      .bind(shoot.id)
      .run();
  } else if (shoot.status !== "uploading") {
    await db.prepare(`UPDATE shoots SET status = 'uploading' WHERE id = ?`).bind(shoot.id).run();
  }

  const stored = await bucket.head(image.original_key);
  return json({
    image: publicImage(image, {
      stored: Boolean(stored),
      stored_bytes: stored ? Number(stored.size) : bytes.length,
      skipped: false,
    }),
  });
};

export const completeOriginalIngest = async ({ db, bucket, shootId }) => {
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);

  const shoot = await db.prepare(`SELECT * FROM shoots WHERE id = ?`).bind(shootId).first();
  if (!shoot) return json({ error: "Shoot not found." }, 404);
  if (LOCKED_STATUSES.has(shoot.status)) {
    return json({ error: "This shoot can no longer be changed." }, 409);
  }

  const images = await loadShootImages(db, shootId);
  if (!images.length) {
    return json({ error: "This shoot has no original image records." }, 409);
  }

  const missing = [];
  for (const image of images) {
    const head = await bucket.head(image.original_key);
    if (!head) {
      missing.push(missingPayload(image, "missing"));
      continue;
    }
    if (Number(head.size) !== Number(image.byte_size)) {
      missing.push(missingPayload(image, "size mismatch"));
    }
  }

  if (missing.length) {
    const stored = images.length - missing.length;
    const verifiedCount = verifiedRowCount(images);
    await persistShootArchiveState(db, shoot, images, {
      status: "uploading",
      verifiedCount,
      verifiedAt: null,
    });
    return json(
      {
        error: `Upload incomplete. ${stored} of ${images.length} originals stored.`,
        incomplete: true,
        expected_count: images.length,
        stored_count: stored,
        verified_count: verifiedCount,
        missing,
      },
      409
    );
  }

  const verifiedCount = verifiedRowCount(images);
  const fullyVerified = images.length > 0 && verifiedCount === images.length;
  const highWater = await persistShootArchiveState(db, shoot, images, {
    status: fullyVerified ? "verified" : "uploaded",
    verifiedCount,
    verifiedAt: fullyVerified ? shoot.verified_at || nowIso() : null,
  });

  return json({
    complete: true,
    status: fullyVerified ? "verified" : "uploaded",
    expected_count: images.length,
    stored_count: images.length,
    image_count: images.length,
    verified_count: verifiedCount,
    max_seq: highWater,
    message: `${images.length} original${images.length === 1 ? "" : "s"} in this shoot`,
  });
};

export const appendOriginals = async ({ db, bucket, shootId, files }) => {
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);

  const planned = normalizeSourceFiles(files);
  if (planned.error) return json({ error: planned.error }, 400);

  const shoot = await loadShootArchive(db, shootId);
  if (!shoot) return json({ error: "Shoot not found." }, 404);
  if (LOCKED_STATUSES.has(shoot.status)) {
    return json({ error: "This shoot can no longer be changed." }, 409);
  }

  const existing = await loadShootImages(db, shootId);
  if (existing.length + planned.files.length > MAX_ORIGINALS) {
    return json(
      {
        error: `A shoot can take at most ${MAX_ORIGINALS} JPEGs. This shoot already has ${existing.length}.`,
      },
      400
    );
  }

  const startSeq = shootHighWater(shoot, existing) + 1;
  const createdAt = nowIso();
  const imageRows = planned.files.map((file, index) => {
    const seq = startSeq + index;
    const filename = generatedFilename(shoot.project_code, shoot.shoot_date, seq, "jpg");
    return {
      id: newId(),
      shoot_id: shoot.id,
      seq,
      original_filename: file.original_filename,
      generated_filename: filename,
      original_key: originalObjectKey(
        shoot.customer_slug,
        shoot.project_code,
        shoot.shoot_date,
        filename
      ),
      content_type: JPEG_CONTENT_TYPE,
      byte_size: file.byte_size,
      created_at: createdAt,
    };
  });

  const nextHighWater = imageRows[imageRows.length - 1].seq;
  const nextCount = existing.length + imageRows.length;

  await db.batch([
    db
      .prepare(
        `UPDATE shoots
         SET status = 'uploading', expected_count = ?, max_seq = ?, verified_count = ?, verified_at = NULL
         WHERE id = ?`
      )
      .bind(nextCount, nextHighWater, verifiedRowCount(existing), shoot.id),
    ...imageRows.map((image) => insertImageStatement(db, image)),
  ]);

  return json(
    {
      shoot_id: shoot.id,
      appended: true,
      max_seq: nextHighWater,
      image_count: nextCount,
      images: imageRows.map((image) => publicImage(image, { stored: false, stored_bytes: 0 })),
    },
    201
  );
};

export const removeOriginalImage = async ({ db, bucket, shootId, imageId }) => {
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);

  const shoot = await db.prepare(`SELECT * FROM shoots WHERE id = ?`).bind(shootId).first();
  if (!shoot) return json({ error: "Shoot not found." }, 404);
  if (LOCKED_STATUSES.has(shoot.status)) {
    return json({ error: "This shoot can no longer be changed." }, 409);
  }

  const image = await db
    .prepare(`SELECT * FROM images WHERE id = ? AND shoot_id = ?`)
    .bind(imageId, shootId)
    .first();
  if (!image) return json({ error: "Image not found." }, 404);

  try {
    await bucket.delete(image.original_key);
  } catch {
    /* missing archive object should not block removing the record */
  }
  if (image.web_key) {
    try {
      await bucket.delete(image.web_key);
    } catch {
      /* missing Standard object should not block removing the record */
    }
  }

  const highWater = Math.max(Number(shoot.max_seq || 0), Number(image.seq || 0));
  const statements = [
    db.prepare(`DELETE FROM images WHERE id = ? AND shoot_id = ?`).bind(image.id, shoot.id),
  ];
  if (shoot.cover_image_id === image.id) {
    statements.push(
      db.prepare(`UPDATE shoots SET cover_image_id = NULL WHERE id = ?`).bind(shoot.id)
    );
  }
  await db.batch(statements);

  const remaining = await loadShootImages(db, shoot.id);
  const verifiedCount = verifiedRowCount(remaining);
  let status = shoot.status === "published" ? "uploaded" : shoot.status;
  let verifiedAt = shoot.verified_at || null;
  if (!remaining.length) {
    status = "draft";
    verifiedAt = null;
  } else if (verifiedCount === remaining.length) {
    status = "verified";
    verifiedAt = shoot.verified_at || nowIso();
  } else {
    verifiedAt = null;
    if (shoot.status === "verified") status = "uploaded";
  }

  await db
    .prepare(
      `UPDATE shoots
       SET status = ?, expected_count = ?, verified_count = ?, verified_at = ?, max_seq = ?
       WHERE id = ?`
    )
    .bind(status, remaining.length, verifiedCount, verifiedAt, highWater, shoot.id)
    .run();
  return json({
    removed: true,
    image_id: image.id,
    generated_filename: image.generated_filename,
    seq: image.seq,
    expected_count: remaining.length,
    image_count: remaining.length,
    verified_count: verifiedCount,
    status,
    max_seq: highWater,
  });
};

export const verifyOriginalArchive = async ({ db, bucket, shootId }) => {
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);

  const shoot = await db.prepare(`SELECT * FROM shoots WHERE id = ?`).bind(shootId).first();
  if (!shoot) return json({ error: "Shoot not found." }, 404);

  const images = await loadShootImages(db, shootId);
  if (!images.length) {
    await persistShootArchiveState(db, shoot, images, {
      status: shoot.status === "published" ? "published" : "draft",
      verifiedCount: 0,
      verifiedAt: null,
    });
    return json({ error: "This shoot has no originals to verify." }, 409);
  }

  const inspected = await inspectOriginals(bucket, images);
  const now = nowIso();
  const passed = inspected.filter((image) => image.stored);
  const failed = inspected.filter((image) => !image.stored);
  const statements = [];
  if (failed.length) {
    statements.push(
      db
        .prepare(
          `UPDATE images SET verified_at = NULL WHERE shoot_id = ? AND id IN (${failed
            .map(() => "?")
            .join(",")})`
        )
        .bind(shoot.id, ...failed.map((image) => image.id))
    );
  }
  if (passed.length) {
    statements.push(
      db
        .prepare(
          `UPDATE images SET verified_at = COALESCE(verified_at, ?) WHERE shoot_id = ? AND id IN (${passed
            .map(() => "?")
            .join(",")})`
        )
        .bind(now, shoot.id, ...passed.map((image) => image.id))
    );
  }

  const verifiedCount = passed.length;
  const missing = failed.map((image) =>
    missingPayload(image, image.missing ? "missing" : "size mismatch")
  );
  const fullyVerified = verifiedCount === inspected.length;

  statements.push(
    db
      .prepare(
        `UPDATE shoots
         SET status = ?, expected_count = ?, verified_count = ?, verified_at = ?, max_seq = ?
         WHERE id = ?`
      )
      .bind(
        fullyVerified
          ? "verified"
          : missing.some((item) => item.reason === "missing")
            ? "uploading"
            : "uploaded",
        inspected.length,
        verifiedCount,
        fullyVerified ? shoot.verified_at || now : null,
        shootHighWater(shoot, images),
        shoot.id
      )
  );

  await db.batch(statements);

  if (!fullyVerified) {
    return json(
      {
        error: verificationFailureMessage(verifiedCount, inspected.length, missing),
        verified: false,
        expected_count: inspected.length,
        verified_count: verifiedCount,
        stored_count: verifiedCount,
        missing,
      },
      409
    );
  }

  return json({
    verified: true,
    status: "verified",
    expected_count: inspected.length,
    verified_count: verifiedCount,
    stored_count: inspected.length,
    verified_at: shoot.verified_at || now,
    image_count: inspected.length,
    message: `${verifiedCount} of ${inspected.length} originals verified`,
  });
};

const safeFilename = (name) =>
  String(name || "original.jpg").replace(/[^\w.-]+/g, "_");

export const serveOriginalObject = async ({ db, bucket, shootId, imageId }) => {
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);
  const image = await db
    .prepare(`SELECT * FROM images WHERE id = ? AND shoot_id = ?`)
    .bind(imageId, shootId)
    .first();
  if (!image) return json({ error: "Image not found." }, 404);
  const object = await bucket.get(image.original_key);
  if (!object) return json({ error: "Original is not in the archive." }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": image.content_type || JPEG_CONTENT_TYPE,
      "Cache-Control": "private, max-age=120",
      "Content-Disposition": `inline; filename="${safeFilename(image.generated_filename)}"`,
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
};
