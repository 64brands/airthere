/**
 * Client (customer portal) authorisation is scoped to a customer id.
 * Knowing another slug, project code, shoot id, image id or R2 key is never enough.
 */

export const projectForCustomer = async (db, customerId, projectId) =>
  db
    .prepare(`SELECT * FROM projects WHERE id = ? AND customer_id = ?`)
    .bind(projectId, customerId)
    .first();

export const projectByCodeForCustomer = async (db, customerId, code) =>
  db
    .prepare(`SELECT * FROM projects WHERE customer_id = ? AND code = ?`)
    .bind(customerId, code)
    .first();

export const shootForCustomer = async (db, customerId, shootId) =>
  db
    .prepare(
      `SELECT s.*
       FROM shoots s
       JOIN projects p ON p.id = s.project_id
       WHERE s.id = ? AND p.customer_id = ?`
    )
    .bind(shootId, customerId)
    .first();

export const imageForCustomer = async (db, customerId, imageId) =>
  db
    .prepare(
      `SELECT i.*
       FROM images i
       JOIN shoots s ON s.id = i.shoot_id
       JOIN projects p ON p.id = s.project_id
       WHERE i.id = ? AND p.customer_id = ?`
    )
    .bind(imageId, customerId)
    .first();
