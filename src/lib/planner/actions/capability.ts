/**
 * Capability Query Handler
 * Handles questions about Jarvis/Enclave capabilities using LLM
 */

import { ActionResult } from '../types'
import { applyPersonality, TEMPLATES } from '../personality'

export interface CapabilityQueryInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
}

/**
 * Use LLM to determine what type of capability query this is
 * and whether it's asking about something Jarvis can't do
 */
async function classifyCapabilityQuery(message: string, isAdmin: boolean): Promise<{
  queryType: 'identity' | 'capabilities' | 'howItWorks' | 'help' | 'impossible' | 'general'
  impossibleTask?: string
  reasoning: string
}> {
  if (!process.env.OPENAI_API_KEY) {
    return { queryType: 'general', reasoning: 'No API key' }
  }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const systemPrompt = `You are analyzing a user's question about Jarvis, an SMS bot assistant for organizations.

JARVIS CAN DO:
- Send announcements to group members
- Create and manage polls
- Answer questions about the organization (events, meetings, schedules)
- Provide help and explain capabilities
- Have casual conversations with personality

JARVIS CANNOT DO:
- Book flights, hotels, or make reservations
- Make purchases or payments
- Access external services (Uber, food delivery, etc.)
- Make phone calls
- Send emails
- Access calendars outside the org
- Anything requiring external APIs or services

Classify the user's message into one of these types:
- "identity": Asking who/what Jarvis is, if it's a bot
- "capabilities": Asking what Jarvis can do
- "howItWorks": Asking how Jarvis works
- "help": Asking for help or commands
- "impossible": Asking Jarvis to do something it cannot do
- "general": General capability question

If it's "impossible", identify what impossible task they're asking for.

Respond with JSON only.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `User message: "${message}"\n\nClassify this query and explain your reasoning.`
        }
      ],
      temperature: 0.2,
      max_tokens: 200,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (content) {
      const parsed = JSON.parse(content)
      return {
        queryType: parsed.queryType || 'general',
        impossibleTask: parsed.impossibleTask,
        reasoning: parsed.reasoning || 'LLM classification'
      }
    }
  } catch (error) {
    console.error('[CapabilityQuery] LLM classification failed:', error)
  }

  return { queryType: 'general', reasoning: 'Fallback' }
}

/**
 * Handle capability query action using LLM-based classification
 */
export async function handleCapabilityQuery(input: CapabilityQueryInput): Promise<ActionResult> {
  const { phone, message, userName, isAdmin } = input

  const classification = await classifyCapabilityQuery(message, isAdmin)
  console.log(`[CapabilityQuery] Classified as: ${classification.queryType} - ${classification.reasoning}`)

  // Handle impossible requests with humorous responses
  if (classification.queryType === 'impossible') {
    const impossibleResponses = [
      `sorry bro i wish i was smart enough to ${classification.impossibleTask || 'do that'} for you. i can help with announcements, polls, and org questions though`,
      `nah i can't ${classification.impossibleTask || 'do that'}. i'm just a bot for org stuff - announcements, polls, and questions about events`,
      `lol i wish. i can't ${classification.impossibleTask || 'help with that'}. but i can send announcements and polls if you need`,
      `${classification.impossibleTask || 'that'} is way beyond my capabilities. i just do org communication stuff - announcements, polls, and answering questions`
    ]

    return {
      action: 'capability_query',
      response: applyPersonality({
        baseResponse: impossibleResponses[Math.floor(Math.random() * impossibleResponses.length)],
        userMessage: message,
        userName
      })
    }
  }

  // Handle based on query type
  switch (classification.queryType) {
    case 'identity':
      return {
        action: 'capability_query',
        response: applyPersonality({
          baseResponse: "i'm jarvis, your org's sassy ai assistant. powered by enclave. i help with announcements, polls, and answering questions about what's going on",
          userMessage: message,
          userName
        })
      }

    case 'howItWorks':
      return {
        action: 'capability_query',
        response: applyPersonality({
          baseResponse: "i read your messages, figure out what you want, and do it. or roast you. depends on my mood 🤷",
          userMessage: message,
          userName
        })
      }

    case 'capabilities':
    case 'help':
      return {
        action: 'capability_query',
        response: applyPersonality({
          baseResponse: TEMPLATES.capabilities(isAdmin),
          userMessage: message,
          userName
        })
      }

    case 'general':
    default:
      return {
        action: 'capability_query',
        response: applyPersonality({
          baseResponse: TEMPLATES.capabilities(isAdmin),
          userMessage: message,
          userName
        })
      }
  }
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
    ],
    'good morning': [
      'is it? anyway what do you need',
      'morning. sup',
      'mornin 🌅'
    ],
    'good night': [
      'night 🌙',
      'sleep tight',
      'later'
    ],
    'how are you': [
      'functioning within normal parameters 🤖',
      'i\'m a bot so... fine i guess',
      'living my best digital life. you?'
    ]
  }
  
  for (const [trigger, responses] of Object.entries(easterEggs)) {
    if (lower.includes(trigger)) {
      return responses[Math.floor(Math.random() * responses.length)]
    }
  }
  
  return null
}

