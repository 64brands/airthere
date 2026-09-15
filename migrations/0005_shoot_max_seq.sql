-- High-water sequence for a Shoot. Appends always continue after this value.
-- Deleting an image must not decrease max_seq, so remaining filenames stay
-- stable and unused sequence numbers are never reused.

ALTER TABLE shoots ADD COLUMN max_seq INTEGER NOT NULL DEFAULT 0;

UPDATE shoots
SET max_seq = COALESCE(
  (SELECT MAX(seq) FROM images WHERE images.shoot_id = shoots.id),
  0
);
