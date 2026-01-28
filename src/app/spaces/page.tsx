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
    <div className="min-h-screen bg-[var(--bg-main)]" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <header className="bg-[var(--bg-main)] border-b border-[var(--text-meta)]/10">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5 text-[#22c55e]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-sm text-[var(--text-on-dark)]">/</span>
              <span className="text-sm font-medium text-[var(--text-on-dark)]">Spaces</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-[var(--text-meta)] hover:text-[var(--text-on-dark)] cursor-pointer">Feedback</span>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search... ⌘K"
                  className="bg-[var(--bg-secondary)] border border-[var(--text-meta)]/20 rounded-lg px-3 py-1.5 pl-8 text-sm text-[var(--text-on-dark)] placeholder-[var(--text-meta)] focus:outline-none focus:border-[var(--text-meta)]/40 w-48"
                />
                <svg className="w-4 h-4 absolute left-2.5 top-2 text-[var(--text-meta)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <button className="text-[var(--text-meta)] hover:text-[var(--text-on-dark)]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              <button className="text-[var(--text-meta)] hover:text-[var(--text-on-dark)]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </button>
              <UserMenu user={user} />
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-[var(--text-on-dark)]">Your Spaces</h1>
          <Link
            href="/spaces/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#22c55e] hover:bg-[#16a34a] text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Space
          </Link>
        </div>

        {spaces.length === 0 ? (
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
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-[var(--text-on-card-title)]">No spaces yet</h3>
            <p className="mt-1 text-sm text-[var(--text-meta)]">
              Create a new space or join one with an invite code.
            </p>
            <div className="mt-6 flex justify-center gap-4">
              <Link
                href="/spaces/new"
                className="inline-flex items-center px-4 py-2 bg-[#22c55e] hover:bg-[#16a34a] text-white text-sm font-medium rounded-lg transition-colors"
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
                className="group bg-[var(--bg-secondary)] rounded-lg border border-[var(--text-meta)]/10 hover:border-[var(--text-meta)]/20 transition-all duration-200 p-6"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-lg bg-[var(--text-meta)]/10 flex items-center justify-center">
                      <svg className="w-5 h-5 text-[var(--text-meta)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-[var(--text-on-dark)] group-hover:text-white transition-colors">{space.name}</h3>
                      <p className="text-sm text-[var(--text-meta)] mt-0.5">
                        {space.memberCount} {space.memberCount === 1 ? 'member' : 'members'}
                      </p>
                    </div>
                  </div>
                  {space.role === 'owner' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgba(206,96,135,0.15)] text-[var(--highlight-red)] border border-[var(--highlight-red)]/30">
                      Owner
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-end">
                  <svg className="w-5 h-5 text-[var(--text-meta)] group-hover:text-[var(--text-on-dark)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
