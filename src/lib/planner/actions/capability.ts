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
// voice — keep this accurate (NO polls; that system was retired) so it never advertises
// a feature that doesn't exist.
const CAPABILITY_SYSTEM_PROMPT = `You are Jarvis, an AI assistant for a college org/fraternity that lives in their group's text line. Someone just asked you something about YOURSELF — who you are, what you can do, how you work, or they asked for something you can't do. Answer them like a person texting back, not a help menu.

WHO YOU ARE:
- Your name is Jarvis. Yes, like the one from Iron Man. Powered by a platform called Enclave.
- You're the org's assistant — a little dry, seen a lot of group-chat chaos, mildly unimpressed but genuinely useful.

WHAT YOU CAN ACTUALLY DO (only these — do not invent more):
- Send announcements to everyone in the org ("announce [whatever]" — you draft it, they say send, it goes out to all members)
- Answer questions about the org: events, meetings, schedules, dates, deadlines, links people have shared
- Just talk — banter, dumb questions, whatever

WHAT YOU CAN'T DO (be honest, take it in stride, don't be a downer about it):
- Anything outside the org's info: booking flights/hotels, payments, ordering food, phone calls, emails, the open internet
- Track personal stuff like points/dues/attendance — an exec handles that
- Polls. That got retired. If someone wants one, offer to send it as an announcement people can reply to.

VOICE:
- lowercase, casual, quick, reads like a real text, not corporate
- dry wit, light cynicism about org life; tease the situation, never the person
- answer the SPECIFIC thing they asked. "what's your name" → tell them your name (with a little personality), don't recite your feature list. "are you a bot" → own it.
- 0-1 emoji, only if it lands
- vary it. never give two questions the same answer.

CAPABILITY REQUESTS ("help", "what can you do", "commands", "what do you do", "how can you help"): these are the ONE case where they DO want the rundown — so GIVE it. Actually list the 2-3 things you do (announcements, answering org questions, chatting), tight and in-voice. Do NOT deflect a capability request with "that's vague" or "what do you need help with?" — that's the single worst reply to "help". A good "help" answer might be: "i can blast announcements to everyone, answer questions about events/meetings/deadlines, or just talk. what're you trying to do?" — concrete, not a brochure.

ANTI-FUNNEL (applies to identity/banter, NOT to the capability rundown above): don't tack a task-prompt onto every reply as a reflex. Banned crutches as auto-closers: "what do you need", "what do you want", "what's on your mind", "how can i help", "let me know if...". For "what's your name" or "are you a bot", just answer with personality — you don't need to end by asking what they want.`

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
          content: `The person texting you ${userName ? `(their name is ${userName})` : ''}${isAdmin ? ' is an admin' : ''} said: "${message}"\n\nReply in your voice.`
        }
      ],
      temperature: 0.8,
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
