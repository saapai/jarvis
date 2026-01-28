import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth/supabase-server'
import { getOrCreateUser, isSpaceAdmin } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'
import { SpaceSettingsForm } from '@/components/SpaceSettingsForm'
import { MembersSection } from '@/components/MembersSection'
import { AddMemberForm } from '@/components/AddMemberForm'
import { InviteLinkSection } from '@/components/InviteLinkSection'

interface SettingsPageProps {
  params: Promise<{ slug: string }>
}

async function getSpaceWithMembers(slug: string) {
  const prisma = await getPrisma()

  const space = await prisma.space.findUnique({
    where: { slug },
    include: {
      members: {
        include: {
          user: true
        },
        orderBy: [
          { role: 'asc' },
          { joinedAt: 'asc' }
        ]
      },
      invites: {
        where: {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } }
          ]
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  })

  return space
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { slug } = await params
  const supabaseUser = await requireAuth()
  const user = await getOrCreateUser(supabaseUser)

  if (!user) {
    redirect('/auth/login')
  }

  const space = await getSpaceWithMembers(slug)

  if (!space) {
    return <div>Space not found</div>
  }

  const isAdmin = await isSpaceAdmin(user.id, space.id)

  if (!isAdmin) {
    redirect(`/spaces/${slug}`)
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-on-dark)]">Space Settings</h2>
        <p className="text-sm text-[var(--text-meta)]">
          Manage your space configuration
        </p>
      </div>

      <SpaceSettingsForm space={space} />

      {/* Members Section */}
      <div className="border-t border-[var(--text-meta)]/10 pt-8">
        <h3 className="text-lg font-semibold text-[var(--text-on-dark)] mb-4">Members</h3>
        <MembersSection 
          members={space.members} 
          currentUserId={user.id}
          spaceSlug={slug}
        />
      </div>

      {/* Add Member Section */}
      <div className="border-t border-[var(--text-meta)]/10 pt-8">
        <h3 className="text-lg font-semibold text-[var(--text-on-dark)] mb-4">Add Member</h3>
        <AddMemberForm spaceId={space.id} slug={slug} />
      </div>

      {/* Invite Links Section */}
      <div className="border-t border-[var(--text-meta)]/10 pt-8">
        <InviteLinkSection
          spaceId={space.id}
          slug={slug}
          existingInvites={space.invites}
        />
      </div>

      {/* Danger Zone */}
      <div className="border-t border-[var(--text-meta)]/10 pt-8">
        <h3 className="text-lg font-semibold text-[var(--highlight-red)] mb-4">Danger Zone</h3>
        <div className="bg-[var(--card-bg)] border border-[var(--highlight-red)]/30 rounded-lg p-6">
          <h4 className="text-sm font-medium text-[var(--highlight-red)]">Delete Space</h4>
          <p className="mt-1 text-sm text-[var(--text-on-card)] opacity-70">
            Once you delete a space, there is no going back. All members, messages, and data will be permanently deleted.
          </p>
          <button
            className="mt-4 inline-flex items-center px-4 py-2 border border-[var(--highlight-red)]/40 text-sm font-medium rounded-md text-[var(--highlight-red)] bg-[var(--card-bg)] hover:bg-[var(--card-hover)] transition-colors"
            disabled
          >
            Delete Space (Coming Soon)
          </button>
        </div>
      </div>
    </div>
  )
}
