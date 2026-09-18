import { json } from "./http.js";
import { loadShootImages } from "./ingest.js";
import { requestReportJpeg, standardStatus } from "./derivatives.js";
import { filenameDateFromShootDate } from "./names.js";
import { AIRTHERE_MARK, OVERSITE_MARK } from "./report-marks.js";
import { PAGE_SIZE, PdfDocument } from "./pdf-lite.js";
import { imageViewUrl } from "./report-links.js";
import { formatDisplayDate, formatGps } from "./validate.js";

const NAVY = [0.1216, 0.2, 0.3373];
const ORANGE = [0.8824, 0.3725, 0.1569];
const MUTED = [0.365, 0.396, 0.439];
const RULE = [0.85, 0.86, 0.88];
const IMAGES_PER_PAGE = 6;
const COLS = 2;
const ROWS = 3;
const REPORTABLE_STATUSES = new Set(["verified", "published"]);
const IMAGE_CORNER_RADIUS = 10;

export const reportPageCount = (imageCount) =>
  1 + Math.ceil(Math.max(0, Number(imageCount) || 0) / IMAGES_PER_PAGE);

export const chunkReportImages = (images = []) => {
  const pages = [];
  for (let index = 0; index < images.length; index += IMAGES_PER_PAGE) {
    pages.push(images.slice(index, index + IMAGES_PER_PAGE));
  }
  return pages;
};

export const imageRefLabel = (seq) => {
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("Image sequence must be an integer starting at 1.");
  }
  const padded = n > 999 ? String(n) : String(n).padStart(3, "0");
  return `Image Ref #${padded}`;
};

const reportableImages = (images = []) =>
  (images || []).filter((image) => standardStatus(image) === "ready" && image.web_key);

export const reportReadiness = (shoot, images = []) => {
  if (!shoot) return { ok: false, error: "Shoot not found.", status: 404 };
  if (!REPORTABLE_STATUSES.has(shoot.status)) {
    return {
      ok: false,
      error: "Verify the original archive before generating a report.",
      status: 409,
    };
  }
  const all = images || [];
  if (!all.length) {
    return { ok: false, error: "This shoot has no images to include in a report.", status: 409 };
  }
  const ready = reportableImages(all);
  if (ready.length !== all.length) {
    return {
      ok: false,
      error: `Standard images are not ready (${ready.length} of ${all.length}). Generate Standard Images first.`,
      status: 409,
    };
  }
  return { ok: true, images: ready };
};

const reportFilename = (projectCode, shootDate) =>
  `OVERSITE_${projectCode}_${filenameDateFromShootDate(shootDate)}_project_progress_report.pdf`;

const markHeight = (mark, width) => width * (mark.height / mark.width);

const fitContain = (srcW, srcH, boxW, boxH) => {
  const scale = Math.min(boxW / srcW, boxH / srcH);
  return { width: srcW * scale, height: srcH * scale };
};

const loadJpeg = async (bucket, key) => {
  const object = await bucket.get(key);
  if (!object) throw new Error("A Standard image is missing from the archive.");
  return new Uint8Array(await object.arrayBuffer());
};

const drawFooter = (pdf, oversite, pageNumber, projectName, location) => {
  const { width } = PAGE_SIZE;
  const margin = 42;
  pdf.setStroke(...RULE);
  pdf.strokeLine(margin, 40, width - margin, 40, 0.4);
  const markW = 74;
  const markH = markHeight(oversite, markW);
  const baseline = 26;
  pdf.drawImage(oversite, margin, baseline - markH * 0.45, markW, markH);
  const parts = [projectName, location, `Page ${pageNumber}`].filter(Boolean);
  const line = parts.join("  ·  ");
  const size = 8;
  const textX = width - margin - pdf.textWidth(line, size);
  pdf.setFill(...MUTED);
  pdf.drawText(line, Math.max(margin + markW + 18, textX), baseline, size);
};

const drawCover = (pdf, airthere, oversite, meta) => {
  const { width, height } = PAGE_SIZE;
  const margin = 64;
  const airthereW = width * 0.36;
  const airthereH = markHeight(airthere, airthereW);
  let y = height - 56;
  pdf.drawImage(airthere, (width - airthereW) / 2, y - airthereH, airthereW, airthereH);
  y -= airthereH + 56;
  const oversiteW = 168;
  const oversiteH = markHeight(oversite, oversiteW);
  pdf.drawImage(oversite, margin, y - oversiteH, oversiteW, oversiteH);
  y -= oversiteH + 22;
  pdf.setFill(...ORANGE);
  pdf.fillRect(margin, y, 42, 2.2);
  y -= 32;
  pdf.setFill(...NAVY);
  pdf.drawText("Project Progress Report", margin, y, 22, { bold: true });
  y -= 28;
  pdf.setStroke(...RULE);
  pdf.strokeLine(margin, y, width - margin, y, 0.5);
  y -= 34;

  const rows = [
    ["Project", meta.projectName],
    ["Client", meta.customerName],
    ["Capture Date", meta.shootDateDisplay],
    ["Project Location", meta.location || "—"],
    ["GPS Coordinates", meta.gps || "—"],
  ];
  for (const [label, value] of rows) {
    pdf.setFill(...ORANGE);
    pdf.drawText(label.toUpperCase(), margin, y, 8, { bold: true });
    y -= 16;
    pdf.setFill(...NAVY);
    pdf.drawText(value, margin, y, 13, { bold: true });
    y -= 28;
  }
};

const drawImagePage = (pdf, airthere, oversite, items, pageNumber, meta) => {
  const { width, height } = PAGE_SIZE;
  const marginX = 44;
  const headerLogoW = width / 6;
  const headerLogoH = markHeight(airthere, headerLogoW);
  const top = 22 + headerLogoH + 18;
  pdf.drawImage(airthere, marginX, height - 22 - headerLogoH, headerLogoW, headerLogoH);
  const footerGap = 58;
  const gapX = 28;
  const gapY = 32;
  const captionH = 16;
  const insetX = 8;
  const insetY = 6;
  const usableW = width - marginX * 2;
  const usableH = height - top - footerGap;
  const cellW = (usableW - gapX) / COLS;
  const cellH = (usableH - gapY * (ROWS - 1)) / ROWS;
  const imageBoxH = cellH - captionH;

  items.forEach((item, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const cellX = marginX + col * (cellW + gapX);
    const cellTop = height - top - row * (cellH + gapY);
    const boxW = cellW - insetX * 2;
    const boxH = imageBoxH - insetY;
    const fitted = fitContain(item.image.width, item.image.height, boxW, boxH);
    const imgX = cellX + (cellW - fitted.width) / 2;
    const imgY = cellTop - insetY / 2 - fitted.height - (boxH - fitted.height) / 2;
    pdf.drawImage(item.image, imgX, imgY, fitted.width, fitted.height, {
      radius: IMAGE_CORNER_RADIUS,
    });
    pdf.link(imgX, imgY, fitted.width, fitted.height, item.href);
    pdf.setFill(...MUTED);
    const caption = imageRefLabel(item.seq);
    const captionSize = 8;
    const captionY = imgY - 12;
    const captionWidth = pdf.textWidth(caption, captionSize);
    pdf.drawText(
      caption,
      cellX + Math.max(0, (cellW - captionWidth) / 2),
      captionY,
      captionSize
    );
  });
  drawFooter(pdf, oversite, pageNumber, meta.projectName, meta.location);
};

export const buildShootReportPdf = ({ meta, jpegImages = [] }) => {
  const pdf = new PdfDocument(PAGE_SIZE);
  const airthere = pdf.embedFlateImage(AIRTHERE_MARK);
  const oversite = pdf.embedFlateImage(OVERSITE_MARK);
  const embedded = jpegImages.map((item) => ({
    image: pdf.embedJpeg(item.bytes),
    seq: item.seq,
    href: item.href,
  }));

  const chunks = chunkReportImages(embedded);
  pdf.addPage();
  drawCover(pdf, airthere, oversite, meta);
  drawFooter(pdf, oversite, 1, meta.projectName, meta.location);

  chunks.forEach((chunk, index) => {
    pdf.addPage();
    drawImagePage(pdf, airthere, oversite, chunk, index + 2, meta);
  });

  return pdf.save();
};

export const generateShootReport = async ({ db, bucket, transformer, shootId, origin }) => {
  if (!bucket) return json({ error: "Image archive is not bound." }, 503);
  if (!transformer) return json({ error: "Image transformer is not bound." }, 503);
  const shoot = await db
    .prepare(
      `SELECT s.*,
              p.name AS project_name,
              p.code AS project_code,
              p.location AS project_location,
              p.latitude AS project_latitude,
              p.longitude AS project_longitude,
              c.name AS customer_name,
              c.slug AS customer_slug
       FROM shoots s
       JOIN projects p ON p.id = s.project_id
       JOIN customers c ON c.id = p.customer_id
       WHERE s.id = ?`
    )
    .bind(shootId)
    .first();
  if (!shoot) return json({ error: "Shoot not found." }, 404);

  const images = await loadShootImages(db, shoot.id);
  const ready = reportReadiness(shoot, images);
  if (!ready.ok) return json({ error: ready.error }, ready.status);

  const meta = {
    projectName: shoot.project_name,
    customerName: shoot.customer_name,
    shootDateDisplay: formatDisplayDate(shoot.shoot_date),
    location: shoot.project_location || "",
    gps: formatGps(shoot.project_latitude, shoot.project_longitude),
  };

  const jpegImages = [];
  try {
    for (const image of ready.images) {
      const standardBytes = await loadJpeg(bucket, image.web_key);
      const reportJpeg = await requestReportJpeg(transformer, standardBytes);
      jpegImages.push({
        bytes: reportJpeg.bytes,
        seq: image.seq,
        href: imageViewUrl({
          origin,
          slug: shoot.customer_slug,
          projectCode: shoot.project_code,
          shootDate: shoot.shoot_date,
          imageId: image.id,
        }),
      });
    }
  } catch (error) {
    return json(
      { error: error.message || "A report image could not be prepared." },
      409
    );
  }

  const bytes = buildShootReportPdf({ meta, jpegImages });
  const filename = reportFilename(shoot.project_code, shoot.shoot_date);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
};
