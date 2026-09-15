-- Operational users. Cloudflare Access authenticates identity;
-- AirThere authorises from role. Customers are NOT stored here.

CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'manager')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_admin_users_email ON admin_users (email);
CREATE INDEX idx_admin_users_role_status ON admin_users (role, status);

INSERT INTO admin_users (id, email, name, role, status, created_at, updated_at)
VALUES (
  '3c9e2f14-8a6b-4d01-9e77-2b5c8d1a0e44',
  'paul@64.com.au',
  'Paul',
  'super_admin',
  'active',
  '2026-09-15T00:00:00.000Z',
  '2026-09-15T00:00:00.000Z'
);
