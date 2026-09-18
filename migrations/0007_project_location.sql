-- Project-level site location for progress reports.
-- Coordinates are the central Project/Shoot site, not per-Shoot.

ALTER TABLE projects ADD COLUMN location TEXT;
ALTER TABLE projects ADD COLUMN latitude REAL;
ALTER TABLE projects ADD COLUMN longitude REAL;
