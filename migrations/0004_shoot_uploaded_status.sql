-- Originals can finish in R2 without implying Brief #5 archive verification.
-- SQLite cannot alter a CHECK constraint in place.

PRAGMA foreign_keys = OFF;

CREATE TABLE shoots_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  shoot_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'uploading', 'uploaded', 'verified', 'published')),
  expected_count INTEGER NOT NULL DEFAULT 0,
  verified_count INTEGER NOT NULL DEFAULT 0,
  cover_image_id TEXT,
  created_at TEXT NOT NULL,
  verified_at TEXT,
  UNIQUE (project_id, shoot_date)
);

INSERT INTO shoots_new (
  id, project_id, shoot_date, status, expected_count, verified_count,
  cover_image_id, created_at, verified_at
)
SELECT
  id, project_id, shoot_date, status, expected_count, verified_count,
  cover_image_id, created_at, verified_at
FROM shoots;

DROP TABLE shoots;
ALTER TABLE shoots_new RENAME TO shoots;

CREATE INDEX idx_shoots_project_date ON shoots (project_id, shoot_date DESC);
CREATE INDEX idx_shoots_status ON shoots (status);

PRAGMA foreign_keys = ON;
