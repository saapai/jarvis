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
 * Fast pattern matching for obvious intents
 * Returns null if no confident match, triggering LLM fallback
 */
function patternMatch(message: string, context: ClassificationContext): PatternMatch | null {
  const lower = message.toLowerCase().trim()
  const { activeDraft, isAdmin } = context
  
  // ============================================
  // SEND COMMANDS (highest priority when draft exists)
  // ============================================
  if (activeDraft && (activeDraft.status === 'ready' || activeDraft.status === 'drafting')) {
    if (/^(send|send it|go|ship|ship it|yes|yep|do it|blast it|fire)$/i.test(lower)) {
      return { action: 'draft_send', confidence: 0.95 }
    }
  }
  
  // ============================================
  // CANCEL/DELETE DRAFT
  // ============================================
  if (activeDraft) {
    if (/^(cancel|nvm|nevermind|never mind|delete|discard|forget it|scratch that)$/i.test(lower)) {
      return { action: 'chat', confidence: 0.9 } // Handle as chat, will clear draft
    }
  }
  
  // ============================================
  // ADMIN: ANNOUNCEMENT INTENT
  // ============================================
  if (isAdmin) {
    // Explicit "announce X" command
    if (/^announce\s+.+/i.test(lower)) {
      return { action: 'draft_write', confidence: 0.95, subtype: 'announcement' }
    }
    
    // "make/send an announcement"
    if (/\b(make|send|create|start)\s+(an?\s+)?announcement\b/i.test(lower)) {
      return { action: 'draft_write', confidence: 0.9, subtype: 'announcement' }
    }
    
    // "tell everyone X" / "let everyone know"
    if (/\b(tell|notify|let)\s+(everyone|people|all|the group|everybody)\b/i.test(lower)) {
      return { action: 'draft_write', confidence: 0.85, subtype: 'announcement' }
    }
    
    // "send out a message"
    if (/\b(send|send out)\s+(a\s+)?(message|text)\s+(to\s+)?(everyone|all|the group)\b/i.test(lower)) {
      return { action: 'draft_write', confidence: 0.85, subtype: 'announcement' }
    }
    
    // "send out a message about X" (without everyone)
    if (/\b(send|send out)\s+(a\s+)?(message|text)\s+(about|for|regarding)\b/i.test(lower)) {
      return { action: 'draft_write', confidence: 0.8, subtype: 'announcement' }
    }
  }
  
  // ============================================
  // ADMIN: POLL INTENT
  // ============================================
  if (isAdmin) {
    // Explicit "poll X" command
    if (/^poll\s+.+/i.test(lower)) {
      return { action: 'draft_write', confidence: 0.95, subtype: 'poll' }
    }
    
    // "make/create/start a poll"
    if (/\b(make|send|create|start)\s+(a\s+)?poll\b/i.test(lower)) {
      return { action: 'draft_write', confidence: 0.9, subtype: 'poll' }
    }
    
    // "ask everyone if/whether"
    if (/\b(ask|asking)\s+(everyone|people|all|the group|everybody)\s+(if|whether|about)\b/i.test(lower)) {
      return { action: 'draft_write', confidence: 0.85, subtype: 'poll' }
    }
    
    // "who's coming to X" - poll intent
    if (/\b(who'?s|who is|who can|who will)\s+(coming|going|attending|free|available)\b/i.test(lower)) {
      return { action: 'draft_write', confidence: 0.8, subtype: 'poll' }
    }
  }
  
  // ============================================
  // CAPABILITY QUERIES (about Jarvis/Enclave)
  // ============================================
  const capabilityPatterns = [
    /\b(what can you do|what do you do|how do you work)\b/i,
    /\b(who are you|what are you|are you a bot|are you ai)\b/i,
    /\b(help|commands|options)\b/i,
    /\bwhat('?s| is) (jarvis|enclave)\b/i,
    /\b(your|jarvis'?s?|enclave'?s?) (capabilities|features|functions)\b/i
  ]
  
  for (const pattern of capabilityPatterns) {
    if (pattern.test(lower)) {
      return { action: 'capability_query', confidence: 0.85 }
    }
  }
  
  // ============================================
  // CONTENT QUERIES (about org stuff)
  // ============================================
  const contentPatterns = [
    /\b(when|what time|where) is\b/i,
    /\b(what'?s|what is) (happening|going on|the plan)\b/i,
    /\b(is there|are there) (a |an )?(meeting|event|active)\b/i,
    /\b(tell me about|info on|details about)\b/i,
    /\bwhat('?s| is) (tonight|today|tomorrow|this week)\b/i
  ]
  
  for (const pattern of contentPatterns) {
    if (pattern.test(lower)) {
      return { action: 'content_query', confidence: 0.8 }
    }
  }
  
  // ============================================
  // CONTEXT-BASED: Awaiting draft input
  // ============================================
  const lastAssistantMsg = context.history.find(h => h.role === 'assistant')?.content?.toLowerCase() || ''
  
  if (activeDraft && activeDraft.status === 'drafting' && !activeDraft.content) {
    // Bot asked for content, user is providing it
    if (
      lastAssistantMsg.includes('what would you like to announce') ||
      lastAssistantMsg.includes('what would you like the announcement to say') ||
      lastAssistantMsg.includes("what's your poll question") ||
      lastAssistantMsg.includes('what do you want to ask')
    ) {
      // Unless it looks like a question or command
      if (!lower.endsWith('?') && !/^(cancel|nvm|help|stop)/i.test(lower)) {
        return { action: 'draft_write', confidence: 0.85, subtype: activeDraft.type }
      }
    }
  }
  
  // ============================================
  // CONTEXT-BASED: Editing existing draft
  // ============================================
  if (activeDraft && activeDraft.status === 'ready') {
    // User might be editing - check for edit indicators
    if (
      /\b(change|edit|update|make it|instead|actually)\b/i.test(lower) ||
      /\bno[,.]?\s+(it should|make it|say)\b/i.test(lower)
    ) {
      return { action: 'draft_write', confidence: 0.8, subtype: activeDraft.type }
    }
  }
  
  // No confident pattern match
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
1. draft_write - Creating or editing an announcement or poll draft
2. draft_send - Sending out an existing draft (only if draft exists and is ready)
3. content_query - Questions about organization content (events, meetings, schedules, people)
4. capability_query - Questions about Jarvis/Enclave capabilities, help requests
5. chat - Casual conversation, banter, insults, greetings, or anything else

Consider:
- The weighted history (higher weight = more relevant context)
- Whether there's an active draft waiting for input or confirmation
- Whether the user is an admin (only admins can create announcements/polls)
- The tone and intent of the message

Respond with JSON only:
{
  "action": "draft_write" | "draft_send" | "content_query" | "capability_query" | "chat",
  "confidence": 0.0-1.0,
  "subtype": "announcement" | "poll" | null,
  "reasoning": "brief explanation"
}`

  return prompt
}

/**
 * Call LLM for classification (placeholder - integrate with actual LLM)
 */
async function callLLMClassifier(prompt: string): Promise<ClassificationResult> {
  // TODO: Integrate with Mistral/OpenAI API
  // For now, return default chat action
  console.log('[Classifier] LLM prompt:', prompt.substring(0, 200) + '...')
  
  // Placeholder: In production, call your LLM here
  // const response = await fetch('https://api.mistral.ai/v1/chat/completions', { ... })
  
  return {
    action: 'chat',
    confidence: 0.5,
    reasoning: 'LLM fallback not yet implemented'
  }
}

// ============================================
// MAIN CLASSIFICATION FUNCTION
// ============================================

/**
 * Classify user intent with weighted conversation context
 * Uses fast pattern matching first, falls back to LLM
 */
export async function classifyIntent(context: ClassificationContext): Promise<ClassificationResult> {
  const { currentMessage } = context
  
  // Try fast pattern matching first
  const patternResult = patternMatch(currentMessage, context)
  
  if (patternResult && patternResult.confidence >= 0.8) {
    return {
      action: patternResult.action,
      confidence: patternResult.confidence,
      subtype: patternResult.subtype,
      reasoning: 'Pattern match'
    }
  }
  
  // Fall back to LLM for ambiguous cases
  const prompt = buildClassificationPrompt(context)
  const llmResult = await callLLMClassifier(prompt)
  
  // If pattern had some match, combine confidence
  if (patternResult) {
    // Use pattern result if LLM is less confident
    if (patternResult.confidence > llmResult.confidence) {
      return {
        action: patternResult.action,
        confidence: patternResult.confidence,
        subtype: patternResult.subtype,
        reasoning: 'Pattern match (LLM less confident)'
      }
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
 * Extract poll/announcement content from message
 */
export function extractContent(message: string, type: DraftType): string {
  let content = message.trim()
  
  if (type === 'announcement') {
    // Remove command prefixes
    content = content.replace(/^announce(ment)?\s*/i, '')
    content = content.replace(/^(send|make|create)\s+(an?\s+)?announcement\s*/i, '')
    content = content.replace(/^(tell|notify|let)\s+(everyone|people|all|the group|everybody)\s*(about|that|to)?\s*/i, '')
  } else if (type === 'poll') {
    // Remove command prefixes
    content = content.replace(/^poll\s*/i, '')
    content = content.replace(/^(send|make|create|start)\s+(a\s+)?poll\s*/i, '')
    content = content.replace(/^(ask|asking)\s+(everyone|people|all|the group|everybody)\s*(if|whether|about)?\s*/i, '')
    
    // Ensure ends with question mark
    if (!content.endsWith('?')) {
      content += '?'
    }
  }
  
  return content.trim()
}

