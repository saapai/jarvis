#!/usr/bin/env node

/**
 * Create Bridge Migration
 * 
 * Generates a migration SQL file that bridges the gap between the current
 * dev database state and schema.prisma. This is useful when migrations are
 * missing or the database is out of sync.
 * 
 * Usage:
 *   node scripts/create-bridge-migration.js
 * 
 * Prerequisites:
 *   - .env.local must have DATABASE_URL and DIRECT_URL with schema=dev
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hour}${minute}${second}`;
}

function main() {
  console.log('🔧 Creating bridge migration...\n');
  
  // Check if .env.local exists
  const envLocalPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envLocalPath)) {
    console.error('❌ Error: .env.local not found');
    console.error('   Please create .env.local with DATABASE_URL and DIRECT_URL');
    process.exit(1);
  }
  
  // Load environment variables
  const envContent = fs.readFileSync(envLocalPath, 'utf-8');
  const envVars = {};
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  });
  
  if (!envVars.DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL not found in .env.local');
    process.exit(1);
  }
  
  if (!envVars.DATABASE_URL.includes('schema=dev')) {
    console.error('❌ Error: DATABASE_URL must include schema=dev');
    console.error('   Current DATABASE_URL:', envVars.DATABASE_URL.substring(0, 50) + '...');
    process.exit(1);
  }
  
  const timestamp = getTimestamp();
  const migrationName = `${timestamp}_bridge_dev_schema`;
  const migrationDir = path.join(__dirname, '..', 'prisma', 'migrations', migrationName);
  
  console.log('📋 Steps:');
  console.log('   1. Generating diff between dev database and schema.prisma');
  console.log('   2. Creating migration file');
  console.log('   3. You can review and edit it before applying\n');
  
  try {
    // Create migration directory
    if (!fs.existsSync(migrationDir)) {
      fs.mkdirSync(migrationDir, { recursive: true });
    }
    
    // Generate the diff SQL
    console.log('⏳ Generating migration SQL...');
    const diffSql = execSync(
      `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --script`,
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          DATABASE_URL: envVars.DATABASE_URL,
          DIRECT_URL: envVars.DIRECT_URL || envVars.DATABASE_URL,
        },
        encoding: 'utf-8'
      }
    );
    
    // Actually, we want the reverse - from database to schema
    // Let's use a different approach - use migrate diff properly
    console.log('   Using prisma migrate diff to compare database to schema...');
    
    // Get the SQL that would bring database in line with schema
    const migrationSql = execSync(
      `npx prisma migrate diff --from-url "${envVars.DATABASE_URL}" --to-schema-datamodel prisma/schema.prisma --script`,
      {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf-8'
      }
    );
    
    if (!migrationSql || migrationSql.trim().length === 0) {
      console.log('✅ Database is already in sync with schema.prisma!');
      console.log('   No migration needed.');
      // Clean up empty directory
      fs.rmdirSync(migrationDir);
      return;
    }
    
    // Add search_path setting for dev schema
    const finalSql = `-- Set search_path to include dev and public (for extensions)
SET search_path = dev, public;

${migrationSql}`;
    
    // Write migration file
    const migrationFile = path.join(migrationDir, 'migration.sql');
    fs.writeFileSync(migrationFile, finalSql, 'utf-8');
    
    console.log(`✅ Migration created: ${migrationName}/migration.sql`);
    console.log('\n📝 Next steps:');
    console.log('   1. Review the migration file:');
    console.log(`      cat prisma/migrations/${migrationName}/migration.sql`);
    console.log('   2. Edit if needed (especially if there are conflicts)');
    console.log('   3. Apply the migration:');
    console.log('      export $(cat .env.local | grep -v "^#" | xargs)');
    console.log(`      npx prisma migrate resolve --applied ${migrationName}`);
    console.log('      npx prisma migrate deploy');
    console.log('\n   Or use dotenv-cli:');
    console.log(`      npx dotenv -e .env.local -- npx prisma migrate resolve --applied ${migrationName}`);
    console.log('      npx dotenv -e .env.local -- npx prisma migrate deploy');
    
  } catch (error) {
    console.error('\n❌ Error creating migration:', error.message);
    
    if (error.stdout) {
      console.error('\nstdout:', error.stdout.toString());
    }
    if (error.stderr) {
      console.error('\nstderr:', error.stderr.toString());
    }
    
    console.error('\n💡 Alternative approach:');
    console.error('   You can manually create a migration using:');
    console.error('   npx prisma migrate dev --create-only --name bridge_dev_schema');
    console.error('   Then edit the generated migration file and apply it.');
    
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
