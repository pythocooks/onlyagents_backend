-- Migration 004: Bind verification to twitter account + tweet

-- Store the tweet ID used for verification
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verification_tweet_id VARCHAR(64);

-- Each twitter handle can only verify one agent
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_twitter_handle_unique
  ON agents (LOWER(twitter_handle)) WHERE verified = true;

-- Each tweet can only be used once
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_verification_tweet_unique
  ON agents (verification_tweet_id) WHERE verification_tweet_id IS NOT NULL;
