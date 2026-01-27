import { getPrisma } from '@/lib/prisma'
import InboxClient from './InboxClient'

interface InboxPageProps {
  params: Promise<{ slug: string }>
}

async function getSpaceId(slug: string) {
  const prisma = await getPrisma()
  const space = await prisma.space.findUnique({
    where: { slug },
    select: { id: true }
  })
  return space?.id
}

async function getFacts(spaceId: string) {
  const prisma = await getPrisma()
  const facts = await prisma.fact.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      upload: {
        select: { name: true }
      }
    }
  })
  
  // Transform to match Fact interface
  return facts.map(fact => ({
    id: fact.id,
    content: fact.content,
    sourceText: fact.sourceText,
    category: fact.category,
    subcategory: fact.subcategory,
    timeRef: fact.timeRef,
    dateStr: fact.dateStr,
    calendarDates: fact.calendarDates ? (typeof fact.calendarDates === 'string' ? JSON.parse(fact.calendarDates) : fact.calendarDates) : null,
    entities: fact.entities ? (typeof fact.entities === 'string' ? JSON.parse(fact.entities) : fact.entities) : [],
    uploadName: fact.upload?.name || 'Unknown'
  }))
}

export default async function InboxPage({ params }: InboxPageProps) {
  const { slug } = await params
  const spaceId = await getSpaceId(slug)

  if (!spaceId) {
    return <div className="text-[var(--text-on-dark)]">Space not found</div>
  }

  const facts = await getFacts(spaceId)

  return <InboxClient facts={facts} />
}
