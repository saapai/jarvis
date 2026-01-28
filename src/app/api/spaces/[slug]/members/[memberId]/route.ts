import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/auth/supabase-server'
import { getOrCreateUser, isSpaceAdmin } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{ slug: string; memberId: string }>
}

/**
 * PATCH /api/spaces/[slug]/members/[memberId] - Update member role
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug, memberId } = await params

    const supabase = await createClient()
    const { data: { user: supabaseUser }, error: authError } = await supabase.auth.getUser()

    if (authError || !supabaseUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const currentUser = await getOrCreateUser(supabaseUser)
    if (!currentUser) {
      return NextResponse.json({ error: 'Failed to get user' }, { status: 500 })
    }

    const prisma = await getPrisma()

    // Get space
    const space = await prisma.space.findUnique({
      where: { slug }
    })

    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }

    // Check admin permission
    const isAdmin = await isSpaceAdmin(currentUser.id, space.id)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { role } = body

    if (!role || !['owner', 'admin', 'member'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // Get the membership
    const membership = await prisma.spaceMember.findUnique({
      where: { id: memberId },
      include: { user: true }
    })

    if (!membership || membership.spaceId !== space.id) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Don't allow changing owner role
    if (membership.role === 'owner') {
      return NextResponse.json({ error: 'Cannot change owner role' }, { status: 400 })
    }

    // Don't allow non-owners to create owners
    const currentUserMembership = await prisma.spaceMember.findUnique({
      where: {
        spaceId_userId: {
          spaceId: space.id,
          userId: currentUser.id
        }
      }
    })

    if (role === 'owner' && currentUserMembership?.role !== 'owner') {
      return NextResponse.json({ error: 'Only owners can assign owner role' }, { status: 403 })
    }

    // Update the role
    const updated = await prisma.spaceMember.update({
      where: { id: memberId },
      data: { role }
    })

    return NextResponse.json({
      id: updated.id,
      userId: updated.userId,
      role: updated.role
    })

  } catch (error) {
    console.error('Error updating member role:', error)
    return NextResponse.json({ error: 'Failed to update member role' }, { status: 500 })
  }
}
