-- AirThere shoot management — Customer → Project → Shoot → Images
-- shoot_date is the authoritative business date and must never be inferred
-- from upload time, file mtime, or EXIF.

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  code TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  UNIQUE (customer_id, code)
);

CREATE TABLE shoots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  shoot_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'uploading', 'verified', 'published')),
  expected_count INTEGER NOT NULL DEFAULT 0,
  verified_count INTEGER NOT NULL DEFAULT 0,
  cover_image_id TEXT,
  created_at TEXT NOT NULL,
  verified_at TEXT,
  UNIQUE (project_id, shoot_date)
);

CREATE TABLE images (
  id TEXT PRIMARY KEY,
  shoot_id TEXT NOT NULL REFERENCES shoots(id) ON DELETE RESTRICT,
  seq INTEGER NOT NULL,
  original_filename TEXT,
  generated_filename TEXT NOT NULL,
  original_key TEXT NOT NULL UNIQUE,
  web_key TEXT,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  verified_at TEXT,
  UNIQUE (shoot_id, seq)
);

CREATE INDEX idx_projects_customer ON projects (customer_id);
CREATE INDEX idx_shoots_project_date ON shoots (project_id, shoot_date DESC);
CREATE INDEX idx_shoots_status ON shoots (status);
CREATE INDEX idx_images_shoot_seq ON images (shoot_id, seq);
CREATE INDEX idx_customers_status ON customers (status);
