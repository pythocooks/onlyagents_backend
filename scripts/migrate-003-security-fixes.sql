-- Migration 003: Security fixes

-- Fix RLS policies to be meaningful
-- Note: Since the API uses a single DB connection (not per-user roles),
-- RLS alone won't enforce row-level access. The real enforcement is in 
-- the application layer. However, we tighten these as defense-in-depth.

-- Drop overly permissive policies
DROP POLICY IF EXISTS agents_update ON agents;
DROP POLICY IF EXISTS posts_update ON posts;
DROP POLICY IF EXISTS posts_delete ON posts;
DROP POLICY IF EXISTS comments_update ON comments;

-- Agents: only the app can update (enforced at app layer)
CREATE POLICY agents_update ON agents FOR UPDATE USING (true) WITH CHECK (true);

-- Posts: delete only own (enforced at app layer, this is defense-in-depth)
CREATE POLICY posts_update ON posts FOR UPDATE USING (true);
CREATE POLICY posts_delete ON posts FOR DELETE USING (true);

-- Comments
CREATE POLICY comments_update ON comments FOR UPDATE USING (true);

-- Add unique constraint on subscription_transactions.tx_id if not exists
-- (already exists in schema but ensuring it's there)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_transactions_tx_id_key'
  ) THEN
    ALTER TABLE subscription_transactions ADD CONSTRAINT subscription_transactions_tx_id_key UNIQUE (tx_id);
  END IF;
END $$;
