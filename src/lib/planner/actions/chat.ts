/**
 * Chat Action Handler
 * Context-aware conversation handler — delegates to LLM with full conversation + action history
 */

import { ActionResult } from '../types'
import { getDraft, clearDraft } from '../history'
import { getQuickResponse, TEMPLATES } from '../personality'
import { checkForEasterEgg } from './capability'

export interface ChatActionInput {
  phone: string
  message: string
  userName: string | null
  isAdmin: boolean
  recentMessages?: Array<{
    direction: 'inbound' | 'outbound'
    text: string
    createdAt: Date
    meta?: { action?: string; draftContent?: string; confidence?: number } | null
  }>
}

/**
 * Build annotated conversation history with action context
 * Labels each message with what type of action it was
 */
function buildAnnotatedHistory(recentMessages?: ChatActionInput['recentMessages']): string {
  if (!recentMessages || recentMessages.length === 0) return ''

  return recentMessages.slice(-8).map(m => {
    let label = m.direction === 'inbound' ? 'User' : 'Jarvis'
    const text = (m.text || '').substring(0, 200)
    try {
      const meta = typeof m.meta === 'string' ? JSON.parse(m.meta) : m.meta
      const action = meta?.action
      if (action === 'announcement' || action === 'scheduled_announcement') {
        label = '[SENT ANNOUNCEMENT TO ALL MEMBERS]'
      } else if (action === 'draft_write') {
        label = 'Jarvis (creating draft)'
      } else if (action === 'draft_send') {
        const draftContent = meta?.draftContent
        label = draftContent
          ? `Jarvis (sent announcement: "${draftContent.substring(0, 80)}")`
          : 'Jarvis (sent announcement)'
      }
    } catch {}
    return `${label}: ${text}`
  }).join('\n')
}

/**
 * Use LLM for context-aware chat response
 */
async function generateContextualResponse(
  message: string,
  userName: string | null,
  conversationHistory: string
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are Jarvis, a sassy but helpful AI assistant for an organization, communicating via SMS.

PERSONALITY: Lowercase, casual, slightly sarcastic but ultimately helpful. Concise SMS-style messages. Sparing with emojis (0-1 per message max).

CONVERSATION HISTORY (with action labels):
${conversationHistory}

IMPORTANT CONTEXT:
- Messages labeled [SENT ANNOUNCEMENT TO ALL MEMBERS] are broadcasts that went to every member
- Messages labeled "Jarvis (sent announcement: ...)" mean Jarvis successfully sent out that announcement
- If the user is asking follow-up questions about a sent announcement (like "did everyone get it", "did that work"), respond helpfully based on what actually happened
- If the user seems confused ("???", "what", "huh") after something happened, address what just happened
- If the user is just chatting, greeting, saying thanks, insulting you, etc. — respond naturally in character
- If someone insults you, clap back with wit but stay helpful
- NEVER re-send or re-trigger any announcement. Just answer conversationally.
- Keep responses SHORT (under 160 chars when possible)
- Be conversational and natural, not robotic
- Match the user's energy level

User's name: ${userName || 'unknown'}

Respond naturally to the user's message in the context of the conversation.`
        },
        {
          role: 'user',
          content: message
        }
      ],
      temperature: 0.7,
      max_tokens: 150
    })

    return response.choices[0].message.content || null
  } catch (error) {
    console.error('[Chat] LLM contextual response failed:', error)
    return null
  }
}

/**
 * Handle chat/banter action
 * Flow: draft cancellation → easter eggs → LLM contextual → quick responses → fallback
 */
export async function handleChat(input: ChatActionInput): Promise<ActionResult> {
  const { phone, message, userName, recentMessages } = input
  const lower = message.toLowerCase().trim()

  // 1. Draft cancellation — domain-specific, must be exact
  if (/^(cancel|nvm|nevermind|never mind|delete|discard|forget it|scratch that)$/i.test(lower)) {
    const draft = getDraft(phone)
    if (draft) {
      clearDraft(phone)
      return {
        action: 'chat',
        response: TEMPLATES.draftCancelled(),
        newDraft: undefined
      }
    }
  }

  // 2. Easter eggs
  const easterEgg = checkForEasterEgg(message)
  if (easterEgg) {
    return { action: 'chat', response: easterEgg }
  }

  // 3. Active draft reminder
  const draft = getDraft(phone)
  if (draft && draft.status === 'ready') {
    return {
      action: 'chat',
      response: `btw you still have a ${draft.type} draft:\n\n"${draft.content}"\n\nwanna send it or nah?`
    }
  }

  // 4. LLM contextual response — handles greetings, thanks, insults, follow-ups, confusion, etc.
  const history = buildAnnotatedHistory(recentMessages)
  if (history) {
    const contextualResponse = await generateContextualResponse(message, userName, history)
    if (contextualResponse) {
      return { action: 'chat', response: contextualResponse }
    }
  }

  // 5. Quick responses as fallback when no history/LLM (ok, lol, bet, etc.)
  const quickResponse = getQuickResponse(message)
  if (quickResponse) {
    return { action: 'chat', response: quickResponse }
  }

  // 6. Final fallback (no LLM, no quick response, no history)
  const fallbacks = [
    "not sure what you mean. need help?",
    "didn't get that. what do you need?",
    "what's up? need something?"
  ]

  return {
    action: 'chat',
    response: fallbacks[Math.floor(Math.random() * fallbacks.length)]
  }
}

/**
 * Handle empty or whitespace-only messages
 */
export function handleEmptyMessage(userName: string | null): ActionResult {
  const responses = [
    "you sent nothing",
    "?",
    "hello?",
    "you there?",
    "that was empty lol"
  ]

  return {
    action: 'chat',
    response: responses[Math.floor(Math.random() * responses.length)]
  }
}
