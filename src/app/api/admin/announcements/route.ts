import { NextRequest, NextResponse } from 'next/server'
import { getPrisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const prisma = await getPrisma()
    
    // Get all outbound messages that are announcements or polls
    // They can have action: 'announcement', 'poll', or 'draft_send' with draftContent
    const messages = await prisma.message.findMany({
      where: {
        direction: 'outbound',
        OR: [
          { meta: { contains: '"action":"announcement"' } },
          { meta: { contains: '"action":"poll"' } },
          { meta: { contains: '"action":"draft_send"' } }
        ]
      },
      orderBy: { createdAt: 'desc' }
    })
    
    const announcements: Array<{
      id: string;
      type: 'announcement' | 'poll';
      content: string;
      sentAt: string;
      sentBy: string;
      pollId: string | null;
    }> = []
    
    // Track seen content to avoid duplicates (same announcement sent to multiple people)
    const seenContent = new Set<string>()
    
    for (const msg of messages) {
      const meta = msg.meta ? JSON.parse(msg.meta) : null
      
      let type: 'announcement' | 'poll' = 'announcement'
      let content = msg.text
      
      // Determine type and extract content
      if (meta?.action === 'announcement') {
        type = 'announcement'
        content = meta.draftContent || msg.text.replace(/^📢 /, '')
      } else if (meta?.action === 'poll') {
        type = 'poll'
        content = meta.draftContent || msg.text.replace(/^📊 /, '').replace(/\n\nreply yes\/no\/maybe.*$/i, '')
      } else if (meta?.action === 'draft_send' && meta?.draftContent) {
        // Check if it's a poll or announcement based on content
        const draftContent = meta.draftContent
        if (draftContent.includes('?') || msg.text.includes('📊')) {
          type = 'poll'
          content = draftContent.replace(/\n\nreply yes\/no\/maybe.*$/i, '')
        } else {
          type = 'announcement'
          content = draftContent
        }
      } else {
        // Skip if not a recognized announcement/poll
        continue
      }
      
      // Use content as key to deduplicate (same announcement sent to multiple people)
      const contentKey = `${type}:${content}`
      if (seenContent.has(contentKey)) {
        continue
      }
      seenContent.add(contentKey)
      
      announcements.push({
        id: msg.id,
        type,
        content: content.trim(),
        sentAt: msg.createdAt.toISOString(),
        sentBy: msg.phoneNumber,
        pollId: meta?.pollId || null
      })
    }
    
    return NextResponse.json({ announcements })
  } catch (error) {
    console.error('[Admin] Error fetching announcements:', error)
    return NextResponse.json({ error: 'Failed to fetch announcements' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const messageId = searchParams.get('id')
    
    if (!messageId) {
      return NextResponse.json({ error: 'Message ID required' }, { status: 400 })
    }
    
    const prisma = await getPrisma()
    
    // First get the message to find its content
    const message = await prisma.message.findUnique({
      where: { id: messageId }
    })
    
    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }
    
    // Extract the content from the message
    const meta = message.meta ? JSON.parse(message.meta) : null
    let contentToMatch = message.text
    
    if (meta?.draftContent) {
      contentToMatch = meta.draftContent
    } else if (meta?.action === 'announcement') {
      contentToMatch = message.text.replace(/^📢 /, '')
    } else if (meta?.action === 'poll') {
      contentToMatch = message.text.replace(/^📊 /, '').replace(/\n\nreply yes\/no\/maybe.*$/i, '')
    }
    
    // Delete all messages with matching content (announcements are sent to multiple people)
    const result = await prisma.message.deleteMany({
      where: {
        direction: 'outbound',
        OR: [
          { text: { contains: contentToMatch } },
          { meta: { contains: `"draftContent":"${contentToMatch.replace(/"/g, '\\"')}"` } }
        ]
      }
    })
    
    console.log(`[Admin] Deleted ${result.count} messages for announcement`)
    
    return NextResponse.json({ success: true, deletedCount: result.count })
  } catch (error) {
    console.error('[Admin] Error deleting announcement:', error)
    return NextResponse.json({ error: 'Failed to delete announcement' }, { status: 500 })
  }
}
