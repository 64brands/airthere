/**
 * Canonical AirThere filenames and private R2 object keys.
 *
 * Generated filename: {project.code}_{DDMMYY}_{NNN}.{ext}
 * Date component comes ONLY from shoots.shoot_date — never upload/EXIF/mtime.
 */

const padSeq = (seq) => {
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("Sequence must be an integer starting at 1.");
  }
  return n > 999 ? String(n) : String(n).padStart(3, "0");
};

export const filenameDateFromShootDate = (shootDate) => {
  const [year, month, day] = String(shootDate).split("-");
  if (!year || !month || !day) {
    throw new Error("shoot_date must be YYYY-MM-DD.");
  }
  return `${day}${month}${year.slice(2)}`;
};

export const generatedFilename = (projectCode, shootDate, seq, extension) => {
  const ext = String(extension || "jpg")
    .replace(/^\./, "")
    .toLowerCase();
  return `${projectCode}_${filenameDateFromShootDate(shootDate)}_${padSeq(seq)}.${ext}`;
};

export const originalObjectKey = (customerSlug, projectCode, shootDate, filename) =>
  `originals/${customerSlug}/${projectCode}/${shootDate}/${filename}`;

export const webObjectKey = (customerSlug, projectCode, shootDate, filename) =>
  `web/${customerSlug}/${projectCode}/${shootDate}/${filename}`;
