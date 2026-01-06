/**
 * Vercel Cron Handler for Event Nudges
 * Sends morning (9am) and 2-hour-before reminders for events
 */

import { NextRequest, NextResponse } from 'next/server'
import * as eventRepo from '@/lib/repositories/eventRepository'
import * as memberRepo from '@/lib/repositories/memberRepository'
import { sendSms, toE164 } from '@/lib/twilio'
import { normalizePhone } from '@/lib/db'

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
 * Send morning reminders (9am same day)
 */
async function sendMorningReminders(): Promise<{ sent: number; failed: number }> {
  const events = await eventRepo.getEventsNeedingMorningReminder()
  
  console.log(`[MorningReminders] Found ${events.length} events needing morning reminders`)
  
  let sent = 0
  let failed = 0
  
  for (const event of events) {
    try {
      const message = await generateReminderMessage(event, 'morning')
      const users = await memberRepo.getOptedInMembers()
      
      console.log(`[MorningReminders] Sending reminder for "${event.title}" to ${users.length} users`)
      
      for (const user of users) {
        const userPhone = user.phone ? normalizePhone(user.phone) : ''
        if (userPhone.length < 10) continue
        
        const result = await sendSms(toE164(userPhone), message)
        if (result.ok) {
          sent++
        } else {
          failed++
          console.error(`[MorningReminders] Failed to send to ${userPhone}:`, result.error)
        }
      }
      
      await eventRepo.markMorningReminderSent(event.id)
    } catch (error) {
      console.error(`[MorningReminders] Error processing event ${event.id}:`, error)
      failed++
    }
  }
  
  return { sent, failed }
}

/**
 * Send 2-hour-before reminders
 */
async function send2HourReminders(): Promise<{ sent: number; failed: number }> {
  const events = await eventRepo.getEventsNeeding2HourReminder()
  
  console.log(`[2HourReminders] Found ${events.length} events needing 2-hour reminders`)
  
  let sent = 0
  let failed = 0
  
  for (const event of events) {
    try {
      const message = await generateReminderMessage(event, 'twohour')
      const users = await memberRepo.getOptedInMembers()
      
      console.log(`[2HourReminders] Sending reminder for "${event.title}" to ${users.length} users`)
      
      for (const user of users) {
        const userPhone = user.phone ? normalizePhone(user.phone) : ''
        if (userPhone.length < 10) continue
        
        const result = await sendSms(toE164(userPhone), message)
        if (result.ok) {
          sent++
        } else {
          failed++
          console.error(`[2HourReminders] Failed to send to ${userPhone}:`, result.error)
        }
      }
      
      await eventRepo.mark2HourReminderSent(event.id)
    } catch (error) {
      console.error(`[2HourReminders] Error processing event ${event.id}:`, error)
      failed++
    }
  }
  
  return { sent, failed }
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
    const [morningResults, twoHourResults] = await Promise.all([
      sendMorningReminders(),
      send2HourReminders()
    ])
    
    const results = {
      morning: morningResults,
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

