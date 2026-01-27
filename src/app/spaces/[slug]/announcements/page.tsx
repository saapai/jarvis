import { getPrisma } from '@/lib/prisma'

interface AnnouncementsPageProps {
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

async function getAnnouncements(spaceId: string) {
  const prisma = await getPrisma()

  // Get finalized announcement drafts
  const announcements = await prisma.announcementDraft.findMany({
    where: {
      spaceId,
      status: 'finalized'
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  })

  return announcements
}

async function getPolls(spaceId: string) {
  const prisma = await getPrisma()

  const polls = await prisma.pollMeta.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      _count: {
        select: { responses: true }
      },
      responses: {
        select: { response: true }
      }
    }
  })

  return polls.map(poll => {
    const yesCount = poll.responses.filter(r => r.response === 'Yes').length
    const noCount = poll.responses.filter(r => r.response === 'No').length
    const maybeCount = poll.responses.filter(r => r.response === 'Maybe').length

    return {
      ...poll,
      yesCount,
      noCount,
      maybeCount,
      totalResponses: poll._count.responses
    }
  })
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

export default async function AnnouncementsPage({ params }: AnnouncementsPageProps) {
  const { slug } = await params
  const spaceId = await getSpaceId(slug)

  if (!spaceId) {
    return <div>Space not found</div>
  }

  const [announcements, polls] = await Promise.all([
    getAnnouncements(spaceId),
    getPolls(spaceId)
  ])

  // Combine and sort by date
  const allItems = [
    ...announcements.map(a => ({ type: 'announcement' as const, item: a, date: a.createdAt })),
    ...polls.map(p => ({ type: 'poll' as const, item: p, date: p.createdAt }))
  ].sort((a, b) => b.date.getTime() - a.date.getTime())

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Announcements & Polls</h2>
        <p className="text-sm text-gray-500">
          History of messages sent to all members
        </p>
      </div>

      {allItems.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No announcements yet</h3>
          <p className="mt-1 text-sm text-gray-500">
            Announcements and polls sent via SMS will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {allItems.map(({ type, item, date }) => (
            <div key={item.id} className="bg-white rounded-lg shadow p-6">
              {type === 'announcement' ? (
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Announcement
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">{formatDate(date)}</span>
                  </div>
                  <p className="mt-3 text-sm text-gray-900">{(item as any).draftText}</p>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        Poll
                      </span>
                      {(item as any).isActive && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Active
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">{formatDate(date)}</span>
                  </div>
                  <p className="mt-3 text-sm text-gray-900">{(item as any).questionText}</p>
                  <div className="mt-3 flex items-center space-x-4 text-sm">
                    <span className="text-green-600">Yes: {(item as any).yesCount}</span>
                    <span className="text-red-600">No: {(item as any).noCount}</span>
                    <span className="text-yellow-600">Maybe: {(item as any).maybeCount}</span>
                    <span className="text-gray-500">({(item as any).totalResponses} total)</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
