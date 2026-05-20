-- Migration 013: External access keys for ahoyvpn.com
-- Active subscribers get a key they can use on other sites owned by the owner

CREATE TABLE IF NOT EXISTS external_access_keys (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_key VARCHAR(64) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One active key per user at a time
CREATE UNIQUE INDEX idx_external_access_one_active
  ON external_access_keys (user_id)
  WHERE is_active = TRUE;

-- Quick lookup by key value
CREATE UNIQUE INDEX idx_external_access_key_lookup
  ON external_access_keys (access_key);