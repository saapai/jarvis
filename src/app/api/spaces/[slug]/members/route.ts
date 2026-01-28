import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/auth/supabase-server'
import { getOrCreateUser, isSpaceAdmin } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/db'
import * as spaceContext from '@/lib/spaceContext'

interface RouteParams {
  params: Promise<{ slug: string }>
}

/**
 * GET /api/spaces/[slug]/members - Get space members
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params

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
      where: { slug },
      include: {
        members: {
          include: {
            user: true
          },
          orderBy: { joinedAt: 'asc' }
        }
      }
    })

    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }

    // Check if user is a member
    const membership = space.members.find(m => m.userId === user.id)
    if (!membership) {
      return NextResponse.json({ error: 'Not a member' }, { status: 403 })
    }

    const members = space.members.map(m => ({
      id: m.id,
      userId: m.userId,
      name: m.name || m.user.name,
      phoneNumber: m.user.phoneNumber,
      role: m.role,
      optedOut: m.optedOut,
      joinedAt: m.joinedAt
    }))

    return NextResponse.json({ members })

  } catch (error) {
    console.error('Error getting members:', error)
    return NextResponse.json({ error: 'Failed to get members' }, { status: 500 })
  }
}

/**
 * POST /api/spaces/[slug]/members - Add a member by phone number
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params

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
    const { phoneNumber, name } = body

    if (!phoneNumber) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }

    const normalizedPhone = normalizePhone(phoneNumber)
    if (normalizedPhone.length !== 10) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    }

    // Use addUserToSpace which handles welcome messages
    const result = await spaceContext.addUserToSpace(normalizedPhone, space.id, name || undefined)
    
    if (result.existing) {
      return NextResponse.json({ error: 'Already a member' }, { status: 400 })
    }

    const membership = result.membership
    const user = await prisma.user.findUnique({
      where: { id: membership.userId }
    })

    if (!user) {
      return NextResponse.json({ error: 'Failed to get user' }, { status: 500 })
    }

    return NextResponse.json({
      id: membership.id,
      userId: user.id,
      name: membership.name || user.name,
      phoneNumber: normalizedPhone,
      role: membership.role,
      joinedAt: membership.joinedAt
    })

  } catch (error) {
    console.error('Error adding member:', error)
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
  }
}
