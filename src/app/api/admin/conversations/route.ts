import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/prisma'
import * as memberRepo from '@/lib/repositories/memberRepository'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const prisma = await getPrisma()
    
    // Get all users from Airtable
    const users = await memberRepo.getAllMembers()
    
    // Get all messages grouped by phone number
    const messages = await prisma.message.findMany({
      orderBy: { createdAt: 'desc' }
    })
    
    // Group messages by phone number
    const messagesByPhone: Record<string, any[]> = {}
    for (const msg of messages) {
      if (!messagesByPhone[msg.phoneNumber]) {
        messagesByPhone[msg.phoneNumber] = []
      }
      messagesByPhone[msg.phoneNumber].push({
        id: msg.id,
        direction: msg.direction,
        text: msg.text,
        meta: msg.meta ? JSON.parse(msg.meta) : null,
        createdAt: msg.createdAt.toISOString()
      })
    }
    
    // Combine user data with their messages
    const conversations = users.map(user => {
      const userMessages = messagesByPhone[user.phone || ''] || []
      
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
    
    return NextResponse.json({ conversations })
  } catch (error) {
    console.error('[Admin] Error fetching conversations:', error)
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
  }
}


