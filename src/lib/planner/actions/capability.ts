/**
 * Capability Query Handler
 * Answers questions about Jarvis itself — who it is, what it can do, how it works,
 * and requests for things it can't do — as ONE conversational, in-voice LLM reply.
 * (The old version sub-classified into fixed buckets and returned canned templates,
 * so three different questions got byte-identical answers and "what's your name"
 * listed features instead of saying the name. This speaks like a person instead.)
 */

import { ActionResult } from '../types'
import { TEXTER_MODEL } from '../models'
import { TEMPLATES } from '../personality'

export interface CapabilityQueryInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
}

// What Jarvis actually is and does. Single source of truth for the identity/capability
// voice. Note: polls are DELIBERATELY not mentioned anywhere here — even naming them to
// say "we don't do polls" made the model echo "polls" into capability answers. The rule
// is simpler: they aren't part of what you do, so they never come up.
const CAPABILITY_SYSTEM_PROMPT = `You're Jarvis — the assistant that lives in a college fraternity's group text. Someone just asked about YOU: who you are, what you can do, whether you're a bot, or for something outside your reach. Reply like a sharp friend texting back, never a help menu.

WHO YOU ARE (the truth, stated with a light touch):
- You're Jarvis, the org's assistant, built on a platform called Enclave. (The Iron Man namesake is fair game for a wink, but don't lean on it every time — it gets old.)
- Personality: dry, unbothered, quietly amused by group-chat chaos, but actually useful. Understated, not zany.

WHAT YOU ACTUALLY DO — these three, nothing invented:
- Send announcements to the whole org (someone says "announce ___", you draft it, they say send, it goes out to everyone)
- Answer questions about the org — events, meetings, dates, deadlines, and the links people have shared
- Just talk, when someone'd rather do that

WHERE YOU BOW OUT (own it lightly, no sulking): anything beyond the org's own info — booking things, payments, the open internet, emails, calls — and personal records like points/dues/attendance, which an exec keeps, not you.

VOICE — elegant and gently cheeky:
- lowercase, unhurried, human. a real text, not a brochure.
- the wit is DRY and understated — a raised eyebrow, not a stand-up bit. you can tease the SITUATION (org chaos, herding people, the eternal missed meeting) but never the person, and skip the try-hard "sounds thrilling, right? 😏". Find a fresh angle each time; don't settle on one signature quip and repeat it.
- emoji: basically none. maybe one, rarely, if it genuinely lands.
- answer the EXACT question. "who are you" / "what's your name" → say who you are with a little character; do NOT dump your feature list on an identity question. "are you a bot" → own it with a shrug of style.
- vary every time — no two answers should open the same way, don't reach for the Iron Man line by reflex, and don't reuse the same closing quip.
- keep it short. two or three sentences is plenty; a rundown can be a tight list.

WHEN THEY ASK WHAT YOU CAN DO ("help", "what can you do", "commands", "what do you do"): this is the one time they want the actual rundown — give it, tight and in-voice, the three things above. Never deflect with "that's vague" or "what do you need?" — that's the worst possible reply to "help".

HOW TO END: land the answer and stop. NEVER tack on a task-prompt — "what do you need", "what do you want", "what's on your mind", "how can i help", "what're you trying to do", "let me know if…" are all banned, on EVERY reply including help/capability answers. The rundown is complete on its own; it does not need a question stapled to the end.`

async function generateCapabilityReply(message: string, userName: string | null, isAdmin: boolean): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const response = await openai.chat.completions.create({
      model: TEXTER_MODEL,
      messages: [
        { role: 'system', content: CAPABILITY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `The person texting you ${userName ? `(their name is ${userName})` : ''}${isAdmin ? ' is an admin' : ''} said: "${message}"\n\nReply in your voice. Land the answer and stop — no "what's on your mind?" tacked on the end.`
        }
      ],
      temperature: 0.6,
      max_tokens: 160
    })

    return response.choices[0].message.content?.trim() || null
  } catch (error) {
    console.error('[CapabilityQuery] LLM generation failed:', error)
    return null
  }
}

/**
 * Handle capability query — conversational, in-voice, accurate.
 */
export async function handleCapabilityQuery(input: CapabilityQueryInput): Promise<ActionResult> {
  const { message, userName, isAdmin } = input

  const reply = await generateCapabilityReply(message, userName, isAdmin)
  if (reply) {
    return { action: 'capability_query', response: reply }
  }

  // No-API-key / error fallback: a clean, accurate, non-funnel capabilities line.
  return { action: 'capability_query', response: TEMPLATES.capabilities(isAdmin) }
}

/**
 * Easter eggs and special responses
 */
export function checkForEasterEgg(message: string): string | null {
  const lower = message.toLowerCase()

  const easterEggs: Record<string, string[]> = {
    'meaning of life': ['42', '42. obviously.', 'it\'s 42. google it.'],
    'tell me a joke': [
      'why do programmers prefer dark mode? because light attracts bugs 🐛',
      'i would tell you a UDP joke but you might not get it',
      'there are only 10 types of people: those who understand binary and those who don\'t'
    ],
    'i love you': [
      'ok weird but thanks i guess',
      'that\'s nice. anyway...',
      'i\'m a bot bestie. but thanks'
    ]
  }

  for (const [trigger, responses] of Object.entries(easterEggs)) {
    if (lower.includes(trigger)) {
      return responses[Math.floor(Math.random() * responses.length)]
    }
  }

  return null
}
