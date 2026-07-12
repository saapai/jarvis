/**
 * Event Update Handler
 * Allows admins to update event details via SMS with LLM-powered context understanding
 */

import { ActionResult } from '../types'
import { TEXTER_MODEL } from '../models'
import * as eventRepo from '@/lib/repositories/eventRepository'
import * as memberRepo from '@/lib/repositories/memberRepository'
import { sendSms } from '@/lib/twilio'
import { normalizePhone, toE164 } from '@/lib/db'

export interface EventUpdateInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
  pendingConfirmation?: {
    eventId: string
    updates: Record<string, unknown>
    description: string
  }
  spaceId?: string | null
}

/**
 * Use LLM to identify which event is being referenced and what's changing
 */
async function identifyEventAndChanges(
  message: string,
  upcomingEvents: eventRepo.Event[]
): Promise<{
  eventId: string | null
  updates: {
    title?: string
    description?: string
    eventDate?: Date
    location?: string
    category?: string
  }
  confidence: number
  summary: string
}> {
  if (!process.env.OPENAI_API_KEY) {
    return { eventId: null, updates: {}, confidence: 0, summary: 'No API key' }
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const eventsContext = upcomingEvents.map((e, idx) => 
      `${idx + 1}. "${e.title}" on ${e.eventDate.toLocaleDateString()} at ${e.eventDate.toLocaleTimeString()}, location: ${e.location || 'TBD'}, id: ${e.id}`
    ).join('\n')

    const systemPrompt = `You are analyzing an admin's message to update an event.

Available upcoming events:
${eventsContext}

Identify:
1. Which event they're referring to (match by name, date, or context)
2. What fields are being updated (title, date/time, location, description)
3. The new values for those fields

Examples:
- "ski retreat is now jan 20-22" → event: ski retreat, update: eventDate
- "move chapter meeting to 7pm" → event: chapter meeting, update: eventDate (time only)
- "study hall is at library now" → event: study hall, update: location

Respond with JSON:
{
  "eventId": "event_id_from_list_or_null",
  "updates": {
    "title": "new title if changed",
    "eventDate": "ISO date string if changed",
    "location": "new location if changed",
    "description": "new description if changed"
  },
  "confidence": 0.0-1.0,
  "summary": "Human-readable summary of what's changing"
}`

    const response = await openai.chat.completions.create({
      model: TEXTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Admin message: "${message}"` }
      ],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      
      // Convert eventDate string to Date if present
      if (parsed.updates?.eventDate) {
        parsed.updates.eventDate = new Date(parsed.updates.eventDate)
      }
      
      return {
        eventId: parsed.eventId || null,
        updates: parsed.updates || {},
        confidence: parsed.confidence || 0,
        summary: parsed.summary || 'Update detected'
      }
    }
  } catch (error) {
    console.error('[EventUpdate] LLM analysis failed:', error)
  }

  return { eventId: null, updates: {}, confidence: 0, summary: 'Analysis failed' }
}

/**
 * Send update blast to all members
 */
async function sendUpdateBlast(event: eventRepo.Event, updateSummary: string): Promise<number> {
  const users = await memberRepo.getOptedInMembers()
  let sent = 0
  
  const message = `📢 update: ${updateSummary} - ${event.title} is now ${event.eventDate.toLocaleDateString()} at ${event.eventDate.toLocaleTimeString()}${event.location ? ` at ${event.location}` : ''}`
  
  for (const user of users) {
    const userPhone = user.phone ? normalizePhone(user.phone) : ''
    if (userPhone.length < 10) continue
    
    const result = await sendSms(toE164(userPhone), message)
    if (result.ok) sent++
  }
  
  return sent
}

/**
 * Check if event is within 2 hours (past the reminder window)
 */
function isPastReminderWindow(eventDate: Date): boolean {
  const now = new Date()
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  return eventDate <= twoHoursFromNow
}

/**
 * Handle event update action (admin only)
 */
export async function handleEventUpdate(input: EventUpdateInput): Promise<ActionResult> {
  const { phone, message, userName, isAdmin, pendingConfirmation } = input

  // Only admins can update events
  if (!isAdmin) {
    return {
      action: 'chat',
      response: "only admins can update events"
    }
  }

  // If there's a pending confirmation, check if this is a confirmation
  if (pendingConfirmation) {
    const lowerMsg = message.toLowerCase().trim()
    const isConfirmation = /^(yes|y|yea|yeah|yep|yup|ya|sure|confirm|confirmed|ok|okay|k|go|go ahead|do it|sounds good|lets do it|let's do it)[.!]*$/.test(lowerMsg)
    const isRejection = /^(no|n|nah|nope|cancel|nvm|nevermind|never mind|stop|forget it|scratch that|dont|don't)[.!]*$/.test(lowerMsg)

    if (isConfirmation) {
      // Apply the update
      try {
        const updatedEvent = await eventRepo.updateEvent(
          pendingConfirmation.eventId,
          pendingConfirmation.updates as Parameters<typeof eventRepo.updateEvent>[1]
        )
        
        // If event is soon, send blast
        let blastSent = 0
        if (isPastReminderWindow(updatedEvent.eventDate)) {
          console.log(`[EventUpdate] Event is within 2 hours, sending update blast`)
          blastSent = await sendUpdateBlast(updatedEvent, pendingConfirmation.description)
        }
        
        const blastMsg = blastSent > 0 ? ` sent update to ${blastSent} people.` : ''
        
        return {
          action: 'event_update',
          response: `✅ event updated: ${pendingConfirmation.description}.${blastMsg}`
        }
      } catch (error) {
        console.error('[EventUpdate] Failed to update event:', error)
        return {
          action: 'event_update',
          response: `failed to update event: ${error instanceof Error ? error.message : 'unknown error'}`
        }
      }
    } else if (isRejection) {
      return {
        action: 'event_update',
        response: "ok, cancelled the update"
      }
    } else {
      return {
        action: 'event_update',
        response: "say 'yes' to confirm the update or 'no' to cancel"
      }
    }
  }

  // New update request - identify event and changes
  console.log(`[EventUpdate] Admin ${userName} requesting event update`)

  const upcomingEvents = await eventRepo.getUpcomingEvents(20)
  
  if (upcomingEvents.length === 0) {
    return {
      action: 'event_update',
      response: "no upcoming events found to update"
    }
  }

  const analysis = await identifyEventAndChanges(message, upcomingEvents)

  if (!analysis.eventId || analysis.confidence < 0.5) {
    return {
      action: 'event_update',
      response: "couldn't figure out which event you want to update. try being more specific?"
    }
  }

  if (Object.keys(analysis.updates).length === 0) {
    return {
      action: 'event_update',
      response: "not sure what you want to change about that event. what field are you updating?"
    }
  }

  const event = upcomingEvents.find(e => e.id === analysis.eventId)
  if (!event) {
    return {
      action: 'event_update',
      response: "found the event but can't load it right now. try again?"
    }
  }

  // Ask for confirmation
  return {
    action: 'event_update',
    response: `confirm: ${analysis.summary} for "${event.title}"? reply yes/no`,
    pendingConfirmation: {
      eventId: analysis.eventId,
      updates: analysis.updates,
      description: analysis.summary
    }
  }
}

