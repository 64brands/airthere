import { json, methodNotAllowed, readJson, splat } from "../../_lib/http.js";
import { verifyPassword } from "../../_lib/passwords.js";
import { isPreviewHost, isSecureRequest } from "../../_lib/preview.js";
import {
  clearPortalCookie,
  createPortalCookie,
  readPortalSession,
} from "../../_lib/session.js";
import { clean, validateSlug } from "../../_lib/validate.js";

const formValue = async (request) => {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await readJson(request)) || {};
  }
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  return {};
};

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  if (isPreviewHost(url) || context.env.PREVIEW_LOCKDOWN === "true") {
    return json({ error: "Portal is not available on preview deployments." }, 403);
  }

  const action = splat(context.params)[0] || "";
  const db = context.env.DB;
  if (!db) return json({ error: "Database is not bound." }, 503);

  if (action === "login") return login(context, db, url);
  if (action === "logout") return logout(context, url);
  if (action === "session") return session(context, db);
  return json({ error: "Not found." }, 404);
};

const login = async (context, db, url) => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const body = await formValue(context.request);
  const slug = validateSlug(body.slug);
  const password = typeof body.password === "string" ? body.password : "";
  const wantsHtml = (context.request.headers.get("accept") || "").includes("text/html");

  const fail = (message, status = 401, code = "1") => {
    if (wantsHtml) {
      return Response.redirect(`${url.origin}/${slug.value || ""}?error=${code}`, 303);
    }
    return json({ error: message }, status);
  };

  if (slug.error) return json({ error: slug.error }, 400);
  if (!password) return fail("Password is required.", 400);
  if (!context.env.SESSION_SECRET) {
    return json({ error: "Portal sessions are not configured yet." }, 503);
  }

  const customer = await db
    .prepare(`SELECT id, slug, status, password_hash FROM customers WHERE slug = ?`)
    .bind(slug.value)
    .first();

  if (!customer || customer.status !== "active") {
    return fail("Unable to sign in.");
  }
  if (!customer.password_hash) {
    return fail("This portal password has not been set yet.", 403, "pending");
  }
  const ok = await verifyPassword(password, customer.password_hash);
  if (!ok) return fail("Unable to sign in.");

  const cookie = await createPortalCookie({
    secret: context.env.SESSION_SECRET,
    customerId: customer.id,
    slug: customer.slug,
    secure: isSecureRequest(url),
  });

  if (wantsHtml) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/${customer.slug}`,
        "Set-Cookie": cookie,
        "Cache-Control": "no-store",
      },
    });
  }

  return json(
    { ok: true, customer: { id: customer.id, slug: customer.slug } },
    200,
    { "Set-Cookie": cookie }
  );
};

const logout = async (context, url) => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const body = await formValue(context.request);
  const slug = clean(body.slug, 48);
  const cookie = clearPortalCookie(isSecureRequest(url));
  const wantsHtml = (context.request.headers.get("accept") || "").includes("text/html");
  if (wantsHtml) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: slug ? `/${slug}` : "/",
        "Set-Cookie": cookie,
        "Cache-Control": "no-store",
      },
    });
  }
  return json({ ok: true }, 200, { "Set-Cookie": cookie });
};

const session = async (context, db) => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  const payload = await readPortalSession(context.request, context.env.SESSION_SECRET);
  if (!payload) return json({ authenticated: false });
  const customer = await db
    .prepare(`SELECT id, name, slug, status FROM customers WHERE id = ?`)
    .bind(payload.cid)
    .first();
  if (!customer || customer.status !== "active") return json({ authenticated: false });
  return json({
    authenticated: true,
    customer: { id: customer.id, name: customer.name, slug: customer.slug },
  });
};
