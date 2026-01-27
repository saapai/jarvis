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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <Link href="/spaces" className="text-gray-500 hover:text-gray-700">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{space.name}</h1>
                <p className="text-sm text-gray-500">
                  {space.memberCount} {space.memberCount === 1 ? 'member' : 'members'}
                  <span className="mx-2">·</span>
                  <span className="font-mono bg-gray-100 px-1 rounded text-xs">JOIN {space.joinCode}</span>
                </p>
              </div>
            </div>
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <SpaceNav slug={slug} isAdmin={isAdmin} />

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  )
}
