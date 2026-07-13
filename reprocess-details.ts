/**
 * Re-process existing facts into the grouped `details` structure.
 * Reads each fact's text, runs extractDetails, writes the JSON back to Fact.details.
 * Defaults to the DEV schema (staging). Pass `--public` to run against production.
 * Run: npx tsx reprocess-details.ts [--public]
 */
import './load-env'
const TARGET_PUBLIC = process.argv.includes('--public')
if (!TARGET_PUBLIC) {
  // default .env.local already points at dev; make it explicit/safe
  process.env.DATABASE_URL = (process.env.DATABASE_URL || '').includes('schema=dev')
    ? process.env.DATABASE_URL
    : (process.env.DATABASE_URL || '') + '&schema=dev&search_path=dev,public'
} else {
  process.env.DATABASE_URL = (process.env.DATABASE_URL || '').replace('schema=dev&search_path=dev,public', 'schema=public&search_path=public')
}

import { getPrisma } from './src/lib/prisma'
import { extractDetails } from './src/text-explorer/detailsExtraction'

const CONCURRENCY = 8
const TODAY = '2026-07-13'

async function main() {
  const prisma = await getPrisma()
  const schema = TARGET_PUBLIC ? 'public' : 'dev'
  const facts: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, subcategory, content, "sourceText", entities FROM ${schema}."Fact" ORDER BY "createdAt" DESC`
  )
  console.log(`RUN target=${schema} facts=${facts.length}`)

  let processed = 0, withDetails = 0, errors = 0
  for (let i = 0; i < facts.length; i += CONCURRENCY) {
    const batch = facts.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (f) => {
      try {
        const details = await extractDetails(
          { content: f.content, sourceText: f.sourceText, entities: f.entities, subcategory: f.subcategory },
          TODAY
        )
        const json = JSON.stringify(details)
        await prisma.$executeRawUnsafe(`UPDATE ${schema}."Fact" SET details = $1 WHERE id = $2`, json, f.id)
        processed++
        if (details.length > 0) { withDetails++; console.log(`  ✓ ${f.subcategory}: ${details.length} details`) }
      } catch (e: any) {
        errors++
        console.log(`  ✗ ${f.subcategory}: ${(e.message || '').substring(0, 80)}`)
      }
    }))
    if (i % 40 === 0) console.log(`... ${processed}/${facts.length} processed`)
  }
  console.log(`DONE target=${schema} processed=${processed} withDetails=${withDetails} errors=${errors}`)
}
main().catch(e => console.error('FATAL', (e.message || '').substring(0, 200)))
