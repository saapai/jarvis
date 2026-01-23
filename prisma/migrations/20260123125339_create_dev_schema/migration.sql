-- Create dev schema for local development
-- This schema isolates dev data from production data in the same database
CREATE SCHEMA IF NOT EXISTS dev;

-- Ensure pgvector extension is available (extensions are database-level, not schema-level)
-- This is safe to run even if the extension already exists
CREATE EXTENSION IF NOT EXISTS vector;
