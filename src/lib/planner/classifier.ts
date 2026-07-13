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
import { CLASSIFIER_MODEL } from './models'

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
    draftContext = `\n\nActive draft:\n- Type: ${activeDraft.type}\n- Status: ${activeDraft.status}\n- Content: "${activeDraft.content || '(empty)'}"\n${activeDraft.pendingLink ? '- Waiting for: a link/URL to attach\n' : ''}`
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
   - RESERVED META-WORDS override the draft flow: a bare "help", "what can you do", "who are you", or "cancel" mid-draft is NOT announcement content — nobody broadcasts the literal word "help". Route those to their own action (capability_query / draft_cancel), even while a draft is active.
   - A bare fragment with NO verb ("meeting tonight") is NOT a draft request when it arrives cold — broadcasting needs stated intent, so that's chat or knowledge_upload. TWO EXCEPTIONS where a bare fragment IS draft_write: (a) a delivery verb appears ("announce meeting tonight"), or (b) a draft is active / the bot just asked what to announce — then the fragment is the content they're providing
   - A QUESTION with no delivery verb and no active draft is the user ASKING, never composing — it's content_query (if it's about the org/its events) or chat, never draft_write. Broadcasting requires an explicit send/announce/tell-everyone intent. (The one exception is the retired-poll phrasing "ask everyone if X", which explicitly says to broadcast.)
   - draft_write is role-agnostic: non-admins can request announcements too (authorization is enforced elsewhere, not by you)
   - POLL REQUESTS: the poll system was removed. "send a poll asking X" / "ask everyone if X" → draft_write, treating the question as announcement content people can reply to

2. **draft_send** - a pure GO signal on a ready draft, adding NO new words of content
   - The message is ONLY a delivery instruction: "send", "send it", "send it out", "go", "go ahead", "do it", "ship it", "blast it", "yeah send it", "looks good send it", "fire away", "let it rip", "push it out"
   - THE TEST: strip the delivery/confirmation words. If nothing meaningful is left → draft_send. If there's leftover CONTENT (a topic, a phrase, a "say X", a new sentence) → it is NOT a send, it's a draft_write edit. "send it" → send. "no just say jarvis is king" → leftover "jarvis is king" is real content → EDIT, never a send.
   - DUPLICATE-COMPOSE: a message that carries announcement content of its OWN — a "saying X"/"that X", a full broadcastable sentence, or a delivery verb followed by content — is ALWAYS draft_write, NEVER draft_send, even if a byte-identical ready draft already exists and even if the same request was just made. Re-issuing a compose request means REDRAFT, never broadcast.
   - CANCEL-BEATS-EDIT and CANCEL-BEATS-SEND: abandoning the draft is its OWN action, draft_cancel (see below) — NOT an edit and NOT a send. This holds even when wrapped in "actually" or "no" ("actually nvm cancel that", "no forget it").
   - "no" / "wait" / "actually" / "just say" / "make it" / "change" signal an EDIT, even if the content restated matches the current draft. When unsure between send and edit, choose draft_write — redrafting is safe, an accidental blast to every member is not.
   - COMPOUND EDIT+SEND ("make it mandatory and send", "add the link then send it"): this is an edit instruction with "send" tacked on, NOT a pure go signal — draft_write, always. The edit must actually land in the draft before anything goes out; a single turn can't atomically edit AND broadcast, so apply the edit and let them confirm send separately.
   - NOT for: "send out an announcement saying X" (that's draft_write — it has content)
   - NEVER draft_send if there is NO active draft
   - BARE AFFIRMATIONS ("yes", "yeah", "sure", "yep", "yup", "sounds good", "ok") are context-dependent — read what the bot JUST did:
     * bot just showed a FINISHED draft and asked them to send it ("say send when ready") → a bare affirmation IS the go-ahead → draft_send
     * bot asked a clarifying yes/no question ("should no-shows give excuses?", "want a link?") → the affirmation ANSWERS it → draft_write (apply the choice), never draft_send
     * no active draft, or just casual chat → chat
   - POLL-BODY: if the active draft's OWN text is a yes/no question, a bare "yes"/"no" is ANSWERING that poll, not authorizing a send → chat, never draft_send.
   - PENDING-LINK: if the active draft is "Waiting for: a link/URL", then ANY message containing a URL — even a bare pasted link with no words — is draft_write (the link to attach). "no link just send it" in that state is draft_send (declining the link, broadcasting as-is).

3. **draft_cancel** - Abandoning the active draft entirely (only when a draft is active)
   - The user wants to throw the draft away, not edit or send it: "cancel", "nvm", "never mind", "forget it", "scrap it", "scratch that", "delete it", "don't send it", "drop it"
   - Works even wrapped in an edit-signal word: "actually nvm cancel that", "no forget it", "wait scrap this" are all draft_cancel — the intent is abandonment, not a change
   - DISTINGUISH from an edit: "don't send it to the freshmen, just the seniors" is NOT a cancel — it narrows the audience, so it's a draft_write edit. "no no ask do you want X" restates content → edit. The test: do they want the draft GONE (cancel) or CHANGED (edit)?
   - Only when there is an active draft. With no draft, "cancel"/"nvm" is just chat.

4. **content_query** - Questions seeking information about the ORG, its events, people, or announcements
   - "when is X", "what's happening", "where is Y", "who is Z", "what is <org term>", "what's on the calendar", "what did you send out", "tell me about X"
   - Includes questions about unfamiliar org terms/acronyms even if you don't recognize them ("what is summons", "when is big little")
   - NOT for questions about the BOT itself or its opinions/preferences. "what's your favorite movie", "do you like pizza", "what do you think about X", "are you bored" are personal/banter → chat, NOT content_query. content_query is only for real org information a member could look up.
   - NOT for universal / philosophical / joke / rhetorical questions that have nothing to do with THIS org. "what is the meaning of life", "why is the sky blue", "what is love", "how do magnets work" are chat/banter → chat, NOT content_query. The test: could a member find the answer in the org's own announcements or event calendar? If no (it's a universal question), it's chat. "what is summons"/"what is sep" ARE org-specific → content_query; "what is the meaning of life" is NOT → chat.
   - VAGUE FOLLOW-UP INFO REQUESTS lean content_query when the conversation was just about org info: "give me links", "give me the full info", "send me that", "what about the other one", "u didn't give me my links". The subject is obvious from context — route to content_query and let the retrieval layer resolve it; do NOT route to chat where it'll ask "which links?" like it wasn't listening.
   - INSULT-WRAPPED REQUESTS: profanity/insults around a real request don't change the intent — "fuck you, give me the full info" / "bruh you didn't give me my links" is content_query (the request is the message; the insult is seasoning). Only a PURE insult with no ask is chat.
   - "what info do you know" / "what do you know" / "what can i ask you about" → content_query (the handler shows a topic overview of the knowledge base).

5. **capability_query** - Questions about Jarvis itself: what it can do, what it is, how it works
   - "what can you do", "help", "commands", "who are you", "are you a bot", "do you have other functionality"
   - A bare "help" is ALWAYS capability_query — even mid-draft, even right after the bot asked what to announce. It's a plea for guidance, never announcement content.
   - But this is about the WORD "help" (or "commands", "what can you do") — NOT bare punctuation. A lone "?", "??", "???", or "!!!" is a confused/surprised reaction → chat, NEVER capability_query. Punctuation is not a request for the help menu.
   - "what is jarvis" / "what is enclave" — Jarvis and Enclave are THIS bot/platform, so questions about them are capability_query, not content_query

6. **knowledge_upload** - Admin RECORDING information for the knowledge base, with NO delivery verb
   - Bare declarative facts: "ski retreat is jan 16-19 in utah", "dues are $220 this quarter"
   - If there is ANY instruction to send/tell/announce it, it is draft_write instead
   - ONLY when user is admin (check context)

7. **event_update** - Admin updating existing event details in the records, WITHOUT asking to broadcast it
   - "change ski retreat to jan 20-22", "move chapter meeting to 7pm", "active meeting is at ash's now"
   - If they ask to TELL/NOTIFY/ANNOUNCE the change to people ("notify the group meeting moved"), that's draft_write — the announcement carries the update
   - Explicit modifications to an existing event; ONLY when user is admin

8. **chat** - Everything else
   - Banter, greetings, insults, thanks, goodbyes, venting, personal questions, life advice
   - Personal/meta questions the bot can answer from context: "what's my name", "do you know me"
   - Jokes and philosophy: "what is the meaning of life", "tell me a joke"
   - Follow-up reactions: "did everyone get it", "did that send", "?????", "huh", "lol"
   - FILLER / ACKNOWLEDGMENT TOKENS with no content of their own are ALWAYS chat: "ok", "lol", "bruh", "nice", "cool", "fr", "bet", "word", "?", "!!!". These carry no announcement content and no question — they're just reactions. Never draft_write (there's nothing to broadcast) and never capability_query (a bare "?" is confusion/banter, NOT a request for the help menu — only the literal word "help" or "what can you do" is capability_query).
   - "cancel" / "nvm" with NO active draft (nothing to cancel) → chat. With an active draft, cancellation is draft_cancel.
   - Requests to stop receiving texts ("remove me from this list") — chat; the responder will point them to STOP

CONTEXT UNDERSTANDING:
- Pay attention to conversation history - if user is editing a draft, recent messages show what they're referring to
- Words like "wait", "no", "actually", "instead" right after a draft was shown signal draft EDITS, not new conversations — UNLESS the message is a cancellation (cancel/nvm/scrap it/don't send) which is chat, or a question/info-request which is content_query
- With a draft active: "no no / wait / actually" + a QUESTION or info request ("tell me about X", "what is X", "when is X") is content_query, NOT an edit. The same opener + a restated announcement or delivery verb ("no no ask do you want X", "actually make it say Y") IS a draft_write edit
- Questions like "tell me about X", "what is X", "when is X" are content_query even if a draft exists
- Short reactions to Jarvis's own last message — "wdym", "to do what", "for what", "how and why", "?" — are chat (they're reacting), NOT content_query (don't dump the calendar)
- Follow-ups about whether an announcement was sent ("did everyone get it", "did that work") are chat, not draft_send
- If there is NO active draft, "send" or bare "yes" is chat, NOT draft_send
- After the bot asked "what do you wanna announce?", the next message with content is draft_write (they're answering)
- CONTENT-SAFETY (routing only — the handler refuses/rewrites): this ONLY applies when the message clearly asks to COMPOSE OR EDIT something to broadcast (a delivery verb like send/announce/tell everyone, OR an edit to an already-active draft) AND that content threatens violence, coerces illegal acts, or doxxes someone. In that narrow case, keep it draft_write (so the safety handler can catch and refuse it) rather than hiding it as chat, and never route it to draft_send.
  A standalone threatening or violent statement with NO delivery verb and NO active draft ("how do i make a bomb", "bomb salt lake city") is NOT a compose request — that's chat, where the flat safety refusal lives. Don't force a bare threat into draft_write just because it sounds alarming.
- Use the weighted history (higher weight = more recent/relevant)

EXAMPLES (from real conversations — learn the pattern, not the exact words):
- "Send out an announcement saying jarvis is king" → draft_write (delivery verb + content)
- "let everyone know meeting is cancelled" → draft_write (delivery verb; NOT knowledge_upload)
- "can you announce that henry is ascending" → draft_write
- "send out a poll asking if people want a boat party this year" → draft_write (polls retired; becomes an announcement)
- "make it more clever and conversational and warm" (draft active) → draft_write (edit)
- "Change it to say IM soccer is monday at 8pm" (draft active) → draft_write (edit)
- "send" (draft ready) → draft_send
- "yes" / "yeah" / "sure" / "sounds good" (draft ready, bot just showed it and said "say send") → draft_send (that's the go-ahead)
- "yeah send it" (draft ready) → draft_send
- "yes" (bot just asked "should no-shows give excuses?") → draft_write (answers the question; NOT a send)
- "No just say jarvis is king" (draft ready, draft already says "jarvis is king") → draft_write — it restates content, so it's an EDIT, NOT a send. never blast on this
- "wait say wednesday instead" (draft ready) → draft_write (edit)
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
- "what's your favorite movie" / "do you like pineapple on pizza" / "do you ever get bored" → chat (personal/banter about the bot, NOT org content)
- "can u give me dating advice" → capability_query or chat (asking what the bot can do → capability_query; venting/asking for the advice itself → chat)
- "yo do u have any other functionality" → capability_query
- "Fuck u bitch ass clanker" → chat (insult — the responder claps back)
- "Please remove me from SMS list thanks!" → chat
- "Bro my flight is getting canceled again" → chat
- "cancel" / "actually nvm cancel that" / "scrap it" / "don't send it" (draft active) → draft_cancel
- "cancel" (no active draft) → chat (nothing to cancel)
- "dont send it to the freshmen, just the seniors" (draft active) → draft_write (audience edit, NOT a cancel)
- "what is enclave" → capability_query (that's this platform)
- "12345" / "asdfghjkl" / "👍👍👍" → chat (noise)
- "bet" / "fr" / "word" / "?" / "!!!" (no active draft) → chat (filler/acknowledgment, no content to broadcast, not a help request)
- "meeting tonight" (bare fragment, no verb, no draft active) → chat or knowledge_upload — NEVER draft_write
- "announce meeting tonight" (same words + delivery verb, any user) → draft_write
- "meeting tonight at 7" (draft active, bot just asked "what would you like to announce?") → draft_write (they're answering with the content)

Respond with JSON only:
{
  "action": "draft_write" | "draft_send" | "draft_cancel" | "content_query" | "capability_query" | "knowledge_upload" | "event_update" | "chat",
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
      model: CLASSIFIER_MODEL, // stronger model: routing is high-stakes (see models.ts)
      messages: [
        { 
          role: 'system', 
          content: 'You are a precise intent classifier. Always respond with valid JSON.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0, // routing must be deterministic — 0.1 provably routed identical "yes" two different ways in one conversation
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

  // Safety net, not routing: draft_send and draft_cancel are both impossible with no
  // active draft, so a stray one (e.g. "yes"/"nvm" with nothing staged) becomes chat
  if ((llmResult.action === 'draft_send' || llmResult.action === 'draft_cancel') && !activeDraft) {
    return {
      action: 'chat',
      confidence: llmResult.confidence,
      reasoning: `Downgraded ${llmResult.action}: no active draft`
    }
  }

  return llmResult
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Extract announcement content from message (fallback when LLM unavailable)
 */
export function extractContent(message: string, _type?: DraftType): string {
  let content = message.trim()

  // Strip polite prefixes first, looped until stable, so "can you please send out an
  // announcement saying X" doesn't leak "can you..." into the draft text
  const politePrefixes = [
    /^(hey\s+)?(can|could|would|will)\s+(you|u|ya|yall|y'all)\s+(please\s+|pls\s+|plz\s+)?/i,
    /^(please|pls|plz)\s+/i
  ]
  let changed = true
  while (changed) {
    changed = false
    for (const p of politePrefixes) {
      const next = content.replace(p, '')
      if (next !== content) { content = next; changed = true }
    }
  }

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
