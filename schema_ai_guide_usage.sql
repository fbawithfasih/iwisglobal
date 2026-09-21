-- schema_ai_guide_usage.sql
-- Backs the AI Guide's rate limiter (src/lib/aiGuide.ts). ip_hash is a
-- SHA-256 hash of the visitor's IP (privacy-only, not a security
-- boundary) — never the raw IP. created_at is a Unix ms timestamp so
-- range queries (`WHERE created_at > ?`) are cheap integer comparisons.
CREATE TABLE ai_guide_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_guide_requests_created_at ON ai_guide_requests(created_at);
CREATE INDEX idx_ai_guide_requests_ip_hash ON ai_guide_requests(ip_hash, created_at);
