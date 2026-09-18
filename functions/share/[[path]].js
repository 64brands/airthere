import { html, json, methodNotAllowed, splat } from "../_lib/http.js";
import { JPEG_CONTENT_TYPE, loadShootImages } from "../_lib/ingest.js";
import { standardStatus } from "../_lib/derivatives.js";
import { readyStandardImages } from "../_lib/portal.js";
import { isPreviewHost } from "../_lib/preview.js";
import { generateShootReport } from "../_lib/report.js";
import { filenameDateFromShootDate } from "../_lib/names.js";
import {
  SHARE_TOKEN_PATTERN,
  imageForShare,
  issueShareOtp,
  loadShareByToken,
  requireShareSession,
  shareHrefForToken,
  sharePublicOrigin,
} from "../_lib/share.js";
import {
  shareImagePage,
  shareMessagePage,
  shareMissingPage,
  shareReportPage,
  shareVerifyPage,
} from "../_lib/share-pages.js";
import { readShareSession } from "../_lib/session.js";

const unavailable = () => html(shareMissingPage(), 404);

const galleryPayload = (token, images) => ({
  images: readyStandardImages(images).map((image) => ({
    id: image.id,
    seq: image.seq,
    src: `/share/${token}/media/${image.id}`,
  })),
});

const hasShareSession = async (request, env, share) => {
  const session = await readShareSession(request, env.SESSION_SECRET);
  return Boolean(session && share && session.sid === share.id);
};

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  if (isPreviewHost(url) || context.env.PREVIEW_LOCKDOWN === "true") {
    return unavailable();
  }
  if (!["GET", "HEAD"].includes(context.request.method)) {
    return methodNotAllowed("GET");
  }

  const parts = splat(context.params);
  const token = parts[0] || "";
  if (!SHARE_TOKEN_PATTERN.test(token)) return unavailable();

  const db = context.env.DB;
  if (!db) {
    return html(
      shareMessagePage({
        title: "Report unavailable — OVERSITE",
        heading: "This report is not available right now.",
        copy: "Please try again shortly.",
      }),
      503
    );
  }

  const share = await loadShareByToken(db, token);
  if (!share) return unavailable();

  if (parts.length === 1) return landing(context, share, token);
  if (parts.length === 2 && parts[1] === "report") return report(context, share, token);
  if (parts.length === 3 && parts[1] === "image") {
    return imagePage(context, share, token, parts[2]);
  }
  if (parts.length === 3 && parts[1] === "media") {
    return media(context, share, token, parts[2]);
  }
  return unavailable();
};

const landing = async (context, share, token) => {
  if (await hasShareSession(context.request, context.env, share)) {
    const images = await loadShootImages(context.env.DB, share.shoot_id);
    return html(shareReportPage({ share, token, gallery: galleryPayload(token, images) }));
  }
  const issued = await issueShareOtp({
    db: context.env.DB,
    env: context.env,
    request: context.request,
    share,
    force: false,
  });
  const error =
    issued.error && issued.status !== 429
      ? issued.error
      : "";
  return html(shareVerifyPage({ share, token, error, nextPath: `/share/${token}` }));
};

const imagePage = async (context, share, token, imageId) => {
  const nextPath = `/share/${token}/image/${imageId}`;
  if (!(await hasShareSession(context.request, context.env, share))) {
    await issueShareOtp({
      db: context.env.DB,
      env: context.env,
      request: context.request,
      share,
      force: false,
    });
    return html(shareVerifyPage({ share, token, nextPath }));
  }
  const image = await imageForShare(context.env.DB, share, imageId);
  if (!image || standardStatus(image) !== "ready") return unavailable();
  const images = await loadShootImages(context.env.DB, share.shoot_id);
  return html(
    shareImagePage({
      share,
      token,
      imageId,
      gallery: galleryPayload(token, images),
    })
  );
};

const media = async (context, share, token, imageId) => {
  const auth = await requireShareSession({
    request: context.request,
    env: context.env,
    db: context.env.DB,
    token,
  });
  if (auth.error) return auth.error;
  const bucket = context.env.IMAGES;
  if (!bucket) return json({ error: "This photograph is not available." }, 503);
  const image = await imageForShare(context.env.DB, share, imageId);
  if (!image || standardStatus(image) !== "ready" || !image.web_key) {
    return json({ error: "This photograph is not available." }, 404);
  }
  const object = await bucket.get(image.web_key);
  if (!object) return json({ error: "This photograph is not available." }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": JPEG_CONTENT_TYPE,
      "Cache-Control": "private, max-age=120",
      "Content-Disposition": "inline",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
};

const report = async (context, share, token) => {
  const auth = await requireShareSession({
    request: context.request,
    env: context.env,
    db: context.env.DB,
    token,
  });
  if (auth.error) {
    if (auth.error.headers.get("content-type")?.includes("application/json")) {
      return html(
        shareVerifyPage({
          share,
          token,
          error: "Please verify to view this report.",
          nextPath: `/share/${token}/report`,
        }),
        401
      );
    }
    return auth.error;
  }

  const origin = sharePublicOrigin(context.request, context.env);
  const pdf = await generateShootReport({
    db: context.env.DB,
    bucket: context.env.IMAGES,
    transformer: context.env.IMAGE_TRANSFORMER,
    shootId: share.shoot_id,
    origin,
    imageHref: shareHrefForToken(origin, token),
  });
  if ((pdf.headers.get("content-type") || "").includes("application/json")) {
    return html(
      shareMessagePage({
        title: "Report unavailable — OVERSITE",
        heading: "The report could not be prepared.",
        copy: "Please try again shortly.",
        token,
      }),
      409
    );
  }

  const download = new URL(context.request.url).searchParams.get("download") === "1";
  if (!download) return pdf;

  const filename = `OVERSITE_${share.project_code}_${filenameDateFromShootDate(
    share.shoot_date
  )}_project_progress_report.pdf`;
  const headers = new Headers(pdf.headers);
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  return new Response(pdf.body, { status: pdf.status, headers });
};
