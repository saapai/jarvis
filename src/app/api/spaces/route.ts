import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/auth/supabase-server'
import { getOrCreateUser } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'

/**
 * POST /api/spaces - Create a new space
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient()
    const { data: { user: supabaseUser }, error: authError } = await supabase.auth.getUser()

    if (authError || !supabaseUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get or create user in our database
    const user = await getOrCreateUser(supabaseUser)
    if (!user) {
      return NextResponse.json({ error: 'Failed to get user' }, { status: 500 })
    }

    // Parse request body
    const body = await request.json()
    const { name, joinCode } = body

    if (!name || !joinCode) {
      return NextResponse.json({ error: 'Name and join code are required' }, { status: 400 })
    }

    // Validate join code format
    const cleanJoinCode = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (cleanJoinCode.length < 2 || cleanJoinCode.length > 8) {
      return NextResponse.json({ error: 'Join code must be 2-8 characters' }, { status: 400 })
    }

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    const prisma = await getPrisma()

    // Check if slug or join code already exists
    const existing = await prisma.space.findFirst({
      where: {
        OR: [
          { slug },
          { joinCode: cleanJoinCode }
        ]
      }
    })

    if (existing) {
      if (existing.slug === slug) {
        return NextResponse.json({ error: 'A space with this name already exists' }, { status: 400 })
      }
      if (existing.joinCode === cleanJoinCode) {
        return NextResponse.json({ error: 'This join code is already taken' }, { status: 400 })
      }
    }

    // Create space and add owner as member in a transaction
    const space = await prisma.$transaction(async (tx) => {
      // Create the space
      const newSpace = await tx.space.create({
        data: {
          name,
          slug,
          joinCode: cleanJoinCode,
          ownerId: user.id
        }
      })

      // Add owner as member with owner role
      await tx.spaceMember.create({
        data: {
          spaceId: newSpace.id,
          userId: user.id,
          role: 'owner',
          name: user.name
        }
      })

      return newSpace
    })

    return NextResponse.json({
      id: space.id,
      name: space.name,
      slug: space.slug,
      joinCode: space.joinCode
    })

  } catch (error) {
    console.error('Error creating space:', error)
    return NextResponse.json({ error: 'Failed to create space' }, { status: 500 })
  }
}

/**
 * GET /api/spaces - Get user's spaces
 */
export async function GET(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient()
    const { data: { user: supabaseUser }, error: authError } = await supabase.auth.getUser()

    if (authError || !supabaseUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get or create user in our database
    const user = await getOrCreateUser(supabaseUser)
    if (!user) {
      return NextResponse.json({ error: 'Failed to get user' }, { status: 500 })
    }

    const prisma = await getPrisma()

    // Get user's spaces
    const memberships = await prisma.spaceMember.findMany({
      where: {
        userId: user.id,
        optedOut: false
      },
      include: {
        space: {
          include: {
            _count: {
              select: { members: true }
            }
          }
        }
      }
    })

    const spaces = memberships.map(m => ({
      id: m.space.id,
      name: m.space.name,
      slug: m.space.slug,
      joinCode: m.space.joinCode,
      role: m.role,
      memberCount: m.space._count.members
    }))

    return NextResponse.json({ spaces })

  } catch (error) {
    console.error('Error getting spaces:', error)
    return NextResponse.json({ error: 'Failed to get spaces' }, { status: 500 })
  }
}
