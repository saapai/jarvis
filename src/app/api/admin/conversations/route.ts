import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/prisma'
import * as memberRepo from '@/lib/repositories/memberRepository'
import { normalizePhone } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const prisma = await getPrisma()
    
    // Get all users from Airtable
    const users = await memberRepo.getAllMembers()
    
    console.log(`[Admin] Found ${users.length} users from Airtable`)
    
    // Get all messages grouped by phone number
    const messages = await prisma.message.findMany({
      orderBy: { createdAt: 'desc' }
    })
    
    console.log(`[Admin] Found ${messages.length} messages from database`)
    
    // Group messages by NORMALIZED phone number
    const messagesByPhone: Record<string, any[]> = {}
    for (const msg of messages) {
      const normalized = normalizePhone(msg.phoneNumber)
      if (!messagesByPhone[normalized]) {
        messagesByPhone[normalized] = []
      }
      messagesByPhone[normalized].push({
        id: msg.id,
        direction: msg.direction,
        text: msg.text,
        meta: msg.meta ? JSON.parse(msg.meta) : null,
        createdAt: msg.createdAt.toISOString()
      })
    }
    
    console.log(`[Admin] Grouped messages by phone:`, Object.keys(messagesByPhone))
    
    // Combine user data with their messages
    const conversations = users.map(user => {
      const normalizedUserPhone = normalizePhone(user.phone || '')
      const userMessages = messagesByPhone[normalizedUserPhone] || []
      
      console.log(`[Admin] User ${user.name} (${user.phone} -> ${normalizedUserPhone}): ${userMessages.length} messages`)
      
      return {
        id: user.id,
        name: user.name || 'Unknown',
        phone: user.phone || '',
        optedOut: user.opted_out,
        messageCount: userMessages.length,
        messages: userMessages.sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ),
        lastMessageAt: userMessages.length > 0 
          ? userMessages[userMessages.length - 1].createdAt 
          : null
      }
    })
    
    // Sort by most recent message
    conversations.sort((a, b) => {
      if (!a.lastMessageAt) return 1
      if (!b.lastMessageAt) return -1
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    })
    
    console.log(`[Admin] Returning ${conversations.length} conversations`)
    console.log(`[Admin] Conversations with messages: ${conversations.filter(c => c.messageCount > 0).length}`)
    
    return NextResponse.json({ conversations })
  } catch (error) {
    console.error('[Admin] Error fetching conversations:', error)
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
  }
}


