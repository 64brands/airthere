const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 278, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 278, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

const encoder = new TextEncoder();

const UNICODE_TO_WINANSI = {
  0x00a0: 0xa0,
  0x00b0: 0xb0,
  0x00b7: 0xb7,
  0x2013: 0x96,
  0x2014: 0x97,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2026: 0x85,
};

const WINANSI_WIDTHS = {
  0x85: 1000,
  0x91: 222,
  0x92: 222,
  0x93: 500,
  0x94: 500,
  0x95: 350,
  0x96: 556,
  0x97: 1000,
  0xb0: 400,
  0xb7: 278,
};

const toWinAnsiByte = (ch) => {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return code;
  if (UNICODE_TO_WINANSI[code]) return UNICODE_TO_WINANSI[code];
  if (code < 256) return code;
  return 0x3f;
};

const num = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, "");
};

const pdfString = (value) => {
  let out = "";
  for (const ch of String(value ?? "")) {
    const code = toWinAnsiByte(ch);
    if (code === 0x5c) out += "\\\\";
    else if (code === 0x28) out += "\\(";
    else if (code === 0x29) out += "\\)";
    else if (code >= 32 && code <= 126) out += String.fromCharCode(code);
    else out += `\\${code.toString(8).padStart(3, "0")}`;
  }
  return `(${out})`;
};

const glyphWidth = (widths, ch) => {
  const code = toWinAnsiByte(ch);
  if (code >= 32 && code <= 126) return widths[code - 32] || 500;
  return WINANSI_WIDTHS[code] || 500;
};

export const jpegDimensions = (bytes) => {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Image is not a JPEG.");
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    offset += 2 + size;
  }
  throw new Error("JPEG dimensions were not found.");
};

export class PdfDocument {
  constructor({ width = A4_WIDTH, height = A4_HEIGHT } = {}) {
    this.width = width;
    this.height = height;
    this.pages = [];
    this.images = [];
    this.current = null;
  }

  addPage() {
    const page = {
      ops: [],
      annots: [],
      fonts: new Set(["F1", "F2"]),
      xobjects: [],
    };
    this.pages.push(page);
    this.current = page;
    return page;
  }

  setFill(r, g, b) {
    this.current.ops.push(`${num(r)} ${num(g)} ${num(b)} rg`);
  }

  setStroke(r, g, b) {
    this.current.ops.push(`${num(r)} ${num(g)} ${num(b)} RG`);
  }

  fillRect(x, y, w, h) {
    this.current.ops.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
  }

  strokeLine(x1, y1, x2, y2, width = 0.6) {
    this.current.ops.push(
      `${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`
    );
  }

  textWidth(text, size, bold = false) {
    const widths = bold ? HELVETICA_BOLD : HELVETICA;
    let total = 0;
    for (const ch of String(text || "")) total += glyphWidth(widths, ch);
    return (total * size) / 1000;
  }

  drawText(text, x, y, size, { bold = false } = {}) {
    const font = bold ? "F2" : "F1";
    this.current.ops.push("BT");
    this.current.ops.push(`/${font} ${num(size)} Tf`);
    this.current.ops.push(`1 0 0 1 ${num(x)} ${num(y)} Tm`);
    this.current.ops.push(`${pdfString(text)} Tj`);
    this.current.ops.push("ET");
  }

  embedJpeg(bytes) {
    const size = jpegDimensions(bytes);
    const image = {
      id: this.images.length + 1,
      kind: "jpeg",
      bytes,
      width: size.width,
      height: size.height,
    };
    this.images.push(image);
    return image;
  }

  embedFlateImage({ width, height, rgb, mask = null }) {
    const image = {
      id: this.images.length + 1,
      kind: "flate",
      width,
      height,
      rgb,
      mask,
    };
    this.images.push(image);
    return image;
  }

  drawImage(image, x, y, w, h, { radius = 0 } = {}) {
    const name = `Im${image.id}`;
    this.current.xobjects.push({ name, image });
    const r = Math.max(0, Math.min(Number(radius) || 0, w / 2, h / 2));
    this.current.ops.push("q");
    if (r >= 0.5) {
      const k = 0.5522847498307936;
      const ox = r * k;
      const oy = r * k;
      const x2 = x + w;
      const y2 = y + h;
      this.current.ops.push(
        `${num(x + r)} ${num(y)} m ` +
          `${num(x2 - r)} ${num(y)} l ` +
          `${num(x2 - r + ox)} ${num(y)} ${num(x2)} ${num(y + r - oy)} ${num(x2)} ${num(y + r)} c ` +
          `${num(x2)} ${num(y2 - r)} l ` +
          `${num(x2)} ${num(y2 - r + oy)} ${num(x2 - r + ox)} ${num(y2)} ${num(x2 - r)} ${num(y2)} c ` +
          `${num(x + r)} ${num(y2)} l ` +
          `${num(x + r - ox)} ${num(y2)} ${num(x)} ${num(y2 - r + oy)} ${num(x)} ${num(y2 - r)} c ` +
          `${num(x)} ${num(y + r)} l ` +
          `${num(x)} ${num(y + r - oy)} ${num(x + r - ox)} ${num(y)} ${num(x + r)} ${num(y)} c ` +
          "h W n"
      );
    }
    this.current.ops.push(`${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm`);
    this.current.ops.push(`/${name} Do`);
    this.current.ops.push("Q");
  }

  link(x, y, w, h, uri) {
    if (!uri) return;
    this.current.annots.push({ x, y, w, h, uri });
  }

  save() {
    if (!this.pages.length) this.addPage();
    const objects = [];
    const add = (body, binary = null) => {
      objects.push({ body, binary });
      return objects.length;
    };

    const helvId = add(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n"
    );
    const boldId = add(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\n"
    );
    const imageIds = this.images.map((image) => {
      if (image.kind === "flate") {
        let smask = "";
        if (image.mask) {
          const maskId = add(
            `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.mask.length} >>\nstream\n`,
            image.mask
          );
          smask = `/SMask ${maskId} 0 R `;
        }
        return add(
          `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${smask}/Filter /FlateDecode /Length ${image.rgb.length} >>\nstream\n`,
          image.rgb
        );
      }
      return add(
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
        image.bytes
      );
    });

    const pageIds = [];
    for (const page of this.pages) {
      const content = encoder.encode(`${page.ops.join("\n")}\n`);
      const contentId = add(`<< /Length ${content.length} >>\nstream\n`, content);
      const xobjectEntries = [];
      const seen = new Set();
      for (const item of page.xobjects) {
        if (seen.has(item.name)) continue;
        seen.add(item.name);
        xobjectEntries.push(`/${item.name} ${imageIds[item.image.id - 1]} 0 R`);
      }
      const annotIds = page.annots.map((annot) =>
        add(
          `<< /Type /Annot /Subtype /Link /Rect [${num(annot.x)} ${num(annot.y)} ${num(
            annot.x + annot.w
          )} ${num(annot.y + annot.h)}] /Border [0 0 0] /A << /S /URI /URI ${pdfString(
            annot.uri
          )} >> >>\n`
        )
      );
      const resources = `<< /Font << /F1 ${helvId} 0 R /F2 ${boldId} 0 R >> /XObject << ${xobjectEntries.join(
        " "
      )} >> /ProcSet [/PDF /Text /ImageC] >>`;
      const annots = annotIds.length ? `/Annots [${annotIds.map((id) => `${id} 0 R`).join(" ")}]` : "";
      pageIds.push(
        add(
          `<< /Type /Page /Parent PAGES /MediaBox [0 0 ${num(this.width)} ${num(
            this.height
          )}] /Resources ${resources} /Contents ${contentId} 0 R ${annots} >>\n`
        )
      );
    }

    const pagesId = add(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${
        pageIds.length
      } >>\n`
    );
    for (const id of pageIds) {
      objects[id - 1].body = objects[id - 1].body.replace(
        " /Parent PAGES",
        ` /Parent ${pagesId} 0 R`
      );
    }
    const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>\n`);

    const chunks = [encoder.encode("%PDF-1.4\n")];
    const offsets = [0];
    let offset = chunks[0].length;
    for (let index = 0; index < objects.length; index += 1) {
      offsets.push(offset);
      const object = objects[index];
      const header = encoder.encode(`${index + 1} 0 obj\n${object.body}`);
      chunks.push(header);
      offset += header.length;
      if (object.binary) {
        chunks.push(object.binary);
        offset += object.binary.length;
        const end = encoder.encode("\nendstream\nendobj\n");
        chunks.push(end);
        offset += end.length;
      } else {
        const end = encoder.encode("endobj\n");
        chunks.push(end);
        offset += end.length;
      }
    }
    const xrefPos = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index <= objects.length; index += 1) {
      xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    chunks.push(encoder.encode(xref));
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const chunk of chunks) {
      out.set(chunk, pos);
      pos += chunk.length;
    }
    return out;
  }
}

export const PAGE_SIZE = { width: A4_WIDTH, height: A4_HEIGHT };
