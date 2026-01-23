# Scripts

Utility scripts for development and testing.

## Files

- **setup-dev-schema.js** - Set up dev schema for local development (creates schema and runs migrations)
- **test-dev-schema.js** - Test that dev schema is working correctly (verifies isolation from production)
- **test-connection.js** - Test Supabase database connections (direct and pooler)
- **migration_add_events.sql** - Manual SQL migration for Event table (if Prisma migrate fails)

## Usage

### Setup Dev Schema (First-time setup)
Sets up the `dev` schema in Supabase for local development. This isolates dev data from production data in the same database.

```bash
# Set your production DATABASE_URL (without schema parameter)
export DATABASE_URL="postgresql://postgres:password@db.yourproject.supabase.co:5432/postgres"

# Run the setup script
node scripts/setup-dev-schema.js
```

The script will:
1. Create the `dev` schema if it doesn't exist
2. Run all migrations on the `dev` schema
3. Provide instructions for creating `.env.local`

### Test Dev Schema Setup
Verifies that the dev schema is working correctly and isolated from production.

```bash
# Make sure .env.local is set up with dev schema connection strings
node scripts/test-dev-schema.js
```

The script checks:
- Current schema is `dev`
- Tables exist in dev schema
- Production (public) schema is separate
- Can perform queries on dev schema

### Test Database Connection
```bash
node scripts/test-connection.js
```

### Apply Event Migration Manually
If Prisma migration fails, run this SQL in Supabase SQL Editor:
```bash
cat scripts/migration_add_events.sql
```
