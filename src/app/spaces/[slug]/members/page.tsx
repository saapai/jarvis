import { requireAuth } from '@/lib/auth/supabase-server'
import { getOrCreateUser, isSpaceAdmin } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'
import { AddMemberForm } from '@/components/AddMemberForm'
import { InviteLinkSection } from '@/components/InviteLinkSection'

interface MembersPageProps {
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
          { role: 'asc' }, // owners first, then admins, then members
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

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date)
}

function formatPhone(phone: string) {
  if (phone.length === 10) {
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`
  }
  return phone
}

export default async function MembersPage({ params }: MembersPageProps) {
  const { slug } = await params
  const supabaseUser = await requireAuth()
  const user = await getOrCreateUser(supabaseUser)

  if (!user) {
    return <div>Not authenticated</div>
  }

  const space = await getSpaceWithMembers(slug)

  if (!space) {
    return <div>Space not found</div>
  }

  const isAdmin = await isSpaceAdmin(user.id, space.id)

  const roleOrder = { owner: 0, admin: 1, member: 2 }
  const sortedMembers = [...space.members].sort((a, b) =>
    (roleOrder[a.role as keyof typeof roleOrder] || 2) - (roleOrder[b.role as keyof typeof roleOrder] || 2)
  )

  return (
    <div className="space-y-8">
      {/* Members List */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Members</h2>
            <p className="text-sm text-gray-500">
              {space.members.length} {space.members.length === 1 ? 'member' : 'members'}
            </p>
          </div>
        </div>

        <div className="bg-white shadow overflow-hidden rounded-lg">
          <ul className="divide-y divide-gray-200">
            {sortedMembers.map((member) => (
              <li key={member.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mr-4">
                      <span className="text-gray-600 font-medium">
                        {(member.name || member.user.name || member.user.phoneNumber).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {member.name || member.user.name || 'Unknown'}
                        {member.userId === user.id && (
                          <span className="ml-2 text-xs text-gray-500">(you)</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatPhone(member.user.phoneNumber)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      member.role === 'owner'
                        ? 'bg-purple-100 text-purple-800'
                        : member.role === 'admin'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                    </span>
                    {member.optedOut && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        Opted out
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      Joined {formatDate(member.joinedAt)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Admin Section: Add Member & Invite Links */}
      {isAdmin && (
        <>
          <div className="border-t border-gray-200 pt-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Member</h3>
            <AddMemberForm spaceId={space.id} slug={slug} />
          </div>

          <div className="border-t border-gray-200 pt-8">
            <InviteLinkSection
              spaceId={space.id}
              slug={slug}
              existingInvites={space.invites}
            />
          </div>
        </>
      )}
    </div>
  )
}
