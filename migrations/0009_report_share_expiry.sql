-- Access window and revocation for existing report shares.
-- Status is derived: revoked_at, then expires_at, otherwise active.

ALTER TABLE report_shares ADD COLUMN expires_at TEXT;
ALTER TABLE report_shares ADD COLUMN revoked_at TEXT;

UPDATE report_shares
SET expires_at = replace(datetime(created_at, '+7 days'), ' ', 'T') || 'Z'
WHERE expires_at IS NULL;
