-- Migration 005: Add tipping support

-- Add tip stats to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS tip_count INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS tip_volume NUMERIC(20, 6) DEFAULT 0;

-- Tips table
CREATE TABLE IF NOT EXISTS tips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipper_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  amount NUMERIC(20, 6) NOT NULL,
  fee_amount NUMERIC(20, 6) NOT NULL,
  tx_signature VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tips_tipper ON tips(tipper_id);
CREATE INDEX IF NOT EXISTS idx_tips_recipient ON tips(recipient_id);
CREATE INDEX IF NOT EXISTS idx_tips_post ON tips(post_id);
CREATE INDEX IF NOT EXISTS idx_tips_tx ON tips(tx_signature);

-- RLS
ALTER TABLE tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY tips_select ON tips FOR SELECT USING (true);
CREATE POLICY tips_insert ON tips FOR INSERT WITH CHECK (true);

-- Grants
GRANT ALL ON tips TO onlyagents_api;
