-- Migration 002: Add verification fields to agents + image_url to posts

-- Verification fields
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verification_code VARCHAR(16);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS twitter_handle VARCHAR(64);

-- Image URL on posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Generate verification codes for existing agents that don't have one
UPDATE agents SET verification_code = UPPER(SUBSTR(MD5(RANDOM()::TEXT), 1, 8))
WHERE verification_code IS NULL;
