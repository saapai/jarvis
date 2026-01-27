import { getPrisma } from '@/lib/prisma'

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
    take: 50,
    include: {
      upload: {
        select: { name: true }
      }
    }
  })
  return facts
}

export default async function InboxPage({ params }: InboxPageProps) {
  const { slug } = await params
  const spaceId = await getSpaceId(slug)

  if (!spaceId) {
    return <div>Space not found</div>
  }

  const facts = await getFacts(spaceId)

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--text-on-dark)]">Knowledge Base</h2>
        <p className="text-sm text-[var(--text-meta)]">
          Facts and information extracted from uploaded documents
        </p>
      </div>

      {facts.length === 0 ? (
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
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-[var(--text-on-card-title)]">No facts yet</h3>
          <p className="mt-1 text-sm text-[var(--text-meta)]">
            Upload documents to extract facts and build your knowledge base.
          </p>
        </div>
      ) : (
        <div className="bg-[var(--card-bg)] shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] border border-[var(--card-border)] overflow-hidden rounded-lg">
          <ul className="divide-y divide-[var(--card-border)]">
            {facts.map((fact) => (
              <li key={fact.id} className="px-6 py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm text-[var(--text-on-card-title)]">{fact.content}</p>
                    {fact.sourceText && (
                      <p className="mt-1 text-xs text-[var(--text-meta)] line-clamp-2">
                        Source: {fact.sourceText}
                      </p>
                    )}
                    <div className="mt-2 flex items-center space-x-4 text-xs text-[var(--text-meta)]">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--text-meta)]/20">
                        {fact.category}
                      </span>
                      {fact.subcategory && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-[rgba(59,124,150,0.25)] text-[var(--highlight-blue)] border border-[var(--highlight-blue)]/40">
                          {fact.subcategory}
                        </span>
                      )}
                      {fact.timeRef && (
                        <span>{fact.timeRef}</span>
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
  )
}
