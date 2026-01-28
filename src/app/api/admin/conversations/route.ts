import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/prisma'
import * as memberRepo from '@/lib/repositories/memberRepository'
import { normalizePhone } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const prisma = await getPrisma()
    
    // Get all users from Airtable (legacy)
    const airtableUsers = await memberRepo.getAllMembers()
    console.log(`[Admin] Found ${airtableUsers.length} users from Airtable`)
    
    // Get all users from Prisma (space members)
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
    
    // Combine users - prefer Prisma users if they exist (they're more up-to-date)
    const userMap = new Map<string, any>()
    
    // Add Airtable users first
    for (const user of airtableUsers) {
      const normalizedPhone = normalizePhone(user.phone || '')
      if (normalizedPhone && !userMap.has(normalizedPhone)) {
        userMap.set(normalizedPhone, {
          id: user.id,
          name: user.name || 'Unknown',
          phone: user.phone || '',
          normalizedPhone,
          optedOut: user.opted_out,
          source: 'airtable'
        })
      }
    }
    
    // Add/update with Prisma users (they take precedence)
    for (const user of prismaUsers) {
      const normalizedPhone = normalizePhone(user.phoneNumber)
      if (normalizedPhone) {
        // Get name from most recent space membership or user record
        const latestMembership = user.memberships
          .filter(m => !m.optedOut)
          .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())[0]
        const displayName = latestMembership?.name || user.name || 'Unknown'
        
        userMap.set(normalizedPhone, {
          id: user.id,
          name: displayName,
          phone: user.phoneNumber,
          normalizedPhone,
          optedOut: latestMembership?.optedOut || false,
          source: 'prisma',
          spaces: user.memberships.map(m => ({
            spaceId: m.spaceId,
            spaceName: m.space.name,
            role: m.role
          }))
        })
      }
    }
    
    const allUsers = Array.from(userMap.values())
    console.log(`[Admin] Combined ${allUsers.length} unique users`)
    
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
        createdAt: msg.createdAt.toISOString(),
        spaceId: msg.spaceId
      })
    }
    
    console.log(`[Admin] Grouped messages by phone:`, Object.keys(messagesByPhone))
    
    // Combine user data with their messages
    const conversations = allUsers.map(user => {
      const userMessages = messagesByPhone[user.normalizedPhone] || []
      
      console.log(`[Admin] User ${user.name} (${user.phone} -> ${user.normalizedPhone}): ${userMessages.length} messages`)
      
      return {
        id: user.id,
        name: user.name || 'Unknown',
        phone: user.phone || '',
        optedOut: user.optedOut,
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


