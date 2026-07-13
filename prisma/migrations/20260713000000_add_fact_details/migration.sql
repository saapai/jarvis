-- Add structured grouped sub-details to Fact (batch-by-relation).
-- Idempotent: the column may already exist from the manual prod rollout.
ALTER TABLE "Fact" ADD COLUMN IF NOT EXISTS "details" TEXT;
