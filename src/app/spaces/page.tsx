import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireAuth } from '@/lib/auth/supabase-server'
import { getOrCreateUser, getUserSpaces } from '@/lib/auth/user'
import { UserMenu } from '@/components/UserMenu'

export default async function SpacesPage() {
  const supabaseUser = await requireAuth()
  const user = await getOrCreateUser(supabaseUser)

  if (!user) {
    redirect('/auth/login')
  }

  const spaces = await getUserSpaces(user.id)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Jarvis</h1>
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-xl font-semibold text-gray-900">Your Spaces</h2>
          <Link
            href="/spaces/new"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Space
          </Link>
        </div>

        {spaces.length === 0 ? (
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
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No spaces yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Create a new space or join one with an invite code.
            </p>
            <div className="mt-6 flex justify-center gap-4">
              <Link
                href="/spaces/new"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
              >
                Create a Space
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {spaces.map((space) => (
              <Link
                key={space.id}
                href={`/spaces/${space.slug}`}
                className="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-6"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">{space.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {space.memberCount} {space.memberCount === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    space.role === 'owner'
                      ? 'bg-purple-100 text-purple-800'
                      : space.role === 'admin'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {space.role.charAt(0).toUpperCase() + space.role.slice(1)}
                  </span>
                </div>
                <div className="mt-4 flex items-center text-sm text-gray-500">
                  <span className="font-mono bg-gray-100 px-2 py-1 rounded">
                    JOIN {space.joinCode}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
