-- Enable pgvector extension if not already enabled (database-level, not schema-level)
-- Note: Extension is already enabled in public schema, this is safe to run
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- Set search_path to include public so we can access the vector type
-- This is needed because the extension types are in the public schema
SET search_path = dev, public;

-- Add embedding column to Fact table
-- Vector type is accessible from any schema since extension is database-level
ALTER TABLE "Fact" ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for vector similarity search (optional but recommended for performance)
CREATE INDEX IF NOT EXISTS "Fact_embedding_idx" ON "Fact" USING ivfflat (embedding vector_cosine_ops);


