import { getPrisma } from '@/lib/prisma'

interface UploadsPageProps {
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

async function getUploads(spaceId: string) {
  const prisma = await getPrisma()
  const uploads = await prisma.upload.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { facts: true }
      }
    }
  })
  return uploads
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date)
}

export default async function UploadsPage({ params }: UploadsPageProps) {
  const { slug } = await params
  const spaceId = await getSpaceId(slug)

  if (!spaceId) {
    return <div>Space not found</div>
  }

  const uploads = await getUploads(spaceId)

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Uploads</h2>
          <p className="text-sm text-gray-500">
            Documents uploaded to this space
          </p>
        </div>
        {/* TODO: Add upload button */}
      </div>

      {uploads.length === 0 ? (
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
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No uploads yet</h3>
          <p className="mt-1 text-sm text-gray-500">
            Upload documents to extract facts and build your knowledge base.
          </p>
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden rounded-lg">
          <ul className="divide-y divide-gray-200">
            {uploads.map((upload) => (
              <li key={upload.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <svg
                      className="h-8 w-8 text-gray-400 mr-4"
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
                    <div>
                      <p className="text-sm font-medium text-gray-900">{upload.name}</p>
                      <p className="text-xs text-gray-500">
                        Uploaded {formatDate(upload.createdAt)} · {upload._count.facts} facts extracted
                      </p>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {Math.round(upload.rawText.length / 1000)}k chars
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
