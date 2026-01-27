import { getPrisma } from '@/lib/prisma'

interface CalendarPageProps {
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

async function getEvents(spaceId: string) {
  const prisma = await getPrisma()
  const now = new Date()

  const events = await prisma.event.findMany({
    where: {
      spaceId,
      eventDate: { gte: now }
    },
    orderBy: { eventDate: 'asc' },
    take: 50
  })

  return events
}

async function getPastEvents(spaceId: string) {
  const prisma = await getPrisma()
  const now = new Date()

  const events = await prisma.event.findMany({
    where: {
      spaceId,
      eventDate: { lt: now }
    },
    orderBy: { eventDate: 'desc' },
    take: 10
  })

  return events
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

export default async function CalendarPage({ params }: CalendarPageProps) {
  const { slug } = await params
  const spaceId = await getSpaceId(slug)

  if (!spaceId) {
    return <div>Space not found</div>
  }

  const [upcomingEvents, pastEvents] = await Promise.all([
    getEvents(spaceId),
    getPastEvents(spaceId)
  ])

  return (
    <div className="space-y-8">
      {/* Upcoming Events */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Events</h2>

        {upcomingEvents.length === 0 ? (
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
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No upcoming events</h3>
            <p className="mt-1 text-sm text-gray-500">
              Events will appear here when they are scheduled.
            </p>
          </div>
        ) : (
          <div className="bg-white shadow overflow-hidden rounded-lg">
            <ul className="divide-y divide-gray-200">
              {upcomingEvents.map((event) => (
                <li key={event.id} className="px-6 py-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-sm font-medium text-gray-900">{event.title}</h3>
                      {event.description && (
                        <p className="mt-1 text-sm text-gray-500">{event.description}</p>
                      )}
                      <div className="mt-2 flex items-center space-x-4 text-xs text-gray-500">
                        <span className="flex items-center">
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {formatDate(event.eventDate)}
                        </span>
                        {event.location && (
                          <span className="flex items-center">
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {event.location}
                          </span>
                        )}
                        {event.category && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                            {event.category}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Past Events */}
      {pastEvents.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Past Events</h2>
          <div className="bg-white shadow overflow-hidden rounded-lg opacity-75">
            <ul className="divide-y divide-gray-200">
              {pastEvents.map((event) => (
                <li key={event.id} className="px-6 py-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-sm font-medium text-gray-500">{event.title}</h3>
                      <div className="mt-1 text-xs text-gray-400">
                        {formatDate(event.eventDate)}
                        {event.location && ` · ${event.location}`}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
