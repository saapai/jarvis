import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const prisma = await getPrisma()

    // ============================================
    // 1) Load users from Prisma only (no Airtable)
    // ============================================
    const prismaUsers = await prisma.user.findMany({
      include: {
        memberships: {
          include: {
            space: true
          }
        }
      }
    })

    console.log(`[Admin] Found ${prismaUsers.length} users from Prisma`)

    // Build a map of normalized phone -> user info
    const userMap = new Map<string, {
      id: string
      name: string
      phone: string
      normalizedPhone: string
      optedOut: boolean
      spaces: { spaceId: string; spaceName: string; role: string }[]
    }>()

    for (const user of prismaUsers) {
      const normalizedPhone = normalizePhone(user.phoneNumber)
      if (!normalizedPhone) continue

      const activeMemberships = user.memberships.filter(m => !m.optedOut)
      const latestMembership = activeMemberships
        .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())[0]

      const displayName = latestMembership?.name || user.name || 'Unknown'

      userMap.set(normalizedPhone, {
        id: user.id,
        name: displayName,
        phone: user.phoneNumber,
        normalizedPhone,
        optedOut: activeMemberships.some(m => m.optedOut),
        spaces: user.memberships.map(m => ({
          spaceId: m.spaceId,
          spaceName: m.space.name,
          role: m.role
        }))
      })
    }

    const allUsers = Array.from(userMap.values())
    console.log(`[Admin] Prisma user map contains ${allUsers.length} unique users`)

    // ============================================
    // 2) Load all messages and group by phone
    // ============================================
    const messages = await prisma.message.findMany({
      orderBy: { createdAt: 'desc' }
    })

    console.log(`[Admin] Found ${messages.length} messages from database`)

    const messagesByPhone: Record<string, any[]> = {}
    for (const msg of messages) {
      const normalized = normalizePhone(msg.phoneNumber)
      if (!normalized) continue

      if (!messagesByPhone[normalized]) {
        messagesByPhone[normalized] = []
      }

      messagesByPhone[normalized].push({
        id: msg.id,
        direction: msg.direction,
        text: msg.text,
        meta: msg.meta ? JSON.parse(msg.meta) : null,
        createdAt: msg.createdAt.toISOString(),
        spaceId: msg.spaceId
      })
    }

    console.log(`[Admin] Grouped messages by phone:`, Object.keys(messagesByPhone))

    // ============================================
    // 3) Build conversations for users that exist in Prisma
    // ============================================
    const conversations = allUsers
      .map(user => {
        const userMessages = messagesByPhone[user.normalizedPhone] || []

        console.log(
          `[Admin] User ${user.name} (${user.phone} -> ${user.normalizedPhone}): ${userMessages.length} messages`
        )

        return {
          id: user.id,
          name: user.name,
          phone: user.phone,
          optedOut: user.optedOut,
          spaces: user.spaces,
          messageCount: userMessages.length,
          messages: userMessages.sort(
            (a, b) =>
              new Date(a.createdAt).getTime() -
              new Date(b.createdAt).getTime()
          ),
          lastMessageAt:
            userMessages.length > 0
              ? userMessages[userMessages.length - 1].createdAt
              : null
        }
      })
      .filter(conv => conv.messageCount > 0)

    // Sort by most recent message
    conversations.sort((a, b) => {
      if (!a.lastMessageAt) return 1
      if (!b.lastMessageAt) return -1
      return (
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime()
      )
    })

    console.log(
      `[Admin] Returning ${conversations.length} conversations (Prisma only)`
    )

    return NextResponse.json({ conversations })
  } catch (error) {
    console.error('[Admin] Error fetching conversations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch conversations' },
      { status: 500 }
    )
  }
}


