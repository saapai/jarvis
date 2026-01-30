import { getOpenAI } from '@/lib/openai'

export interface DeadlineResult {
  scheduledFor: Date
  content: string
}

/**
 * Detect deadlines in Slack messages and resolve relative time to ONE absolute date
 * based on when the message was sent (not "today"). E.g. "fill out form tmr" in a
 * message sent Jan 15 → Jan 16; "by Thursday" in a message sent Tue Jan 21 → Thu Jan 23.
 * Returns null if no deadline or if the resolved date is in the past.
 */
export async function detectDeadline(
  messageText: string,
  messageTs: string
): Promise<DeadlineResult | null> {
  try {
    const openai = getOpenAI()
    const messageSentAt = new Date(parseFloat(messageTs) * 1000)
    const messageSentStr = messageSentAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

    const prompt = `Analyze this Slack message and detect if it contains a deadline or reminder time.

Message: "${messageText}"

CRITICAL: This message was SENT at: ${messageSentStr}

Resolve ALL relative time expressions relative to WHEN THE MESSAGE WAS SENT, not relative to today:
- "tmr", "tomorrow" → the day after the message was sent (one specific date)
- "Thursday", "Friday", "EOD Thursday" → the specific Thursday/Friday in the same or next week from the message date
- "next week" → the specific week and day implied from the message date
- "end of day", "EOD" → that specific calendar day at end of day (e.g. 5pm)

You must output ONE specific absolute date/time. Do NOT interpret as recurring (e.g. not "every Thursday").

Look for:
- Deadlines: "EOD Thursday", "by Thursday", "due Thursday", "fill out form tmr"
- Reminder times: "remind everyone on Thursday", "send reminder Thursday"

If you find a deadline/reminder:
1. Resolve it to the exact calendar date and time based on the MESSAGE SENT date above.
2. Default to 5pm local for "EOD" or end of day.
3. Extract the key content/action to send (e.g. RSVP link or reminder text).

Return JSON:
{
  "hasDeadline": boolean,
  "scheduledFor": "YYYY-MM-DDTHH:mm:ss" (ISO datetime for that ONE specific occurrence, or null),
  "content": "Message to send at the deadline" or null
}

Examples (message sent Tue Jan 21, 2025 10am):
- "fill out this form tmr" → hasDeadline: true, scheduledFor: "2025-01-22T17:00:00", content: "fill out the form..."
- "rsvp by EOD thurs" → hasDeadline: true, scheduledFor: "2025-01-23T17:00:00", content: "rsvp reminder..."
- "meeting is Friday" → hasDeadline: false (informational, not a deadline)

Return ONLY valid JSON:`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You resolve relative time in messages to one absolute date based on when the message was sent. Return only valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 300,
    })

    const result = JSON.parse(response.choices[0]?.message?.content || '{}')

    if (!result.hasDeadline || !result.scheduledFor) return null

    const scheduledFor = new Date(result.scheduledFor)
    if (isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) return null

    return {
      scheduledFor,
      content: result.content || messageText,
    }
  } catch (error) {
    console.error('[slackDeadline] Error:', error)
    return null
  }
}
