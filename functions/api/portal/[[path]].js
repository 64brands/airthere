import { json, methodNotAllowed, readJson, splat } from "../../_lib/http.js";
import { loadShootImages } from "../../_lib/ingest.js";
import {
  projectByCodeForCustomer,
  projectForCustomer,
} from "../../_lib/ownership.js";
import {
  isClientShoot,
  publicPortalCustomer,
  publicPortalImage,
  publicPortalProject,
  publicPortalShoot,
  readyStandardImages,
  requirePortalCustomer,
} from "../../_lib/portal.js";
import { isPreviewHost, isSecureRequest } from "../../_lib/preview.js";
import { verifyPassword } from "../../_lib/passwords.js";
import {
  clearPortalCookie,
  createPortalCookie,
  readPortalSession,
} from "../../_lib/session.js";
import { clean, DATE_PATTERN, validateSlug } from "../../_lib/validate.js";

const formValue = async (request) => {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await readJson(request)) || {};
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  return {};
};

const loginError = (code) =>
  code === "pending" ? "This portal is not available yet." : "The password is incorrect.";

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  if (isPreviewHost(url) || context.env.PREVIEW_LOCKDOWN === "true") {
    return json({ error: "Portal is not available on preview deployments." }, 403);
  }

  const parts = splat(context.params);
  const action = parts[0] || "";
  const db = context.env.DB;
  if (!db) return json({ error: "Database is not bound." }, 503);

  if (action === "login") return login(context, db, url);
  if (action === "logout") return logout(context, url);
  if (action === "session") return session(context, db);
  if (action === "projects") return projects(context, db, parts);
  return json({ error: "Not found." }, 404);
};

const login = async (context, db, url) => {
  if (context.request.method !== "POST") return methodNotAllowed("POST");
  const body = await formValue(context.request);
  const slug = validateSlug(body.slug);
  const password = typeof body.password === "string" ? body.password : "";
  const wantsHtml = (context.request.headers.get("accept") || "").includes("text/html");

  const fail = (code = "1", status = 401) => {
    if (wantsHtml) {
      return Response.redirect(`${url.origin}/${slug.value || ""}?error=${code}`, 303);
    }
    return json({ error: loginError(code) }, status);
  };

  if (slug.error) return json({ error: slug.error }, 400);
  if (!password) return fail("1", 400);
  if (!context.env.SESSION_SECRET) {
    return json({ error: "This portal is not available yet." }, 503);
  }

  const customer = await db
    .prepare(`SELECT id, slug, status, password_hash FROM customers WHERE slug = ?`)
    .bind(slug.value)
    .first();

  if (!customer || customer.status !== "active") return fail();
  if (!customer.password_hash) return fail("pending", 403);
  const ok = await verifyPassword(password, customer.password_hash);
  if (!ok) return fail();

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
    customer: publicPortalCustomer(customer),
  });
};

const projects = async (context, db, parts) => {
  if (context.request.method !== "GET") return methodNotAllowed("GET");
  const auth = await requirePortalCustomer(context, db);
  if (auth.error) return auth.error;

  if (parts.length === 1) {
    const rows = await db
      .prepare(
        `SELECT id, name, code, status
         FROM projects
         WHERE customer_id = ? AND status = 'active'
         ORDER BY name COLLATE NOCASE`
      )
      .bind(auth.customer.id)
      .all();
    return json({
      customer: publicPortalCustomer(auth.customer),
      projects: (rows.results || []).map(publicPortalProject),
    });
  }

  const project = await projectByCodeForCustomer(db, auth.customer.id, parts[1]);
  if (!project || project.status !== "active") return json({ error: "Not found." }, 404);

  if (parts.length === 2) {
    const shoots = await listClientShoots(db, project.id);
    return json({
      customer: publicPortalCustomer(auth.customer),
      project: publicPortalProject(project),
      shoots,
    });
  }

  if (parts.length === 4 && parts[2] === "shoots") {
    if (!DATE_PATTERN.test(parts[3])) return json({ error: "Not found." }, 404);
    return shootGallery(db, auth.customer, project, parts[3]);
  }

  return json({ error: "Not found." }, 404);
};

const listClientShoots = async (db, projectId) => {
  const rows = await db
    .prepare(
      `SELECT * FROM shoots
       WHERE project_id = ? AND status IN ('verified', 'published')
       ORDER BY shoot_date DESC`
    )
    .bind(projectId)
    .all();
  const shoots = [];
  for (const shoot of rows.results || []) {
    if (!isClientShoot(shoot)) continue;
    const images = await loadShootImages(db, shoot.id);
    shoots.push(publicPortalShoot(shoot, images));
  }
  return shoots;
};

const shootGallery = async (db, customer, project, shootDate) => {
  const shoot = await db
    .prepare(
      `SELECT s.*
       FROM shoots s
       WHERE s.project_id = ? AND s.shoot_date = ?`
    )
    .bind(project.id, shootDate)
    .first();
  if (!shoot || !isClientShoot(shoot)) return json({ error: "Not found." }, 404);
  const owned = await projectForCustomer(db, customer.id, shoot.project_id);
  if (!owned) return json({ error: "Not found." }, 404);

  const images = readyStandardImages(await loadShootImages(db, shoot.id)).map(publicPortalImage);
  return json({
    customer: publicPortalCustomer(customer),
    project: publicPortalProject(project),
    shoot: {
      date: shoot.shoot_date,
      display_date: publicPortalShoot(shoot, []).display_date,
    },
    images,
  });
};
