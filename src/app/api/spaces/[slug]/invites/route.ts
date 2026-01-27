import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/auth/supabase-server'
import { getOrCreateUser, isSpaceAdmin } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{ slug: string }>
}

// Generate a random invite code
function generateInviteCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

/**
 * GET /api/spaces/[slug]/invites - Get space invites
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

    const invites = await prisma.spaceInvite.findMany({
      where: {
        spaceId: space.id,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ invites })

  } catch (error) {
    console.error('Error getting invites:', error)
    return NextResponse.json({ error: 'Failed to get invites' }, { status: 500 })
  }
}

/**
 * POST /api/spaces/[slug]/invites - Create an invite link
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

    // Parse optional body parameters
    let expiresAt = null
    let maxUses = null

    try {
      const body = await request.json()
      if (body.expiresInDays) {
        expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + body.expiresInDays)
      }
      if (body.maxUses) {
        maxUses = body.maxUses
      }
    } catch {
      // No body provided, use defaults
    }

    // Generate unique code
    let code = generateInviteCode()
    let attempts = 0
    while (attempts < 10) {
      const existing = await prisma.spaceInvite.findUnique({
        where: { code }
      })
      if (!existing) break
      code = generateInviteCode()
      attempts++
    }

    const invite = await prisma.spaceInvite.create({
      data: {
        spaceId: space.id,
        code,
        expiresAt,
        maxUses
      }
    })

    return NextResponse.json({
      id: invite.id,
      code: invite.code,
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses,
      uses: invite.uses,
      createdAt: invite.createdAt
    })

  } catch (error) {
    console.error('Error creating invite:', error)
    return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 })
  }
}
