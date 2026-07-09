/**
 * Vercel Cron Handler for Scheduled Announcements
 * Sends scheduled announcements that are due
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPrisma } from '@/lib/prisma'
import { sendSms } from '@/lib/twilio'
import * as memberRepo from '@/lib/repositories/memberRepository'
import * as messageRepo from '@/lib/repositories/messageRepository'
import * as spaceContext from '@/lib/spaceContext'
import { normalizePhone, toE164 } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Send scheduled announcements that are due
 */
async function sendScheduledAnnouncements(): Promise<{ sent: number; failed: number; scheduled: any[] }> {
  const prisma = await getPrisma()
  const now = new Date()
  
  // Find all scheduled announcements that are due (scheduledFor <= now) and not yet sent
  const scheduled = await prisma.scheduledAnnouncement.findMany({
    where: {
      scheduledFor: { lte: now },
      sent: false,
    },
    orderBy: {
      scheduledFor: 'asc',
    },
  })
  
  console.log(`[ScheduledAnnouncements] Found ${scheduled.length} scheduled announcements to send`)
  
  let sent = 0
  let failed = 0
  
  for (const announcement of scheduled) {
    try {
      // Get recipients: space members if space-scoped, otherwise legacy Airtable members
      let users: { phone: string }[] = []
      const spaceId = announcement.spaceId

      if (spaceId) {
        const members = await spaceContext.getSpaceMembers(spaceId)
        users = members.map(m => ({ phone: m.phoneNumber }))
      } else {
        // Try to find the default/only space first (most orgs have one space)
        const prisma = await getPrisma()
        const defaultSpace = await prisma.space.findFirst()
        if (defaultSpace) {
          const members = await spaceContext.getSpaceMembers(defaultSpace.id)
          users = members.map(m => ({ phone: m.phoneNumber }))
        }
        // Fallback to legacy Airtable if no space found
        if (users.length === 0) {
          const legacyUsers = await memberRepo.getOptedInMembers()
          users = legacyUsers.map(u => ({ phone: u.phone || '' }))
        }
      }

      console.log(`[ScheduledAnnouncements] Sending scheduled announcement "${announcement.content.substring(0, 50)}..." to ${users.length} users${spaceId ? ` (space: ${spaceId})` : ''}`)

      // Extract media URLs if present
      const mediaUrls = Array.isArray(announcement.mediaUrls) ? announcement.mediaUrls as string[] : undefined

      let successCount = 0

      for (const user of users) {
        const userPhone = user.phone ? normalizePhone(user.phone) : ''
        if (userPhone.length < 10) continue

        const result = await sendSms(toE164(userPhone), announcement.content, mediaUrls)
        if (result.ok) {
          // Log message for this recipient with space context
          await messageRepo.logMessage(userPhone, 'outbound', announcement.content, {
            action: 'scheduled_announcement',
          }, spaceId)
          successCount++
        } else {
          console.error(`[ScheduledAnnouncements] Failed to send to ${userPhone}:`, result.error)
        }
      }
      
      // Mark as sent if at least some messages succeeded
      if (successCount > 0) {
        await prisma.scheduledAnnouncement.update({
          where: { id: announcement.id },
          data: {
            sent: true,
            sentAt: new Date(),
          },
        })
        sent++
      } else {
        failed++
      }
    } catch (error) {
      console.error(`[ScheduledAnnouncements] Error sending announcement ${announcement.id}:`, error)
      failed++
    }
  }
  
  return { sent, failed, scheduled }
}

/**
 * Main cron handler
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (Vercel sets this header)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.error('[Cron] Unauthorized request')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    console.log('[Cron] Running scheduled announcements...')
    
    const results = await sendScheduledAnnouncements()
    
    console.log('[Cron] Scheduled announcements complete:', results)
    
    return NextResponse.json({
      success: true,
      results: {
        sent: results.sent,
        failed: results.failed,
        scheduledCount: results.scheduled.length,
        scheduled: results.scheduled.map(s => ({
          id: s.id,
          content: s.content.substring(0, 100),
          scheduledFor: s.scheduledFor,
          sourceMessageTs: s.sourceMessageTs,
        })),
      },
    })
  } catch (error) {
    console.error('[Cron] Scheduled announcements error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

