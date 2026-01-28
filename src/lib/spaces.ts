import { getPrisma } from './prisma'

export async function getSpaceId(slug: string): Promise<string | null> {
  const prisma = await getPrisma()
  const space = await prisma.space.findUnique({
    where: { slug },
    select: { id: true }
  })
  return space?.id || null
}
