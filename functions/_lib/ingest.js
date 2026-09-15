import { json, newId, nowIso } from "./http.js";
import { compareSourceFilenames, generatedFilename, originalObjectKey } from "./names.js";

export const JPEG_CONTENT_TYPE = "image/jpeg";
export const MAX_ORIGINAL_BYTES = 100 * 1024 * 1024;
export const MAX_ORIGINALS = 200;

const COMPLETE_STATUSES = new Set(["uploaded", "verified", "published"]);

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

const storedFlags = async (bucket, images) => {
  const flags = await Promise.all(
    images.map(async (image) => {
      const head = await bucket.head(image.original_key);
      return {
        stored: Boolean(head) && Number(head.size) === Number(image.byte_size),
        stored_bytes: head ? Number(head.size) : 0,
      };
    })
  );
  return images.map((image, index) => publicImage(image, flags[index]));
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
        .prepare(`UPDATE shoots SET status = 'uploading', expected_count = ? WHERE id = ?`)
        .bind(planned.files.length, existing.id)
        .run();
      existing.status = "uploading";
      existing.expected_count = planned.files.length;
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
           id, project_id, shoot_date, status, expected_count, verified_count, created_at
         ) VALUES (?, ?, ?, 'uploading', ?, 0, ?)`
      )
      .bind(shootId, project.id, shootDate, imageRows.length, createdAt),
    ...imageRows.map((image) =>
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
        )
    ),
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
  if (COMPLETE_STATUSES.has(shoot.status)) {
    return json({ error: "This shoot is already complete." }, 409);
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
    if (shoot.status !== "uploading") {
      await db.prepare(`UPDATE shoots SET status = 'uploading' WHERE id = ?`).bind(shoot.id).run();
    }
    return json({
      image: publicImage(image, { stored: true, stored_bytes: Number(head.size), skipped: true }),
    });
  }
  if (head) {
    return json(
      { error: "An original already exists at this archive path with a different size." },
      409
    );
  }

  await bucket.put(image.original_key, bytes, {
    httpMetadata: { contentType: JPEG_CONTENT_TYPE },
  });

  if (shoot.status !== "uploading") {
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

  const images = await loadShootImages(db, shootId);
  if (!images.length) {
    return json({ error: "This shoot has no original image records." }, 409);
  }

  const missing = [];
  for (const image of images) {
    const head = await bucket.head(image.original_key);
    if (!head) {
      missing.push({
        original_filename: image.original_filename,
        generated_filename: image.generated_filename,
        reason: "not in archive",
      });
      continue;
    }
    if (Number(head.size) !== Number(image.byte_size)) {
      missing.push({
        original_filename: image.original_filename,
        generated_filename: image.generated_filename,
        reason: "byte size mismatch",
      });
    }
  }

  if (missing.length) {
    if (shoot.status !== "uploading") {
      await db.prepare(`UPDATE shoots SET status = 'uploading' WHERE id = ?`).bind(shoot.id).run();
    }
    const stored = images.length - missing.length;
    return json(
      {
        error: `Upload incomplete. ${stored} of ${images.length} originals stored.`,
        incomplete: true,
        expected_count: images.length,
        stored_count: stored,
        missing,
      },
      409
    );
  }

  if (shoot.status !== "uploaded") {
    await db
      .prepare(`UPDATE shoots SET status = 'uploaded', expected_count = ? WHERE id = ?`)
      .bind(images.length, shoot.id)
      .run();
  }

  return json({
    complete: true,
    status: "uploaded",
    expected_count: images.length,
    stored_count: images.length,
    message: `${images.length} original${images.length === 1 ? "" : "s"} uploaded`,
  });
};
