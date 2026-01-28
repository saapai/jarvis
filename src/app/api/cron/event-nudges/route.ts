/**
 * Vercel Cron Handler for Event Nudges
 * Sends morning (9am) and 2-hour-before reminders for events
 */

import { NextRequest, NextResponse } from 'next/server'
import * as eventRepo from '@/lib/repositories/eventRepository'
import * as memberRepo from '@/lib/repositories/memberRepository'
import * as messageRepo from '@/lib/repositories/messageRepository'
import * as spaceContext from '@/lib/spaceContext'
import { sendSms } from '@/lib/twilio'
import { normalizePhone, toE164 } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Generate reminder message using LLM for context
 */
async function generateReminderMessage(
  event: eventRepo.Event,
  type: 'morning' | 'twohour'
): Promise<string> {
  const timeStr = event.eventDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  })
  
  const locationStr = event.location ? ` at ${event.location}` : ''
  
  if (type === 'morning') {
    return `🌅 reminder: ${event.title} is today at ${timeStr}${locationStr}`
  } else {
    return `⏰ happening in 2 hours: ${event.title} at ${timeStr}${locationStr}`
  }
}

/**
 * Send day-of reminders (sent throughout the day for events happening today)
 */
async function sendDayOfReminders(): Promise<{ sent: number; failed: number }> {
  // Get all events (both space-scoped and legacy)
  const allEvents = await eventRepo.getEventsNeedingMorningReminder()
  
  // Group events by spaceId
  const eventsBySpace = new Map<string | null, eventRepo.Event[]>()
  for (const event of allEvents) {
    const key = event.spaceId || null
    if (!eventsBySpace.has(key)) {
      eventsBySpace.set(key, [])
    }
    eventsBySpace.get(key)!.push(event)
  }
  
  let totalSent = 0
  let totalFailed = 0
  
  // Process each space group
  for (const [spaceId, events] of eventsBySpace.entries()) {
  
    console.log(`[DayOfReminders] Processing ${events.length} events${spaceId ? ` for space ${spaceId}` : ' (legacy)'}`)
    
    for (const event of events) {
      try {
        const message = await generateReminderMessage(event, 'morning')
        
        // Get users based on space or legacy mode
        let users: { phone: string; name?: string | null }[] = []
        
        if (spaceId) {
          // Space-scoped: get space members
          const members = await spaceContext.getSpaceMembers(spaceId)
          users = members.map(m => ({ phone: m.phoneNumber, name: m.name }))
        } else {
          // Legacy mode: get all opted-in members
          const legacyUsers = await memberRepo.getOptedInMembers()
          users = legacyUsers.map(u => ({ phone: u.phone || '', name: u.name }))
        }
        
        console.log(`[DayOfReminders] Sending reminder for "${event.title}" to ${users.length} users${spaceId ? ` (space: ${spaceId})` : ''}`)
        
        for (const user of users) {
          const userPhone = user.phone ? normalizePhone(user.phone) : ''
          if (userPhone.length < 10) continue
          
          const result = await sendSms(toE164(userPhone), message)
          if (result.ok) {
            // Log message for this recipient
            await messageRepo.logMessage(userPhone, 'outbound', message, {
              action: 'event_nudge',
              eventId: event.id,
              eventTitle: event.title,
              nudgeType: 'dayof'
            }, spaceId || undefined)
            totalSent++
          } else {
            totalFailed++
            console.error(`[DayOfReminders] Failed to send to ${userPhone}:`, result.error)
          }
        }
        
        await eventRepo.markMorningReminderSent(event.id)
      } catch (error) {
        console.error(`[DayOfReminders] Error processing event ${event.id}:`, error)
        totalFailed++
      }
    }
  }
  
  return { sent: totalSent, failed: totalFailed }
}

/**
 * Send 2-hour-before reminders (only if event has a time)
 */
async function send2HourReminders(): Promise<{ sent: number; failed: number }> {
  // Get all events (both space-scoped and legacy)
  const allEvents = await eventRepo.getEventsNeeding2HourReminder()
  
  // Group events by spaceId
  const eventsBySpace = new Map<string | null, eventRepo.Event[]>()
  for (const event of allEvents) {
    const key = event.spaceId || null
    if (!eventsBySpace.has(key)) {
      eventsBySpace.set(key, [])
    }
    eventsBySpace.get(key)!.push(event)
  }
  
  let totalSent = 0
  let totalFailed = 0
  
  // Process each space group
  for (const [spaceId, events] of eventsBySpace.entries()) {
    console.log(`[2HourReminders] Processing ${events.length} events${spaceId ? ` for space ${spaceId}` : ' (legacy)'}`)
    
    for (const event of events) {
      try {
        // Only send 2-hour reminders if event has a specific time (not just a date)
        const eventTime = event.eventDate
        const now = new Date()
        const hoursUntilEvent = (eventTime.getTime() - now.getTime()) / (1000 * 60 * 60)
        
        // Check if event has a time component (not just midnight)
        const hasTime = eventTime.getHours() !== 0 || eventTime.getMinutes() !== 0
        
        if (!hasTime) {
          console.log(`[2HourReminders] Skipping "${event.title}" - no specific time set`)
          continue
        }
        
        // Only send if we're within 2-2.5 hours before
        if (hoursUntilEvent < 2 || hoursUntilEvent > 2.5) {
          continue
        }
        
        const message = await generateReminderMessage(event, 'twohour')
        
        // Get users based on space or legacy mode
        let users: { phone: string; name?: string | null }[] = []
        
        if (spaceId) {
          // Space-scoped: get space members
          const members = await spaceContext.getSpaceMembers(spaceId)
          users = members.map(m => ({ phone: m.phoneNumber, name: m.name }))
        } else {
          // Legacy mode: get all opted-in members
          const legacyUsers = await memberRepo.getOptedInMembers()
          users = legacyUsers.map(u => ({ phone: u.phone || '', name: u.name }))
        }
        
        console.log(`[2HourReminders] Sending reminder for "${event.title}" to ${users.length} users${spaceId ? ` (space: ${spaceId})` : ''}`)
        
        for (const user of users) {
          const userPhone = user.phone ? normalizePhone(user.phone) : ''
          if (userPhone.length < 10) continue
          
          const result = await sendSms(toE164(userPhone), message)
          if (result.ok) {
            // Log message for this recipient
            await messageRepo.logMessage(userPhone, 'outbound', message, {
              action: 'event_nudge',
              eventId: event.id,
              eventTitle: event.title,
              nudgeType: 'twohour'
            }, spaceId || undefined)
            totalSent++
          } else {
            totalFailed++
            console.error(`[2HourReminders] Failed to send to ${userPhone}:`, result.error)
          }
        }
        
        await eventRepo.mark2HourReminderSent(event.id)
      } catch (error) {
        console.error(`[2HourReminders] Error processing event ${event.id}:`, error)
        totalFailed++
      }
    }
  }
  
  return { sent: totalSent, failed: totalFailed }
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
    
    console.log('[Cron] Running event nudges...')
    
    // Run both types of reminders
    const [dayOfResults, twoHourResults] = await Promise.all([
      sendDayOfReminders(),
      send2HourReminders()
    ])
    
    const results = {
      dayOf: dayOfResults,
      twoHour: twoHourResults,
      timestamp: new Date().toISOString()
    }
    
    console.log('[Cron] Event nudges complete:', results)
    
    return NextResponse.json({
      success: true,
      results
    })
  } catch (error) {
    console.error('[Cron] Event nudges error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

