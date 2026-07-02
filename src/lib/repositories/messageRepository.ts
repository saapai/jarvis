/**
 * Message Repository
 * Handles logging and querying SMS message history
 */

import { getPrisma } from '@/lib/prisma'

export interface MessageMeta {
  draftId?: string
  pollId?: string
  action?: string
  confidence?: number
  tags?: string[]
  draftContent?: string
  senderPhone?: string
  eventId?: string
  eventTitle?: string
  nudgeType?: 'morning' | 'dayof' | 'twohour'
  welcome?: boolean
  sent?: boolean
  error?: string | null
  twilioSid?: string | null
  pendingConfirmation?: {
    eventId: string
    updates: Record<string, unknown>
    description: string
  }
}

export interface Message {
  id: string
  phoneNumber: string
  direction: 'inbound' | 'outbound'
  text: string
  meta: MessageMeta | null
  createdAt: Date
  spaceId?: string | null
}

/**
 * Log an inbound or outbound message
 * @param spaceId - Optional space ID for multi-tenant support
 */
export async function logMessage(
  phoneNumber: string,
  direction: 'inbound' | 'outbound',
  text: string,
  meta: MessageMeta | null,
  spaceId?: string | null
): Promise<Message> {
  const prisma = await getPrisma()

  const message = await prisma.message.create({
    data: {
      phoneNumber,
      direction,
      text,
      meta: meta ? JSON.stringify(meta) : null,
      spaceId: spaceId || null
    }
  })

  return {
    ...message,
    direction: message.direction as 'inbound' | 'outbound',
    meta: message.meta ? JSON.parse(message.meta) : null
  }
}

/**
 * Get recent messages for a phone number (chronological)
 * @param spaceId - Optional space ID to filter messages
 */
export async function getRecentMessages(
  phoneNumber: string,
  limit: number = 10,
  spaceId?: string | null
): Promise<Message[]> {
  const prisma = await getPrisma()

  const where: { phoneNumber: string; spaceId?: string | null } = { phoneNumber }
  if (spaceId !== undefined) {
    where.spaceId = spaceId
  }

  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit
  })

  return messages.reverse().map((m) => ({
    ...m,
    direction: m.direction as 'inbound' | 'outbound',
    meta: m.meta ? JSON.parse(m.meta) : null
  }))
}

/**
 * Get all messages for a phone number (oldest first)
 * @param spaceId - Optional space ID to filter messages
 */
export async function getAllMessages(phoneNumber: string, spaceId?: string | null): Promise<Message[]> {
  const prisma = await getPrisma()

  const where: { phoneNumber: string; spaceId?: string | null } = { phoneNumber }
  if (spaceId !== undefined) {
    where.spaceId = spaceId
  }

  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'asc' }
  })

  return messages.map((m) => ({
    ...m,
    direction: m.direction as 'inbound' | 'outbound',
    meta: m.meta ? JSON.parse(m.meta) : null
  }))
}

/**
 * Delete messages older than N days
 */
export async function deleteOldMessages(daysOld: number = 30): Promise<number> {
  const prisma = await getPrisma()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)

  const result = await prisma.message.deleteMany({
    where: { createdAt: { lt: cutoffDate } }
  })

  return result.count
}

/**
 * Get recent announcements and polls that were sent.
 * Searches for all announcement action types: draft_send, announcement, scheduled_announcement, poll.
 * @param spaceId - Optional space ID to filter actions
 */
export async function getPastActions(limit: number = 20, spaceId?: string | null): Promise<Array<{
  type: 'announcement' | 'poll'
  content: string
  sentAt: Date
  sentBy: string
}>> {
  const prisma = await getPrisma()

  // Search for all announcement-related action types
  const baseWhere: { direction: string; spaceId?: string | null } = {
    direction: 'outbound',
  }
  if (spaceId !== undefined) {
    baseWhere.spaceId = spaceId
  }

  const messages = await prisma.message.findMany({
    where: {
      ...baseWhere,
      OR: [
        { meta: { contains: 'draft_send' } },
        { meta: { contains: '"announcement"' } },
        { meta: { contains: 'scheduled_announcement' } },
        { meta: { contains: '"poll"' } },
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  })

  const actions: Array<{
    type: 'announcement' | 'poll'
    content: string
    sentAt: Date
    sentBy: string
  }> = []

  // Deduplicate by content + approximate time (same announcement sent to multiple users)
  const seen = new Set<string>()

  for (const message of messages) {
    const meta = message.meta ? JSON.parse(message.meta) : null
    if (!meta?.action) continue

    let content: string | null = null
    let isPoll = false

    if (meta.action === 'draft_send' && meta.draftContent) {
      content = meta.draftContent
      isPoll = meta.draftContent.includes('?') || message.text.includes('📊')
    } else if (meta.action === 'announcement' || meta.action === 'scheduled_announcement') {
      content = message.text
      isPoll = false
    } else if (meta.action === 'poll') {
      content = message.text
      isPoll = true
    }

    if (!content) continue

    // Deduplicate: same content within 5 minutes is the same broadcast
    const dedupeKey = `${content.substring(0, 80)}_${Math.floor(message.createdAt.getTime() / 300000)}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    actions.push({
      type: isPoll ? 'poll' : 'announcement',
      content,
      sentAt: message.createdAt,
      sentBy: meta.senderPhone || message.phoneNumber
    })
  }

  return actions
}
