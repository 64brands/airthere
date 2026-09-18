import { json, methodNotAllowed, readJson, splat } from "../../_lib/http.js";
import { isPreviewHost, isSecureRequest } from "../../_lib/preview.js";
import {
  SHARE_TOKEN_PATTERN,
  issueShareOtp,
  loadShareByToken,
  shareUnavailable,
  verifyShareOtp,
} from "../../_lib/share.js";
import { createShareCookie } from "../../_lib/session.js";

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  if (isPreviewHost(url) || context.env.PREVIEW_LOCKDOWN === "true") {
    return json({ error: "This report link is not available." }, 404);
  }

  const parts = splat(context.params);
  const token = parts[0] || "";
  if (!SHARE_TOKEN_PATTERN.test(token)) return shareUnavailable();

  const db = context.env.DB;
  if (!db) return json({ error: "This report is not available right now." }, 503);

  const share = await loadShareByToken(db, token);
  if (!share) return shareUnavailable();

  if (parts.length === 2 && parts[1] === "otp") return resend(context, share);
  if (parts.length === 2 && parts[1] === "verify") return verify(context, share, token, url);
  return json({ error: "Not found." }, 404);
};

const resend = async (context, share) => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const issued = await issueShareOtp({
    db: context.env.DB,
    env: context.env,
    request: context.request,
    share,
    force: true,
  });
  if (issued.error) return json({ error: issued.error }, issued.status || 400);
  return json({ ok: true });
};

const verify = async (context, share, token, url) => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const body = (await readJson(context.request)) || {};
  const result = await verifyShareOtp({
    db: context.env.DB,
    env: context.env,
    share,
    code: body.code,
  });
  if (result.error) return json({ error: result.error }, result.status || 400);

  const cookie = await createShareCookie({
    secret: context.env.SESSION_SECRET,
    shareId: share.id,
    secure: isSecureRequest(url),
  });
  if (!cookie) return json({ error: "This report is not available right now." }, 503);

  let next = `/share/${token}`;
  if (typeof body.next === "string" && body.next.startsWith("/")) {
    try {
      const resolved = new URL(body.next, url.origin);
      const prefix = `/share/${token}`;
      if (
        resolved.origin === url.origin &&
        (resolved.pathname === prefix || resolved.pathname.startsWith(`${prefix}/`))
      ) {
        next = `${resolved.pathname}${resolved.search}`;
      }
    } catch {
      /* keep default */
    }
  }
  return json({ ok: true, next }, 200, { "Set-Cookie": cookie });
};
