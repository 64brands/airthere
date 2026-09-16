const JPEG_CONTENT_TYPE = "image/jpeg";
const STANDARD_LONG_EDGE = 2000;
const STANDARD_JPEG_QUALITY = 85;
const MAX_STANDARD_SOURCE_BYTES = 20 * 1024 * 1024;
const STANDARD_PATH = "/v1/standard";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const toStream = (bytes) => new Blob([bytes]).stream();

const resizeOptions = (width, height) => {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (w < 1 || h < 1) return {};
  if (w >= h && w > STANDARD_LONG_EDGE) return { width: STANDARD_LONG_EDGE };
  if (h > w && h > STANDARD_LONG_EDGE) return { height: STANDARD_LONG_EDGE };
  if (w === h && w > STANDARD_LONG_EDGE) return { width: STANDARD_LONG_EDGE };
  return {};
};

const standardJpeg = async (transform, source) => {
  const info = await transform.info(toStream(source));
  const sourceWidth = Number(info.width || 0);
  const sourceHeight = Number(info.height || 0);
  const ops = resizeOptions(sourceWidth, sourceHeight);
  let handle = transform.input(toStream(source));
  if (ops.width || ops.height) handle = handle.transform(ops);
  const encoded = await handle.output({
    format: JPEG_CONTENT_TYPE,
    quality: STANDARD_JPEG_QUALITY,
  });
  const imageResponse = encoded.response();
  const webBytes = new Uint8Array(await imageResponse.arrayBuffer());
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
    if (request.method !== "POST" || url.pathname !== STANDARD_PATH) {
      return json({ error: "Not found." }, 404);
    }
    if (!env.TRANSFORM) {
      return json({ error: "Image transform is not bound." }, 503);
    }

    const source = new Uint8Array(await request.arrayBuffer());
    if (!source.byteLength) {
      return json({ error: "Original JPEG was empty." }, 400);
    }
    if (source.byteLength > MAX_STANDARD_SOURCE_BYTES) {
      return json(
        { error: "Original is larger than the 20 MB Standard processing limit." },
        413
      );
    }

    try {
      const result = await standardJpeg(env.TRANSFORM, source);
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
