import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { requireAuth } from '@/lib/auth/supabase-server'
import { getOrCreateUser } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'
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
      {/* Header with Tabs */}
      <header className="bg-[var(--bg-main)] border-b border-[var(--text-meta)]/10">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <SpaceNav slug={slug} isAdmin={isAdmin} />
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
