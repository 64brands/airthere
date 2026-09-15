import { requireAdmin } from "../../_lib/access.js";
import { json, methodNotAllowed, newId, nowIso, readJson, splat } from "../../_lib/http.js";
import { hashPassword } from "../../_lib/passwords.js";
import {
  clean,
  formatDisplayDate,
  formatTimestamp,
  suggestProjectCode,
  validateProjectCode,
  validateShootDate,
  validateSlug,
  validateStatus,
} from "../../_lib/validate.js";

const CUSTOMER_STATUSES = ["active", "disabled"];
const PROJECT_STATUSES = ["active", "disabled"];
const SHOOT_STATUSES = ["draft", "uploading", "verified", "published"];

const publicCustomer = (row) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  status: row.status,
  created_at: row.created_at,
  password_set: Boolean(row.password_hash),
});

const publicProject = (row) => ({
  id: row.id,
  customer_id: row.customer_id,
  name: row.name,
  code: row.code,
  status: row.status,
  created_at: row.created_at,
  image_count: Number(row.image_count || 0),
  code_locked: Number(row.image_count || 0) > 0,
});

const publicShoot = (row) => ({
  id: row.id,
  project_id: row.project_id,
  customer_id: row.customer_id,
  customer_name: row.customer_name,
  customer_slug: row.customer_slug,
  project_name: row.project_name,
  project_code: row.project_code,
  shoot_date: row.shoot_date,
  shoot_date_display: formatDisplayDate(row.shoot_date),
  status: row.status,
  expected_count: row.expected_count,
  verified_count: row.verified_count,
  cover_image_id: row.cover_image_id,
  created_at: row.created_at,
  created_at_display: formatTimestamp(row.created_at),
  verified_at: row.verified_at,
});

const uniqueError = (error, fallback) => {
  const message = String(error?.message || "");
  if (message.includes("UNIQUE") && message.includes("slug")) {
    return "A customer with that slug already exists.";
  }
  if (message.includes("UNIQUE") && message.includes("code")) {
    return "That project code is already used for this customer.";
  }
  if (message.includes("UNIQUE") && message.includes("shoot_date")) {
    return "This project already has a shoot on that Shoot Date.";
  }
  return fallback;
};

const getCustomer = async (db, id) =>
  db.prepare(`SELECT * FROM customers WHERE id = ?`).bind(id).first();

const getProject = async (db, id) =>
  db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM images i JOIN shoots s ON s.id = i.shoot_id WHERE s.project_id = p.id) AS image_count
       FROM projects p
       WHERE p.id = ?`
    )
    .bind(id)
    .first();

const shootSelect = `
  SELECT s.*,
         p.name AS project_name,
         p.code AS project_code,
         p.customer_id,
         c.name AS customer_name,
         c.slug AS customer_slug
  FROM shoots s
  JOIN projects p ON p.id = s.project_id
  JOIN customers c ON c.id = p.customer_id
`;

export const onRequest = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;

  const db = context.env.DB;
  if (!db) return json({ error: "Database is not bound." }, 503);

  const parts = splat(context.params);
  const { request } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  try {
    if (parts.length === 0 || (parts.length === 1 && parts[0] === "me")) {
      if (parts[0] === "me") {
        if (method !== "GET") return methodNotAllowed("GET");
        return json({ authenticated: true });
      }
    }

    if (parts[0] === "customers") {
      return customers(db, method, parts, request, url);
    }
    if (parts[0] === "projects") {
      return projects(db, method, parts, request, url);
    }
    if (parts[0] === "shoots") {
      return shoots(db, method, parts, request, url);
    }

    return json({ error: "Not found." }, 404);
  } catch (error) {
    return json({ error: uniqueError(error, "Unable to complete that request.") }, 400);
  }
};

const customers = async (db, method, parts, request, url) => {
  if (parts.length === 1) {
    if (method === "GET") {
      const rows = await db
        .prepare(`SELECT * FROM customers ORDER BY name COLLATE NOCASE`)
        .all();
      return json({ customers: (rows.results || []).map(publicCustomer) });
    }
    if (method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON." }, 400);
      const name = clean(body.name, 160);
      const slug = validateSlug(body.slug);
      const status = validateStatus(body.status || "active", CUSTOMER_STATUSES);
      if (!name) return json({ error: "Customer name is required." }, 400);
      if (slug.error) return json({ error: slug.error }, 400);
      if (status.error) return json({ error: status.error }, 400);

      let passwordHash = null;
      const password = typeof body.password === "string" ? body.password : "";
      if (password) {
        if (password.length < 8) {
          return json({ error: "Customer password must be at least 8 characters." }, 400);
        }
        passwordHash = await hashPassword(password);
      }

      const id = newId();
      const createdAt = nowIso();
      try {
        await db
          .prepare(
            `INSERT INTO customers (id, name, slug, password_hash, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(id, name, slug.value, passwordHash, status.value, createdAt)
          .run();
      } catch (error) {
        return json({ error: uniqueError(error, "Unable to create customer.") }, 409);
      }
      const row = await getCustomer(db, id);
      return json({ customer: publicCustomer(row) }, 201);
    }
    return methodNotAllowed("GET, POST");
  }

  if (parts.length === 2) {
    const id = parts[1];
    const existing = await getCustomer(db, id);
    if (!existing) return json({ error: "Customer not found." }, 404);

    if (method === "GET") {
      const projectRows = await db
        .prepare(
          `SELECT p.*,
                  (SELECT COUNT(*) FROM images i JOIN shoots s ON s.id = i.shoot_id WHERE s.project_id = p.id) AS image_count
           FROM projects p
           WHERE p.customer_id = ?
           ORDER BY p.name COLLATE NOCASE`
        )
        .bind(id)
        .all();
      return json({
        customer: publicCustomer(existing),
        projects: (projectRows.results || []).map(publicProject),
      });
    }

    if (method === "PATCH") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON." }, 400);

      let name = existing.name;
      let slug = existing.slug;
      let status = existing.status;
      let passwordHash = existing.password_hash;

      if (body.name !== undefined) {
        name = clean(body.name, 160);
        if (!name) return json({ error: "Customer name is required." }, 400);
      }
      if (body.slug !== undefined) {
        const checked = validateSlug(body.slug);
        if (checked.error) return json({ error: checked.error }, 400);
        slug = checked.value;
      }
      if (body.status !== undefined) {
        const checked = validateStatus(body.status, CUSTOMER_STATUSES);
        if (checked.error) return json({ error: checked.error }, 400);
        status = checked.value;
      }
      if (body.password !== undefined && body.password !== "") {
        if (String(body.password).length < 8) {
          return json({ error: "Customer password must be at least 8 characters." }, 400);
        }
        passwordHash = await hashPassword(String(body.password));
      }

      try {
        await db
          .prepare(
            `UPDATE customers SET name = ?, slug = ?, password_hash = ?, status = ? WHERE id = ?`
          )
          .bind(name, slug, passwordHash, status, id)
          .run();
      } catch (error) {
        return json({ error: uniqueError(error, "Unable to update customer.") }, 409);
      }
      const row = await getCustomer(db, id);
      return json({ customer: publicCustomer(row) });
    }

    return methodNotAllowed("GET, PATCH");
  }

  return json({ error: "Not found." }, 404);
};

const projects = async (db, method, parts, request, url) => {
  if (parts.length === 1) {
    if (method === "GET") {
      const customerId = url.searchParams.get("customer_id");
      const sql = customerId
        ? `SELECT p.*,
                  (SELECT COUNT(*) FROM images i JOIN shoots s ON s.id = i.shoot_id WHERE s.project_id = p.id) AS image_count
           FROM projects p WHERE p.customer_id = ? ORDER BY p.name COLLATE NOCASE`
        : `SELECT p.*,
                  (SELECT COUNT(*) FROM images i JOIN shoots s ON s.id = i.shoot_id WHERE s.project_id = p.id) AS image_count
           FROM projects p ORDER BY p.name COLLATE NOCASE`;
      const stmt = customerId ? db.prepare(sql).bind(customerId) : db.prepare(sql);
      const rows = await stmt.all();
      return json({
        suggest_code: suggestProjectCode(url.searchParams.get("name") || ""),
        projects: (rows.results || []).map(publicProject),
      });
    }

    if (method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON." }, 400);
      const customerId = clean(body.customer_id, 64);
      const name = clean(body.name, 160);
      const codeInput = body.code ? body.code : suggestProjectCode(name);
      const code = validateProjectCode(codeInput);
      const status = validateStatus(body.status || "active", PROJECT_STATUSES);
      if (!customerId) return json({ error: "Select a customer." }, 400);
      if (!name) return json({ error: "Project name is required." }, 400);
      if (code.error) return json({ error: code.error }, 400);
      if (status.error) return json({ error: status.error }, 400);
      const customer = await getCustomer(db, customerId);
      if (!customer) return json({ error: "Customer not found." }, 404);

      const id = newId();
      try {
        await db
          .prepare(
            `INSERT INTO projects (id, customer_id, name, code, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(id, customerId, name, code.value, status.value, nowIso())
          .run();
      } catch (error) {
        return json({ error: uniqueError(error, "Unable to create project.") }, 409);
      }
      const row = await getProject(db, id);
      return json({ project: publicProject(row) }, 201);
    }
    return methodNotAllowed("GET, POST");
  }

  if (parts.length === 2) {
    const existing = await getProject(db, parts[1]);
    if (!existing) return json({ error: "Project not found." }, 404);

    if (method === "GET") {
      return json({ project: publicProject(existing) });
    }

    if (method === "PATCH") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON." }, 400);
      let name = existing.name;
      let code = existing.code;
      let status = existing.status;

      if (body.name !== undefined) {
        name = clean(body.name, 160);
        if (!name) return json({ error: "Project name is required." }, 400);
      }
      if (body.status !== undefined) {
        const checked = validateStatus(body.status, PROJECT_STATUSES);
        if (checked.error) return json({ error: checked.error }, 400);
        status = checked.value;
      }
      if (body.code !== undefined && body.code !== existing.code) {
        if (Number(existing.image_count) > 0) {
          return json(
            {
              error:
                "This project already has images. The filename code cannot be changed because it is part of the archive path.",
            },
            409
          );
        }
        const checked = validateProjectCode(body.code);
        if (checked.error) return json({ error: checked.error }, 400);
        code = checked.value;
      }

      try {
        await db
          .prepare(`UPDATE projects SET name = ?, code = ?, status = ? WHERE id = ?`)
          .bind(name, code, status, existing.id)
          .run();
      } catch (error) {
        return json({ error: uniqueError(error, "Unable to update project.") }, 409);
      }
      const row = await getProject(db, existing.id);
      return json({ project: publicProject(row) });
    }

    return methodNotAllowed("GET, PATCH");
  }

  return json({ error: "Not found." }, 404);
};

const shoots = async (db, method, parts, request, url) => {
  if (parts.length === 1) {
    if (method === "GET") {
      const projectId = url.searchParams.get("project_id");
      const customerId = url.searchParams.get("customer_id");
      let sql = `${shootSelect}`;
      const binds = [];
      if (projectId) {
        sql += ` WHERE s.project_id = ?`;
        binds.push(projectId);
      } else if (customerId) {
        sql += ` WHERE p.customer_id = ?`;
        binds.push(customerId);
      }
      sql += ` ORDER BY s.shoot_date DESC, s.created_at DESC`;
      const stmt = binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql);
      const rows = await stmt.all();
      return json({ shoots: (rows.results || []).map(publicShoot) });
    }

    if (method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON." }, 400);
      const projectId = clean(body.project_id, 64);
      const shootDate = validateShootDate(body.shoot_date);
      if (!projectId) return json({ error: "Select a project." }, 400);
      if (shootDate.error) return json({ error: shootDate.error }, 400);
      const project = await getProject(db, projectId);
      if (!project) return json({ error: "Project not found." }, 404);

      const id = newId();
      const createdAt = nowIso();
      try {
        await db
          .prepare(
            `INSERT INTO shoots (
               id, project_id, shoot_date, status, expected_count, verified_count, created_at
             ) VALUES (?, ?, ?, 'draft', 0, 0, ?)`
          )
          .bind(id, projectId, shootDate.value, createdAt)
          .run();
      } catch (error) {
        return json({ error: uniqueError(error, "Unable to create shoot.") }, 409);
      }
      const row = await db.prepare(`${shootSelect} WHERE s.id = ?`).bind(id).first();
      return json({ shoot: publicShoot(row) }, 201);
    }
    return methodNotAllowed("GET, POST");
  }

  if (parts.length === 2) {
    if (method !== "GET") return methodNotAllowed("GET");
    const row = await db.prepare(`${shootSelect} WHERE s.id = ?`).bind(parts[1]).first();
    if (!row) return json({ error: "Shoot not found." }, 404);
    return json({ shoot: publicShoot(row) });
  }

  return json({ error: "Not found." }, 404);
};
