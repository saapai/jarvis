import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/auth/supabase-server'
import { getOrCreateUser, isSpaceAdmin } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{ slug: string; factId: string }>
}

/**
 * PATCH /api/spaces/[slug]/facts/[factId] - Update a fact
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug, factId } = await params

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

    // Get space
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

    // Get the fact
    const fact = await prisma.fact.findUnique({
      where: { id: factId }
    })

    if (!fact || fact.spaceId !== space.id) {
      return NextResponse.json({ error: 'Fact not found' }, { status: 404 })
    }

    const body = await request.json()
    const { subcategory, content } = body

    // Build update data
    const updateData: {
      subcategory?: string | null
      content?: string
    } = {}

    if (subcategory !== undefined) {
      updateData.subcategory = subcategory || null
    }

    if (content !== undefined) {
      updateData.content = content
    }

    // Update the fact
    const updated = await prisma.fact.update({
      where: { id: factId },
      data: updateData
    })

    return NextResponse.json({
      id: updated.id,
      subcategory: updated.subcategory,
      content: updated.content
    })

  } catch (error) {
    console.error('Error updating fact:', error)
    return NextResponse.json({ error: 'Failed to update fact' }, { status: 500 })
  }
}

/**
 * DELETE /api/spaces/[slug]/facts/[factId] - Delete a fact
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug, factId } = await params

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

    // Get space
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

    // Get the fact
    const fact = await prisma.fact.findUnique({
      where: { id: factId }
    })

    if (!fact || fact.spaceId !== space.id) {
      return NextResponse.json({ error: 'Fact not found' }, { status: 404 })
    }

    // Delete the fact
    await prisma.fact.delete({
      where: { id: factId }
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error deleting fact:', error)
    return NextResponse.json({ error: 'Failed to delete fact' }, { status: 500 })
  }
}
