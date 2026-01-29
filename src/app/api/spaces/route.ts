import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/auth/supabase-server'
import { getOrCreateUser } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'
import { sendSms } from '@/lib/twilio'
import { normalizePhone, toE164 } from '@/lib/db'
import * as spaceContext from '@/lib/spaceContext'
import * as messageRepo from '@/lib/repositories/messageRepository'

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

    // Send admin onboarding SMS (non-blocking)
    try {
      await sendAdminOnboardingSMS(space, user.phoneNumber)
    } catch (error) {
      // Log error but don't fail space creation
      console.error('[Space Creation] Failed to send admin onboarding SMS:', error)
    }

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

/**
 * Send admin onboarding SMS when a space is created
 */
async function sendAdminOnboardingSMS(space: { id: string; name: string; joinCode: string }, ownerPhoneNumber: string): Promise<void> {
  const normalizedPhone = normalizePhone(ownerPhoneNumber)
  
  if (!normalizedPhone || normalizedPhone.length < 10) {
    console.warn(`[AdminOnboarding] Invalid phone number for space ${space.id}: ${ownerPhoneNumber}`)
    return
  }

  // Construct onboarding message
  const message = `hey! 👋 welcome to your new space: ${space.name}

your join code is: ${space.joinCode}

as admin, you can do everything via text:

📅 events: "move meeting to 7pm" or "ski retreat is jan 16-19"
📢 announcements: "announce meeting tonight at 7pm"
📊 polls: "poll are you coming to the game?"
📝 knowledge: text me info to add to your space

file uploads: use the website at tryenclave.com

text HELP anytime to see all commands`

  // Send SMS
  const result = await sendSms(toE164(normalizedPhone), message)
  
  if (result.ok) {
    console.log(`[AdminOnboarding] ✅ Sent onboarding SMS to ${normalizedPhone} for space ${space.name} (${space.id})`)
  } else {
    console.error(`[AdminOnboarding] ❌ Failed to send SMS to ${normalizedPhone}:`, result.error)
  }

  // Log message regardless of send status (for admin visibility)
  await messageRepo.logMessage(normalizedPhone, 'outbound', message, {
    action: 'admin_onboarding',
    sent: result.ok,
    error: result.error || null,
    twilioSid: result.sid || null
  }, space.id)

  // Set active space for admin so future SMS interactions default to this space
  try {
    await spaceContext.setActiveSpaceId(normalizedPhone, space.id)
    console.log(`[AdminOnboarding] Set active space ${space.id} for admin ${normalizedPhone}`)
  } catch (error) {
    console.error(`[AdminOnboarding] Failed to set active space:`, error)
    // Non-critical error, continue
  }
}
