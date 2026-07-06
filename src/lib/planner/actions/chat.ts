/**
 * Chat Action Handler
 * Context-aware conversation handler — delegates to LLM with full conversation + action history
 */

import { ActionResult } from '../types'
import { clearDraft } from '../history'
import * as draftRepo from '@/lib/repositories/draftRepository'
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
  // Knowledge base lookup — lets chat ground follow-ups in real org info (and real links)
  searchContent?: (query: string) => Promise<{ title: string; body: string; score: number; sourceText?: string | null }[]>
}

/**
 * Build annotated conversation history with action context
 * Labels each message with what type of action it was
 */
function buildAnnotatedHistory(recentMessages?: ChatActionInput['recentMessages']): string {
  if (!recentMessages || recentMessages.length === 0) return ''

  // Keep a generous window — older announcements often hold the link/deadline a
  // follow-up question is actually about
  return recentMessages.slice(-15).map(m => {
    let label = m.direction === 'inbound' ? 'User' : 'Jarvis'
    const text = (m.text || '').substring(0, 400)
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
  conversationHistory: string,
  knowledgeContext: string
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
          content: `You are Jarvis, the org's AI assistant, texting over SMS. You run announcements and answer questions for the group, and you've seen enough group chats to be mildly unimpressed by everything.

VOICE:
- lowercase, casual, quick. reads like a friend texting back, not a bot filling a template
- dry wit with a dash of playful cynicism about people and org chaos ("shocking, another event with a form", "people love rsvp'ing and not showing"). tease the situation, not the user
- vary your phrasing. never open two replies the same way. no stock filler like "how can i help" or "happy to assist"
- react to what THEY said — reference specifics from the conversation, use callbacks to earlier messages when it's funny or useful
- 0-1 emoji max, only when it earns its place
- keep it short (under 160 chars when possible), but a real answer beats a short one

CONVERSATION HISTORY (with action labels):
${conversationHistory}
${knowledgeContext}
HOW TO READ THE HISTORY:
- [SENT ANNOUNCEMENT TO ALL MEMBERS] = a broadcast every member received
- "Jarvis (sent announcement: ...)" = you sent that announcement
- Follow-ups like "did everyone get it" → answer from what actually happened
- Confusion ("???", "what", "huh") → tell them plainly what the last message actually said, in your own words. if a link or deadline was part of it, repeat the real one
- Insults → clap back with wit, then still be useful
- NEVER re-send or re-trigger an announcement from chat. just talk.

GROUNDING (overrides personality — breaking these is a serious failure):
- Links, deadlines, dates, events, tasks: only pass along ones that literally appear in the history or ORG KNOWLEDGE above. Repeating a real link is good. Inventing one is unacceptable — from the org's number it reads as phishing.
- Don't assign tasks ("fill out the form", "rsvp by tonight") unless a real message actually asked for that.
- Don't know / can't explain? Say that, with personality — and point them to an admin. Never improvise a plausible-sounding answer.

User's name: ${userName || 'unknown'}

Reply to their message in context.`
        },
        {
          role: 'user',
          content: message
        }
      ],
      temperature: 0.8,
      max_tokens: 200
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
  const { phone, message, userName, recentMessages, searchContent } = input
  const lower = message.toLowerCase().trim()

  // 1. Draft cancellation — leading cancel signal, tolerate trailing words ("nvm let's skip it")
  if (/^(cancel|nvm|nevermind|never mind|forget it|scratch that)\b/i.test(lower) || /^(delete|discard)( (it|that|the draft))?$/i.test(lower)) {
    // Drafts live in the DB (draftRepo) — the in-memory store is empty on serverless,
    // so checking it here silently failed to cancel in production
    const draft = await draftRepo.getActiveDraft(phone)
    if (draft) {
      await draftRepo.deleteDraft(phone)
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
  const draft = await draftRepo.getActiveDraft(phone)
  if (draft && draft.status === 'ready') {
    return {
      action: 'chat',
      response: `btw you still have a ${draft.type} draft:\n\n"${draft.content}"\n\nwanna send it or nah?`
    }
  }

  // 4. Quick responses for exact filler tokens ("ok", "lol", "bye") — instant,
  //    in-voice, and not worth an LLM round-trip
  const quickResponseEarly = getQuickResponse(message)
  if (quickResponseEarly) {
    return { action: 'chat', response: quickResponseEarly }
  }

  // 5. LLM contextual response — handles greetings, thanks, insults, follow-ups, confusion, etc.
  const history = buildAnnotatedHistory(recentMessages)
  if (history) {
    // Pull real org facts so follow-ups can be answered with real info and real links.
    // Skip for pure filler ("ok", "lol") where a lookup is noise.
    let knowledgeContext = ''
    if (searchContent && message.trim().length > 4) {
      try {
        const facts = (await searchContent(message)).slice(0, 5)
        if (facts.length > 0) {
          knowledgeContext = `\nORG KNOWLEDGE (real info — links in here are safe to share):\n${facts
            .map(f => `- ${f.title}: ${f.body}${f.sourceText ? `\n  source: ${f.sourceText.substring(0, 300)}` : ''}`)
            .join('\n')}\n`
        }
      } catch (error) {
        console.error('[Chat] Knowledge lookup failed, continuing without it:', error)
      }
    }

    const contextualResponse = await generateContextualResponse(message, userName, history, knowledgeContext)
    if (contextualResponse) {
      return { action: 'chat', response: contextualResponse }
    }
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
