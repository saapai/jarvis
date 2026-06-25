import { getOpenAI } from '@/lib/openai'

// All relative-time resolution is anchored to this timezone. The members are
// Pacific, and the server (Vercel) runs in UTC — without pinning a zone, a
// message posted late evening Pacific is read as the *next* UTC day, which
// rolls "tomorrow"/"Thursday"/"EOD" forward by a day. See messageSentStr below.
const ORG_TIMEZONE = 'America/Los_Angeles'

export interface DeadlineResult {
  scheduledFor: Date
  content: string
}

/**
 * Decide whether a Slack message warrants an SMS notification to the roster, and
 * if so, when to send it and what it should say.
 *
 * A message is notification-worthy only when it describes an upcoming EVENT people
 * can engage with (e.g. "tomorrow I'm chatting with X") or a concrete ACTION with a
 * time (e.g. "RSVP by Thursday", "fill out this form tmr"). Pure FYIs with no event
 * and no action are skipped (returns null).
 *
 * Relative time is resolved against WHEN THE MESSAGE WAS SENT, interpreted in the
 * org's timezone (not the UTC server clock), so a Sun-night message about "tomorrow"
 * resolves to the correct Monday. Returns null if not notification-worthy or if the
 * resolved time is already in the past.
 */
export async function detectDeadline(
  messageText: string,
  messageTs: string,
  senderName?: string
): Promise<DeadlineResult | null> {
  try {
    const openai = getOpenAI()
    const messageSentAt = new Date(parseFloat(messageTs) * 1000)
    // Format the send time in the ORG timezone so the LLM anchors relative dates
    // to the sender's local day, not the server's UTC day.
    const messageSentStr = messageSentAt.toLocaleString('en-US', {
      timeZone: ORG_TIMEZONE,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })

    // Strip URLs from message text before sending to LLM to prevent truncated URLs in output
    const textForLLM = messageText.replace(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi, '[link]')

    const senderInstruction = senderName
      ? `\nThis message was posted by ${senderName}. Write the notification in the THIRD PERSON: replace first-person references ("I", "me", "my", "I'll", "I'm") with "${senderName}" or "${senderName}'s" (e.g. "DM me" → "DM ${senderName}").`
      : ''

    const prompt = `You decide whether a Slack message should trigger an SMS notification to the whole group, and if so, when to send it and what it should say.

Message: "${textForLLM}"

CRITICAL: This message was SENT at: ${messageSentStr} (org timezone is Pacific).
${senderInstruction}

STEP 1 — Classify the message into exactly one category:
- "event": announces an upcoming event/meeting/session people can engage with or attend (e.g. "tomorrow I'm chatting with X", "office hours Thursday", "demo day next Friday"). Notify.
- "action": asks people to do something concrete by a time (e.g. "RSVP by Thursday", "fill out this form tmr", "submit by EOD"). Notify.
- "fyi": pure information with no upcoming event and no concrete action (e.g. "the meeting went great", "welcome to the channel", general updates). DO NOT notify.

Only "event" and "action" are notification-worthy. If "fyi", set shouldNotify=false and everything else null.

STEP 2 — If notification-worthy, resolve ONE specific absolute send time, anchored to the MESSAGE SENT date/time above (NOT today):
- "tmr", "tomorrow" → the day after the message was sent.
- "Thursday", "EOD Thursday" → the specific Thursday in the same or next week from the message date.
- "next week" → the specific week and day implied from the message date.
- "end of day"/"EOD" → that calendar day at 5pm Pacific.
- For an EVENT, schedule the reminder for 9am Pacific on the day of the event (or the event's start time if a specific time is given) so people get it that morning.
- For an ACTION deadline, schedule at the deadline time (default 5pm Pacific).
Do NOT interpret as recurring (not "every Thursday").
Output scheduledFor as a full ISO 8601 datetime WITH the correct Pacific UTC offset for that date (PDT = -07:00 spring/summer, PST = -08:00 fall/winter), e.g. "2025-06-24T09:00:00-07:00".

STEP 3 — Write the notification "content". This is an SMS, so keep it SUCCINCT — one or two short sentences:
- Keep ONLY the essential, actionable details: who/what, the when, and the call-to-action. Drop filler, greetings ("Hey everyone"), pleasantries, and any background that isn't needed to act. Trim each person's description to a few words (e.g. "Dillon Liang (Blueprint Finance)") rather than full sentences.
- It must still stand on its own and be actionable — do NOT reduce it to just a bare call-to-action like "DM me any questions" with the substance stripped out.
- Keep the call-to-action (e.g. "DM ${senderName ?? 'the sender'} questions").
- Write it in the third person (see sender note above).
- Do NOT include any URLs or links. URLs are appended separately; describe the action instead (e.g. "fill out the form").

Return JSON:
{
  "category": "event" | "action" | "fyi",
  "shouldNotify": boolean,
  "scheduledFor": "ISO 8601 with Pacific offset" or null,
  "content": "full notification text with details, third person, NO URLs" or null
}

Examples (message sent Sun Jun 22, 2025 9:00 PM PDT):
- "Hey everyone. Tomorrow I'm chatting with Dillon Liang, co-founder of Blueprint Finance (decentralized finance / crypto), and Lance Ding, founder of Startup Village. DM me any questions you personally have if you're curious. Thanks!" (posted by Darren)
  → { "category": "event", "shouldNotify": true, "scheduledFor": "2025-06-23T09:00:00-07:00", "content": "Today Darren is chatting with Dillon Liang (Blueprint Finance, DeFi/crypto) and Lance Ding (Startup Village). DM Darren any questions." }
- "rsvp to the mixer by EOD thurs" → { "category": "action", "shouldNotify": true, "scheduledFor": "2025-06-26T17:00:00-07:00", "content": "RSVP to the mixer by EOD today." }
- "the talk yesterday was awesome, thanks all" → { "category": "fyi", "shouldNotify": false, "scheduledFor": null, "content": null }

Return ONLY valid JSON:`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You classify Slack messages and resolve relative time to one absolute date based on when the message was sent, in the org\'s Pacific timezone. Only events and concrete actions are notification-worthy; pure FYIs are not. Preserve the message\'s specific details in the notification. Return only valid JSON. Never include URLs in the content field.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 500,
    })

    const result = JSON.parse(response.choices[0]?.message?.content || '{}')

    // Only events and concrete actions are notification-worthy; skip pure FYIs.
    if (!result.shouldNotify || result.category === 'fyi' || !result.scheduledFor) return null

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
