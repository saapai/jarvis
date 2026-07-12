/**
 * Intent Classifier
 * LLM-based classification with weighted conversation context
 */

import {
  ActionType,
  DraftType,
  ClassificationResult,
  ClassificationContext,
  WeightedTurn,
  Draft
} from './types'

// ============================================
// LLM-BASED CLASSIFICATION
// All routing goes through the LLM — pattern fast-paths were removed because
// regexes silently miss phrasing variants. The prompt below carries few-shot
// examples mined from real production conversations instead.
// ============================================

/**
 * Build the classification prompt with weighted history
 */
function buildClassificationPrompt(context: ClassificationContext): string {
  const { currentMessage, history, activeDraft, isAdmin, userName } = context

  // Build weighted history context
  let historyContext = ''
  if (history.length > 0) {
    historyContext = '\n\nRecent conversation (most recent last, with importance weights):\n'
    for (const turn of history) {
      const roleLabel = turn.role === 'user' ? 'User' : 'Jarvis'
      historyContext += `[weight ${turn.weight.toFixed(1)}] ${roleLabel}: ${turn.content}\n`
    }
  }

  // Build draft context
  let draftContext = ''
  if (activeDraft) {
    draftContext = `\n\nActive draft:\n- Type: ${activeDraft.type}\n- Status: ${activeDraft.status}\n- Content: "${activeDraft.content || '(empty)'}"\n`
  }

  const prompt = `You are classifying the intent of an SMS message to Jarvis, a sassy AI assistant for an organization.

User info:
- Name: ${userName || 'Unknown'}
- Is admin: ${isAdmin}
${historyContext}${draftContext}

Current message: "${currentMessage}"

Classify this message into ONE of these actions:

1. **draft_write** - Creating or editing an announcement draft
   - THE DECISION RULE: the user wants a message DELIVERED to the members. Any delivery verb — send, send out, announce, tell everyone, let everyone know, notify, blast, broadcast, message the group — means draft_write, no matter how the content is phrased
   - Initial requests: "send out an announcement saying X", "make an announcement that X", "let everyone know X", "tell everyone X"
   - Edits to existing drafts: "wait say X instead", "no make it say Y", "actually change it to Z", "make it more casual"
   - Follow-ups providing content when the bot just asked "what do you wanna announce?"
   - A bare fragment with NO verb ("meeting tonight") is NOT a draft request when it arrives cold — broadcasting needs stated intent, so that's chat or knowledge_upload. TWO EXCEPTIONS where a bare fragment IS draft_write: (a) a delivery verb appears ("announce meeting tonight"), or (b) a draft is active / the bot just asked what to announce — then the fragment is the content they're providing
   - draft_write is role-agnostic: non-admins can request announcements too (authorization is enforced elsewhere, not by you)
   - POLL REQUESTS: the poll system was removed. "send a poll asking X" / "ask everyone if X" → draft_write, treating the question as announcement content people can reply to

2. **draft_send** - explicit send confirmations when a draft is ready
   - Must have active draft AND a confirmation: "send", "send it", "yes", "yep", "go", "go ahead", "do it", "ship it", "looks good send it"
   - NOT for: "send out an announcement saying X" (that's draft_write — it has content)
   - NEVER classify as draft_send if there is NO active draft
   - Sending blasts every member — require clear AUTHORIZATION, not mere acknowledgment. A bare "ok" / "k" / "kk" / "sure" / "cool" alone is an acknowledgment → chat. If they want it sent they'll say send/yes/go.

3. **content_query** - Questions seeking information about the org, its events, people, or announcements
   - "when is X", "what's happening", "where is Y", "who is Z", "what is <org term>", "what's on the calendar", "what did you send out", "tell me about X"
   - Includes questions about unfamiliar org terms/acronyms even if you don't recognize them ("what is summons", "when is big little")

4. **capability_query** - Questions about Jarvis itself: what it can do, what it is, how it works
   - "what can you do", "help", "commands", "who are you", "are you a bot", "do you have other functionality"
   - "what is jarvis" / "what is enclave" — Jarvis and Enclave are THIS bot/platform, so questions about them are capability_query, not content_query

5. **knowledge_upload** - Admin RECORDING information for the knowledge base, with NO delivery verb
   - Bare declarative facts: "ski retreat is jan 16-19 in utah", "dues are $220 this quarter"
   - If there is ANY instruction to send/tell/announce it, it is draft_write instead
   - ONLY when user is admin (check context)

6. **event_update** - Admin updating existing event details in the records, WITHOUT asking to broadcast it
   - "change ski retreat to jan 20-22", "move chapter meeting to 7pm", "active meeting is at ash's now"
   - If they ask to TELL/NOTIFY/ANNOUNCE the change to people ("notify the group meeting moved"), that's draft_write — the announcement carries the update
   - Explicit modifications to an existing event; ONLY when user is admin

7. **chat** - Everything else
   - Banter, greetings, insults, thanks, goodbyes, venting, personal questions, life advice
   - Personal/meta questions the bot can answer from context: "what's my name", "do you know me"
   - Jokes and philosophy: "what is the meaning of life", "tell me a joke"
   - Follow-up reactions: "did everyone get it", "did that send", "?????", "huh", "lol"
   - Cancellations: "nevermind", "cancel", "scratch that"
   - Requests to stop receiving texts ("remove me from this list") — chat; the responder will point them to STOP

CONTEXT UNDERSTANDING:
- Pay attention to conversation history - if user is editing a draft, recent messages show what they're referring to
- Words like "wait", "no", "actually", "instead" right after a draft was shown signal draft EDITS, not new conversations
- Questions like "tell me about X", "what is X", "when is X" are content_query even if a draft exists
- If a draft exists but the message is a question, it's content_query, NOT draft_write
- Follow-ups about whether an announcement was sent ("did everyone get it", "did that work") are chat, not draft_send
- If there is NO active draft, "send" or bare "yes" is chat, NOT draft_send
- After the bot asked "what do you wanna announce?", the next message with content is draft_write (they're answering)
- Use the weighted history (higher weight = more recent/relevant)

EXAMPLES (from real conversations — learn the pattern, not the exact words):
- "Send out an announcement saying jarvis is king" → draft_write (delivery verb + content)
- "let everyone know meeting is cancelled" → draft_write (delivery verb; NOT knowledge_upload)
- "can you announce that henry is ascending" → draft_write
- "send out a poll asking if people want a boat party this year" → draft_write (polls retired; becomes an announcement)
- "make it more clever and conversational and warm" (draft active) → draft_write (edit)
- "Change it to say IM soccer is monday at 8pm" (draft active) → draft_write (edit)
- "send" (draft ready) → draft_send
- "yes" (draft ready, bot just showed the draft) → draft_send
- "ok" (draft ready) → chat (acknowledgment, not send authorization — they'll say send when ready)
- "yes" (no draft) → chat
- "notify the group meeting moved to thursday" → draft_write (delivery verb — the announcement carries the update; NOT event_update)
- "When is creatathon" → content_query
- "what is sep" → content_query (org term)
- "What did you just send out" → content_query
- "whats going on" → content_query (asking what's happening)
- "what's the calendar looking like" → content_query
- "When is study hall. When are the recurring events" → content_query
- "meeting moved to thursday at 7pm" (admin, no send verb) → knowledge_upload
- "ski retreat is jan 16-19 in utah" (admin) → knowledge_upload
- "What's my name" → chat (bot knows this from context)
- "can u give me dating advice" → capability_query or chat (asking what the bot can do → capability_query; venting/asking for the advice itself → chat)
- "yo do u have any other functionality" → capability_query
- "Fuck u bitch ass clanker" → chat (insult — the responder claps back)
- "Please remove me from SMS list thanks!" → chat
- "Bro my flight is getting canceled again" → chat
- "cancel" → chat (cancellation)
- "what is enclave" → capability_query (that's this platform)
- "12345" / "asdfghjkl" / "👍👍👍" → chat (noise)
- "meeting tonight" (bare fragment, no verb, no draft active) → chat or knowledge_upload — NEVER draft_write
- "announce meeting tonight" (same words + delivery verb, any user) → draft_write
- "meeting tonight at 7" (draft active, bot just asked "what would you like to announce?") → draft_write (they're answering with the content)

Respond with JSON only:
{
  "action": "draft_write" | "draft_send" | "content_query" | "capability_query" | "knowledge_upload" | "event_update" | "chat",
  "confidence": 0.0-1.0,
  "subtype": "announcement" | null,
  "reasoning": "brief explanation including context used"
}`

  return prompt
}

/**
 * Call LLM for classification using OpenAI
 */
async function callLLMClassifier(prompt: string): Promise<ClassificationResult> {
  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    
    console.log('[Classifier] Calling OpenAI for intent classification...')
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // fast + cheap for routing
      messages: [
        { 
          role: 'system', 
          content: 'You are a precise intent classifier. Always respond with valid JSON.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1, // routing should be stable, not creative
      response_format: { type: 'json_object' }
    })
    
    const content = response.choices[0].message.content
    if (!content) {
      console.error('[Classifier] LLM returned empty response')
      return {
        action: 'chat',
        confidence: 0.5,
        reasoning: 'LLM returned empty response'
      }
    }
    
    const json = JSON.parse(content)
    
    return {
      action: json.action || 'chat',
      confidence: json.confidence || 0.5,
      subtype: json.subtype || undefined,
      reasoning: json.reasoning || 'LLM classification'
    }
  } catch (error) {
    console.error('[Classifier] LLM classification error:', error)
    // Fallback to chat on error
    return {
      action: 'chat',
      confidence: 0.5,
      reasoning: `LLM error: ${error instanceof Error ? error.message : 'unknown'}`
    }
  }
}

// ============================================
// MAIN CLASSIFICATION FUNCTION
// ============================================

/**
 * Classify user intent with weighted conversation context
 * LLM-first approach for better context understanding
 */
export async function classifyIntent(context: ClassificationContext): Promise<ClassificationResult> {
  const { activeDraft } = context

  // Everything routes through the LLM — no regex fast-paths (they miss phrasing
  // variants). The prompt carries few-shot examples from real conversations.
  const prompt = buildClassificationPrompt(context)
  const llmResult = await callLLMClassifier(prompt)

  // Safety net, not routing: sending a broadcast with no draft is impossible, so a
  // stray draft_send (e.g. for a bare "yes" with nothing staged) becomes chat
  if (llmResult.action === 'draft_send' && !activeDraft) {
    return {
      action: 'chat',
      confidence: llmResult.confidence,
      reasoning: 'Downgraded draft_send: no active draft'
    }
  }

  return llmResult
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Check if message looks like a question
 */
export function looksLikeQuestion(message: string): boolean {
  const lower = message.toLowerCase().trim()
  
  // Ends with question mark
  if (lower.endsWith('?')) return true
  
  // Starts with question words
  if (/^(what|when|where|who|why|how|is|are|can|do|does|will|should)\b/i.test(lower)) {
    return true
  }
  
  return false
}

/**
 * Check if message looks like a command/imperative
 */
export function looksLikeCommand(message: string): boolean {
  const lower = message.toLowerCase().trim()
  
  // Starts with command verbs
  return /^(send|make|create|start|tell|ask|announce|poll|cancel|delete|stop)\b/i.test(lower)
}

/**
 * Check if message is very short (likely a response, not a new intent)
 */
export function isShortResponse(message: string): boolean {
  return message.trim().length <= 20
}


/**
 * Extract announcement content from message (fallback when LLM unavailable)
 */
export function extractContent(message: string, _type?: DraftType): string {
  let content = message.trim()

  // Handle edit signals first (wait, no, actually, etc.)
  const editPatterns = [
    /^(wait|no|nah|nvm),?\s+(just\s+)?say\s+/i,
    /^(wait|no|nah|actually),?\s+/i,
    /^just\s+say\s+/i,
    /^make\s+it\s+(say|be)\s+/i,
    /^change\s+it\s+to\s+/i,
    /^(it\s+should\s+say|it\s+should\s+be)\s+/i
  ]

  for (const pattern of editPatterns) {
    content = content.replace(pattern, '')
  }

  // Remove command prefixes
  content = content.replace(/^announce(ment)?\s+(saying|that)\s+/i, '')
  content = content.replace(/^(send|make|create)(\s+out)?\s+(an?\s+)?announcement\s+(saying|that)\s+/i, '')
  content = content.replace(/^(send|make|create)(\s+out)?\s+(an?\s+)?announcement\s+/i, '')
  content = content.replace(/^announce(ment)?\s+/i, '')
  content = content.replace(/^(tell|notify|let)\s+(everyone|people|all|the group|everybody)\s*(about|that)?\s*/i, '')

  return content.trim()
}
