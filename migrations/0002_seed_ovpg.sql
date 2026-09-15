-- First real customer and project.
-- Portal password is left unset (password_hash NULL) until Paul sets it in Admin.

INSERT INTO customers (id, name, slug, password_hash, status, created_at)
VALUES (
  '8f0c6d2a-4b91-4e3a-9c7f-1a2b3c4d5e6f',
  'Ocean View Property Group',
  'ovpg',
  NULL,
  'active',
  '2026-09-15T00:00:00.000Z'
);

INSERT INTO projects (id, customer_id, name, code, status, created_at)
VALUES (
  'b3e91a47-2c5d-4f80-a1e6-7d8c9b0a1e2f',
  '8f0c6d2a-4b91-4e3a-9c7f-1a2b3c4d5e6f',
  'Mount Whitsunday Stage 1',
  'mount_whitsunday_stage_1',
  'active',
  '2026-09-15T00:00:00.000Z'
);
