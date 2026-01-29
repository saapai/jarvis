#!/bin/bash

# Generate bridge migration script
# This script generates a migration that bridges the gap between dev database and schema.prisma

set -e

echo "🔧 Generating bridge migration..."

# Load .env.local
if [ ! -f .env.local ]; then
    echo "❌ Error: .env.local not found"
    exit 1
fi

# Export variables from .env.local
export $(cat .env.local | grep -v '^#' | grep DATABASE_URL | xargs)
export $(cat .env.local | grep -v '^#' | grep DIRECT_URL | xargs)

if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL not found in .env.local"
    exit 1
fi

# Check if schema=dev is in the URL
if [[ ! "$DATABASE_URL" == *"schema=dev"* ]]; then
    echo "❌ Error: DATABASE_URL must include schema=dev"
    echo "   Current DATABASE_URL: ${DATABASE_URL:0:50}..."
    exit 1
fi

echo "📋 Generating diff SQL..."
echo "   From: dev database"
echo "   To: schema.prisma"

# Generate timestamp for migration name
TIMESTAMP=$(date +%Y%m%d%H%M%S)
MIGRATION_NAME="${TIMESTAMP}_bridge_dev_schema"
MIGRATION_DIR="prisma/migrations/${MIGRATION_NAME}"

# Create migration directory
mkdir -p "$MIGRATION_DIR"

# Generate the diff with a timeout
echo "⏳ Running prisma migrate diff (this may take a moment)..."
timeout 30 npx prisma migrate diff \
    --from-url "$DATABASE_URL" \
    --to-schema-datamodel prisma/schema.prisma \
    --script > "${MIGRATION_DIR}/migration.sql" 2>&1 || {
    
    if [ $? -eq 124 ]; then
        echo "❌ Command timed out after 30 seconds"
        echo "   This might indicate a connection issue"
        echo ""
        echo "💡 Try this alternative approach:"
        echo "   1. Use prisma migrate dev --create-only instead"
        echo "   2. Or check your DATABASE_URL connection"
        rm -rf "$MIGRATION_DIR"
        exit 1
    else
        echo "❌ Error generating migration"
        cat "${MIGRATION_DIR}/migration.sql"
        rm -rf "$MIGRATION_DIR"
        exit 1
    fi
}

# Check if migration SQL is empty or just whitespace
if [ ! -s "${MIGRATION_DIR}/migration.sql" ] || [ -z "$(cat "${MIGRATION_DIR}/migration.sql" | tr -d '[:space:]')" ]; then
    echo "✅ Database is already in sync with schema.prisma!"
    echo "   No migration needed."
    rm -rf "$MIGRATION_DIR"
    exit 0
fi

# Add search_path setting at the top
echo "-- Set search_path to include dev and public (for extensions)
SET search_path = dev, public;

$(cat "${MIGRATION_DIR}/migration.sql")" > "${MIGRATION_DIR}/migration.sql.tmp"
mv "${MIGRATION_DIR}/migration.sql.tmp" "${MIGRATION_DIR}/migration.sql"

echo ""
echo "✅ Migration created: ${MIGRATION_NAME}/migration.sql"
echo ""
echo "📝 Next steps:"
echo "   1. Review the migration:"
echo "      cat ${MIGRATION_DIR}/migration.sql"
echo ""
echo "   2. Apply the migration:"
echo "      export \$(cat .env.local | grep -v '^#' | xargs)"
echo "      npx prisma migrate deploy"
echo ""
echo "   Or mark it as applied if you've already applied it manually:"
echo "      npx prisma migrate resolve --applied ${MIGRATION_NAME}"
