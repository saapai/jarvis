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
}

export interface Message {
  id: string
  phoneNumber: string
  direction: 'inbound' | 'outbound'
  text: string
  meta: MessageMeta | null
  createdAt: Date
}

/**
 * Log an inbound or outbound message
 */
export async function logMessage(
  phoneNumber: string,
  direction: 'inbound' | 'outbound',
  text: string,
  meta: MessageMeta | null
): Promise<Message> {
  const prisma = await getPrisma()
  
  const message = await prisma.message.create({
    data: {
      phoneNumber,
      direction,
      text,
      meta: meta ? JSON.stringify(meta) : null
    }
  })
  
  return {
    ...message,
    direction: message.direction as 'inbound' | 'outbound',
    meta: message.meta ? JSON.parse(message.meta) : null
  }
}

/**
 * Get recent messages for a phone number
 */
export async function getRecentMessages(
  phoneNumber: string,
  limit: number = 10
): Promise<Message[]> {
  const prisma = await getPrisma()
  
  const messages = await prisma.message.findMany({
    where: { phoneNumber },
    orderBy: { createdAt: 'desc' },
    take: limit
  })
  
  // Return in chronological order (oldest first)
  return messages.reverse().map(m => ({
    ...m,
    direction: m.direction as 'inbound' | 'outbound',
    meta: m.meta ? JSON.parse(m.meta) : null
  }))
}

/**
 * Get all messages for a phone number
 */
export async function getAllMessages(phoneNumber: string): Promise<Message[]> {
  const prisma = await getPrisma()
  
  const messages = await prisma.message.findMany({
    where: { phoneNumber },
    orderBy: { createdAt: 'asc' }
  })
  
  return messages.map(m => ({
    ...m,
    direction: m.direction as 'inbound' | 'outbound',
    meta: m.meta ? JSON.parse(m.meta) : null
  }))
}

/**
 * Delete old messages (cleanup)
 */
export async function deleteOldMessages(daysOld: number = 30): Promise<number> {
  const prisma = await getPrisma()
  
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)
  
  const result = await prisma.message.deleteMany({
    where: {
      createdAt: {
        lt: cutoffDate
      }
    }
  })
  
  return result.count
}
