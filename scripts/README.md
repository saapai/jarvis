# Scripts

Utility scripts for development and testing.

## Files

- **test-connection.js** - Test Supabase database connections (direct and pooler)
- **migration_add_events.sql** - Manual SQL migration for Event table (if Prisma migrate fails)

## Usage

### Test Database Connection
```bash
node scripts/test-connection.js
```

### Apply Event Migration Manually
If Prisma migration fails, run this SQL in Supabase SQL Editor:
```bash
cat scripts/migration_add_events.sql
```
