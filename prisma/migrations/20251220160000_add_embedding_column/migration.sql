-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to Fact table
ALTER TABLE "Fact" ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for vector similarity search (optional but recommended for performance)
CREATE INDEX IF NOT EXISTS "Fact_embedding_idx" ON "Fact" USING ivfflat (embedding vector_cosine_ops);


