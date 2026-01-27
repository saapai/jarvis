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
        <h2 className="text-lg font-semibold text-[var(--text-on-dark)]">Announcements & Polls</h2>
        <p className="text-sm text-[var(--text-meta)]">
          History of messages sent to all members
        </p>
      </div>

      {allItems.length === 0 ? (
        <div className="text-center py-12 bg-[var(--card-bg)] rounded-lg shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] border border-[var(--card-border)]">
          <svg
            className="mx-auto h-12 w-12 text-[var(--text-meta)]"
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
          <h3 className="mt-2 text-sm font-medium text-[var(--text-on-card-title)]">No announcements yet</h3>
          <p className="mt-1 text-sm text-[var(--text-meta)]">
            Announcements and polls sent via SMS will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {allItems.map(({ type, item, date }) => (
            <div key={item.id} className="bg-[var(--card-bg)] rounded-lg shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] border border-[var(--card-border)] p-6">
              {type === 'announcement' ? (
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[rgba(59,124,150,0.25)] text-[var(--highlight-blue)] border border-[var(--highlight-blue)]/40">
                        Announcement
                      </span>
                    </div>
                    <span className="text-xs text-[var(--text-meta)]">{formatDate(date)}</span>
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-on-card-title)]">{(item as any).draftText}</p>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[rgba(206,96,135,0.25)] text-[var(--highlight-red)] border border-[var(--highlight-red)]/40">
                        Poll
                      </span>
                      {(item as any).isActive && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[rgba(59,124,150,0.25)] text-[var(--highlight-blue)] border border-[var(--highlight-blue)]/40">
                          Active
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-[var(--text-meta)]">{formatDate(date)}</span>
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-on-card-title)]">{(item as any).questionText}</p>
                  <div className="mt-3 flex items-center space-x-4 text-sm">
                    <span className="text-[var(--highlight-blue)]">Yes: {(item as any).yesCount}</span>
                    <span className="text-[var(--highlight-red)]">No: {(item as any).noCount}</span>
                    <span className="text-[var(--highlight-red)]">Maybe: {(item as any).maybeCount}</span>
                    <span className="text-[var(--text-meta)]">({(item as any).totalResponses} total)</span>
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
