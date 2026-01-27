import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/auth/supabase-server'
import { getOrCreateUser, isSpaceAdmin } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{ slug: string; inviteId: string }>
}

/**
 * DELETE /api/spaces/[slug]/invites/[inviteId] - Delete an invite
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug, inviteId } = await params

    const supabase = await createClient()
    const { data: { user: supabaseUser }, error: authError } = await supabase.auth.getUser()

    if (authError || !supabaseUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getOrCreateUser(supabaseUser)
    if (!user) {
      return NextResponse.json({ error: 'Failed to get user' }, { status: 500 })
    }

    const prisma = await getPrisma()

    const space = await prisma.space.findUnique({
      where: { slug }
    })

    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }

    // Check admin permission
    const isAdmin = await isSpaceAdmin(user.id, space.id)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get the invite and verify it belongs to this space
    const invite = await prisma.spaceInvite.findUnique({
      where: { id: inviteId }
    })

    if (!invite || invite.spaceId !== space.id) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    // Delete the invite
    await prisma.spaceInvite.delete({
      where: { id: inviteId }
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error deleting invite:', error)
    return NextResponse.json({ error: 'Failed to delete invite' }, { status: 500 })
  }
}
