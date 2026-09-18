const JPEG_CONTENT_TYPE = "image/jpeg";
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export const STANDARD_LONG_EDGE = 2000;
export const STANDARD_JPEG_QUALITY = 85;
export const REPORT_LONG_EDGE = 1000;
export const REPORT_JPEG_QUALITY = 72;

const PROFILES = {
  "/v1/standard": { longEdge: STANDARD_LONG_EDGE, quality: STANDARD_JPEG_QUALITY },
  "/v1/report": { longEdge: REPORT_LONG_EDGE, quality: REPORT_JPEG_QUALITY },
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const toStream = (bytes) => new Blob([bytes]).stream();

export const resizeOptions = (width, height, longEdge) => {
  const w = Number(width || 0);
  const h = Number(height || 0);
  const edge = Number(longEdge || 0);
  if (w < 1 || h < 1 || edge < 1) return {};
  if (Math.max(w, h) <= edge) return {};
  if (w >= h) return { width: edge };
  return { height: edge };
};

const encodeJpeg = async (transform, source, { longEdge, quality }) => {
  const info = await transform.info(toStream(source));
  const sourceWidth = Number(info.width || 0);
  const sourceHeight = Number(info.height || 0);
  const ops = resizeOptions(sourceWidth, sourceHeight, longEdge);
  let handle = transform.input(toStream(source));
  if (ops.width || ops.height) handle = handle.transform(ops);
  const encoded = await handle.output({
    format: JPEG_CONTENT_TYPE,
    quality,
  });
  const imageResponse = encoded.response();
  const webBytes = new Uint8Array(await imageResponse.arrayBuffer());
  if (!webBytes.byteLength) throw new Error("Encoded JPEG was empty.");

  let webWidth = ops.width || sourceWidth;
  let webHeight = ops.height || sourceHeight;
  try {
    const webInfo = await transform.info(toStream(webBytes));
    webWidth = Number(webInfo.width || webWidth);
    webHeight = Number(webInfo.height || webHeight);
  } catch {
    /* local low-fidelity info is enough when present */
  }

  return {
    bytes: webBytes,
    sourceWidth,
    sourceHeight,
    width: webWidth,
    height: webHeight,
  };
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const profile = PROFILES[url.pathname];
    if (request.method !== "POST" || !profile) {
      return json({ error: "Not found." }, 404);
    }
    if (!env.TRANSFORM) {
      return json({ error: "Image transform is not bound." }, 503);
    }

    const source = new Uint8Array(await request.arrayBuffer());
    if (!source.byteLength) {
      return json({ error: "Source JPEG was empty." }, 400);
    }
    if (source.byteLength > MAX_SOURCE_BYTES) {
      return json(
        { error: "Source is larger than the 20 MB processing limit." },
        413
      );
    }

    try {
      const result = await encodeJpeg(env.TRANSFORM, source, profile);
      return new Response(result.bytes, {
        status: 200,
        headers: {
          "content-type": JPEG_CONTENT_TYPE,
          "cache-control": "no-store",
          "x-airthere-source-width": String(result.sourceWidth),
          "x-airthere-source-height": String(result.sourceHeight),
          "x-airthere-width": String(result.width),
          "x-airthere-height": String(result.height),
        },
      });
    } catch (error) {
      return json({ error: String(error?.message || error) }, 422);
    }
  },
};
