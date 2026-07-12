/**
 * One-time backfill: legacy Slack-synced Uploads and Facts were created with
 * spaceId = NULL (before space-scoping was wired into the sync). They belong to
 * the primary org space. This assigns them to it.
 *
 * Idempotent: only touches rows where spaceId IS NULL. Safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=<direct connection> node scripts/backfill-null-space.mjs           # dry run
 *   DATABASE_URL=<direct connection> node scripts/backfill-null-space.mjs --commit  # apply
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const COMMIT = process.argv.includes('--commit')

async function primarySpace() {
  const preferred = process.env.SLACK_DEFAULT_SPACE_SLUG
  if (preferred) {
    const s = await prisma.space.findUnique({ where: { slug: preferred }, select: { id: true, slug: true } })
    if (s) return s
  }
  const [top] = await prisma.space.findMany({
    select: { id: true, slug: true, _count: { select: { members: true } } },
    orderBy: { members: { _count: 'desc' } },
    take: 1
  })
  return top
}

async function main() {
  const space = await primarySpace()
  if (!space) { console.error('No space found; aborting.'); process.exit(1) }
  console.log(`Primary space: ${space.slug} (${space.id})`)

  const nullUploads = await prisma.upload.count({ where: { spaceId: null } })
  const nullFacts = await prisma.fact.count({ where: { spaceId: null } })
  console.log(`Null-space rows → Uploads: ${nullUploads}, Facts: ${nullFacts}`)

  if (!COMMIT) {
    console.log('\nDRY RUN. Re-run with --commit to apply. Nothing was changed.')
    return
  }

  const up = await prisma.upload.updateMany({ where: { spaceId: null }, data: { spaceId: space.id } })
  const fa = await prisma.fact.updateMany({ where: { spaceId: null }, data: { spaceId: space.id } })
  console.log(`\nUpdated Uploads: ${up.count}, Facts: ${fa.count}`)

  const remUploads = await prisma.upload.count({ where: { spaceId: null } })
  const remFacts = await prisma.fact.count({ where: { spaceId: null } })
  console.log(`Remaining null-space → Uploads: ${remUploads}, Facts: ${remFacts}`)
  console.log(`Facts now in ${space.slug}: ${await prisma.fact.count({ where: { spaceId: space.id } })}`)
}

main().catch(e => { console.error(e.message); process.exit(1) }).finally(() => prisma.$disconnect())
