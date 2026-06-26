import Link from 'next/link'
import { getPrisma } from '@/lib/prisma'

interface QueuedPageProps {
  params: Promise<{ slug: string }>
}

// Announcements are scheduled/sent in the org's timezone (see src/lib/slackDeadline.ts).
// Render all times here in the same zone so the queue matches when messages actually go out.
const ORG_TIMEZONE = 'America/Los_Angeles'
const ORG_TZ_LABEL = 'PT'

async function getSpaceId(slug: string) {
  const prisma = await getPrisma()
  const space = await prisma.space.findUnique({
    where: { slug },
    select: { id: true },
  })
  return space?.id
}

async function getQueued(spaceId: string) {
  const prisma = await getPrisma()

  // Queued = scheduled but not yet sent. Include this space's items and global
  // (spaceId: null) items, which is where Slack-sync announcements currently land.
  return prisma.scheduledAnnouncement.findMany({
    where: {
      sent: false,
      OR: [{ spaceId }, { spaceId: null }],
    },
    orderBy: { scheduledFor: 'asc' },
    take: 100,
  })
}

/** YYYY-MM-DD for a date in the org timezone (used as the digest grouping key). */
function orgDayKey(date: Date): string {
  // en-CA renders as ISO-like YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ORG_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function formatDayHeading(dayKey: string): string {
  // Parse the key at UTC noon so the weekday/label aren't shifted by parsing.
  const d = new Date(`${dayKey}T12:00:00Z`)
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

function formatTime(date: Date): string {
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: ORG_TIMEZONE,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date) + ` ${ORG_TZ_LABEL}`
  )
}

/** Relative label like "Today" / "Tomorrow" / "In 3 days" / "Overdue", computed in org-day terms. */
function relativeDayLabel(dayKey: string, todayKey: string): string {
  const target = Date.parse(`${dayKey}T00:00:00Z`)
  const today = Date.parse(`${todayKey}T00:00:00Z`)
  const diff = Math.round((target - today) / 86_400_000)
  if (diff < 0) return 'Overdue'
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return `In ${diff} days`
}

function Toggle({ slug }: { slug: string }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--card-border)] p-0.5 bg-[var(--card-bg)]">
      <Link
        href={`/spaces/${slug}/announcements`}
        className="px-3 py-1 text-sm rounded-md text-[var(--text-meta)] hover:text-[var(--text-on-dark)] transition-colors"
      >
        History
      </Link>
      <Link
        href={`/spaces/${slug}/announcements/queued`}
        className="px-3 py-1 text-sm rounded-md bg-[rgba(59,124,150,0.25)] text-[var(--highlight-blue)] border border-[var(--highlight-blue)]/40"
      >
        Queued
      </Link>
    </div>
  )
}

export default async function QueuedAnnouncementsPage({ params }: QueuedPageProps) {
  const { slug } = await params
  const spaceId = await getSpaceId(slug)

  if (!spaceId) {
    return <div>Space not found</div>
  }

  const queued = await getQueued(spaceId)
  const todayKey = orgDayKey(new Date())

  // Group into a digest: one section per scheduled send-day.
  const groups: { dayKey: string; items: typeof queued }[] = []
  for (const item of queued) {
    const dayKey = orgDayKey(item.scheduledFor)
    const last = groups[groups.length - 1]
    if (last && last.dayKey === dayKey) {
      last.items.push(item)
    } else {
      groups.push({ dayKey, items: [item] })
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-on-dark)]">Queued announcements</h2>
          <p className="text-sm text-[var(--text-meta)]">
            Scheduled messages waiting to be sent to all members, by send date ({ORG_TZ_LABEL}).
          </p>
        </div>
        <Toggle slug={slug} />
      </div>

      {queued.length === 0 ? (
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
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-[var(--text-on-card-title)]">Nothing queued</h3>
          <p className="mt-1 text-sm text-[var(--text-meta)]">
            Scheduled announcements (e.g. reminders detected from Slack) will appear here until they send.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(({ dayKey, items }) => {
            const rel = relativeDayLabel(dayKey, todayKey)
            const isOverdue = rel === 'Overdue'
            return (
              <div key={dayKey}>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-[var(--text-on-dark)]">{formatDayHeading(dayKey)}</h3>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                      isOverdue
                        ? 'bg-[rgba(206,96,135,0.25)] text-[var(--highlight-red)] border-[var(--highlight-red)]/40'
                        : 'bg-[rgba(59,124,150,0.25)] text-[var(--highlight-blue)] border-[var(--highlight-blue)]/40'
                    }`}
                  >
                    {rel}
                  </span>
                </div>
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="bg-[var(--card-bg)] rounded-lg shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] border border-[var(--card-border)] p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[rgba(59,124,150,0.25)] text-[var(--highlight-blue)] border border-[var(--highlight-blue)]/40">
                            Queued
                          </span>
                          {item.sourceMessageTs && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-[var(--text-meta)] border border-[var(--card-border)]">
                              From Slack
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-[var(--text-meta)] whitespace-nowrap">{formatTime(item.scheduledFor)}</span>
                      </div>
                      <p className="mt-3 text-sm text-[var(--text-on-card-title)] whitespace-pre-wrap">{item.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
