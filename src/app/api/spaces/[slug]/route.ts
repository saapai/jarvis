import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/auth/supabase-server'
import { getOrCreateUser, isSpaceAdmin } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{ slug: string }>
}

/**
 * GET /api/spaces/[slug] - Get space details
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
          where: { userId: user.id },
          take: 1
        },
        _count: {
          select: { members: true }
        }
      }
    })

    if (!space || space.members.length === 0) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }

    return NextResponse.json({
      id: space.id,
      name: space.name,
      slug: space.slug,
      joinCode: space.joinCode,
      airtableBaseId: space.airtableBaseId,
      airtableTableName: space.airtableTableName,
      role: space.members[0].role,
      memberCount: space._count.members
    })

  } catch (error) {
    console.error('Error getting space:', error)
    return NextResponse.json({ error: 'Failed to get space' }, { status: 500 })
  }
}

/**
 * PATCH /api/spaces/[slug] - Update space settings
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

    // Get current space
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

    const body = await request.json()
    const { name, joinCode, airtableBaseId, airtableTableName } = body

    // Build update data
    const updateData: {
      name?: string
      slug?: string
      joinCode?: string
      airtableBaseId?: string | null
      airtableTableName?: string | null
    } = {}

    if (name && name !== space.name) {
      updateData.name = name
      updateData.slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    }

    if (joinCode && joinCode !== space.joinCode) {
      const cleanJoinCode = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (cleanJoinCode.length < 2 || cleanJoinCode.length > 8) {
        return NextResponse.json({ error: 'Join code must be 2-8 characters' }, { status: 400 })
      }

      // Check if join code is taken
      const existingCode = await prisma.space.findUnique({
        where: { joinCode: cleanJoinCode }
      })
      if (existingCode && existingCode.id !== space.id) {
        return NextResponse.json({ error: 'Join code already taken' }, { status: 400 })
      }

      updateData.joinCode = cleanJoinCode
    }

    // Allow null values for Airtable fields
    if (airtableBaseId !== undefined) {
      updateData.airtableBaseId = airtableBaseId || null
    }
    if (airtableTableName !== undefined) {
      updateData.airtableTableName = airtableTableName || null
    }

    // Check if new slug is taken
    if (updateData.slug && updateData.slug !== space.slug) {
      const existingSlug = await prisma.space.findUnique({
        where: { slug: updateData.slug }
      })
      if (existingSlug) {
        return NextResponse.json({ error: 'A space with this name already exists' }, { status: 400 })
      }
    }

    const updatedSpace = await prisma.space.update({
      where: { id: space.id },
      data: updateData
    })

    return NextResponse.json({
      id: updatedSpace.id,
      name: updatedSpace.name,
      slug: updatedSpace.slug,
      joinCode: updatedSpace.joinCode
    })

  } catch (error) {
    console.error('Error updating space:', error)
    return NextResponse.json({ error: 'Failed to update space' }, { status: 500 })
  }
}
