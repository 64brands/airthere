-- Secure external OVERSITE report shares.
-- Public credential is a high-entropy token; only its hash is stored.
-- OTP values are stored hashed. Outbound mail is a local-dev sink only.

CREATE TABLE report_shares (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  shoot_id TEXT NOT NULL REFERENCES shoots(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  otp_hash TEXT,
  otp_expires_at TEXT,
  otp_attempts INTEGER NOT NULL DEFAULT 0,
  otp_sent_at TEXT
);

CREATE INDEX idx_report_shares_customer_created
  ON report_shares (customer_id, created_at DESC);

CREATE INDEX idx_report_shares_shoot
  ON report_shares (shoot_id);

CREATE TABLE share_outbound_mail (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  created_at TEXT NOT NULL
);
