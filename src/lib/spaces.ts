import { getPrisma } from './prisma'

export async function getSpaceId(slug: string): Promise<string | null> {
  const prisma = await getPrisma()
  const space = await prisma.space.findUnique({
    where: { slug },
    select: { id: true }
  })
  return space?.id || null
}

/**
 * The "primary" space for global integrations (Slack sync) that aren't tied to a
 * specific space. Resolution order:
 *   1. SLACK_DEFAULT_SPACE_SLUG env var, if set and it resolves
 *   2. the space with the most members (the real org, not a test space)
 *   3. any space (findFirst) as a last resort
 *
 * The old code used prisma.space.findFirst(), which returned whichever space was
 * created first — a 2-member test space in production — so synced facts landed in
 * the wrong space. Member count is a deterministic proxy for "the space people
 * actually use".
 */
export async function getPrimarySpaceId(): Promise<string | null> {
  const prisma = await getPrisma()

  const preferredSlug = process.env.SLACK_DEFAULT_SPACE_SLUG
  if (preferredSlug) {
    const preferred = await prisma.space.findUnique({ where: { slug: preferredSlug }, select: { id: true } })
    if (preferred) return preferred.id
  }

  const byMembers = await prisma.space.findMany({
    select: { id: true, _count: { select: { members: true } } },
    orderBy: { members: { _count: 'desc' } },
    take: 1
  })
  if (byMembers[0]) return byMembers[0].id

  const any = await prisma.space.findFirst({ select: { id: true } })
  return any?.id || null
}
