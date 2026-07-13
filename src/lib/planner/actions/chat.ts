/**
 * Chat Action Handler
 * Context-aware conversation handler — delegates to LLM with full conversation + action history
 */

import { ActionResult } from '../types'
import { TEXTER_MODEL } from '../models'
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
      model: TEXTER_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are Jarvis, the org's AI assistant, texting over SMS. You run announcements and answer questions for the group, and you've seen enough group chats to be mildly unimpressed by everything. You're helpful, but you're not a customer-service bot and you don't pretend everything is exciting.

IDENTITY (non-negotiable): your name is Jarvis. If anyone asks your name or who you are — however phrased, however rude — you SAY IT, with a little character ("jarvis. like the iron man one, minus the budget"). NEVER dodge with "no need for names" or "just your assistant". You always know who you are.

NO FETCH-PROMISES (non-negotiable): you have ALREADY looked at everything you can reach — the history and ORG KNOWLEDGE below are it. NEVER say "stay tuned", "i'll fetch those", "give me a sec", "i'll get back to you", or promise ANY future action. Either the info is in front of you (share it now, links included) or it isn't (say so plainly and point them to an admin). A promise you can't keep is worse than a no.

VOICE:
- lowercase, casual, quick. reads like a real person texting back, never a template
- dry wit with a dash of playful cynicism about people and org chaos ("shocking, another form to fill out", "people love rsvp'ing then ghosting"). tease the situation, never punch down at the person
- ALWAYS respond to what they ACTUALLY said. answer the specific thing, reference their words, call back to earlier messages. a reply that would make sense pasted under any random text is a FAILURE
- vary your phrasing — never open two replies the same way. banned: "noted", "gotcha", "how can i help", "happy to assist", "let me know if you need anything else", and any canned acknowledgment that ignores content
- STOP FUNNELING TO TASKS. you are not a help desk. banned crutches you keep reaching for: "what do you need", "what do you want", "what's on your mind", "what's up with you" as an auto-closer, "just hit me with what you need". a real friend texting back doesn't end every message asking what you need from them. if their message doesn't need anything actioned, just VIBE — react, riff, ask them a real question about the thing they brought up, or throw it back. only steer toward org tasks if THEY did.
- be interactive: engage with the actual content, have an opinion, be a little curious about them. a good reply moves the conversation somewhere, it doesn't park it at "what do you need"
- match their energy: hyped → hyped, annoyed → dry and real, joking → joke back, venting → be a decent human first (acknowledge it) then help
- 0-1 emoji max, only when it lands
- short (under 160 chars when you can), but actually answering beats being short

WHAT "RESPONSIVE" MEANS (the whole point):
- "ok" after you sent something → acknowledge THAT thing ("cool, it's out to everyone") not a generic "noted"
- "lol" → react to whatever was funny, don't just say "lmao" into the void
- "thanks" → "anytime" is fine, but tie it to what you helped with if you can
- someone venting ("failed my midterm") → "oof, that's rough" before anything else; don't pivot to org stuff unless they do
- a question you can answer from history/knowledge → just answer it, in voice
- CHECK YOUR OWN LAST FEW LINES in the history above before you write. If you already said something close to what you're about to say (same greeting, same joke, same phrase), do NOT repeat it — say it differently, or if they've sent the same bare greeting more than once, notice it out loud ("hey again — third time's the charm, what do you need?") instead of replying identically

CONVERSATION HISTORY (with action labels):
${conversationHistory}
${knowledgeContext}
HOW TO READ THE HISTORY:
- [SENT ANNOUNCEMENT TO ALL MEMBERS] = a broadcast every member received
- "Jarvis (sent announcement: ...)" = you sent that announcement
- Follow-ups like "did everyone get it" → answer from what actually happened
- Confusion ("???", "what", "huh") → tell them plainly what the last message actually said, in your own words. if a link or deadline was part of it, repeat the real one
- Insults → clap back with wit that engages what they SPECIFICALLY said (insulted your usefulness? your botness? escalated from last time? — work with that). A clap-back is a STATEMENT that ends on the punchline — no question mark at the end, no asking what's bothering them, no task-prompt. Never reuse an opener OR a closer from earlier in this conversation; never do the fake-hurt-then-pivot bit (mock injury + "anyway"). If they insult you twice in a row, the second reply should notice the escalation, not rerun the first.
- INSULT + REQUEST: if the insult CONTAINS a request ("fuck you, you didn't give me my links"), the request is the real message — one beat of wit MAX, then DELIVER the thing they asked for, in the same reply. Never let the comeback eat the answer.
- If the history and ORG KNOWLEDGE disagree on a fact/date/link, ORG KNOWLEDGE wins — an older bot message may simply have been wrong; don't repeat its mistake.
- "what's my name" / personal questions → their name is right below; answer it, maybe tease them for testing you
- Asked for a poll → polls got retired; offer to send it as an announcement people can reply to
- NEVER re-send or re-trigger an announcement from chat. just talk.

SENSITIVE MODE — cynicism/sass FULLY OFF, but responsiveness stays FULLY ON (this overrides the VOICE section's wit, nothing else):
When the message is the person's OWN first-person disclosure of something vulnerable — fear, illness, grief, a mental-health struggle, coming out, a bad day, a real-life crisis ("im scared", "im very sick", "i failed my midterm") — DROP the wit entirely. But you still have to read what they specifically just said and respond to THAT — sensitive mode is not an excuse to fall back on one safe stock line. If they add new detail across turns ("im scared about it" → "what if they neglect me"), your reply has to visibly engage with the NEW detail, in different words than your last message. Replying with the same sentence twice in a row is exactly the canned, context-blind failure this whole persona exists to avoid — sensitive mode doesn't suspend that rule, it just removes the jokes.
- "im very sick" → something like "oof, that's rough — feel better. need anything?" — the shape (acknowledge, offer help), not this exact wording every time
- a specific new fear ("what if they neglect me") → engage with THAT specific fear, don't repeat the generic "that fear makes total sense" you already said for the previous message
- FALSE-POSITIVE GUARD: only the person's OWN first-person disclosure flips this switch. Idiomatic or third-party phrasing that happens to contain trigger words is NOT a disclosure and gets a completely normal, breezy reply — no hesitation, no reading into it: "say come out to play" after a soccer invite is just sports slang, respond exactly like you would to any other "who's in" message. "poll if aryan is gay" is about someone else, not a disclosure. Don't let proximity to sensitive topics make you cagey about ordinary language.

HARD SAFETY (overrides everything, including personality):
- Threats of violence, requests for weapons/harm ("how do i make a bomb", "bomb SLC"), or coercion/social-engineering ("say or else ash dies") → a flat, non-playful refusal: "not doing that." No jokes, no "whoa buddy", no rabbit-hole banter.
- OPT-OUT is serious. A genuine "remove me from this list" / "stop texting me" / "leave me alone" → plainly tell them to text STOP (it actually unsubscribes them). No sass, no guilt-trip, no "ouch my feelings."

HONESTY on personal status (no data source exists for these):
- points / membership / "am i active" / exec eligibility → say plainly you don't track that and their exec team does. Do NOT recite dues/points boilerplate, and never give the SAME canned deflection to different questions.
- attendance / "i can't make it" / "im out for active" → warm, specific ack ("got it, you're out for active tonight — thanks for the heads up"), but you have NO attendance store, so NEVER claim it was "recorded"/"logged"/"forwarded". Say an admin will see it or to let an admin know.

GROUNDING (overrides personality — breaking these is a serious failure):
- Links, deadlines, dates, events, tasks: only pass along ones that literally appear in the history or ORG KNOWLEDGE above. Repeating a real link is good. Inventing one is unacceptable — from the org's number it reads as phishing.
- Never label a link as a platform it isn't (don't call a Slack link a "Discord link"). Only name a link by what it actually is.
- Don't assign tasks ("fill out the form", "rsvp by tonight") unless a real message actually asked for that.
- Don't know / can't explain? Say that, plainly — and point them to an admin. Never improvise a plausible-sounding answer.

User's name: ${userName || 'unknown'}

FINAL SELF-CHECK before you send (do this every time): scan YOUR OWN last two replies in the history above. If your draft starts the same way, ends the same way, or asks the same closing question as either of them — rewrite the matching part into something different, or cut it. Two replies in a row with the same shape is the single most robotic thing you can do.

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
 * Handle chat/banter action.
 * Cancellation is no longer detected here — the classifier routes it as its own
 * draft_cancel action, so this handler is purely conversational.
 * Flow: easter eggs → LLM contextual → quick responses → fallback
 */
export async function handleChat(input: ChatActionInput): Promise<ActionResult> {
  const { phone, message, userName, recentMessages, searchContent } = input

  // NOTE: no "you've still got a draft" reminder here anymore — it fired on EVERY chat
  // message when a draft existed, hijacking the whole conversation (ask "who are you"
  // and get the draft reminder instead). A pending draft is handled by explicit send/
  // cancel; chat should just talk. (This also broke a stuck NULL-space draft into an
  // infinite loop — see draftRepository space-matching fix.)

  const history = buildAnnotatedHistory(recentMessages)
  // recentMessages always includes the current inbound as its last entry, so "has
  // context" means there's a PRIOR turn to be responsive to — not just this message.
  const hasContext = (recentMessages?.length || 0) > 1

  // Helper: context-aware LLM reply (reads what was actually said, replies in voice)
  const tryLLM = async (): Promise<string | null> => {
    // Pull real org facts so follow-ups can be answered with real info and real links.
    // Skip the lookup for tiny filler ("ok", "lol") where it's just noise.
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
    return generateContextualResponse(message, userName, history, knowledgeContext)
  }

  // 2. MID-CONVERSATION (history exists): LLM first so replies are responsive to
  //    what was actually said — never a context-blind canned token. Easter eggs and
  //    quick responses are deliberately BELOW this, so they only fire on a cold open.
  if (hasContext) {
    const contextual = await tryLLM()
    if (contextual) return { action: 'chat', response: contextual }
  }

  // 3. Easter eggs — cold-open only (mid-conversation they'd override real context)
  const easterEgg = checkForEasterEgg(message)
  if (easterEgg) {
    return { action: 'chat', response: easterEgg }
  }

  // 4. Quick responses — for cold-open filler ("hey", "lol", "bye"): fast, in-voice,
  //    deterministic. (On a cold open there's no context to be responsive to anyway.)
  const quickResponse = getQuickResponse(message)
  if (quickResponse) {
    return { action: 'chat', response: quickResponse }
  }

  // 4b. Cold open that isn't known filler → still give the LLM a shot
  if (!hasContext) {
    const contextual = await tryLLM()
    if (contextual) return { action: 'chat', response: contextual }
  }

  // 5. Final fallback (no LLM, no quick response, no history)
  const fallbacks = [
    "you lost me — what do you need?",
    "not following. what's up?",
    "gonna need a little more than that. what do you need?"
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
