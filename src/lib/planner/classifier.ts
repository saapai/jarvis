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
// PATTERN-BASED FAST PATH (no LLM needed)
// ============================================

interface PatternMatch {
  action: ActionType
  confidence: number
  subtype?: DraftType
}

/**
 * Fast pattern matching for ONLY the most explicit intents
 * Returns null for everything else, triggering LLM classification
 */
function patternMatch(message: string, context: ClassificationContext): PatternMatch | null {
  const lower = message.toLowerCase().trim()
  const { activeDraft } = context

  // ONLY match explicit send commands when draft is ready
  if (activeDraft && activeDraft.status === 'ready') {
    // Ambiguous acks ("ok", "k", "sure") stay on the LLM path, which sees history
    if (/^(send|send it|send it out|go|go ahead|yes|yea|yeah|yep|yup|do it|ship|ship it|yes send it|send now|blast it|lets go|let's go)[.!]*$/i.test(lower)) {
      return { action: 'draft_send', confidence: 0.95 }
    }
  }

  // Explicit broadcast commands with content — unambiguous intent to send.
  // "let everyone know X" / "tell everyone X" read as knowledge_upload to the LLM
  // often enough to be flaky, so pin them here.
  if (!activeDraft && (
    /^announce(ment)?\s+\S/i.test(lower) ||
    /^(tell|let|notify)\s+(everyone|everybody|the group|all|people)\b.+\S/i.test(lower) ||
    /^send\s+(out\s+)?(a\s+|an\s+)?(message|announcement|text|blast)\b/i.test(lower)
  )) {
    return { action: 'draft_write', confidence: 0.95, subtype: 'announcement' }
  }

  // Unmistakable capability queries
  if (/^(help|commands|what can you do\??|who are you\??|how do you work\??|what is (jarvis|enclave)\??|are you a bot\??)$/i.test(lower)) {
    return { action: 'capability_query', confidence: 0.95 }
  }

  // Everything else goes to LLM for context-aware classification
  return null
}

// ============================================
// LLM-BASED CLASSIFICATION
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
   - Initial requests: "send out an announcement saying X", "make an announcement that X"
   - Edits to existing drafts: "wait say X instead", "no make it say Y", "actually change it to Z"
   - Follow-ups providing content when bot asked for it
   - Key: Look for content to send or modifications to existing drafts

2. **draft_send** - ONLY explicit send confirmations when draft is ready
   - Must have active draft AND explicit confirmation: "send", "yes", "go", "send it", "do it"
   - NOT for: "send out an announcement" (that's draft_write)
   - NEVER classify as draft_send if there is NO active draft

3. **content_query** - Questions about organization content
   - "when is X", "what's happening", "where is Y", "who is Z"

4. **capability_query** - Questions about Jarvis itself
   - "what can you do", "help", "how do you work"

5. **knowledge_upload** - Admin sharing factual information to add to knowledge base
   - Examples: "ski retreat is jan 16-19 in utah", "meeting moved to thursday at 7pm"
   - Must be declarative information, not questions or commands
   - ONLY classify as this if user is admin (check context)

6. **event_update** - Admin updating existing event details
   - Examples: "change ski retreat to jan 20-22", "move chapter meeting to 7pm"
   - Explicit modifications to existing events
   - ONLY classify as this if user is admin and referencing an existing event

7. **chat** - Everything else
   - Casual conversation, banter, greetings, insults
   - Follow-up questions like "did everyone get it", "did that send", "?????"
   - Cancellations: "nevermind", "cancel"
   - Confusion, question marks, or reactions to bot messages

CONTEXT UNDERSTANDING:
- Pay attention to conversation history - if user is editing a draft, recent messages show what they're referring to
- Words like "wait", "no", "actually", "instead" signal draft edits, NOT new conversations
- IMPORTANT: Questions like "tell me about X", "what is X", "when is X" are ALWAYS content_query, even if a draft exists
- "Tell me about", "give me info about", "what's the deal with" = content_query (asking for information)
- Only classify as draft_write if user is clearly providing content to send or editing existing draft content
- If draft exists but message is a question, it's content_query, NOT draft_write
- IMPORTANT: Follow-up questions about whether an announcement was sent (e.g. "did everyone get it", "did that work", "did it send") are CHAT, not draft_send
- IMPORTANT: If there is NO active draft, "send" or similar words should be classified as chat, NOT draft_send
- Use the weighted history (higher weight = more recent/relevant)

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
      temperature: 0.3,
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
  const { currentMessage, activeDraft } = context

  // Easter eggs are handled by the chat action — route them there directly so a
  // "content_query" classification can't swallow them
  const { checkForEasterEgg } = await import('./actions/capability')
  if (checkForEasterEgg(currentMessage)) {
    return { action: 'chat', confidence: 0.95, reasoning: 'Easter egg trigger' }
  }

  // Only use pattern matching for super obvious cases (explicit send commands)
  const patternResult = patternMatch(currentMessage, context)

  if (patternResult && patternResult.confidence >= 0.95) {
    return {
      action: patternResult.action,
      confidence: patternResult.confidence,
      subtype: patternResult.subtype,
      reasoning: 'Explicit command match'
    }
  }

  // Use LLM for all other cases (context-aware classification)
  const prompt = buildClassificationPrompt(context)
  const llmResult = await callLLMClassifier(prompt)

  // Deterministic guardrail: the prompt forbids draft_send with no active draft,
  // but the LLM occasionally returns it anyway (e.g. for a bare "yes")
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
