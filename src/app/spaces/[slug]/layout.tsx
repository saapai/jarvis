import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { requireAuth } from '@/lib/auth/supabase-server'
import { getOrCreateUser } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'
import { UserMenu } from '@/components/UserMenu'
import { SpaceNav } from '@/components/SpaceNav'

interface SpaceLayoutProps {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

async function getSpace(slug: string, userId: string) {
  const prisma = await getPrisma()

  const space = await prisma.space.findUnique({
    where: { slug },
    include: {
      members: {
        where: { userId },
        take: 1
      },
      _count: {
        select: { members: true }
      }
    }
  })

  if (!space) return null

  // Check if user is a member
  const membership = space.members[0]
  if (!membership) return null

  return {
    ...space,
    role: membership.role,
    memberCount: space._count.members
  }
}

export default async function SpaceLayout({ children, params }: SpaceLayoutProps) {
  const { slug } = await params
  const supabaseUser = await requireAuth()
  const user = await getOrCreateUser(supabaseUser)

  if (!user) {
    redirect('/auth/login')
  }

  const space = await getSpace(slug, user.id)

  if (!space) {
    notFound()
  }

  const isAdmin = space.role === 'owner' || space.role === 'admin'

  return (
    <div className="min-h-screen bg-[var(--bg-main)]">
      {/* Minimal Header */}
      <header className="bg-[var(--bg-main)] border-b border-[var(--text-meta)]/5">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex justify-between items-center py-3">
            <div className="flex items-center space-x-2">
              <Link href="/spaces" className="p-1.5 rounded hover:bg-[var(--bg-secondary)] transition-colors">
                <svg className="w-4 h-4 text-[var(--text-meta)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </Link>
              <svg className="w-4 h-4 text-[var(--text-meta)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm text-[var(--text-meta)] font-mono">/all_</span>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-sm text-[var(--text-meta)] font-mono lowercase">{space.name}_</span>
              <button className="text-xs text-[var(--text-meta)] px-2 py-1 rounded hover:bg-[var(--bg-secondary)] transition-colors font-mono">viewer</button>
              <div className="w-6 h-6 rounded bg-[var(--text-meta)]/10"></div>
              <div className="w-6 h-6 rounded bg-[var(--text-meta)]/10"></div>
              <UserMenu user={user} />
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <SpaceNav slug={slug} isAdmin={isAdmin} />

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
