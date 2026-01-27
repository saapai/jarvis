import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUser } from '@/lib/auth/supabase-server'
import { getOrCreateUser } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'

interface InvitePageProps {
  params: Promise<{ code: string }>
}

async function getInvite(code: string) {
  const prisma = await getPrisma()

  const invite = await prisma.spaceInvite.findUnique({
    where: { code },
    include: {
      space: true
    }
  })

  if (!invite) return null

  // Check if expired
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return { expired: true, space: invite.space }
  }

  // Check if max uses reached
  if (invite.maxUses && invite.uses >= invite.maxUses) {
    return { maxUsesReached: true, space: invite.space }
  }

  return { invite, space: invite.space }
}

async function joinSpace(userId: string, spaceId: string, inviteId: string) {
  const prisma = await getPrisma()

  // Check if already a member
  const existing = await prisma.spaceMember.findUnique({
    where: {
      spaceId_userId: { spaceId, userId }
    }
  })

  if (existing) {
    return { alreadyMember: true }
  }

  // Create membership and increment invite uses in a transaction
  await prisma.$transaction([
    prisma.spaceMember.create({
      data: {
        spaceId,
        userId,
        role: 'member'
      }
    }),
    prisma.spaceInvite.update({
      where: { id: inviteId },
      data: { uses: { increment: 1 } }
    })
  ])

  return { success: true }
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { code } = await params

  const inviteData = await getInvite(code)

  if (!inviteData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900">Invalid Invite</h1>
          <p className="mt-2 text-gray-600">
            This invite link is not valid or has been deleted.
          </p>
          <Link
            href="/spaces"
            className="mt-4 inline-block text-blue-600 hover:text-blue-500"
          >
            Go to your spaces
          </Link>
        </div>
      </div>
    )
  }

  if ('expired' in inviteData && inviteData.expired) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900">Invite Expired</h1>
          <p className="mt-2 text-gray-600">
            This invite link has expired. Ask the space admin for a new invite.
          </p>
          <Link
            href="/spaces"
            className="mt-4 inline-block text-blue-600 hover:text-blue-500"
          >
            Go to your spaces
          </Link>
        </div>
      </div>
    )
  }

  if ('maxUsesReached' in inviteData && inviteData.maxUsesReached) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900">Invite Limit Reached</h1>
          <p className="mt-2 text-gray-600">
            This invite link has reached its maximum number of uses. Ask the space admin for a new invite.
          </p>
          <Link
            href="/spaces"
            className="mt-4 inline-block text-blue-600 hover:text-blue-500"
          >
            Go to your spaces
          </Link>
        </div>
      </div>
    )
  }

  const { invite, space } = inviteData as { invite: NonNullable<typeof inviteData>['invite']; space: NonNullable<typeof inviteData>['space'] }

  // Check if user is authenticated
  const supabaseUser = await getUser()

  if (!supabaseUser) {
    // Not authenticated - show invite info and prompt to sign in
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900">Join {space.name}</h1>
            <p className="mt-2 text-gray-600">
              You&apos;ve been invited to join <strong>{space.name}</strong> on Jarvis.
            </p>
            <p className="mt-4 text-sm text-gray-500">
              Sign in with your phone number to accept this invite.
            </p>
            <Link
              href={`/auth/login?redirect=/invite/${code}`}
              className="mt-6 inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
            >
              Sign in to join
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // User is authenticated - join the space
  const user = await getOrCreateUser(supabaseUser)

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900">Error</h1>
          <p className="mt-2 text-gray-600">
            Something went wrong. Please try again.
          </p>
        </div>
      </div>
    )
  }

  const result = await joinSpace(user.id, space.id, invite!.id)

  if ('alreadyMember' in result) {
    // Already a member - redirect to space
    redirect(`/spaces/${space.slug}`)
  }

  // Successfully joined - redirect to space
  redirect(`/spaces/${space.slug}`)
}
